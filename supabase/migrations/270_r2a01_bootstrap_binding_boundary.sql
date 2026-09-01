-- R2A-01: an unbound authenticated profile cannot self-select a tenant.

drop policy if exists profiles_self_bootstrap_update_lane_a on public.profiles;

create policy profiles_self_bootstrap_update_lane_a
on public.profiles
for update
to authenticated
using (
  id = (select private.auth_profile_id())
  and org_id is null
  and role = 'consumer'
)
with check (
  id = (select private.auth_profile_id())
  and org_id is null
  and role in ('consumer', 'affiliate')
  and org_role is null
);

comment on policy profiles_self_bootstrap_update_lane_a on public.profiles is
  'R2A-01: self-bootstrap may correct only an unbound consumer/affiliate role; tenant binding requires server-controlled signup metadata, invite acceptance, or a service path.';
