begin;
set local search_path = public, extensions;

-- 2026-08-18 R4A-04 / R4C-08 (with R4D-02) / R4C-07 / R4C-01: the charge and
-- activation boundary. On c2df7ae `enrollment_settle_sub` reads only the
-- subscription status, the null reference and the enrollment status, so every
-- refusal below is an activation and the two `cancel_pending` verdicts do not
-- exist at all.
select plan(33);

-- Persona A: the ordinary path, used for the IDV precondition and activation.
insert into public.orgs(id, name, slug) values
  ('35500000-0000-4000-8000-000000000001', 'Settlement gate', 'r4a04-settlement-gate');
insert into public.clients(id, org_id, display_name) values
  ('35500000-0000-4000-8000-000000000002', '35500000-0000-4000-8000-000000000001', 'Gate client A'),
  ('35500000-0000-4000-8000-000000000012', '35500000-0000-4000-8000-000000000001', 'Gate client B'),
  ('35500000-0000-4000-8000-000000000022', '35500000-0000-4000-8000-000000000001', 'Gate client C'),
  ('35500000-0000-4000-8000-000000000032', '35500000-0000-4000-8000-000000000001', 'Gate client D');
insert into public.consents(id, client_id, kind, text_version, signed_at, ip, esig_ref) values
  ('35500000-0000-4000-8000-000000000003', '35500000-0000-4000-8000-000000000002', 'monitoring', 'monitoring-r4a04', pg_catalog.now(), '127.0.0.1', 'r4a04-a'),
  ('35500000-0000-4000-8000-000000000004', '35500000-0000-4000-8000-000000000002', 'analysis', 'analysis-r4a04', pg_catalog.now(), '127.0.0.1', 'r4a04-a'),
  ('35500000-0000-4000-8000-000000000013', '35500000-0000-4000-8000-000000000012', 'monitoring', 'monitoring-r4a04', pg_catalog.now(), '127.0.0.1', 'r4a04-b'),
  ('35500000-0000-4000-8000-000000000014', '35500000-0000-4000-8000-000000000012', 'analysis', 'analysis-r4a04', pg_catalog.now(), '127.0.0.1', 'r4a04-b'),
  ('35500000-0000-4000-8000-000000000023', '35500000-0000-4000-8000-000000000022', 'monitoring', 'monitoring-r4a04', pg_catalog.now(), '127.0.0.1', 'r4a04-c'),
  ('35500000-0000-4000-8000-000000000024', '35500000-0000-4000-8000-000000000022', 'analysis', 'analysis-r4a04', pg_catalog.now(), '127.0.0.1', 'r4a04-c'),
  ('35500000-0000-4000-8000-000000000033', '35500000-0000-4000-8000-000000000032', 'monitoring', 'monitoring-r4a04', pg_catalog.now(), '127.0.0.1', 'r4a04-d'),
  ('35500000-0000-4000-8000-000000000034', '35500000-0000-4000-8000-000000000032', 'analysis', 'analysis-r4a04', pg_catalog.now(), '127.0.0.1', 'r4a04-d');
insert into public.enrollments(id, client_id, status, monitoring_consent_at, analysis_consent_at, esig_doc_id, crs_member_ref) values
  ('35500000-0000-4000-8000-000000000005', '35500000-0000-4000-8000-000000000002', 'enrolled', pg_catalog.now(), pg_catalog.now(), 'r4a04-a', 'member-a'),
  ('35500000-0000-4000-8000-000000000015', '35500000-0000-4000-8000-000000000012', 'enrolled', pg_catalog.now(), pg_catalog.now(), 'r4a04-b', 'member-b'),
  ('35500000-0000-4000-8000-000000000025', '35500000-0000-4000-8000-000000000022', 'enrolled', pg_catalog.now(), pg_catalog.now(), 'r4a04-c', 'member-c'),
  ('35500000-0000-4000-8000-000000000035', '35500000-0000-4000-8000-000000000032', 'enrolled', pg_catalog.now(), pg_catalog.now(), 'r4a04-d', 'member-d');
