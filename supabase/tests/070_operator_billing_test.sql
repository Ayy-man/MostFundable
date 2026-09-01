-- 070_operator_billing_test.sql — the executable contract for migration 070.
--
-- Phase 10 (S2.1) makes an operator organization's membership rung a consequence
-- of provider webhooks and nothing else. That claim is only checkable if the
-- database refuses every other writer, so this suite asserts the refusal in both
-- directions: the five billing columns raise for an operator owner, and the three
-- settings columns lane A's org-settings route writes still succeed.
--
-- Fixture identifiers all carry the 70000000 prefix and the whole file runs inside
-- one transaction that rolls back, so a rerun against the shared local stack is
-- stable and no row survives the run.

create extension if not exists pgtap with schema extensions;

begin;

set local search_path = public, extensions;

select plan(55);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into public.orgs (id, name, slug, plan, seats_included, membership)
values
  (
    '70000000-0000-0000-0000-000000000001',
    'Operator Billing Guard Org',
    'operator-billing-guard-org',
    'trial',
    5,
    'trial'
  ),
  (
    '70000000-0000-0000-0000-000000000002',
    'Operator Billing Reference Org A',
    'operator-billing-reference-org-a',
    'trial',
    5,
    'trial'
  ),
  (
    '70000000-0000-0000-0000-000000000003',
    'Operator Billing Reference Org B',
    'operator-billing-reference-org-b',
    'trial',
    5,
    'trial'
  );

insert into auth.users (id, email, raw_app_meta_data)
values (
  '70000000-0000-0000-0000-000000000101',
  'owner.guard.operator-billing@test.example',
  jsonb_build_object(
    'app_role', 'operator_member',
    'full_name', 'Operator Billing Guard Owner',
    'org_id', '70000000-0000-0000-0000-000000000001',
    'org_role', 'owner'
  )
);

insert into public.profiles (id, role, org_id, org_role, full_name, email)
values (
  '70000000-0000-0000-0000-000000000101',
  'operator_member',
  '70000000-0000-0000-0000-000000000001',
  'owner',
  'Operator Billing Guard Owner',
  'owner.guard.operator-billing@test.example'
)
on conflict (id) do update
set
  role = excluded.role,
  org_id = excluded.org_id,
  org_role = excluded.org_role,
  full_name = excluded.full_name,
  email = excluded.email;

-- ---------------------------------------------------------------------------
-- Shape
-- ---------------------------------------------------------------------------

select has_type(
  'public',
  'operator_subscription_status',
  'the operator subscription status type exists'
);

select enum_has_labels(
  'public',
  'operator_subscription_status',
  ARRAY[
    'trialing',
    'active',
    'incomplete',
    'incomplete_expired',
    'past_due',
    'canceled',
    'unpaid',
    'paused'
  ]::name[],
  'the status type carries the provider statuses verbatim and adds none'
);

select has_table('public', 'operator_subscriptions', 'operator_subscriptions exists');
select has_table('public', 'operator_billing_events', 'operator_billing_events exists');
select has_table('public', 'operator_seat_sync_outbox', 'operator_seat_sync_outbox exists');

select col_not_null('public', 'operator_subscriptions', 'org_id', 'org_id is not null');
select col_not_null(
  'public',
  'operator_subscriptions',
  'base_price_ref',
  'base_price_ref is not null, so no subscription can exist without a recorded base price'
);
select col_not_null(
  'public',
  'operator_subscriptions',
  'seat_price_ref',
  'seat_price_ref is not null, so no subscription can exist without a recorded seat price'
);
select col_not_null('public', 'operator_subscriptions', 'seat_quantity', 'seat_quantity is not null');
select col_not_null('public', 'operator_subscriptions', 'status', 'status is not null');
select col_not_null('public', 'operator_subscriptions', 'provider', 'provider is not null');

select col_has_default('public', 'operator_subscriptions', 'seat_quantity', 'seat_quantity has a default');
select col_has_default('public', 'operator_subscriptions', 'status', 'status has a default');

select has_check('public', 'operator_subscriptions', 'operator_subscriptions carries check constraints');

-- ---------------------------------------------------------------------------
-- Defaults, observed rather than declared
-- ---------------------------------------------------------------------------

insert into public.operator_subscriptions (org_id, base_price_ref, seat_price_ref)
values (
  '70000000-0000-0000-0000-000000000001',
  'mock_price_operator_base',
  'mock_price_operator_seat'
);

select is(
  (
    select seat_quantity
    from public.operator_subscriptions
    where org_id = '70000000-0000-0000-0000-000000000001'
  ),
  0,
  'a new subscription starts at zero billable seats'
);

select is(
  (
    select status::text
    from public.operator_subscriptions
    where org_id = '70000000-0000-0000-0000-000000000001'
  ),
  'incomplete',
  'a new subscription starts incomplete, so no rung is implied by its creation'
);

select throws_ok(
  $$
    insert into public.operator_subscriptions (org_id, base_price_ref, seat_price_ref, seat_quantity)
    values ('70000000-0000-0000-0000-000000000002', 'mock_price_operator_base', 'mock_price_operator_seat', -1)
  $$,
  '23514',
  null,
  'a negative billable seat quantity is refused'
);

