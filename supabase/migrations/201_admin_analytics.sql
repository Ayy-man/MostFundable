-- Phase 23: daily admin KPI rollups and per-admin layout preferences.
begin;

create function private.admin_kpi_metrics_valid(p_metrics jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text;
begin
  if p_metrics is null or pg_catalog.jsonb_typeof(p_metrics) <> 'object'
     or pg_catalog.octet_length(p_metrics::text) > 4096
     or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_metrics)) <> 8 then
    return false;
  end if;
  foreach v_key in array array[
    'activeUsers', 'operators', 'currentMonitoring', 'trialConversionPct',
    'averageMonthlyPlanCents', 'averageMembershipDays', 'aiUsage',
    'fundedOutcomesCents'
  ] loop
    if not (p_metrics ? v_key)
       or pg_catalog.jsonb_typeof(p_metrics -> v_key) not in ('number', 'null') then
      return false;
    end if;
  end loop;
  return true;
exception
  when others then return false;
end;
$$;

create table public.kpi_rollups (
  scope text not null,
  subject_id text not null,
  day date not null,
  metrics jsonb not null,
  updated_at timestamptz not null default pg_catalog.now(),
  primary key (scope, subject_id, day),
  constraint kpi_rollups_scope_allowed check (scope in ('org', 'member', 'platform')),
  constraint kpi_rollups_subject_shape check (
    (scope = 'platform' and subject_id = 'platform')
    or (scope = 'org' and subject_id ~ '^org:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
    or (scope = 'member' and subject_id ~ '^member:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
  ),
  constraint kpi_rollups_metrics_valid check (private.admin_kpi_metrics_valid(metrics))
);

create index kpi_rollups_subject_day_idx
  on public.kpi_rollups(subject_id, day desc);

create function private.admin_layout_valid(p_layout jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_item jsonb;
  v_seen text[] := array[]::text[];
  v_value text;
begin
  if p_layout is null or pg_catalog.jsonb_typeof(p_layout) <> 'array'
     or pg_catalog.jsonb_array_length(p_layout) not between 1 and 8 then
    return false;
  end if;
  for v_item in select value from pg_catalog.jsonb_array_elements(p_layout) loop
    if pg_catalog.jsonb_typeof(v_item) <> 'string' then return false; end if;
    v_value := v_item #>> '{}';
    if v_value not in (
      'activeUsers', 'operators', 'currentMonitoring', 'trialConversionPct',
      'averageMonthlyPlanCents', 'averageMembershipDays', 'aiUsage',
      'fundedOutcomesCents'
    ) or v_value = any(v_seen) then
      return false;
    end if;
    v_seen := pg_catalog.array_append(v_seen, v_value);
  end loop;
  return true;
exception
  when others then return false;
end;
$$;

create table public.admin_layouts (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  layout jsonb not null,
  updated_at timestamptz not null default pg_catalog.now(),
  constraint admin_layouts_layout_valid check (private.admin_layout_valid(layout))
);

create function public.admin_compute_kpi_metrics(p_scope text, p_subject_id text, p_day date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_member_id uuid;
  v_operators numeric;
  v_monitoring numeric;
  v_plan numeric;
  v_ai numeric;
  v_funded numeric;
begin
  if p_day is null then
    raise exception using errcode = 'P0001', message = 'ADMIN_KPI_DAY_INVALID';
  end if;
  if p_scope = 'platform' and p_subject_id = 'platform' then
    null;
  elsif p_scope = 'org' and p_subject_id ~ '^org:[0-9a-f-]{36}$' then
    v_org_id := pg_catalog.substring(p_subject_id, 5)::uuid;
    if not exists (select 1 from public.orgs where id = v_org_id) then
      raise exception using errcode = 'P0002', message = 'ADMIN_KPI_SUBJECT_NOT_FOUND';
    end if;
  elsif p_scope = 'member' and p_subject_id ~ '^member:[0-9a-f-]{36}$' then
    v_member_id := pg_catalog.substring(p_subject_id, 8)::uuid;
    select profile.org_id into v_org_id from public.profiles profile
    where profile.id = v_member_id and profile.role = 'operator_member';
    if v_org_id is null then
      raise exception using errcode = 'P0002', message = 'ADMIN_KPI_SUBJECT_NOT_FOUND';
    end if;
  else
    raise exception using errcode = 'P0001', message = 'ADMIN_KPI_SUBJECT_INVALID';
  end if;

  select pg_catalog.count(*)::numeric into v_operators
  from public.profiles profile
  where profile.role = 'operator_member'
    and (v_org_id is null or profile.org_id = v_org_id)
    and (v_member_id is null or profile.id = v_member_id);

  select pg_catalog.count(*)::numeric into v_monitoring
  from public.enrollments enrollment
  join public.clients client on client.id = enrollment.client_id
  where enrollment.status = 'active'
    and (v_org_id is null or client.org_id = v_org_id)
    and (v_member_id is null or client.assigned_to = v_member_id);

  select pg_catalog.avg(org.base_price_cents)::numeric into v_plan
  from public.orgs org where v_org_id is null or org.id = v_org_id;

  select pg_catalog.count(*)::numeric into v_ai
  from public.analysis_runs run
  join public.clients client on client.id = run.client_id
  where run.ran_at >= p_day::timestamptz
    and run.ran_at < (p_day + 1)::timestamptz
    and (v_org_id is null or client.org_id = v_org_id)
    and (v_member_id is null or client.assigned_to = v_member_id);

  select coalesce(pg_catalog.sum(outcome.amount_cents), 0)::numeric into v_funded
  from public.outcomes outcome
  join public.clients client on client.id = outcome.client_id
  where outcome.kind = 'approved' and outcome.state = 'counted'
    and outcome.decided_on = p_day
    and (v_org_id is null or client.org_id = v_org_id)
    and (v_member_id is null or client.assigned_to = v_member_id);

  return pg_catalog.jsonb_build_object(
    'activeUsers', null,
    'operators', v_operators,
    'currentMonitoring', v_monitoring,
    'trialConversionPct', null,
    'averageMonthlyPlanCents', v_plan,
    'averageMembershipDays', null,
    'aiUsage', v_ai,
    'fundedOutcomesCents', v_funded
  );
end;
$$;

create function public.admin_upsert_kpi_rollup(p_scope text, p_subject_id text, p_day date)
returns setof public.kpi_rollups
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result public.kpi_rollups;
begin
  insert into public.kpi_rollups (scope, subject_id, day, metrics, updated_at)
  values (
    p_scope,
    p_subject_id,
    p_day,
    public.admin_compute_kpi_metrics(p_scope, p_subject_id, p_day),
    pg_catalog.clock_timestamp()
  )
  on conflict (scope, subject_id, day) do update set
    metrics = excluded.metrics,
    updated_at = excluded.updated_at
  returning * into strict v_result;
  return next v_result;
end;
$$;

create function public.admin_set_layout(p_actor uuid, p_layout jsonb)
returns setof public.admin_layouts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result public.admin_layouts;
begin
  if not exists (
    select 1 from public.profiles actor
    where actor.id = p_actor and actor.role = 'platform_admin'
  ) then
    raise exception using errcode = 'P0001', message = 'ADMIN_LAYOUT_ACTOR_FORBIDDEN';
  end if;
  if not private.admin_layout_valid(p_layout) then
    raise exception using errcode = 'P0001', message = 'ADMIN_LAYOUT_INVALID';
  end if;
  insert into public.admin_layouts (profile_id, layout, updated_at)
  values (p_actor, p_layout, pg_catalog.clock_timestamp())
  on conflict (profile_id) do update set
    layout = excluded.layout,
    updated_at = excluded.updated_at
  returning * into strict v_result;
  return next v_result;
end;
$$;

alter table public.kpi_rollups enable row level security;
alter table public.kpi_rollups force row level security;
alter table public.admin_layouts enable row level security;
alter table public.admin_layouts force row level security;

revoke all on table public.kpi_rollups from public, anon, authenticated;
revoke all on table public.admin_layouts from public, anon, authenticated;
grant select on table public.kpi_rollups to authenticated, service_role;
grant select on table public.admin_layouts to authenticated, service_role;

create policy kpi_rollups_platform_admin_select on public.kpi_rollups
for select to authenticated
using ((select private.auth_app_role()) = 'platform_admin');

create policy admin_layouts_own_select on public.admin_layouts
for select to authenticated
using (
  (select private.auth_app_role()) = 'platform_admin'
  and profile_id = (select private.auth_profile_id())
);

revoke all on function private.admin_kpi_metrics_valid(jsonb) from public;
revoke all on function private.admin_layout_valid(jsonb) from public;
revoke all on function public.admin_compute_kpi_metrics(text, text, date) from public, anon, authenticated;
revoke all on function public.admin_upsert_kpi_rollup(text, text, date) from public, anon, authenticated;
revoke all on function public.admin_set_layout(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.admin_compute_kpi_metrics(text, text, date) to service_role;
grant execute on function public.admin_upsert_kpi_rollup(text, text, date) to service_role;
grant execute on function public.admin_set_layout(uuid, jsonb) to service_role;

commit;
