-- Phase 23: governed settings, prompt versions, and evaluator history.
begin;

create function private.admin_setting_valid(p_key text, p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_number numeric;
begin
  if p_key not in (
    'SUPPORT_DRAFT_CONFIDENCE_THRESHOLD',
    'TRIAL_DAYS',
    'OPERATOR_GRACE_DAYS',
    'FORCE_PULL_PRICE_CENTS'
  ) or p_value is null or pg_catalog.jsonb_typeof(p_value) <> 'number' then
    return false;
  end if;

  v_number := (p_value #>> '{}')::numeric;
  if p_key = 'SUPPORT_DRAFT_CONFIDENCE_THRESHOLD' then
    return v_number > 0 and v_number <= 1;
  end if;
  if v_number <> pg_catalog.trunc(v_number) then
    return false;
  end if;
  if p_key in ('TRIAL_DAYS', 'OPERATOR_GRACE_DAYS') then
    return v_number between 1 and 365;
  end if;
  return v_number between 1 and 100000000;
exception
  when others then return false;
end;
$$;

create table public.settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint settings_key_allowed check (key in (
    'SUPPORT_DRAFT_CONFIDENCE_THRESHOLD',
    'TRIAL_DAYS',
    'OPERATOR_GRACE_DAYS',
    'FORCE_PULL_PRICE_CENTS'
  )),
  constraint settings_value_valid check (private.admin_setting_valid(key, value))
);

insert into public.settings (key, value) values
  ('SUPPORT_DRAFT_CONFIDENCE_THRESHOLD', '0.7'::jsonb),
  ('TRIAL_DAYS', '14'::jsonb),
  ('OPERATOR_GRACE_DAYS', '7'::jsonb),
  ('FORCE_PULL_PRICE_CENTS', '1900'::jsonb);

create table public.prompts (
  key text not null,
  version integer not null,
  body text not null,
  active boolean not null default false,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default pg_catalog.now(),
  primary key (key, version),
  constraint prompts_key_allowed check (key in ('funding-readiness-plan', 'support-draft')),
  constraint prompts_version_positive check (version > 0),
  constraint prompts_body_bounded check (
    pg_catalog.length(pg_catalog.btrim(body)) between 1 and 50000
  )
);

create unique index prompts_one_active_per_key
  on public.prompts(key) where active;

create table public.eval_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  prompt_key text not null,
  prompt_version integer not null,
  evaluator_key text not null,
  passed boolean not null,
  result jsonb not null,
  ran_by uuid references public.profiles(id),
  ran_at timestamptz not null default pg_catalog.now(),
  constraint eval_runs_prompt_key_allowed check (
    prompt_key in ('funding-readiness-plan', 'support-draft')
  ),
  constraint eval_runs_prompt_version_positive check (prompt_version > 0),
  constraint eval_runs_evaluator_key_bounded check (
    evaluator_key ~ '^[a-z][a-z0-9._-]{0,63}$'
  ),
  constraint eval_runs_result_bounded check (
    pg_catalog.jsonb_typeof(result) = 'object'
    and pg_catalog.octet_length(result::text) <= 16384
  )
);

create index eval_runs_prompt_ran_at_idx
  on public.eval_runs(prompt_key, prompt_version, ran_at desc);

alter table public.settings enable row level security;
alter table public.settings force row level security;
alter table public.prompts enable row level security;
alter table public.prompts force row level security;
alter table public.eval_runs enable row level security;
alter table public.eval_runs force row level security;

revoke all on table public.settings from public, anon, authenticated;
revoke all on table public.prompts from public, anon, authenticated;
revoke all on table public.eval_runs from public, anon, authenticated;
grant select on table public.settings to authenticated, service_role;
grant select on table public.prompts to authenticated, service_role;
grant select on table public.eval_runs to authenticated, service_role;

create policy settings_platform_admin_select on public.settings
for select to authenticated
using ((select private.auth_app_role()) = 'platform_admin');

create policy prompts_platform_admin_select on public.prompts
for select to authenticated
using ((select private.auth_app_role()) = 'platform_admin');

create policy eval_runs_platform_admin_select on public.eval_runs
for select to authenticated
using ((select private.auth_app_role()) = 'platform_admin');

