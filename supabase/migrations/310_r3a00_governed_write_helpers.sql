-- R3A-00: shared primitives for owner-governed writes and stored actor kinds.

create or replace function private.require_governed_write(p_marker text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_owner name;
begin
  select pg_catalog.pg_get_userbyid(relation.relowner)
  into v_owner
  from pg_catalog.pg_class as relation
  where relation.oid = 'public.clients'::regclass;

  if pg_catalog.current_setting('app.' || p_marker, true) is distinct from 'on'
    or current_user <> v_owner
  then
    raise exception using
      errcode = '42501',
      message = 'GOVERNED_WRITE_REQUIRED';
  end if;
end;
$$;

create or replace function private.session_actor_kind(p_profile_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case profile.role
    when 'consumer'::public.app_role then 'consumer'
    when 'operator_member'::public.app_role then 'operator'
    when 'platform_admin'::public.app_role then 'platform_admin'
    else null
  end
  from public.profiles as profile
  where profile.id = p_profile_id
    and profile.disabled_at is null
$$;

revoke all on function private.require_governed_write(text)
  from public, anon, authenticated, service_role;
revoke all on function private.session_actor_kind(uuid)
  from public, anon, authenticated, service_role;
