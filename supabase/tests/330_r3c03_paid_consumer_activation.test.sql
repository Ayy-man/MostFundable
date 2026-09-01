begin;
set local search_path = public, extensions;

-- 2026-08-17 R3C-03: IDV alone cannot authorize paid monitoring or analysis.
-- 2026-08-18 R4A-04: this file used to settle with no `idv_sessions` row at all
-- and positively assert activation, so it passed while asserting the bypass.
-- The missing-IDV case is now the refusal, and the activation arm carries the
-- persisted pass that settlement requires.
select plan(11);

insert into public.orgs(id, name, slug) values
  ('33000000-0000-4000-8000-000000000001', 'Paid activation', 'r3c03-paid-activation');
insert into public.clients(id, org_id, display_name) values
  ('33000000-0000-4000-8000-000000000002', '33000000-0000-4000-8000-000000000001', 'Paid activation client');
insert into public.consents(id, client_id, kind, text_version, signed_at, ip, esig_ref) values
  ('33000000-0000-4000-8000-000000000003', '33000000-0000-4000-8000-000000000002', 'monitoring', 'monitoring-r3c03', pg_catalog.now(), '127.0.0.1', 'r3c03'),
  ('33000000-0000-4000-8000-000000000004', '33000000-0000-4000-8000-000000000002', 'analysis', 'analysis-r3c03', pg_catalog.now(), '127.0.0.1', 'r3c03');
insert into public.enrollments(id, client_id, status, monitoring_consent_at, analysis_consent_at, esig_doc_id, crs_member_ref) values
  ('33000000-0000-4000-8000-000000000005', '33000000-0000-4000-8000-000000000002', 'active', pg_catalog.now(), pg_catalog.now(), 'r3c03', 'member-r3c03');
insert into public.consumer_subscriptions(
  client_id, enrollment_id, provider, customer_ref, setup_intent_ref, payment_method_ref,
  subscription_ref, price_ref, price_cents, status, idempotency_key,
  provider_amount_cents, provider_currency, provider_status, review_code
) values (
  '33000000-0000-4000-8000-000000000002', '33000000-0000-4000-8000-000000000005',
  'mock', 'cus_r3c03', 'seti_r3c03', 'pm_r3c03', 'sub_r3c03_incomplete', 'price_r3c03', 4900,
  'review_required', 'enroll:r3c03', 4900, 'usd', 'incomplete', 'provider_response_mismatch'
);

select is(public.monitoring_is_authorized('33000000-0000-4000-8000-000000000002'), false,
  'an incomplete first payment cannot authorize monitoring');
select is(public.analysis_is_authorized('33000000-0000-4000-8000-000000000002'), false,
  'an incomplete first payment cannot authorize analysis');

delete from public.consumer_subscriptions where enrollment_id = '33000000-0000-4000-8000-000000000005';
update public.enrollments set status = 'enrolled' where id = '33000000-0000-4000-8000-000000000005';
insert into public.consumer_subscriptions(
  client_id, enrollment_id, provider, customer_ref, setup_intent_ref, payment_method_ref,
  price_ref, price_cents, status, idempotency_key
) values (
  '33000000-0000-4000-8000-000000000002', '33000000-0000-4000-8000-000000000005',
  'mock', 'cus_r3c03', 'seti_r3c03', 'pm_r3c03', 'price_r3c03', 4900, 'authorized', 'enroll:r3c03'
);

-- R4A-04: the authority that charges has its own identity precondition.
select throws_ok(
  $$select public.enrollment_settle_sub('33000000-0000-4000-8000-000000000005', null, 'sub_r3c03_active')$$,
  '23514', 'ENROLLMENT_IDV_NOT_PASSED',
  'settlement without a persisted passed IDV session is refused');
select results_eq(
  $$select enrollment.status::text, subscription.status, subscription.subscription_ref,
      (select count(*) from public.enrollment_milestones where client_id = '33000000-0000-4000-8000-000000000002' and kind = 'monitoring_connected'),
      (select count(*) from public.analysis_jobs where client_id = '33000000-0000-4000-8000-000000000002' and source_kind = 'enrollment')
    from public.enrollments as enrollment
    join public.consumer_subscriptions as subscription on subscription.enrollment_id = enrollment.id
    where enrollment.id = '33000000-0000-4000-8000-000000000005'$$,
  $$values ('enrolled'::text, 'authorized'::text, null::text, 0::bigint, 0::bigint)$$,
  'the refusal leaves enrollment, subscription, milestones and the analysis queue untouched');

insert into public.idv_sessions(enrollment_id, client_id, member_ref, driver, kind, state, max_attempts)
values ('33000000-0000-4000-8000-000000000005', '33000000-0000-4000-8000-000000000002',
  'member-r3c03', 'mock', 'sms', 'sms_sent', 3);
select throws_ok(
  $$select public.enrollment_settle_sub('33000000-0000-4000-8000-000000000005', null, 'sub_r3c03_active')$$,
  '23514', 'ENROLLMENT_IDV_NOT_PASSED',
  'a started but unfinished IDV session is refused the same way');
update public.idv_sessions set state = 'passed', outcome = 'pass'
where enrollment_id = '33000000-0000-4000-8000-000000000005';

select lives_ok(
  $$select public.enrollment_settle_sub('33000000-0000-4000-8000-000000000005', null, 'sub_r3c03_active')$$,
  'exact paid settlement atomically activates the enrollment');
select results_eq(
  $$select enrollment.status::text, subscription.status, subscription.subscription_ref
    from public.enrollments as enrollment
    join public.consumer_subscriptions as subscription on subscription.enrollment_id = enrollment.id
    where enrollment.id = '33000000-0000-4000-8000-000000000005'$$,
  $$values ('active'::text, 'active'::text, 'sub_r3c03_active'::text)$$,
  'the enrollment and subscription become active together');
select is((select count(*) from public.enrollment_milestones where client_id = '33000000-0000-4000-8000-000000000002' and kind = 'monitoring_connected'), 1::bigint,
  'paid activation records one monitoring milestone');
select is((select count(*) from public.analysis_jobs where client_id = '33000000-0000-4000-8000-000000000002' and source_kind = 'enrollment'), 1::bigint,
  'paid activation creates one initial analysis tuple');
select lives_ok(
  $$select public.enrollment_settle_sub('33000000-0000-4000-8000-000000000005', null, 'sub_r3c03_active')$$,
  'exact paid settlement replays');
select results_eq(
  $$select (select count(*) from public.enrollment_milestones where client_id = '33000000-0000-4000-8000-000000000002' and kind = 'monitoring_connected'),
           (select count(*) from public.analysis_jobs where client_id = '33000000-0000-4000-8000-000000000002' and source_kind = 'enrollment')$$,
  $$values (1::bigint, 1::bigint)$$,
  'settlement replay creates no duplicate activation evidence');

select * from finish();
rollback;