select throws_ok(
  $$
    insert into public.operator_subscriptions (org_id, base_price_ref, seat_price_ref, provider)
    values ('70000000-0000-0000-0000-000000000002', 'mock_price_operator_base', 'mock_price_operator_seat', 'paypal')
  $$,
  '23514',
  null,
  'the provider allow-list refuses a provider outside stripe and mock'
);

-- ---------------------------------------------------------------------------
-- Uniqueness
-- ---------------------------------------------------------------------------

select col_is_unique(
  'public',
  'operator_subscriptions',
  'org_id',
  'one organization holds at most one operator subscription'
);

select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'operator_subscriptions'
      and indexname = 'operator_subscriptions_subscription_ref_key'
  ),
  'the subscription reference carries its own unique index'
);

select lives_ok(
  $$
    insert into public.operator_subscriptions (org_id, base_price_ref, seat_price_ref)
    values
      ('70000000-0000-0000-0000-000000000002', 'mock_price_operator_base', 'mock_price_operator_seat'),
      ('70000000-0000-0000-0000-000000000003', 'mock_price_operator_base', 'mock_price_operator_seat')
  $$,
  'two organizations may each hold a subscription with no provider reference yet'
);

update public.operator_subscriptions
set subscription_ref = 'mock_sub_shared_reference'
where org_id = '70000000-0000-0000-0000-000000000002';

select throws_ok(
  $$
    update public.operator_subscriptions
    set subscription_ref = 'mock_sub_shared_reference'
    where org_id = '70000000-0000-0000-0000-000000000003'
  $$,
  '23505',
  null,
  'two organizations can never share one subscription reference'
);

select col_is_pk(
  'public',
  'operator_seat_sync_outbox',
  'org_id',
  'the seat sync outbox holds at most one row per organization'
);

select col_is_unique(
  'public',
  'operator_billing_events',
  ARRAY['org_id', 'event_id']::name[],
  'one provider event applies at most once per organization'
);

-- ---------------------------------------------------------------------------
-- The ladder trail is append-only
-- ---------------------------------------------------------------------------

insert into public.operator_billing_events (
  org_id, event_id, event_type, reason_code, applied, occurred_at
) values (
  '70000000-0000-0000-0000-000000000001',
  'evt_mock_operator_billing_1',
  'invoice.paid',
  'applied',
  true,
  '2026-08-16T00:00:00Z'
);

select has_trigger(
  'public',
  'operator_billing_events',
  'operator_billing_events_prevent_change',
  'the ladder trail carries the append-only trigger'
);

select throws_ok(
  $$
    update public.operator_billing_events
    set reason_code = 'rewritten'
    where event_id = 'evt_mock_operator_billing_1'
  $$,
  'P0001',
  null,
  'a recorded ladder event cannot be rewritten'
);

select throws_ok(
  $$
    delete from public.operator_billing_events
    where event_id = 'evt_mock_operator_billing_1'
  $$,
  'P0001',
  null,
  'a recorded ladder event cannot be erased'
);

select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'operator_billing_events'
      and indexname = 'operator_billing_events_org_recorded_at_idx'
  ),
  'the ladder trail is indexed for a per-organization read'
);

select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'operator_seat_sync_outbox'
      and indexname = 'operator_seat_sync_outbox_status_idx'
  ),
  'the seat sync outbox is indexed for a pending drain'
);

-- ---------------------------------------------------------------------------
-- Row level security posture
-- ---------------------------------------------------------------------------

select ok(
  (
    select relrowsecurity
    from pg_class
    where oid = 'public.operator_subscriptions'::regclass
  ),
  'operator_subscriptions enables row security'
);
select ok(
  (
    select relrowsecurity
    from pg_class
    where oid = 'public.operator_billing_events'::regclass
  ),
  'operator_billing_events enables row security'
);
select ok(
  (
    select relrowsecurity
    from pg_class
    where oid = 'public.operator_seat_sync_outbox'::regclass
  ),
  'operator_seat_sync_outbox enables row security'
);
select ok(
  (
    select relforcerowsecurity
    from pg_class
    where oid = 'public.operator_subscriptions'::regclass
  ),
  'operator_subscriptions forces row security'
);
select ok(
  (
    select relforcerowsecurity
    from pg_class
    where oid = 'public.operator_billing_events'::regclass
  ),
  'operator_billing_events forces row security'
);
select ok(
  (
    select relforcerowsecurity
    from pg_class
    where oid = 'public.operator_seat_sync_outbox'::regclass
  ),
  'operator_seat_sync_outbox forces row security'
);

select results_eq(
  $$
    select distinct cmd::text
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'operator_subscriptions',
        'operator_billing_events',
        'operator_seat_sync_outbox'
      )
      and roles @> array['authenticated']::name[]
    order by 1
  $$,
  $$ values ('SELECT'::text) $$,
  'the only policy an authenticated session holds on a billing table is a read'
);

select is(
  (
    select count(*)::integer
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'operator_subscriptions',
        'operator_billing_events',
        'operator_seat_sync_outbox'
      )
      and roles @> array['authenticated']::name[]
  ),
  3,
  'each billing table carries exactly one scoped read policy'
);

