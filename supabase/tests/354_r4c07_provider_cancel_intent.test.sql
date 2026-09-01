begin;
set local search_path = public, extensions;

-- 2026-08-18 R4C-07: a provider subscription created inside the cancellation
-- window is owed a durable cancellation. On c2df7ae `enrollment_cancel_sub`
-- returned void and the service cancelled whatever its stale pre-cancel
-- snapshot held, so a reference the provider returned afterwards was retained
-- in the attempt columns and never cancelled anywhere.
select plan(14);

insert into public.orgs(id, name, slug) values
  ('35400000-0000-4000-8000-000000000001', 'Cancel intent', 'r4c07-cancel-intent');
insert into public.clients(id, org_id, display_name) values
  ('35400000-0000-4000-8000-000000000002', '35400000-0000-4000-8000-000000000001', 'Cancel intent client A'),
  ('35400000-0000-4000-8000-000000000012', '35400000-0000-4000-8000-000000000001', 'Cancel intent client B');
insert into public.consents(id, client_id, kind, text_version, signed_at, ip, esig_ref) values
  ('35400000-0000-4000-8000-000000000003', '35400000-0000-4000-8000-000000000002', 'monitoring', 'monitoring-r4c07', pg_catalog.now(), '127.0.0.1', 'r4c07-a'),
  ('35400000-0000-4000-8000-000000000004', '35400000-0000-4000-8000-000000000002', 'analysis', 'analysis-r4c07', pg_catalog.now(), '127.0.0.1', 'r4c07-a'),
  ('35400000-0000-4000-8000-000000000013', '35400000-0000-4000-8000-000000000012', 'monitoring', 'monitoring-r4c07', pg_catalog.now(), '127.0.0.1', 'r4c07-b'),
  ('35400000-0000-4000-8000-000000000014', '35400000-0000-4000-8000-000000000012', 'analysis', 'analysis-r4c07', pg_catalog.now(), '127.0.0.1', 'r4c07-b');
insert into public.enrollments(id, client_id, status, monitoring_consent_at, analysis_consent_at, esig_doc_id, crs_member_ref) values
  ('35400000-0000-4000-8000-000000000005', '35400000-0000-4000-8000-000000000002', 'enrolled', pg_catalog.now(), pg_catalog.now(), 'r4c07-a', 'member-r4c07-a'),
  ('35400000-0000-4000-8000-000000000015', '35400000-0000-4000-8000-000000000012', 'enrolled', pg_catalog.now(), pg_catalog.now(), 'r4c07-b', 'member-r4c07-b');
insert into public.consumer_subscriptions(
  client_id, enrollment_id, provider, customer_ref, setup_intent_ref, payment_method_ref,
  price_ref, price_cents, status, idempotency_key
) values
  ('35400000-0000-4000-8000-000000000002', '35400000-0000-4000-8000-000000000005', 'mock', 'cus_r4c07a', 'seti_a', 'pm_a', 'price_a', 4900, 'authorized', 'enroll:r4c07:a'),
  ('35400000-0000-4000-8000-000000000012', '35400000-0000-4000-8000-000000000015', 'mock', 'cus_r4c07b', 'seti_b', 'pm_b', 'price_b', 4900, 'authorized', 'enroll:r4c07:b');
insert into public.idv_sessions(enrollment_id, client_id, member_ref, driver, kind, state, outcome, max_attempts) values
  ('35400000-0000-4000-8000-000000000005', '35400000-0000-4000-8000-000000000002', 'member-r4c07-a', 'mock', 'sms', 'passed', 'pass', 3),
  ('35400000-0000-4000-8000-000000000015', '35400000-0000-4000-8000-000000000012', 'member-r4c07-b', 'mock', 'sms', 'passed', 'pass', 3);

-- Nothing dispatched: cancellation owes the provider nothing.
select is(
  (select public.enrollment_cancel_sub('35400000-0000-4000-8000-000000000005', null, 'consumer_request') ->> 'provider_cancel_ref'),
  null, 'cancelling before any dispatch owes no provider cancellation');
select is(
  (select public.consumer_subscription_pending_provider_cancel('35400000-0000-4000-8000-000000000005') ->> 'subscription_ref'),
  null, 'and the drain has nothing pending to close');

-- Persona B is the reviewer's interleaving: the provider result lands after the
-- local cancellation has already committed.
select lives_ok(
  $$select public.begin_consumer_subscription_attempt('35400000-0000-4000-8000-000000000015','enroll:r4c07:b')$$,
  'the dispatch claim is durable before the provider call');
select is(
  (select public.enrollment_cancel_sub('35400000-0000-4000-8000-000000000015', null, 'consumer_request') ->> 'provider_cancel_ref'),
  null, 'cancelling mid-flight has no reference to cancel yet');
select lives_ok(
  $$select public.record_consumer_subscription_provider_returned(
    '35400000-0000-4000-8000-000000000015','enroll:r4c07:b','sub_late',4900,'usd','active')$$,
  'the late provider result is retained rather than discarded');
select is(
  (select public.enrollment_settle_sub('35400000-0000-4000-8000-000000000015', null, 'sub_late') ->> 'verdict'),
  'cancel_pending', 'settlement on a cancelled enrollment reports the obligation instead of activating');
select results_eq(
  $$select enrollment.status::text, subscription.status, subscription.subscription_ref,
      subscription.provider_cancel_ref, subscription.provider_cancel_reason,
      subscription.provider_cancel_completed_at
    from public.enrollments as enrollment
    join public.consumer_subscriptions as subscription on subscription.enrollment_id = enrollment.id
    where enrollment.id = '35400000-0000-4000-8000-000000000015'$$,
  $$values ('cancelled'::text, 'cancelled'::text, null::text, 'sub_late'::text,
    'enrollment_cancelled'::text, null::timestamptz)$$,
  'the late subscription is never bound as canonical and is owed a cancellation');
select is(
  (select public.consumer_subscription_pending_provider_cancel('35400000-0000-4000-8000-000000000015') ->> 'subscription_ref'),
  'sub_late', 'the drain can read the obligation after a crash');
select is(
  (select count(*) from public.background_jobs
   where job = 'purge.derived' and subject = 'enrollment:35400000-0000-4000-8000-000000000015'),
  1::bigint, 'the obligation is carried by the existing purge.derived tuple, not a new job name');
select is(
  (select public.enrollment_settle_sub('35400000-0000-4000-8000-000000000015', null, 'sub_late') ->> 'reason_code'),
  'enrollment_cancelled', 'a retried settlement repeats the verdict');
select is(
  (select count(*) from public.consumer_subscriptions
   where enrollment_id = '35400000-0000-4000-8000-000000000015'
     and provider_cancel_ref = 'sub_late'),
  1::bigint, 'and records exactly one obligation, not a second');

-- Only the provider's confirmation discharges it, and only for the exact
-- reference the product actually holds.
select is(
  (select public.consumer_subscription_provider_cancel_completed(
    '35400000-0000-4000-8000-000000000015', 'sub_stranger') ->> 'completed'),
  'false', 'confirming a reference the product never owed changes nothing');
select is(
  (select public.consumer_subscription_provider_cancel_completed(
    '35400000-0000-4000-8000-000000000015', 'sub_late') ->> 'completed'),
  'true', 'the provider confirmation discharges the obligation');
select is(
  (select public.consumer_subscription_pending_provider_cancel('35400000-0000-4000-8000-000000000015') ->> 'subscription_ref'),
  null, 'a discharged obligation is no longer pending');

select * from finish();
rollback;
