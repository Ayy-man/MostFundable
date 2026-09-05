-- Plan engine v2: somewhere to keep the narrative, and a third governed prompt family.
--
-- The rules half produces the plan and the score, which `persist_analysis_result` already stores.
-- This migration adds the second half: `plans.narrative`, written after the plan by the analysis
-- worker once a model has written it and the deterministic checker has approved it.
--
-- `narrative` is nullable and it is meant to stay nullable for some rows. A narrative can fail —
-- the model can time out, the checker can refuse a number it did not recognise — and none of that
-- may cost the consumer their analysis. So the column is an addition to a plan that is already
-- complete without it, and every read has to treat null as "the surface shows its template copy",
-- not as "something went wrong here".
--
-- `attach_plan_narrative` is service-role only for the same reason `persist_analysis_result` is:
-- the writer is a background worker, not a session. It is idempotent by replacement rather than by
-- refusal, because the honest behaviour for a re-run of an analysis is the narrative that matches
-- the plan the re-run produced, and a function that refused the second write would leave a row
-- describing the previous one.

begin;

alter table public.prompts
  drop constraint prompts_key_allowed,
  add constraint prompts_key_allowed check (
    key in ('funding-readiness-plan', 'funding-readiness-narrative', 'support-draft')
  );

alter table public.eval_runs
  drop constraint eval_runs_prompt_key_allowed,
  add constraint eval_runs_prompt_key_allowed check (
    prompt_key in ('funding-readiness-plan', 'funding-readiness-narrative', 'support-draft')
  );

-- The two functions that enumerate the key set in their own bodies. Both are replaced whole rather
-- than patched, because a `create or replace` of an older definition would silently undo whatever
-- the newest migration did to it: `admin_create_prompt_version` is still migration 200's, and
-- `admin_activate_prompt_version` is migration 338's, with the evaluation-identity binding.

create or replace function public.admin_create_prompt_version(
  p_key text,
  p_body text,
  p_fallback_body text,
  p_actor uuid
)
returns setof public.prompts
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_version integer;
  v_result public.prompts;
begin
  if not exists (
    select 1 from public.profiles actor
    where actor.id = p_actor and actor.role = 'platform_admin'
  ) then
    raise exception using errcode = 'P0001', message = 'ADMIN_PROMPT_ACTOR_FORBIDDEN';
  end if;
  if p_key not in ('funding-readiness-plan', 'funding-readiness-narrative', 'support-draft')
     or pg_catalog.length(pg_catalog.btrim(coalesce(p_body, ''))) not between 1 and 50000
     or pg_catalog.length(pg_catalog.btrim(coalesce(p_fallback_body, ''))) not between 1 and 50000 then
    raise exception using errcode = 'P0001', message = 'ADMIN_PROMPT_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('admin.prompt:' || p_key, 0));
  select pg_catalog.max(prompt.version) into v_version
  from public.prompts prompt where prompt.key = p_key;
  if v_version is null then
    insert into public.prompts (key, version, body, active, created_by)
    values (p_key, 1, p_fallback_body, true, p_actor);
    v_version := 1;
  end if;

  insert into public.prompts (key, version, body, active, created_by)
  values (p_key, v_version + 1, p_body, false, p_actor)
  returning * into strict v_result;

  insert into public.audit_log (
    actor_profile_id, action, subject_type, subject_id, meta
  ) values (
    p_actor,
    'admin.prompt.version.created',
    'prompt',
    pg_catalog.md5('admin.prompt:' || p_key)::uuid,
    pg_catalog.jsonb_build_object('from', v_version::text, 'to', v_result.version::text)
  );
  return next v_result;
end;
$fn$;