insert into public.consumer_subscriptions(
  client_id, enrollment_id, provider, customer_ref, setup_intent_ref, payment_method_ref,
  price_ref, price_cents, status, idempotency_key
) values
  ('35500000-0000-4000-8000-000000000002', '35500000-0000-4000-8000-000000000005', 'mock', 'cus_a', 'seti_a', 'pm_a', 'price_a', 4900, 'authorized', 'enroll:r4a04:a'),
  ('35500000-0000-4000-8000-000000000012', '35500000-0000-4000-8000-000000000015', 'mock', 'cus_b', 'seti_b', 'pm_b', 'price_b', 4900, 'authorized', 'enroll:r4a04:b'),
  ('35500000-0000-4000-8000-000000000022', '35500000-0000-4000-8000-000000000025', 'mock', 'cus_c', 'seti_c', 'pm_c', 'price_c', 4900, 'authorized', 'enroll:r4a04:c'),
  ('35500000-0000-4000-8000-000000000032', '35500000-0000-4000-8000-000000000035', 'mock', 'cus_d', 'seti_d', 'pm_d', 'price_d', 4900, 'authorized', 'enroll:r4a04:d');
insert into public.idv_sessions(enrollment_id, client_id, member_ref, driver, kind, state, outcome, max_attempts) values
  ('35500000-0000-4000-8000-000000000015', '35500000-0000-4000-8000-000000000012', 'member-b', 'mock', 'sms', 'passed', 'pass', 3),
  ('35500000-0000-4000-8000-000000000025', '35500000-0000-4000-8000-000000000022', 'member-c', 'mock', 'sms', 'passed', 'pass', 3),
  ('35500000-0000-4000-8000-000000000035', '35500000-0000-4000-8000-000000000032', 'member-d', 'mock', 'sms', 'passed', 'pass', 3);

-- R4A-04. Persona A has no IDV row at all, which is the reviewer's exact probe.
select throws_ok(
  $$select public.enrollment_settle_sub('35500000-0000-4000-8000-000000000005', null, 'sub_a')$$,
  '23514', 'ENROLLMENT_IDV_NOT_PASSED',
  'settlement with no IDV session is refused');
select results_eq(
  $$select enrollment.status::text, subscription.status, subscription.subscription_ref,
      (select count(*) from public.enrollment_milestones where client_id = '35500000-0000-4000-8000-000000000002'),
      (select count(*) from public.analysis_jobs where client_id = '35500000-0000-4000-8000-000000000002')
    from public.enrollments as enrollment
    join public.consumer_subscriptions as subscription on subscription.enrollment_id = enrollment.id
    where enrollment.id = '35500000-0000-4000-8000-000000000005'$$,
  $$values ('enrolled'::text, 'authorized'::text, null::text, 0::bigint, 0::bigint)$$,
  'the refusal changes nothing');
select is(public.monitoring_is_authorized('35500000-0000-4000-8000-000000000002'), false,
  'a refused settlement grants no monitoring');

-- Every non-passed IDV state is refused the same way.
insert into public.idv_sessions(enrollment_id, client_id, member_ref, driver, kind, state, max_attempts)
values ('35500000-0000-4000-8000-000000000005', '35500000-0000-4000-8000-000000000002', 'member-a', 'mock', 'sms', 'pending', 3);
select throws_ok(
  format($$update public.idv_sessions set state = %L, locked_until = case when %L = 'locked' then pg_catalog.now() else null end
    where enrollment_id = '35500000-0000-4000-8000-000000000005';
    select public.enrollment_settle_sub('35500000-0000-4000-8000-000000000005', null, 'sub_a')$$,
    unfinished.state, unfinished.state),
  '23514', 'ENROLLMENT_IDV_NOT_PASSED',
  format('IDV state %s cannot settle', unfinished.state))
from (values ('pending'), ('sms_sent'), ('retry'), ('quiz'), ('locked')) as unfinished(state);

-- The positive arm: a genuine pass activates exactly once and replays cleanly.
update public.idv_sessions set state = 'passed', outcome = 'pass', locked_until = null
where enrollment_id = '35500000-0000-4000-8000-000000000005';
select is(
  (select public.enrollment_settle_sub('35500000-0000-4000-8000-000000000005', null, 'sub_a') ->> 'verdict'),
  'settled', 'a passed IDV session settles');
