-- 073_billing_isolation_test.sql — the two billing systems never cross.
--
-- Consumer billing is lane B's, keyed on enrollment_id in consumer_subscriptions.
-- Operator billing is Phase 10's, keyed on org_id in operator_subscriptions. The
-- S2.1 scope sentence's "must never double-charge" is therefore a routing
-- property rather than a shared table, and this suite pins both halves of it:
-- no provider reference appears in both tables, and applying an operator event
-- leaves every consumer row byte-identical.
--
-- Fixture identifiers carry the 73000000 prefix and the whole file rolls back.

create extension if not exists pgtap with schema extensions;

begin;

set local search_path = public, extensions;

select plan(5);

-- ---------------------------------------------------------------------------
-- Fixtures: one consumer subscription and one operator subscription
-- ---------------------------------------------------------------------------

insert into public.orgs (id, name, slug, seats_included, membership)
values (
  '73000000-0000-0000-0000-000000000001',
  'Billing Isolation Org',
  'billing-isolation-org',
  5,
  'trial'
);

insert into public.clients (id, org_id, display_name)
values (
  '73000000-0000-0000-0000-000000000011',
  '73000000-0000-0000-0000-000000000001',
  'Billing Isolation Client'
);

insert into public.consents (id, client_id, kind, text_version, signed_at, ip, esig_ref)
values
  (
    '73000000-0000-0000-0000-000000000021',
    '73000000-0000-0000-0000-000000000011',
    'monitoring',
    'monitoring-2026-08-16.1',
    '2026-08-16T00:00:00Z',
    '127.0.0.1',
    'billing-isolation-e1'
  ),
  (
    '73000000-0000-0000-0000-000000000022',
    '73000000-0000-0000-0000-000000000011',
    'analysis',
    'analysis-2026-08-16.1',
    '2026-08-16T00:00:00Z',
    '127.0.0.1',
    'billing-isolation-e1'
  );

insert into public.enrollments (
  id, client_id, status, monitoring_consent_at, analysis_consent_at, esig_doc_id
) values (
  '73000000-0000-0000-0000-000000000031',
  '73000000-0000-0000-0000-000000000011',
  'active',
  '2026-08-16T00:00:00Z',
  '2026-08-16T00:00:00Z',
  'billing-isolation-e1'
);

insert into public.consumer_subscriptions (
  client_id, enrollment_id, provider, customer_ref,
  setup_intent_ref, payment_method_ref, subscription_ref,
  price_ref, price_cents, status, idempotency_key
) values (
  '73000000-0000-0000-0000-000000000011',
  '73000000-0000-0000-0000-000000000031',
  'mock',
  'mock_cus_isolation_consumer',
  'mock_seti_isolation_consumer',
  'mock_pm_isolation_consumer',
  'mock_sub_isolation_consumer',
  'mock_price_monitoring',
  4900,
  'active',
  'enroll:73000000-0000-0000-0000-000000000031:sub'
);

insert into public.operator_subscriptions (
  org_id, provider, customer_ref, subscription_ref, base_price_ref, seat_price_ref
) values (
  '73000000-0000-0000-0000-000000000001',
  'mock',
  'mock_cus_isolation_operator',
  'mock_sub_isolation_operator',
  'mock_price_operator_base',
  'mock_price_operator_seat'
);

-- ---------------------------------------------------------------------------
-- The two key spaces are disjoint
-- ---------------------------------------------------------------------------

select is(
  (
    select count(*)::integer
    from public.operator_subscriptions as operator_row
    join public.consumer_subscriptions as consumer_row
      on consumer_row.subscription_ref = operator_row.subscription_ref
  ),
  0,
  'no provider subscription reference appears in both the operator and the consumer table'
);

select is(
  (
    select count(*)::integer
    from public.operator_subscriptions as operator_row
    join public.consumer_subscriptions as consumer_row
      on consumer_row.customer_ref = operator_row.customer_ref
  ),
  0,
  'no provider customer reference appears in both tables either'
);

-- ---------------------------------------------------------------------------
-- Applying an operator event leaves the consumer side alone
-- ---------------------------------------------------------------------------

create temporary table billing_isolation_consumer_before on commit drop as
select to_jsonb(consumer_row) as row_json
from public.consumer_subscriptions as consumer_row
where consumer_row.enrollment_id = '73000000-0000-0000-0000-000000000031';

select public.operator_billing_apply_event(
  'evt_mock_isolation_01', 'invoice.paid',
  '73000000-0000-0000-0000-000000000001', 'mock_sub_isolation_operator', 'active',
  null, 0, '2026-09-16T00:00:00Z', '2026-08-16T01:00:00Z', 'stripe'
);

select is(
  (select membership::text from public.orgs where id = '73000000-0000-0000-0000-000000000001'),
  'current',
  'the operator event did move the operator rung, so this suite is not vacuous'
);

select is(
  (
    select to_jsonb(consumer_row)
    from public.consumer_subscriptions as consumer_row
    where consumer_row.enrollment_id = '73000000-0000-0000-0000-000000000031'
  ),
  (select row_json from billing_isolation_consumer_before),
  'the consumer subscription row is byte-identical after an operator event'
);

select is(
  (
    select count(*)::integer
    from public.operator_billing_events
    where org_id = '73000000-0000-0000-0000-000000000001'
  ),
  1,
  'the operator event was recorded once against the operator organization and nowhere else'
);

select * from finish();

rollback;
