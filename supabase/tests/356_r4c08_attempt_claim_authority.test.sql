begin;
set local search_path = public, extensions;

-- 2026-08-18 R4C-08: the dispatch claim carries the same authority the
-- settlement carries, so a withdrawal or a missing identity pass that commits
-- before the provider is reached creates no charge to unwind. On c2df7ae
-- `begin_consumer_subscription_attempt` read only the subscription status and
-- the operation identity, so every refusal below was a provider call.
select plan(9);

insert into public.orgs(id, name, slug) values
  ('35600000-0000-4000-8000-000000000001', 'Attempt authority', 'r4c08-attempt-authority');
insert into public.clients(id, org_id, display_name) values
  ('35600000-0000-4000-8000-000000000002', '35600000-0000-4000-8000-000000000001', 'Attempt client A'),
  ('35600000-0000-4000-8000-000000000012', '35600000-0000-4000-8000-000000000001', 'Attempt client B');
insert into public.consents(id, client_id, kind, text_version, signed_at, ip, esig_ref) values
  ('35600000-0000-4000-8000-000000000003', '35600000-0000-4000-8000-000000000002', 'monitoring', 'monitoring-r4c08', pg_catalog.now(), '127.0.0.1', 'r4c08-a'),
  ('35600000-0000-4000-8000-000000000004', '35600000-0000-4000-8000-000000000002', 'analysis', 'analysis-r4c08', pg_catalog.now(), '127.0.0.1', 'r4c08-a'),
  ('35600000-0000-4000-8000-000000000013', '35600000-0000-4000-8000-000000000012', 'monitoring', 'monitoring-r4c08', pg_catalog.now(), '127.0.0.1', 'r4c08-b'),
  ('35600000-0000-4000-8000-000000000014', '35600000-0000-4000-8000-000000000012', 'analysis', 'analysis-r4c08', pg_catalog.now(), '127.0.0.1', 'r4c08-b');
insert into public.enrollments(id, client_id, status, monitoring_consent_at, analysis_consent_at, esig_doc_id, crs_member_ref) values
  ('35600000-0000-4000-8000-000000000005', '35600000-0000-4000-8000-000000000002', 'enrolled', pg_catalog.now(), pg_catalog.now(), 'r4c08-a', 'member-r4c08-a'),
  ('35600000-0000-4000-8000-000000000015', '35600000-0000-4000-8000-000000000012', 'enrolled', pg_catalog.now(), pg_catalog.now(), 'r4c08-b', 'member-r4c08-b');
insert into public.consumer_subscriptions(
  client_id, enrollment_id, provider, customer_ref, setup_intent_ref, payment_method_ref,
  price_ref, price_cents, status, idempotency_key
) values
  ('35600000-0000-4000-8000-000000000002', '35600000-0000-4000-8000-000000000005', 'mock', 'cus_r4c08a', 'seti_a', 'pm_a', 'price_a', 4900, 'authorized', 'enroll:r4c08:a'),
  ('35600000-0000-4000-8000-000000000012', '35600000-0000-4000-8000-000000000015', 'mock', 'cus_r4c08b', 'seti_b', 'pm_b', 'price_b', 4900, 'authorized', 'enroll:r4c08:b');

-- Identity first: the claim will not dispatch a charge for an unverified person.
select throws_ok(
  $$select public.begin_consumer_subscription_attempt('35600000-0000-4000-8000-000000000005','enroll:r4c08:a')$$,
  '23514', 'ENROLLMENT_IDV_NOT_PASSED',
  'the dispatch claim refuses without a persisted passed IDV session');
insert into public.idv_sessions(enrollment_id, client_id, member_ref, driver, kind, state, max_attempts) values
  ('35600000-0000-4000-8000-000000000005', '35600000-0000-4000-8000-000000000002', 'member-r4c08-a', 'mock', 'sms', 'quiz', 3),
  ('35600000-0000-4000-8000-000000000015', '35600000-0000-4000-8000-000000000012', 'member-r4c08-b', 'mock', 'sms', 'passed', 3);
select throws_ok(
  $$select public.begin_consumer_subscription_attempt('35600000-0000-4000-8000-000000000005','enroll:r4c08:a')$$,
  '23514', 'ENROLLMENT_IDV_NOT_PASSED',
  'an in-progress identity check is refused the same way');
select results_eq(
  $$select operation_state, operation_id from public.consumer_subscriptions
    where enrollment_id = '35600000-0000-4000-8000-000000000005'$$,
  $$values ('none'::text, null::text)$$,
  'a refused claim leaves the operation unclaimed');

-- Analysis withdrawal, the kind migration 330 left to the enqueue to catch.
select lives_ok(
  $$select public.enrollment_revoke_consent('35600000-0000-4000-8000-000000000012','analysis',null)$$,
  'analysis authorization is withdrawn before dispatch');
select throws_ok(
  $$select public.begin_consumer_subscription_attempt('35600000-0000-4000-8000-000000000015','enroll:r4c08:b')$$,
  '23514', 'ENROLLMENT_SUBSCRIPTION_CONSENT_WITHDRAWN',
  'a withdrawn analysis authorization refuses the dispatch claim');
select results_eq(
  $$select operation_state, attempt_provider_subscription_ref, provider_cancel_ref
    from public.consumer_subscriptions where enrollment_id = '35600000-0000-4000-8000-000000000015'$$,
  $$values ('none'::text, null::text, null::text)$$,
  'no provider call means no retained reference and no obligation');

-- The positive arm: a re-grant restores the claim, which then dispatches once.
update public.idv_sessions set state = 'passed', outcome = 'pass'
where enrollment_id = '35600000-0000-4000-8000-000000000005';
select lives_ok(
  $$select public.begin_consumer_subscription_attempt('35600000-0000-4000-8000-000000000005','enroll:r4c08:a')$$,
  'a passed identity check with both authorizations current claims the dispatch');
select results_eq(
  $$select operation_state, operation_id from public.consumer_subscriptions
    where enrollment_id = '35600000-0000-4000-8000-000000000005'$$,
  $$values ('dispatching'::text, 'enroll:r4c08:a'::text)$$,
  'the claim retains the operation identity exactly as before');
select lives_ok(
  $$select public.begin_consumer_subscription_attempt('35600000-0000-4000-8000-000000000005','enroll:r4c08:a')$$,
  'the claim still replays for the same operation');

select * from finish();
rollback;