select results_eq(
  $$select enrollment.status::text, subscription.status, subscription.subscription_ref,
      (select count(*) from public.analysis_jobs where client_id = '35500000-0000-4000-8000-000000000002' and source_kind = 'enrollment')
    from public.enrollments as enrollment
    join public.consumer_subscriptions as subscription on subscription.enrollment_id = enrollment.id
    where enrollment.id = '35500000-0000-4000-8000-000000000005'$$,
  $$values ('active'::text, 'active'::text, 'sub_a'::text, 1::bigint)$$,
  'activation binds the reference and creates one analysis tuple');
select is(
  (select public.enrollment_settle_sub('35500000-0000-4000-8000-000000000005', null, 'sub_a') ->> 'reason_code'),
  'replay', 'the exact replay is idempotent');
select is(
  (select count(*) from public.analysis_jobs where client_id = '35500000-0000-4000-8000-000000000002' and source_kind = 'enrollment'),
  1::bigint, 'the replay creates no second analysis tuple');

-- R4C-08 / R4D-02. Persona B revokes monitoring inside the provider window.
-- Migration 330 activated this consumer with `monitoring_is_authorized` false.
select lives_ok(
  $$select public.begin_consumer_subscription_attempt('35500000-0000-4000-8000-000000000015','enroll:r4a04:b')$$,
  'the dispatch claim succeeds while both consents are current');
select lives_ok(
  $$select public.enrollment_revoke_consent('35500000-0000-4000-8000-000000000012','monitoring',null)$$,
  'monitoring is withdrawn while the provider call is in flight');
select lives_ok(
  $$select public.record_consumer_subscription_provider_returned(
    '35500000-0000-4000-8000-000000000015','enroll:r4a04:b','sub_b',4900,'usd','active')$$,
  'the provider result is retained');
select is(
  (select public.enrollment_settle_sub('35500000-0000-4000-8000-000000000015', null, 'sub_b') ->> 'reason_code'),
  'consent_withdrawn', 'settlement refuses to activate and reports the withdrawal');
select results_eq(
  $$select enrollment.status::text, subscription.status, subscription.provider_cancel_ref,
      subscription.provider_cancel_reason, subscription.provider_cancel_completed_at,
      (select count(*) from public.analysis_jobs where client_id = '35500000-0000-4000-8000-000000000012' and source_kind = 'enrollment')
    from public.enrollments as enrollment
    join public.consumer_subscriptions as subscription on subscription.enrollment_id = enrollment.id
    where enrollment.id = '35500000-0000-4000-8000-000000000015'$$,
  $$values ('cancelled'::text, 'cancelled'::text, 'sub_b'::text, 'consent_withdrawn'::text, null::timestamptz, 0::bigint)$$,
  'nothing is granted and exactly one open cancellation obligation exists');
select is(
  (select count(*) from public.background_jobs
   where job = 'purge.derived' and subject = 'enrollment:35500000-0000-4000-8000-000000000015'),
  1::bigint, 'the obligation has a drain tuple');

-- Persona C: analysis instead of monitoring. Migration 330 let the analysis
-- enqueue raise, rolling the local write back while the provider subscription
-- survived with no cancellation path; both consents must behave identically.
select lives_ok(
  $$select public.begin_consumer_subscription_attempt('35500000-0000-4000-8000-000000000025','enroll:r4a04:c')$$,
  'the dispatch claim succeeds for persona C');
select lives_ok($$
  select public.enrollment_revoke_consent('35500000-0000-4000-8000-000000000022','analysis',null);
  select public.record_consumer_subscription_provider_returned(
    '35500000-0000-4000-8000-000000000025','enroll:r4a04:c','sub_c',4900,'usd','active')$$,
  'analysis is withdrawn and the provider result is retained');
select is(
  (select public.enrollment_settle_sub('35500000-0000-4000-8000-000000000025', null, 'sub_c') ->> 'reason_code'),
  'consent_withdrawn', 'the analysis withdrawal produces the same verdict');
select results_eq(
  $$select enrollment.status::text, subscription.provider_cancel_ref, subscription.provider_cancel_reason
    from public.enrollments as enrollment
    join public.consumer_subscriptions as subscription on subscription.enrollment_id = enrollment.id
    where enrollment.id = '35500000-0000-4000-8000-000000000025'$$,
  $$values ('cancelled'::text, 'sub_c'::text, 'consent_withdrawn'::text)$$,
  'the analysis withdrawal leaves the same open obligation');

