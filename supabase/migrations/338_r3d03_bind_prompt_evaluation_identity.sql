-- R3D-03 — bind prompt evidence to the exact launch evaluation identity.

begin;

alter table public.eval_runs
  add column if not exists reference_dataset_hash text not null default 'legacy-pre-r3d03',
  add column if not exists driver text not null default 'legacy',
  add column if not exists model text not null default 'legacy',
  add column if not exists eligible boolean not null default false;

do $guard$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'eval_runs_reference_dataset_hash_bounded'
      and conrelid = 'public.eval_runs'::regclass
  ) then
    alter table public.eval_runs add constraint eval_runs_reference_dataset_hash_bounded check (
      reference_dataset_hash = 'legacy-pre-r3d03'
      or reference_dataset_hash ~ '^sha256:[0-9a-f]{64}$'
    );
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'eval_runs_driver_closed'
      and conrelid = 'public.eval_runs'::regclass
  ) then
    alter table public.eval_runs add constraint eval_runs_driver_closed check (
      driver in ('legacy', 'mock', 'openrouter')
    );
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'eval_runs_model_bounded'
      and conrelid = 'public.eval_runs'::regclass
  ) then
    alter table public.eval_runs add constraint eval_runs_model_bounded check (
      char_length(model) between 1 and 128 and model = btrim(model)
    );
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'eval_runs_mock_ineligible'
      and conrelid = 'public.eval_runs'::regclass
  ) then
    alter table public.eval_runs add constraint eval_runs_mock_ineligible check (
      not eligible or driver <> 'mock'
    );
  end if;
end;
$guard$;

drop function if exists public.admin_record_eval_run(text, integer, text, boolean, jsonb, text, uuid);
create or replace function public.admin_record_eval_run(
  p_prompt_key text,
  p_prompt_version integer,
  p_evaluator_key text,
  p_passed boolean,
  p_result jsonb,
  p_policy_version text,
  p_reference_dataset_hash text,
  p_driver text,
  p_model text,
  p_eligible boolean,
  p_actor uuid default null
)
returns setof public.eval_runs
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_result public.eval_runs;
begin
  if p_actor is not null and not exists (
    select 1 from public.profiles actor where actor.id = p_actor and actor.role = 'platform_admin'
  ) then
    raise exception using errcode = 'P0001', message = 'ADMIN_EVAL_ACTOR_FORBIDDEN';
  end if;
  if p_policy_version is null or p_policy_version !~ '^[a-z0-9][a-z0-9._-]{0,63}$'
     or p_reference_dataset_hash is null or p_reference_dataset_hash !~ '^sha256:[0-9a-f]{64}$'
     or p_driver not in ('mock', 'openrouter')
     or nullif(btrim(p_model), '') is null or char_length(p_model) > 128
     or p_eligible is null or (p_eligible and p_driver = 'mock') then
    raise exception using errcode = 'P0001', message = 'ADMIN_EVAL_IDENTITY_INVALID';
  end if;

  insert into public.eval_runs (
    prompt_key, prompt_version, evaluator_key, passed, result, policy_version,
    reference_dataset_hash, driver, model, eligible, ran_by
  ) values (
    p_prompt_key, p_prompt_version, p_evaluator_key, p_passed, p_result, p_policy_version,
    p_reference_dataset_hash, p_driver, p_model, p_eligible, p_actor
  ) returning * into strict v_result;

  if p_actor is not null then
    insert into public.audit_log (actor_profile_id, action, subject_type, subject_id, meta)
    values (
      p_actor, 'admin.prompt.evaluated', 'prompt', pg_catalog.md5('admin.prompt:' || p_prompt_key)::uuid,
      pg_catalog.jsonb_build_object(
        'version', p_prompt_version::text,
        'driver', p_driver,
        'status', p_passed::text,
        'source', p_policy_version
      )
    );
  end if;
  return next v_result;
end;
$fn$;

drop function if exists public.admin_activate_prompt_version(text, integer, uuid, text);
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
  if p_key not in ('funding-readiness-plan', 'support-draft')
     or p_version is null or p_version < 1
     or p_policy_version is null or p_policy_version !~ '^[a-z0-9][a-z0-9._-]{0,63}$'
     or p_reference_dataset_hash is null or p_reference_dataset_hash !~ '^sha256:[0-9a-f]{64}$'
     or p_driver not in ('mock', 'openrouter')
     or nullif(btrim(p_model), '') is null or char_length(p_model) > 128 then
    raise exception using errcode = 'P0001', message = 'ADMIN_PROMPT_INVALID';
  end if;

  v_required := case p_key
    when 'funding-readiness-plan' then array['plan.supervisor', 'plan.deterministic']::text[]
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
    update public.prompts prompt set active = false
    where prompt.key = p_key and prompt.active and prompt.version <> p_version;
    update public.prompts prompt set active = true
    where prompt.key = p_key and prompt.version = p_version;
    insert into public.audit_log (actor_profile_id, action, subject_type, subject_id, meta)
    values (
      p_actor, 'admin.prompt.activated', 'prompt', pg_catalog.md5('admin.prompt:' || p_key)::uuid,
      pg_catalog.jsonb_build_object(
        'from', coalesce(v_prior::text, 'null'),
        'to', p_version::text,
        'source', p_policy_version,
        'driver', p_driver
      )
    );
  end if;

  select prompt.* into strict v_result
  from public.prompts prompt where prompt.key = p_key and prompt.version = p_version;
  return query select
    'activated'::public.prompt_activation_status,
    null::public.prompt_activation_hold_reason,
    v_result.key, v_result.version, v_result.body, v_result.active,
    v_result.created_by, v_result.created_at;
end;
$fn$;

revoke all on function public.admin_record_eval_run(
  text, integer, text, boolean, jsonb, text, text, text, text, boolean, uuid
) from public, anon, authenticated;
revoke all on function public.admin_activate_prompt_version(
  text, integer, uuid, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.admin_record_eval_run(
  text, integer, text, boolean, jsonb, text, text, text, text, boolean, uuid
) to service_role;
grant execute on function public.admin_activate_prompt_version(
  text, integer, uuid, text, text, text, text
) to service_role;

commit;
