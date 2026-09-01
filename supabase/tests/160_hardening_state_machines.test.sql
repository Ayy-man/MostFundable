begin;

set local search_path = public, extensions;

select plan(40);

-- The EARLY suite exercises merged Phase 1-13 seams only. Purge execution is
-- deliberately represented by explicit OPEN assertions because the base has
-- neither the scheduled row nor the RPC named by the planning research.

select ok(
  to_regprocedure('public.enrollment_revoke_consent(uuid,text,uuid)') is not null,
  'consent revoke uses the merged service-role RPC'
);
select ok(
  to_regprocedure('public.enrollment_cancel_sub(uuid,uuid,text)') is not null,
  'cancellation uses the merged subscription-aware RPC'
);
select ok(
  to_regprocedure('public.enrollment_begin(uuid,uuid,uuid,text,text,text,text,text,inet,text)') is not null,
  'enrollment begin uses the merged idempotent RPC'
);
select ok(
  to_regprocedure('public.operator_billing_apply_event(text,text,uuid,text,text,timestamptz,integer,timestamptz,timestamptz,text)') is not null,
  'billing dunning uses the merged event ladder RPC'
);
select has_table('public', 'outcome_refresh_jobs', 'outcome recompute has a durable job table');
select ok(
  to_regprocedure('public.claim_outcome_refresh_job(text,integer)') is not null,
  'outcome recompute exposes the lease claim RPC'
);

select has_table('public', 'background_jobs', 'late scheduler and drainer state is durable');
select has_table('public', 'operator_earnings_ledger', 'late revenue accrual state is durable');
select has_table('public', 'referral_ledger', 'late SaaS referral accrual state is durable');
select has_table('public', 'consumer_referrals', 'late consumer referral lifecycle is durable');
select has_table('public', 'kb_import_runs', 'late KB import lifecycle is durable');
select has_table('public', 'notification_delivery_outbox', 'late notification dispatch state is durable');
select has_table('public', 'document_uploads', 'late uploaded-report purge state is durable');
select has_table('public', 'paid_refresh_requests', 'late paid-refresh request state is durable');
select has_table('public', 'paid_refresh_payment_events', 'late paid-refresh payment evidence is durable');
select ok(
  to_regprocedure('public.claim_background_jobs(text,integer,integer)') is not null,
  'late shared drainer exposes one bounded lease claim RPC'
);

insert into public.orgs (id, name, slug, membership)
values (
  '16000000-0000-0000-0000-000000000001',
  'Hardening Test Org',
  'hardening-test-org-160',
  'trial'
);

insert into public.clients (id, org_id, display_name)
values (
  '16000000-0000-0000-0000-000000000011',
  '16000000-0000-0000-0000-000000000001',
  'Hardening Test Client'
);

insert into public.consents (id, client_id, kind, text_version, signed_at, ip, esig_ref)
values
  (
    '16000000-0000-0000-0000-000000000021',
    '16000000-0000-0000-0000-000000000011',
    'monitoring', 'hardening-160.1', '2026-08-16T00:00:00Z', '127.0.0.1', 'hardening-160-esig'
  ),
  (
    '16000000-0000-0000-0000-000000000022',
    '16000000-0000-0000-0000-000000000011',
    'analysis', 'hardening-160.1', '2026-08-16T00:00:00Z', '127.0.0.1', 'hardening-160-esig'
  );

select lives_ok(
  $$ select public.enrollment_revoke_consent(
    '16000000-0000-0000-0000-000000000011', 'analysis', null
  ) $$,
  'consent legal edge revokes the latest active grant'
);
select is(
  (select count(*)::integer from public.consent_revocations
   where consent_id = '16000000-0000-0000-0000-000000000022'),
  1,
  'consent revocation creates one durable authority row'
);
select lives_ok(
  $$ select public.enrollment_revoke_consent(
    '16000000-0000-0000-0000-000000000011', 'analysis', null
  ) $$,
  'consent replay is a stable no-op'
);
select is(
  (select count(*)::integer from public.consent_revocations
   where consent_id = '16000000-0000-0000-0000-000000000022'),
  1,
  'consent replay leaves durable authority unchanged'
);

set local role anon;
select throws_ok(
  $$ select count(*) from public.consents $$,
  '42501', null,
  'consent cross-tenant access is denied as anon'
);
reset role;

insert into public.enrollments (
  id, client_id, status, monitoring_consent_at, analysis_consent_at, esig_doc_id
) values (
  '16000000-0000-0000-0000-000000000031',
  '16000000-0000-0000-0000-000000000011',
  'active', '2026-08-16T00:00:00Z', '2026-08-16T00:00:00Z', 'hardening-160-esig'
);

insert into public.consumer_subscriptions (
  id, client_id, enrollment_id, provider, customer_ref, setup_intent_ref,
  payment_method_ref, subscription_ref, price_ref, price_cents, status, idempotency_key
) values (
  '16000000-0000-0000-0000-000000000041',
  '16000000-0000-0000-0000-000000000011',
  '16000000-0000-0000-0000-000000000031',
  'mock', 'mock_cus_hardening_160', 'mock_seti_hardening_160',
  null, null,
  'mock_price_monitoring', 4900, 'authorized', 'hardening-160-sub'
);

select lives_ok(
  $$ select public.enrollment_cancel_sub(
    '16000000-0000-0000-0000-000000000031', null, 'user_request'
  ) $$,
  'cancellation legal edge reaches the terminal state'
);
select is(
  (select status::text from public.enrollments
   where id = '16000000-0000-0000-0000-000000000031'),
  'cancelled',
  'cancellation persists the terminal enrollment state'
);
select is(
  (select status from public.consumer_subscriptions
   where id = '16000000-0000-0000-0000-000000000041'),
  'cancelled',
  'cancellation persists the subscription effect'
);

