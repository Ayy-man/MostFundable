-- R4A-03: a deactivated organization walls its affiliate in the owner-context
-- portal views, not only at the route.
--
-- AFF-04 (`.planning/REQUIREMENTS.md:544`) ratifies that a deactivated org walls
-- the affiliate. Migration 274 taught `affiliate_client_view` about disabled
-- profiles and stopped there; neither it nor `org_brand_view` ever mentioned
-- `orgs.membership`. Both views are owner-context (`security_barrier`, not
-- `security_invoker`) because affiliates deliberately hold no base-table grants,
-- so base-table RLS cannot supply the check and the route's 402 is bypassed by a
-- direct Data API read with the same still-valid JWT.
--
-- The affiliate's organization is the tenant that pays, and
-- `private.validate_affiliate_client_share` already forces the shared client into
-- that same organization, so the single membership predicate covers both sides of
-- the share. `security_barrier = true` is restated deliberately.
--
-- `org_brand_view`'s consumer arm is left alone: TEN-04 keeps consumers unwalled,
-- and a consumer losing their operator's brand mid-session is different,
-- unratified behaviour.

create or replace view public.affiliate_client_view
with (security_barrier = true)
as
select
  client.started_at,
  client.stage,
  client.funded_amount_cents,
  share.expected_commission_cents,
  share.payment_status
from public.clients as client
join public.affiliate_client_shares as share on share.client_id = client.id
join public.affiliates as affiliate on affiliate.id = share.affiliate_id
join public.orgs as organization on organization.id = affiliate.org_id
where (select private.auth_app_role()) = 'affiliate'
  and affiliate.profile_id = (select auth.uid())
  and organization.membership <> 'deactivated'::public.org_membership;

comment on view public.affiliate_client_view is
  'Disabled-aware, deactivation-aware owner-context affiliate projection; base tables remain unavailable to the shared authenticated role.';

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
where organization.id = (select private.auth_org_id())
  and (
    (select private.auth_app_role()) = 'consumer'::public.app_role
    or (
      (select private.auth_app_role()) = 'affiliate'::public.app_role
      and organization.membership <> 'deactivated'::public.org_membership
    )
  );

comment on view public.org_brand_view is
  'Five-column brand projection for consumers and affiliates; the affiliate arm is walled by tenant deactivation, the consumer arm is not (TEN-04).';
