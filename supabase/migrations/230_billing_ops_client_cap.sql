-- 230 (renumbered from 180 at the s3b wrap): this file depends on
-- public.client_status and clients.status from migration 190 (Phase 22).
-- Phase 21 executed after Phase 22 merged, so the shared stack applied 190
-- first and hid the ordering; a clean serial replay (CI db-tests, wrap reset)
-- fails at 180 < 190. Renumbering past 220 restores serial replayability.
-- Ownership is unchanged (INTERFACES §4 Phase 21 row annotated).
-- Phase 21: authoritative client-cap enforcement and audited cap raises.

begin;

alter table public.orgs
  add column client_cap integer,
  add constraint orgs_client_cap_nonnegative
    check (client_cap is null or client_cap >= 0);

create or replace function private.billing_guard_client_cap_write()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if new.client_cap is distinct from old.client_cap
    and coalesce(pg_catalog.current_setting('app.billing_client_cap_write', true), 'off') <> 'on'
  then
    raise exception using errcode = '42501', message = 'CLIENT_CAP_WRITE_FORBIDDEN';
  end if;
  return new;
end;
$fn$;

revoke all on function private.billing_guard_client_cap_write() from public;

create trigger orgs_billing_client_cap_guard
before update of client_cap on public.orgs
for each row execute function private.billing_guard_client_cap_write();

create or replace function private.billing_enforce_client_cap()
returns trigger
language plpgsql
set search_path = ''
as $fn$
declare
  v_cap integer;
  v_count integer;
begin
  if new.status <> 'active'::public.client_status then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.org_id::text, 0)
  );

  select organization.client_cap
  into v_cap
  from public.orgs as organization
  where organization.id = new.org_id
  for share;

  if not found then
    return new;
  end if;
  if v_cap is null then
    return new;
  end if;

  select pg_catalog.count(*)::integer
  into v_count
  from public.clients as client
  where client.org_id = new.org_id
    and client.status = 'active'::public.client_status
    and (tg_op = 'INSERT' or client.id <> old.id);

  if v_count >= v_cap then
    raise exception using errcode = 'P0001', message = 'CLIENT_CAP_REACHED';
  end if;

  return new;
end;
$fn$;

revoke all on function private.billing_enforce_client_cap() from public;

create trigger clients_billing_cap_guard
before insert or update of org_id, status on public.clients
for each row execute function private.billing_enforce_client_cap();

create or replace function public.billing_read_client_cap(p_org_id uuid)
returns table(active_count integer, client_cap integer)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_role public.app_role;
  v_org_id uuid;
begin
  if p_org_id is null then
    raise exception using errcode = '22023', message = 'CLIENT_CAP_ORG_INVALID';
  end if;

  if (select auth.role()) = 'authenticated' then
    select profile.role, profile.org_id
    into v_role, v_org_id
    from public.profiles as profile
    where profile.id = (select auth.uid());

    if v_role is null
      or (v_role <> 'platform_admin'::public.app_role and v_org_id is distinct from p_org_id)
    then
      raise exception using errcode = '42501', message = 'CLIENT_CAP_READ_FORBIDDEN';
    end if;
  elsif (select auth.role()) <> 'service_role' then
    raise exception using errcode = '42501', message = 'CLIENT_CAP_READ_FORBIDDEN';
  end if;

  return query
  select
    pg_catalog.count(client.id)::integer,
    organization.client_cap
  from public.orgs as organization
  left join public.clients as client
    on client.org_id = organization.id
   and client.status = 'active'::public.client_status
  where organization.id = p_org_id
  group by organization.id, organization.client_cap;
end;
$fn$;

create or replace function public.billing_raise_client_cap(
  p_org_id uuid,
  p_actor_profile_id uuid,
  p_cap integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_old integer;
begin
  if p_org_id is null or p_actor_profile_id is null or p_cap is null or p_cap <= 0 then
    raise exception using errcode = '22023', message = 'CLIENT_CAP_INVALID';
  end if;

  if not exists (
    select 1
    from public.profiles as actor
    where actor.id = p_actor_profile_id
      and actor.role = 'platform_admin'::public.app_role
  ) then
    raise exception using errcode = '42501', message = 'CLIENT_CAP_PLATFORM_ADMIN_REQUIRED';
  end if;

  select organization.client_cap
  into v_old
  from public.orgs as organization
  where organization.id = p_org_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'CLIENT_CAP_ORG_NOT_FOUND';
  end if;
  if v_old is not null and p_cap <= v_old then
    raise exception using errcode = '22023', message = 'CLIENT_CAP_MUST_INCREASE';
  end if;

  perform pg_catalog.set_config('app.billing_client_cap_write', 'on', true);
  update public.orgs
  set client_cap = p_cap
  where id = p_org_id;
  perform pg_catalog.set_config('app.billing_client_cap_write', 'off', true);

  insert into public.audit_log (
    org_id, client_id, actor_profile_id, action, subject_type, subject_id, occurred_at, meta
  ) values (
    p_org_id, null, p_actor_profile_id, 'billing.client_cap_raised', 'org', p_org_id,
    pg_catalog.now(),
    pg_catalog.jsonb_build_object(
      'from', coalesce(v_old::text, ''),
      'to', p_cap::text
    )
  );

  return pg_catalog.jsonb_build_object(
    'applied', true,
    'org_id', p_org_id,
    'from', v_old,
    'client_cap', p_cap
  );
end;
$fn$;

revoke all on function public.billing_read_client_cap(uuid) from public, anon;
revoke all on function public.billing_raise_client_cap(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.billing_read_client_cap(uuid) to authenticated, service_role;
grant execute on function public.billing_raise_client_cap(uuid, uuid, integer) to service_role;

comment on function public.billing_read_client_cap(uuid) is
  'Reads an organization active-client count and nullable cap without exposing client rows.';
comment on function public.billing_raise_client_cap(uuid, uuid, integer) is
  'Platform-admin-attributed monotonic client-cap change with one audit row.';

commit;