-- R4C-08 sibling: the dispatch claim itself refuses a withdrawal that commits
-- before the provider is reached, so no charge is created to cancel.
insert into public.orgs(id, name, slug) values
  ('35500000-0000-4000-8000-000000000041', 'Pre-dispatch', 'r4c08-pre-dispatch');
select lives_ok(
  $$select public.enrollment_revoke_consent('35500000-0000-4000-8000-000000000032','monitoring',null)$$,
  'monitoring is withdrawn before dispatch');
select throws_ok(
  $$select public.begin_consumer_subscription_attempt('35500000-0000-4000-8000-000000000035','enroll:r4a04:d')$$,
  '23514', 'ENROLLMENT_SUBSCRIPTION_CONSENT_WITHDRAWN',
  'the dispatch claim refuses before any provider call');
select results_eq(
  $$select operation_state, provider_cancel_ref from public.consumer_subscriptions
    where enrollment_id = '35500000-0000-4000-8000-000000000035'$$,
  $$values ('none'::text, null::text)$$,
  'nothing was dispatched, so nothing is owed');

-- R4C-01. The retained attempt is the only thing settlement may bind, and it
-- must carry the exact governed amount and currency. On c2df7ae settlement
-- read none of these columns, so any provider result bound at any price.
insert into public.clients(id, org_id, display_name) values
  ('35500000-0000-4000-8000-000000000042', '35500000-0000-4000-8000-000000000001', 'Gate client E'),
  ('35500000-0000-4000-8000-000000000052', '35500000-0000-4000-8000-000000000001', 'Gate client F'),
  ('35500000-0000-4000-8000-000000000062', '35500000-0000-4000-8000-000000000001', 'Gate client G');
insert into public.consents(id, client_id, kind, text_version, signed_at, ip, esig_ref) values
  ('35500000-0000-4000-8000-000000000043', '35500000-0000-4000-8000-000000000042', 'monitoring', 'monitoring-r4c01', pg_catalog.now(), '127.0.0.1', 'r4c01-e'),
  ('35500000-0000-4000-8000-000000000044', '35500000-0000-4000-8000-000000000042', 'analysis', 'analysis-r4c01', pg_catalog.now(), '127.0.0.1', 'r4c01-e'),
  ('35500000-0000-4000-8000-000000000053', '35500000-0000-4000-8000-000000000052', 'monitoring', 'monitoring-r4c01', pg_catalog.now(), '127.0.0.1', 'r4c01-f'),
  ('35500000-0000-4000-8000-000000000054', '35500000-0000-4000-8000-000000000052', 'analysis', 'analysis-r4c01', pg_catalog.now(), '127.0.0.1', 'r4c01-f'),
  ('35500000-0000-4000-8000-000000000063', '35500000-0000-4000-8000-000000000062', 'monitoring', 'monitoring-r4c01', pg_catalog.now(), '127.0.0.1', 'r4c01-g'),
  ('35500000-0000-4000-8000-000000000064', '35500000-0000-4000-8000-000000000062', 'analysis', 'analysis-r4c01', pg_catalog.now(), '127.0.0.1', 'r4c01-g');
insert into public.enrollments(id, client_id, status, monitoring_consent_at, analysis_consent_at, esig_doc_id, crs_member_ref) values
  ('35500000-0000-4000-8000-000000000045', '35500000-0000-4000-8000-000000000042', 'enrolled', pg_catalog.now(), pg_catalog.now(), 'r4c01-e', 'member-e'),
  ('35500000-0000-4000-8000-000000000055', '35500000-0000-4000-8000-000000000052', 'enrolled', pg_catalog.now(), pg_catalog.now(), 'r4c01-f', 'member-f'),
  ('35500000-0000-4000-8000-000000000065', '35500000-0000-4000-8000-000000000062', 'enrolled', pg_catalog.now(), pg_catalog.now(), 'r4c01-g', 'member-g');
