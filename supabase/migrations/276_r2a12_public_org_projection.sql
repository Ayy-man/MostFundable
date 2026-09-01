-- R2A-12: consumers and affiliates cannot read commercial organization rows.

drop policy if exists orgs_select_authenticated on public.orgs;
drop policy if exists orgs_self_read_lane_a on public.orgs;

create policy orgs_select_authenticated
on public.orgs
for select
to authenticated
using (
  (select private.auth_app_role()) = 'platform_admin'
  or (
    (select private.auth_app_role()) = 'operator_member'
    and id = (select private.auth_org_id())
  )
);

create or replace view public.org_brand_view
with (security_barrier = true)
as
select
  organization.id,
  organization.name,
  organization.slug,
  organization.brand,
  organization.brand_published_at
from public.orgs as organization
where (select private.auth_app_role()) in ('consumer', 'affiliate')
  and organization.id = (select private.auth_org_id());

comment on view public.org_brand_view is
  'Disabled-aware consumer and affiliate organization projection: identity and published-brand state only.';

revoke all on table public.org_brand_view from public, anon, authenticated;
grant select on table public.org_brand_view to authenticated;
