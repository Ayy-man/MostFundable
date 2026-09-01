-- Workspace owners and admins can change a live operator member's stored role.
-- The RPC owns the last-owner invariant and audit row so the UI cannot bypass
-- either by calling the Data API directly.

create or replace function public.tenancy_update_member_role(
  p_target_id uuid,
  p_org_role public.org_role,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_target public.profiles;
  v_applied boolean := false;
begin
  select target.* into v_target
  from public.profiles as target
  where target.id = p_target_id
  for update;

  if v_target.id is null
    or v_target.role <> 'operator_member'::public.app_role
    or v_target.disabled_at is not null
    or not private.tenancy_actor_can_manage_org(p_actor_id, v_target.org_id)
  then
    raise exception using errcode = '42501', message = 'TENANT_MEMBER_NOT_FOUND';
  end if;

  if p_org_role is null then
    raise exception using errcode = '22023', message = 'TENANT_MEMBER_ROLE_INVALID';
  end if;

  -- The invariant is organization-wide, so locking only the target profile is
  -- insufficient: two owners can otherwise lock different rows, each observe
  -- the other owner, and both demote. Every role mutation takes this shared
  -- organization lock before reading the active-owner set. A waiter executes
  -- the `not exists` statement below with a fresh READ COMMITTED snapshot after
  -- the first mutation commits, so the second demotion sees the new owner set.
  perform organization.id
  from public.orgs as organization
  where organization.id = v_target.org_id
  for update;

  if v_target.org_role = 'owner'::public.org_role
    and p_org_role <> 'owner'::public.org_role
    and not exists (
      select 1
      from public.profiles as owner_profile
      where owner_profile.org_id = v_target.org_id
        and owner_profile.role = 'operator_member'::public.app_role
        and owner_profile.org_role = 'owner'::public.org_role
        and owner_profile.disabled_at is null
        and owner_profile.id <> v_target.id
    )
  then
    raise exception using errcode = '22023', message = 'TENANT_LAST_OWNER_ROLE_FORBIDDEN';
  end if;

  if v_target.org_role is distinct from p_org_role then
    update public.profiles
    set org_role = p_org_role,
        manages = case
          when p_org_role = 'manager'::public.org_role then manages
          else '{}'::uuid[]
        end
    where id = v_target.id;
    v_applied := true;

    insert into public.audit_log (
      org_id, client_id, actor_profile_id, action, subject_type, subject_id, occurred_at, meta
    ) values (
      v_target.org_id, null, p_actor_id, 'org.member_role_updated', 'profile', v_target.id,
      pg_catalog.clock_timestamp(), pg_catalog.jsonb_build_object(
        'from', v_target.org_role::text,
        'to', p_org_role::text
      )
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'applied', v_applied,
    'org_id', v_target.org_id,
    'profile_id', v_target.id,
    'org_role', p_org_role::text
  );
end;
$fn$;

revoke all on function public.tenancy_update_member_role(uuid, public.org_role, uuid)
  from public, anon, authenticated;
grant execute on function public.tenancy_update_member_role(uuid, public.org_role, uuid)
  to service_role;

comment on function public.tenancy_update_member_role(uuid, public.org_role, uuid) is
  'Service-only operator role mutation. Validates an active owner/admin actor, preserves one active owner, and appends the role transition to audit_log.';