insert into public.consumer_subscriptions(
  client_id, enrollment_id, provider, customer_ref, setup_intent_ref, payment_method_ref,
  price_ref, price_cents, status, idempotency_key
) values
  ('35500000-0000-4000-8000-000000000042', '35500000-0000-4000-8000-000000000045', 'mock', 'cus_e', 'seti_e', 'pm_e', 'price_e', 4900, 'authorized', 'enroll:r4c01:e'),
  ('35500000-0000-4000-8000-000000000052', '35500000-0000-4000-8000-000000000055', 'mock', 'cus_f', 'seti_f', 'pm_f', 'price_f', 4900, 'authorized', 'enroll:r4c01:f'),
  ('35500000-0000-4000-8000-000000000062', '35500000-0000-4000-8000-000000000065', 'mock', 'cus_g', 'seti_g', 'pm_g', 'price_g', 4900, 'authorized', 'enroll:r4c01:g');
insert into public.idv_sessions(enrollment_id, client_id, member_ref, driver, kind, state, outcome, max_attempts) values
  ('35500000-0000-4000-8000-000000000045', '35500000-0000-4000-8000-000000000042', 'member-e', 'mock', 'sms', 'passed', 'pass', 3),
  ('35500000-0000-4000-8000-000000000055', '35500000-0000-4000-8000-000000000052', 'member-f', 'mock', 'sms', 'passed', 'pass', 3),
  ('35500000-0000-4000-8000-000000000065', '35500000-0000-4000-8000-000000000062', 'member-g', 'mock', 'sms', 'passed', 'pass', 3);

select lives_ok($$
  select public.begin_consumer_subscription_attempt('35500000-0000-4000-8000-000000000045','enroll:r4c01:e');
  select public.record_consumer_subscription_provider_returned(
    '35500000-0000-4000-8000-000000000045','enroll:r4c01:e','sub_e',5900,'usd','active')$$,
  'a provider result at the wrong price is still retained for review');
select throws_ok(
  $$select public.enrollment_settle_sub('35500000-0000-4000-8000-000000000045', null, 'sub_e')$$,
  '23514', 'ENROLLMENT_SUBSCRIPTION_AMOUNT_MISMATCH',
  'an off-price provider result cannot activate paid access');
select results_eq(
  $$select enrollment.status::text, subscription.status, subscription.subscription_ref
    from public.enrollments as enrollment
    join public.consumer_subscriptions as subscription on subscription.enrollment_id = enrollment.id
    where enrollment.id = '35500000-0000-4000-8000-000000000045'$$,
  $$values ('enrolled'::text, 'authorized'::text, null::text)$$,
  'the off-price refusal binds nothing');

select lives_ok($$
  select public.begin_consumer_subscription_attempt('35500000-0000-4000-8000-000000000055','enroll:r4c01:f');
  select public.record_consumer_subscription_provider_returned(
    '35500000-0000-4000-8000-000000000055','enroll:r4c01:f','sub_f',4900,'usd','active')$$,
  'persona F retains its own provider result');
select throws_ok(
  $$select public.enrollment_settle_sub('35500000-0000-4000-8000-000000000055', null, 'sub_stranger')$$,
  '23514', 'ENROLLMENT_SUBSCRIPTION_ATTEMPT_MISMATCH',
  'a reference the server never dispatched cannot be bound');

-- The entry path R4C-01 adds: an `incomplete` first payment at the exact
-- governed price is retryable, so the later paid webhook settles it without
-- lowering any predicate above.
select lives_ok($$
  select public.begin_consumer_subscription_attempt('35500000-0000-4000-8000-000000000065','enroll:r4c01:g');
  select public.record_consumer_subscription_provider_returned(
    '35500000-0000-4000-8000-000000000065','enroll:r4c01:g','sub_g',4900,'usd','incomplete')$$,
  'an exact-price incomplete result is retained');
select is(
  (select public.enrollment_settle_sub('35500000-0000-4000-8000-000000000065', null, 'sub_g') ->> 'verdict'),
  'settled', 'the exact-price incomplete attempt settles when the invoice is paid');
select results_eq(
  $$select enrollment.status::text, subscription.status, subscription.subscription_ref, subscription.operation_state
    from public.enrollments as enrollment
    join public.consumer_subscriptions as subscription on subscription.enrollment_id = enrollment.id
    where enrollment.id = '35500000-0000-4000-8000-000000000065'$$,
  $$values ('active'::text, 'active'::text, 'sub_g'::text, 'settled'::text)$$,
  'the retryable path activates through the same gate, not around it');

select * from finish();
rollback;
