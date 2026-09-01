begin;
set local search_path = public, extensions;

-- 2026-08-18 R5D-01: migration 354 hung the provider-cancellation obligation on
-- `purge.derived`; migration 357, one file later, wrote that job's selector out of the CRS
-- member reference and the derived rows alone. A residue that is only a live provider
-- subscription was therefore never selected once, let alone rediscovered after exhaustion.
select plan(8);

create temporary table r5f2_target as
select enrollment.id, enrollment.crs_member_ref
from public.enrollments as enrollment
where enrollment.id = 'a5000000-0000-0000-0000-000000000001';

select is((select pg_catalog.count(*) from r5f2_target), 1::bigint, 'the seeded active enrollment is present');

-- The real cancellation transition records the durable intent (354) and enqueues the tuple.
select public.enrollment_cancel_sub((select id from r5f2_target), null, 'consumer_request');

select isnt(
  (select subscription.provider_cancel_ref
   from public.consumer_subscriptions as subscription
   where subscription.enrollment_id = (select id from r5f2_target)),
  null,
  'cancellation records the provider-cancellation intent'
);

-- Drive the derived graph to empty through the product's own purge, which is exactly what a
-- purge tuple that ran before the provider confirmed leaves behind — and is also the shape of
-- any enrollment that never had a CRS member or a derived graph in the first place.
select public.purge_derived_enrollment(
  (select id from r5f2_target), (select crs_member_ref from r5f2_target));

select ok(
  not private.derived_purge_data_outstanding((select id from r5f2_target)),
  'the 357 data predicate is satisfied: nothing derived is left to clear'
);

select ok(
  private.derived_purge_provider_cancel_outstanding((select id from r5f2_target)),
  'the migration-354 obligation is still open'
);

select isnt(
  public.consumer_subscription_pending_provider_cancel((select id from r5f2_target)),
  'null'::jsonb,
  'the provider subscription is still live and still billing'
);

update public.enrollments
set updated_at = pg_catalog.now() - interval '1 hour'
where id = (select id from r5f2_target);

-- The finding, inverted. On `d6ae268` this count is 0 and the provider keeps charging.
select is(
  (select pg_catalog.count(*)
   from public.list_derived_purge_targets(pg_catalog.now()) as target
   where target.enrollment_id = (select id from r5f2_target)),
  1::bigint,
  'a provider-only cancellation residue is selected for a fresh purge tuple'
);

-- Confirming the provider cancellation is the only thing that retires it, so the selector
-- cannot rediscover an obligation nobody owes.
select public.consumer_subscription_provider_cancel_completed(
  (select id from r5f2_target),
  (select subscription.provider_cancel_ref from public.consumer_subscriptions as subscription
   where subscription.enrollment_id = (select id from r5f2_target)));

select is(
  (select pg_catalog.count(*)
   from public.list_derived_purge_targets(pg_catalog.now()) as target
   where target.enrollment_id = (select id from r5f2_target)),
  0::bigint,
  'a confirmed provider cancellation retires the target instead of rediscovering forever'
);

-- 357's own predicate is extended, never replaced: an enrollment with a derived graph and no
-- provider-cancellation intent is still selected exactly as before.
select public.enrollment_cancel_sub('a5000000-0000-0000-0000-000000000002', null, 'consumer_request');
update public.consumer_subscriptions
set provider_cancel_ref = null, provider_cancel_reason = null,
    provider_cancel_requested_at = null, provider_cancel_completed_at = null
where enrollment_id = 'a5000000-0000-0000-0000-000000000002';
update public.enrollments
set updated_at = pg_catalog.now() - interval '1 hour'
where id = 'a5000000-0000-0000-0000-000000000002';

select is(
  (select pg_catalog.count(*)
   from public.list_derived_purge_targets(pg_catalog.now()) as target
   where target.enrollment_id = 'a5000000-0000-0000-0000-000000000002'),
  (select case when private.derived_purge_data_outstanding('a5000000-0000-0000-0000-000000000002')
            then 1::bigint else 0::bigint end),
  'the data predicate still decides an enrollment with no cancellation intent'
);

select * from finish();
rollback;