create temporary table cancellation_snapshot on commit drop as
select to_jsonb(enrollment_row) as enrollment_json,
       (select to_jsonb(subscription_row)
        from public.consumer_subscriptions as subscription_row
        where subscription_row.id = '16000000-0000-0000-0000-000000000041') as subscription_json
from public.enrollments as enrollment_row
where enrollment_row.id = '16000000-0000-0000-0000-000000000031';

select lives_ok(
  $$ select public.enrollment_cancel_sub(
    '16000000-0000-0000-0000-000000000031', null, 'user_request'
  ) $$,
  'cancellation replay is accepted'
);
select is(
  (select to_jsonb(enrollment_row) from public.enrollments as enrollment_row
   where enrollment_row.id = '16000000-0000-0000-0000-000000000031'),
  (select enrollment_json from cancellation_snapshot),
  'cancellation replay leaves the terminal enrollment row unchanged'
);

set local role authenticated;
select throws_ok(
  $$ select public.enrollment_cancel_sub(
    '16000000-0000-0000-0000-000000000031', null, 'user_request'
  ) $$,
  '42501', null,
  'cancellation refuses an authenticated actor without the service seam'
);
reset role;

select ok(
  to_regprocedure('public.purge_cancelled_client(uuid)') is null,
  'purge before-due and after-due edges stay OPEN because no merged purge RPC exists'
);
select ok(
  to_regclass('public.enrollment_cancel_jobs') is null,
  'purge retry and tenant edges stay OPEN because no merged purge job table exists'
);

select throws_ok(
  $$ insert into public.enrollments (
    id, client_id, status, parked_until, monitoring_consent_at, analysis_consent_at, esig_doc_id
  ) values (
    '16000000-0000-0000-0000-000000000032',
    '16000000-0000-0000-0000-000000000011',
    'parked', null, '2026-08-16T00:00:00Z', '2026-08-16T00:00:00Z', 'hardening-160-esig'
  ) $$,
  '23514', null,
  'enrollment illegal edge rejects a parked state without a deadline'
);
select is(
  (select count(*)::integer from public.enrollments
   where id = '16000000-0000-0000-0000-000000000032'),
  0,
  'enrollment refusal leaves no durable stale row'
);

insert into public.operator_subscriptions (
  id, org_id, provider, customer_ref, subscription_ref,
  base_price_ref, seat_price_ref, status
) values (
  '16000000-0000-0000-0000-000000000051',
  '16000000-0000-0000-0000-000000000001',
  'mock', 'mock_cus_operator_160', 'mock_sub_operator_160',
  'mock_price_operator_base', 'mock_price_operator_seat', 'active'
);

select is(
  (public.operator_billing_apply_event(
    'evt_hardening_160', 'invoice.paid',
    '16000000-0000-0000-0000-000000000001', 'mock_sub_operator_160', 'active',
    null, 0, '2026-09-16T00:00:00Z', '2026-08-16T01:00:00Z', 'mock'
  ) ->> 'reason_code'),
  'applied',
  'billing dunning legal edge advances to the paid rung'
);
select is(
  (select membership::text from public.orgs
   where id = '16000000-0000-0000-0000-000000000001'),
  'current',
  'billing dunning persists the terminal paid rung'
);
select is(
  (public.operator_billing_apply_event(
    'evt_hardening_160', 'invoice.paid',
    '16000000-0000-0000-0000-000000000001', 'mock_sub_operator_160', 'active',
    null, 0, '2026-09-16T00:00:00Z', '2026-08-16T01:00:00Z', 'mock'
  ) ->> 'reason_code'),
  'duplicate_event',
  'billing dunning replay is classified as a no-op'
);
select is(
  (select count(*)::integer from public.operator_billing_events
   where org_id = '16000000-0000-0000-0000-000000000001'
     and event_id = 'evt_hardening_160'),
  1,
  'billing dunning replay leaves one durable event'
);

insert into public.outcome_refresh_jobs (
  id, bank_ref, change_id, status, attempt_count, lease_owner, lease_until
) values (
  '16000000-0000-0000-0000-000000000061',
  'hardening-bank-160', '16000000-0000-0000-0000-000000000062',
  'running', 3, 'hardening-worker-160', now() + interval '5 minutes'
);

select lives_ok(
  $$ select * from public.fail_outcome_refresh_job(
    '16000000-0000-0000-0000-000000000061',
    'hardening-worker-160', 'attempts_exhausted', false, 1
  ) $$,
  'outcome recompute maximum-attempt edge reaches terminal failure'
);
select results_eq(
  $$ select status::text collate "C", attempt_count, error_code collate "C"
     from public.outcome_refresh_jobs
     where id = '16000000-0000-0000-0000-000000000061' $$,
  $$ values ('failed'::text collate "C", 3, 'attempts_exhausted'::text collate "C") $$,
  'outcome recompute terminal state keeps its attempt and error facts'
);
select throws_ok(
  $$ select * from public.fail_outcome_refresh_job(
    '16000000-0000-0000-0000-000000000061',
    'other-worker-160', 'lease_lost', false, 1
  ) $$,
  '55000', null,
  'outcome recompute lease-loss edge refuses the wrong worker'
);
select is(
  (select status::text from public.outcome_refresh_jobs
   where id = '16000000-0000-0000-0000-000000000061'),
  'failed',
  'outcome recompute lease refusal leaves terminal state unchanged'
);

set local role authenticated;
select throws_ok(
  $$ select count(*) from public.outcome_refresh_jobs $$,
  '42501', null,
  'outcome recompute queue is denied to authenticated tenant actors'
);
reset role;

select * from finish();
rollback;