create function public.admin_set_setting(p_key text, p_value jsonb, p_actor uuid)
returns setof public.settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prior public.settings;
  v_result public.settings;
begin
  if not exists (
    select 1 from public.profiles actor
    where actor.id = p_actor and actor.role = 'platform_admin'
  ) then
    raise exception using errcode = 'P0001', message = 'ADMIN_SETTING_ACTOR_FORBIDDEN';
  end if;
  if not private.admin_setting_valid(p_key, p_value) then
    raise exception using errcode = 'P0001', message = 'ADMIN_SETTING_INVALID';
  end if;

  select setting.* into v_prior
  from public.settings setting where setting.key = p_key for update;
  if v_prior.key is not null and v_prior.value = p_value then
    return next v_prior;
    return;
  end if;

  insert into public.settings (key, value, updated_by, updated_at)
  values (p_key, p_value, p_actor, pg_catalog.clock_timestamp())
  on conflict (key) do update set
    value = excluded.value,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at
  returning * into strict v_result;

  insert into public.audit_log (
    actor_profile_id, action, subject_type, subject_id, meta
  ) values (
    p_actor,
    'admin.setting.set',
    'setting',
    pg_catalog.md5('admin.setting:' || p_key)::uuid,
    pg_catalog.jsonb_build_object(
      'from', coalesce(v_prior.value::text, 'null'),
      'to', v_result.value::text
    )
  );
  return next v_result;
end;
$$;

create function public.admin_create_prompt_version(
  p_key text,
  p_body text,
  p_fallback_body text,
  p_actor uuid
)
returns setof public.prompts
language plpgsql
security definer
set search_path = ''
as $$
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
  if p_key not in ('funding-readiness-plan', 'support-draft')
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
$$;

create function public.admin_activate_prompt_version(p_key text, p_version integer, p_actor uuid)
returns setof public.prompts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prior integer;
  v_result public.prompts;
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

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('admin.prompt:' || p_key, 0));
  select prompt.version into v_prior
  from public.prompts prompt where prompt.key = p_key and prompt.active for update;
  select prompt.* into v_result
  from public.prompts prompt where prompt.key = p_key and prompt.version = p_version for update;
  if v_result.key is null then
    raise exception using errcode = 'P0002', message = 'ADMIN_PROMPT_NOT_FOUND';
  end if;
  if v_prior is distinct from p_version then
    -- Two statements: the partial unique index prompts_one_active_per_key is checked per row,
    -- so a single UPDATE can raise 23505 when the newly-active row is written before the old one clears.
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
      pg_catalog.jsonb_build_object(
        'from', coalesce(v_prior::text, 'null'),
        'to', p_version::text
      )
    );
  end if;
  select prompt.* into strict v_result
  from public.prompts prompt where prompt.key = p_key and prompt.version = p_version;
  return next v_result;
end;
$$;

create function public.admin_record_eval_run(
  p_prompt_key text,
  p_prompt_version integer,
  p_evaluator_key text,
  p_passed boolean,
  p_result jsonb,
  p_actor uuid default null
)
returns setof public.eval_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result public.eval_runs;
begin
  if p_actor is not null and not exists (
    select 1 from public.profiles actor
    where actor.id = p_actor and actor.role = 'platform_admin'
  ) then
    raise exception using errcode = 'P0001', message = 'ADMIN_EVAL_ACTOR_FORBIDDEN';
  end if;
  insert into public.eval_runs (
    prompt_key, prompt_version, evaluator_key, passed, result, ran_by
  ) values (
    p_prompt_key, p_prompt_version, p_evaluator_key, p_passed, p_result, p_actor
  ) returning * into strict v_result;
  return next v_result;
end;
$$;

revoke all on function private.admin_setting_valid(text, jsonb) from public;
revoke all on function public.admin_set_setting(text, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.admin_create_prompt_version(text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.admin_activate_prompt_version(text, integer, uuid) from public, anon, authenticated;
revoke all on function public.admin_record_eval_run(text, integer, text, boolean, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.admin_set_setting(text, jsonb, uuid) to service_role;
grant execute on function public.admin_create_prompt_version(text, text, text, uuid) to service_role;
grant execute on function public.admin_activate_prompt_version(text, integer, uuid) to service_role;
grant execute on function public.admin_record_eval_run(text, integer, text, boolean, jsonb, uuid) to service_role;

commit;
