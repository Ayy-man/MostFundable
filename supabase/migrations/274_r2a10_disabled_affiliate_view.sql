-- R2A-10: the affiliate owner-context projection honors profile disablement.

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
where (select private.auth_app_role()) = 'affiliate'
  and affiliate.profile_id = (select auth.uid());

comment on view public.affiliate_client_view is
  'Disabled-aware owner-context affiliate projection; base tables remain unavailable to the shared authenticated role.';
