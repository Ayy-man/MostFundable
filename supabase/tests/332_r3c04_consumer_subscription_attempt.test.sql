begin;
set local search_path = public, extensions;

-- 2026-08-17 R3C-04: provider subscription identity survives every local crash seam.
select plan(8);

insert into public.orgs(id, name, slug) values
  ('33200000-0000-4000-8000-000000000001', 'Subscription recovery', 'r3c04-subscription-recovery');
insert into public.clients(id, org_id, display_name) values
  ('33200000-0000-4000-8000-000000000002', '33200000-0000-4000-8000-000000000001', 'Subscription recovery client');
insert into public.consents(id, client_id, kind, text_version, signed_at, ip, esig_ref) values
  ('33200000-0000-4000-8000-000000000003', '33200000-0000-4000-8000-000000000002', 'monitoring', 'monitoring-r3c04', pg_catalog.now(), '127.0.0.1', 'r3c04'),
  ('33200000-0000-4000-8000-000000000004', '33200000-0000-4000-8000-000000000002', 'analysis', 'analysis-r3c04', pg_catalog.now(), '127.0.0.1', 'r3c04');
insert into public.enrollments(id, client_id, status, monitoring_consent_at, analysis_consent_at, esig_doc_id) values
  ('33200000-0000-4000-8000-000000000005', '33200000-0000-4000-8000-000000000002', 'enrolled', pg_catalog.now(), pg_catalog.now(), 'r3c04');
insert into public.consumer_subscriptions(
  client_id, enrollment_id, provider, customer_ref, payment_method_ref, price_ref, price_cents, status, idempotency_key
) values (
  '33200000-0000-4000-8000-000000000002', '33200000-0000-4000-8000-000000000005',
  'mock', 'cus_332', 'pm_332', 'price_332', 4900, 'authorized', 'enroll:332:sub'
);
-- 2026-08-18 R4A-04/R4C-08: the dispatch claim and the settlement gate both
-- require a persisted passed IDV session, so this fixture now carries one.
insert into public.idv_sessions(enrollment_id, client_id, member_ref, driver, kind, state, outcome, max_attempts)
values ('33200000-0000-4000-8000-000000000005', '33200000-0000-4000-8000-000000000002',
  'member-332', 'mock', 'sms', 'passed', 'pass', 3);

select lives_ok(
  $$select public.begin_consumer_subscription_attempt('33200000-0000-4000-8000-000000000005','enroll:332:sub')$$,
  'the server operation is durable before provider dispatch');
select results_eq(
  $$select operation_state, operation_id from public.consumer_subscriptions where enrollment_id='33200000-0000-4000-8000-000000000005'$$,
  $$values ('dispatching'::text, 'enroll:332:sub'::text)$$,
  'dispatching state retains the operation identity');
select lives_ok(
  $$select public.record_consumer_subscription_provider_returned('33200000-0000-4000-8000-000000000005','enroll:332:sub','sub_332',4900,'usd','active')$$,
  'the provider reference is durable before activation');
select results_eq(
  $$select operation_state, attempt_provider_subscription_ref, attempt_provider_amount_cents, attempt_provider_currency, attempt_provider_status from public.consumer_subscriptions where enrollment_id='33200000-0000-4000-8000-000000000005'$$,
  $$values ('provider_returned'::text, 'sub_332'::text, 4900, 'usd'::text, 'active'::text)$$,
  'the exact provider result is retained');
select lives_ok(
  $$select public.record_consumer_subscription_provider_returned('33200000-0000-4000-8000-000000000005','enroll:332:sub','sub_332',4900,'usd','active')$$,
  'the same provider result replays');
select throws_ok(
  $$select public.record_consumer_subscription_provider_returned('33200000-0000-4000-8000-000000000005','enroll:332:sub','sub_other',4900,'usd','active')$$,
  '22023', 'CONSUMER_SUBSCRIPTION_PROVIDER_RESULT_MISMATCH',
  'a second provider reference cannot replace the retained subscription');
select lives_ok(
  $$select public.enrollment_settle_sub('33200000-0000-4000-8000-000000000005',null,'sub_332')$$,
  'the retained provider result settles through the paid activation gate');
select results_eq(
  $$select status, subscription_ref, operation_state from public.consumer_subscriptions where enrollment_id='33200000-0000-4000-8000-000000000005'$$,
  $$values ('active'::text, 'sub_332'::text, 'settled'::text)$$,
  'settlement binds the retained reference exactly once');

select * from finish();
rollback;
