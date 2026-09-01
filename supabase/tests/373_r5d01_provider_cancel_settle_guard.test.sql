begin;
set local search_path = public, extensions;

-- 2026-08-18 R5D-01: migration 022's settle guard read the resting state instead of the
-- transition, so `consumer_subscription_provider_cancel_completed` raised 23514 on every
-- cancelled enrollment and the migration-354 obligation could never reach zero. Making the
-- residue selectable (372) without this would have re-armed a tuple nobody could ever discharge.
select plan(7);

select is(
  (select enrollment.status::text from public.enrollments as enrollment
   where enrollment.id = 'a5000000-0000-0000-0000-000000000001'),
  'active',
  'the seeded enrollment starts active, so the guard has something to protect'
);

select public.enrollment_cancel_sub('a5000000-0000-0000-0000-000000000001', null, 'consumer_request');

select is(
  (select enrollment.status::text from public.enrollments as enrollment
   where enrollment.id = 'a5000000-0000-0000-0000-000000000001'),
  'cancelled',
  'cancellation leaves the enrollment non-active with the provider reference still on the row'
);

-- The finding, inverted. On `d6ae268` this call raises 23514 from the BEFORE UPDATE guard.
select lives_ok(
  $$select public.consumer_subscription_provider_cancel_completed(
      'a5000000-0000-0000-0000-000000000001',
      (select subscription.provider_cancel_ref from public.consumer_subscriptions as subscription
       where subscription.enrollment_id = 'a5000000-0000-0000-0000-000000000001'))$$,
  'a cancelled subscription can record the completion of its own cancellation obligation'
);

select isnt(
  (select subscription.provider_cancel_completed_at from public.consumer_subscriptions as subscription
   where subscription.enrollment_id = 'a5000000-0000-0000-0000-000000000001'),
  null,
  'the obligation is discharged in the row, not merely reported as discharged'
);

select ok(
  not private.derived_purge_provider_cancel_outstanding('a5000000-0000-0000-0000-000000000001'),
  'the purge selector stops rediscovering an obligation that is now settled'
);

-- The guard is narrowed, never removed: settling under a non-active enrollment still fails.
select throws_ok(
  $$update public.consumer_subscriptions
    set subscription_ref = 'r5d01-new-provider-reference', updated_at = pg_catalog.now()
    where enrollment_id = 'a5000000-0000-0000-0000-000000000001'$$,
  '23514', 'a consumer subscription cannot settle before its enrollment is active',
  'acquiring a different provider reference under a cancelled enrollment is still refused'
);

-- The insert path is untouched: a subscription may not arrive live under an enrollment that has
-- not reached `active`, which is the case migration 022 was written for.
select throws_ok(
  $$insert into public.consumer_subscriptions (enrollment_id, client_id, status, subscription_ref)
    values ('b5000000-0000-0000-0000-000000000001', 'b3000000-0000-0000-0000-000000000001',
            'active', 'r5d01-premature-provider-reference')$$,
  '23514', 'a consumer subscription cannot settle before its enrollment is active',
  'a subscription still cannot arrive live under an enrollment that never activated'
);

select * from finish();
rollback;
