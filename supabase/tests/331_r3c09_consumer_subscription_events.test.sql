begin;
set local search_path = public, extensions;

-- 2026-08-17 R3C-09: consumer billing events converge and terminal states close access.
select plan(11);

insert into public.orgs(id, name, slug) values
  ('33100000-0000-4000-8000-000000000001', 'Consumer event order', 'r3c09-consumer-events');
insert into public.clients(id, org_id, display_name) values
  ('33100000-0000-4000-8000-000000000002', '33100000-0000-4000-8000-000000000001', 'Consumer event client'),
  ('33100000-0000-4000-8000-000000000012', '33100000-0000-4000-8000-000000000001', 'Equal timestamp client'),
  ('33100000-0000-4000-8000-000000000022', '33100000-0000-4000-8000-000000000001', 'Unpaid client');
insert into public.consents(id, client_id, kind, text_version, signed_at, ip, esig_ref) values
  ('33100000-0000-4000-8000-000000000004', '33100000-0000-4000-8000-000000000002', 'monitoring', 'monitoring-r3c09', pg_catalog.now(), '127.0.0.1', 'r3c09-main'),
  ('33100000-0000-4000-8000-000000000005', '33100000-0000-4000-8000-000000000002', 'analysis', 'analysis-r3c09', pg_catalog.now(), '127.0.0.1', 'r3c09-main'),
  ('33100000-0000-4000-8000-000000000014', '33100000-0000-4000-8000-000000000012', 'monitoring', 'monitoring-r3c09', pg_catalog.now(), '127.0.0.1', 'r3c09-equal'),
  ('33100000-0000-4000-8000-000000000015', '33100000-0000-4000-8000-000000000012', 'analysis', 'analysis-r3c09', pg_catalog.now(), '127.0.0.1', 'r3c09-equal'),
  ('33100000-0000-4000-8000-000000000024', '33100000-0000-4000-8000-000000000022', 'monitoring', 'monitoring-r3c09', pg_catalog.now(), '127.0.0.1', 'r3c09-unpaid'),
  ('33100000-0000-4000-8000-000000000025', '33100000-0000-4000-8000-000000000022', 'analysis', 'analysis-r3c09', pg_catalog.now(), '127.0.0.1', 'r3c09-unpaid');
insert into public.enrollments(id, client_id, status, monitoring_consent_at, analysis_consent_at, esig_doc_id) values
  ('33100000-0000-4000-8000-000000000003', '33100000-0000-4000-8000-000000000002', 'active', pg_catalog.now(), pg_catalog.now(), 'r3c09-main'),
  ('33100000-0000-4000-8000-000000000013', '33100000-0000-4000-8000-000000000012', 'active', pg_catalog.now(), pg_catalog.now(), 'r3c09-equal'),
  ('33100000-0000-4000-8000-000000000023', '33100000-0000-4000-8000-000000000022', 'active', pg_catalog.now(), pg_catalog.now(), 'r3c09-unpaid');
insert into public.consumer_subscriptions(
  client_id, enrollment_id, provider, customer_ref, payment_method_ref, subscription_ref,
  price_ref, price_cents, status, idempotency_key
) values
  ('33100000-0000-4000-8000-000000000002', '33100000-0000-4000-8000-000000000003', 'mock', 'cus_331', 'pm_331', 'sub_331', 'price_331', 4900, 'active', 'enroll:331'),
  ('33100000-0000-4000-8000-000000000012', '33100000-0000-4000-8000-000000000013', 'mock', 'cus_331_equal', 'pm_331_equal', 'sub_331_equal', 'price_331', 4900, 'active', 'enroll:331:equal'),
  ('33100000-0000-4000-8000-000000000022', '33100000-0000-4000-8000-000000000023', 'mock', 'cus_331_unpaid', 'pm_331_unpaid', 'sub_331_unpaid', 'price_331', 4900, 'active', 'enroll:331:unpaid');

select is((public.consumer_subscription_apply_event('33100000-0000-4000-8000-000000000003','evt_331_due','invoice.payment_failed','past_due','2026-08-17T01:00:00Z')->>'reason_code'), 'applied', 'active to past due applies');
select results_eq(
  $$select status, last_provider_status from public.consumer_subscriptions where enrollment_id='33100000-0000-4000-8000-000000000003'$$,
  $$values ('active'::text, 'past_due'::text)$$,
  'nonterminal dunning persists without changing access');
select is((public.consumer_subscription_apply_event('33100000-0000-4000-8000-000000000003','evt_331_paid','invoice.paid','active','2026-08-17T02:00:00Z')->>'reason_code'), 'applied', 'past due to active applies');
select is((public.consumer_subscription_apply_event('33100000-0000-4000-8000-000000000003','evt_331_cancel','customer.subscription.deleted','canceled','2026-08-17T03:00:00Z')->>'reason_code'), 'applied', 'active to canceled applies');
select results_eq(
  $$select enrollment.status::text, subscription.status from public.enrollments enrollment join public.consumer_subscriptions subscription on subscription.enrollment_id=enrollment.id where enrollment.id='33100000-0000-4000-8000-000000000003'$$,
  $$values ('cancelled'::text, 'cancelled'::text)$$,
  'terminal cancellation closes the subscription and enrollment atomically');
select is((select count(*) from public.background_jobs where job='purge.derived' and subject='enrollment:33100000-0000-4000-8000-000000000003'), 1::bigint, 'terminal cancellation enqueues derived purge');
select is((public.consumer_subscription_apply_event('33100000-0000-4000-8000-000000000003','evt_331_late','invoice.paid','active','2026-08-17T04:00:00Z')->>'reason_code'), 'terminal_closed', 'late paid event cannot reopen canceled access');

select is((public.consumer_subscription_apply_event('33100000-0000-4000-8000-000000000013','evt_331_equal_a','invoice.payment_failed','past_due','2026-08-17T05:00:00Z')->>'reason_code'), 'applied', 'first equal-time event applies');
select is((public.consumer_subscription_apply_event('33100000-0000-4000-8000-000000000013','evt_331_equal_b','invoice.paid','active','2026-08-17T05:00:00Z')->>'reason_code'), 'equal_timestamp', 'second equal-time event requires a snapshot');
select is((public.consumer_subscription_apply_event('33100000-0000-4000-8000-000000000013','evt_331_equal_b','provider.snapshot','active','2026-08-17T05:00:00Z','provider.snapshot')->>'reason_code'), 'applied', 'authoritative snapshot resolves equal timestamps');
select is((public.consumer_subscription_apply_event('33100000-0000-4000-8000-000000000023','evt_331_unpaid','customer.subscription.updated','unpaid','2026-08-17T06:00:00Z')->>'reason_code'), 'applied', 'terminal unpaid state closes consumer access');

select * from finish();
rollback;
