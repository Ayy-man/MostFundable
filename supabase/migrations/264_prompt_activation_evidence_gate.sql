-- R1D-06: prompt activation requires current passing evidence from every mandatory evaluator.

create type public.prompt_activation_status as enum ('activated', 'held');
create type public.prompt_activation_hold_reason as enum ('evaluation_evidence_missing');

drop function public.admin_activate_prompt_version(text, integer, uuid);

create function public.admin_activate_prompt_version(p_key text, p_version integer, p_actor uuid)
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
    select 1 from public.profiles actor
    where actor.id = p_actor and actor.role = 'platform_admin'
  ) then
    raise exception using errcode = 'P0001', message = 'ADMIN_PROMPT_ACTOR_FORBIDDEN';
  end if;
  if p_key not in ('funding-readiness-plan', 'support-draft') or p_version is null or p_version < 1 then
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
      run.passed
    from public.eval_runs as run
    where run.prompt_key = p_key
      and run.prompt_version = p_version
      and run.evaluator_key = any(v_required)
    order by run.evaluator_key, run.ran_at desc, run.id desc
  )
  select count(*) = pg_catalog.cardinality(v_required) and pg_catalog.bool_and(latest.passed)
  into v_evidence_ready
  from latest;

  if not coalesce(v_evidence_ready, false) then
    return query select
      'held'::public.prompt_activation_status,
      'evaluation_evidence_missing'::public.prompt_activation_hold_reason,
      v_result.key,
      v_result.version,
      v_result.body,
      v_result.active,
      v_result.created_by,
      v_result.created_at;
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
      'admin.prompt.activated',
      'prompt',
      pg_catalog.md5('admin.prompt:' || p_key)::uuid,
      pg_catalog.jsonb_build_object('from', coalesce(v_prior::text, 'null'), 'to', p_version::text)
    );
  end if;

  select prompt.* into strict v_result
  from public.prompts prompt where prompt.key = p_key and prompt.version = p_version;
  return query select
    'activated'::public.prompt_activation_status,
    null::public.prompt_activation_hold_reason,
    v_result.key,
    v_result.version,
    v_result.body,
    v_result.active,
    v_result.created_by,
    v_result.created_at;
end;
$fn$;

revoke all on function public.admin_activate_prompt_version(text, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.admin_activate_prompt_version(text, integer, uuid)
  to service_role;