create or replace function public.admin_activate_prompt_version(
  p_key text,
  p_version integer,
  p_actor uuid,
  p_policy_version text,
  p_reference_dataset_hash text,
  p_driver text,
  p_model text
)
returns table (
  status public.prompt_activation_status,
  reason public.prompt_activation_hold_reason,
  prompt_key text,
  prompt_version integer,
  prompt_body text,
  prompt_active boolean,
  prompt_created_by uuid,
  prompt_created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_prior integer;
  v_result public.prompts;
  v_required text[];
  v_evidence_ready boolean;
begin
  if not exists (
    select 1 from public.profiles actor where actor.id = p_actor and actor.role = 'platform_admin'
  ) then
    raise exception using errcode = 'P0001', message = 'ADMIN_PROMPT_ACTOR_FORBIDDEN';
  end if;
  if p_key not in ('funding-readiness-plan', 'funding-readiness-narrative', 'support-draft')
     or p_version is null or p_version < 1
     or p_policy_version is null or p_policy_version !~ '^[a-z0-9][a-z0-9._-]{0,63}$'
     or p_reference_dataset_hash is null or p_reference_dataset_hash !~ '^sha256:[0-9a-f]{64}$'
     or p_driver not in ('mock', 'openrouter')
     or nullif(btrim(p_model), '') is null or char_length(p_model) > 128 then
    raise exception using errcode = 'P0001', message = 'ADMIN_PROMPT_INVALID';
  end if;

  v_required := case p_key
    when 'funding-readiness-plan' then array['plan.supervisor', 'plan.deterministic']::text[]
    when 'funding-readiness-narrative' then array['narrative.grounding', 'narrative.language']::text[]
    when 'support-draft' then array['support.supervisor', 'support.language', 'support.confidence']::text[]
  end;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('admin.prompt:' || p_key, 0));
  select prompt.version into v_prior
  from public.prompts prompt where prompt.key = p_key and prompt.active for update;
  select prompt.* into v_result
  from public.prompts prompt where prompt.key = p_key and prompt.version = p_version for update;
  if v_result.key is null then
    raise exception using errcode = 'P0002', message = 'ADMIN_PROMPT_NOT_FOUND';
  end if;

  with latest as (
    select distinct on (run.evaluator_key)
      run.evaluator_key,
      run.passed,
      run.policy_version,
      run.reference_dataset_hash,
      run.driver,
      run.model,
      run.eligible,
      run.ran_at
    from public.eval_runs as run
    where run.prompt_key = p_key
      and run.prompt_version = p_version
      and run.evaluator_key = any(v_required)
    order by run.evaluator_key, run.ran_at desc, run.id desc
  )
  select count(*) = pg_catalog.cardinality(v_required)
    and pg_catalog.bool_and(
      latest.passed
      and latest.eligible
      and latest.ran_at >= v_result.created_at
      and latest.policy_version = p_policy_version
      and latest.reference_dataset_hash = p_reference_dataset_hash
      and latest.driver = p_driver
      and latest.model = p_model
    )
  into v_evidence_ready
  from latest;

  if not coalesce(v_evidence_ready, false) then
    return query select
      'held'::public.prompt_activation_status,
      'evaluation_evidence_missing'::public.prompt_activation_hold_reason,
      v_result.key, v_result.version, v_result.body, v_result.active,
      v_result.created_by, v_result.created_at;
    return;
  end if;

  if v_prior is distinct from p_version then
    update public.prompts prompt
    set active = false
    where prompt.key = p_key and prompt.active and prompt.version <> p_version;
    update public.prompts prompt
    set active = true
    where prompt.key = p_key and prompt.version = p_version;

    insert into public.audit_log (
      actor_profile_id, action, subject_type, subject_id, meta
    ) values (
      p_actor,
      'admin.prompt.version.activated',
      'prompt',
      pg_catalog.md5('admin.prompt:' || p_key)::uuid,
      pg_catalog.jsonb_build_object(
        'from', coalesce(v_prior::text, 'none'),
        'to', p_version::text,
        'driver', p_driver,
        'source', p_policy_version
      )
    );
  end if;

  select prompt.* into v_result
  from public.prompts prompt where prompt.key = p_key and prompt.version = p_version;

  return query select
    'activated'::public.prompt_activation_status,
    null::public.prompt_activation_hold_reason,
    v_result.key, v_result.version, v_result.body, v_result.active,
    v_result.created_by, v_result.created_at;
end;
$fn$;

alter table public.plans
  add column if not exists narrative jsonb;

comment on column public.plans.narrative is
  'The model-written narrative for this plan, or null. Null is an ordinary state: a narrative that failed its grounding check is not stored, and the surface falls back to template copy. Nothing here is a fact; the facts are in body.';

-- 16 KB. The narrative is a verdict, four short prose fields and at most ten one-sentence notes,
-- which measures in the low single-digit kilobytes; the bound is the same one `eval_runs.result`
-- carries, and it is here so a defect upstream cannot turn a jsonb column into an unbounded sink.
alter table public.plans
  add constraint plans_narrative_bounded check (
    narrative is null
    or (
      pg_catalog.jsonb_typeof(narrative) = 'object'
      and pg_catalog.octet_length(narrative::text) <= 16384
    )
  );

create function public.attach_plan_narrative(p_analysis_run_id uuid, p_narrative jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_updated integer;
begin
  if p_analysis_run_id is null
     or p_narrative is null
     or pg_catalog.jsonb_typeof(p_narrative) <> 'object'
     or pg_catalog.octet_length(p_narrative::text) > 16384 then
    raise exception using errcode = 'P0001', message = 'PLAN_NARRATIVE_INVALID';
  end if;

  update public.plans as plan
  set narrative = p_narrative
  where plan.analysis_run_id = p_analysis_run_id;
  get diagnostics v_updated = row_count;

  -- False rather than an exception. The caller is a worker whose analysis is already durable, and
  -- an absent plan row means the narrative arrived for something that was never persisted — a
  -- condition to report and swallow, not one to fail a job over.
  return v_updated = 1;
end;
$fn$;

revoke all on function public.attach_plan_narrative(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.attach_plan_narrative(uuid, jsonb) to service_role;

commit;