select table_privs_are(
  'public',
  'operator_subscriptions',
  'anon',
  ARRAY[]::text[],
  'anon holds no privilege on operator_subscriptions'
);
select table_privs_are(
  'public',
  'operator_billing_events',
  'anon',
  ARRAY[]::text[],
  'anon holds no privilege on operator_billing_events'
);
select table_privs_are(
  'public',
  'operator_seat_sync_outbox',
  'anon',
  ARRAY[]::text[],
  'anon holds no privilege on operator_seat_sync_outbox'
);
select table_privs_are(
  'public',
  'operator_subscriptions',
  'authenticated',
  ARRAY['SELECT'],
  'authenticated may only read operator_subscriptions'
);
select table_privs_are(
  'public',
  'operator_billing_events',
  'authenticated',
  ARRAY['SELECT'],
  'authenticated may only read operator_billing_events'
);
select table_privs_are(
  'public',
  'operator_seat_sync_outbox',
  'authenticated',
  ARRAY['SELECT'],
  'authenticated may only read operator_seat_sync_outbox'
);

select ok(
  has_table_privilege('service_role', 'public.operator_subscriptions', 'SELECT')
  and has_table_privilege('service_role', 'public.operator_subscriptions', 'INSERT')
  and has_table_privilege('service_role', 'public.operator_subscriptions', 'UPDATE')
  and has_table_privilege('service_role', 'public.operator_subscriptions', 'DELETE'),
  'service_role holds the write privileges on operator_subscriptions'
);
select ok(
  has_table_privilege('service_role', 'public.operator_billing_events', 'SELECT')
  and has_table_privilege('service_role', 'public.operator_billing_events', 'INSERT')
  and has_table_privilege('service_role', 'public.operator_billing_events', 'UPDATE')
  and has_table_privilege('service_role', 'public.operator_billing_events', 'DELETE'),
  'service_role holds the write privileges on operator_billing_events'
);
select ok(
  has_table_privilege('service_role', 'public.operator_seat_sync_outbox', 'SELECT')
  and has_table_privilege('service_role', 'public.operator_seat_sync_outbox', 'INSERT')
  and has_table_privilege('service_role', 'public.operator_seat_sync_outbox', 'UPDATE')
  and has_table_privilege('service_role', 'public.operator_seat_sync_outbox', 'DELETE'),
  'service_role holds the write privileges on operator_seat_sync_outbox'
);

-- ---------------------------------------------------------------------------
-- The billing column guard
-- ---------------------------------------------------------------------------

select has_function(
  'private',
  'orgs_guard_billing_columns',
  'the billing column guard function exists'
);

select has_trigger(
  'public',
  'orgs',
  'orgs_billing_columns_guard',
  'the billing column guard is attached to orgs'
);

set local request.jwt.claims = '{"sub":"70000000-0000-0000-0000-000000000101","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$
    update public.orgs
    set membership = 'current'
    where id = '70000000-0000-0000-0000-000000000001'
  $$,
  'P0001',
  'billing columns are webhook-derived',
  'an operator owner cannot set their own membership rung'
);

select throws_ok(
  $$
    update public.orgs
    set plan = 'agency'
    where id = '70000000-0000-0000-0000-000000000001'
  $$,
  'P0001',
  'billing columns are webhook-derived',
  'an operator owner cannot change their own plan tier'
);

select throws_ok(
  $$
    update public.orgs
    set base_price_cents = 1
    where id = '70000000-0000-0000-0000-000000000001'
  $$,
  'P0001',
  'billing columns are webhook-derived',
  'an operator owner cannot lower their own base price'
);

select throws_ok(
  $$
    update public.orgs
    set seat_price_cents = 1
    where id = '70000000-0000-0000-0000-000000000001'
  $$,
  'P0001',
  'billing columns are webhook-derived',
  'an operator owner cannot lower their own seat price'
);

select throws_ok(
  $$
    update public.orgs
    set seats_included = 500
    where id = '70000000-0000-0000-0000-000000000001'
  $$,
  'P0001',
  'billing columns are webhook-derived',
  'an operator owner cannot raise their own included seat allowance'
);

-- The negative direction, and the reason the guard compares old to new per column
-- rather than blocking the statement: lane A's /api/org/settings writes these three
-- columns in one UPDATE that also carries the untouched billing columns.
select lives_ok(
  $$
    update public.orgs
    set assignment_mode = 'round_robin',
        default_client_goal_cents = 12000000,
        team_sees_all_clients = false
    where id = '70000000-0000-0000-0000-000000000001'
  $$,
  'lane A''s org settings write still succeeds with the guard in place'
);

reset role;

-- The bypass the security-definer billing functions use, proving plan 10-02 has a
-- path through the guard.
select set_config('app.billing_write', 'on', true);

select lives_ok(
  $$
    update public.orgs
    set membership = 'current'
    where id = '70000000-0000-0000-0000-000000000001'
  $$,
  'a transaction that has set the billing write marker may move the rung'
);

select set_config('app.billing_write', 'off', true);

select * from finish();

rollback;
