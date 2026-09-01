-- 071_operator_billing_rpc_test.sql — the executable contract for the ladder RPC.
--
-- The ladder walks rung by rung through the D-04 mapping, then proves the three
-- properties that make it trustworthy against a real provider: a redelivered
-- event is a no-op, an event older than the one already recorded is refused, and
-- an unrecognized status leaves the rung alone rather than defaulting to one.
--
-- The membership-containment block is the part that keeps this phase honest: the
-- three other billing functions are privileged too, and a privileged path that
-- quietly set membership would defeat the 070 guard from the inside.
--
-- Fixture identifiers carry the 71000000 prefix and the whole file rolls back.

create extension if not exists pgtap with schema extensions;

begin;

set local search_path = public, extensions;

select plan(58);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into public.orgs (id, name, slug, plan, seats_included, membership)
values
  (
    '71000000-0000-0000-0000-000000000001',
    'Operator Ladder Org',
    'operator-ladder-org',
    'trial',
    5,
    'trial'
  ),
  (
    '71000000-0000-0000-0000-000000000002',
    'Operator Ladder Org Without Subscription',
    'operator-ladder-org-without-subscription',
    'trial',
    5,
    'trial'
  ),
  (
    '71000000-0000-0000-0000-000000000003',
    'Operator Ladder Containment Org',
    'operator-ladder-containment-org',
    'trial',
    5,
    'trial'
  );

insert into public.operator_subscriptions (
  org_id, provider, customer_ref, subscription_ref,
  base_item_ref, seat_item_ref, base_price_ref, seat_price_ref, status
) values (
  '71000000-0000-0000-0000-000000000001',
  'mock',
  'mock_cus_ladder',
  'mock_sub_ladder',
  'mock_si_base_ladder',
  'mock_si_seat_ladder',
  'mock_price_operator_base',
  'mock_price_operator_seat',
  'incomplete'
);

-- ---------------------------------------------------------------------------
-- The D-04 mapping, walked rung by rung
-- ---------------------------------------------------------------------------

select public.operator_billing_apply_event(
  'evt_mock_ladder_01', 'customer.subscription.updated',
  '71000000-0000-0000-0000-000000000001', 'mock_sub_ladder', 'active',
  null, 0, '2026-09-16T00:00:00Z', '2026-08-16T01:00:00Z', 'stripe'
);
select is(
  (select membership::text from public.orgs where id = '71000000-0000-0000-0000-000000000001'),
  'current',
  'subscription status active moves the rung to current'
);

select public.operator_billing_apply_event(
  'evt_mock_ladder_02', 'invoice.payment_failed',
  '71000000-0000-0000-0000-000000000001', 'mock_sub_ladder', 'past_due',
  '2026-08-19T00:00:00Z', 1, '2026-09-16T00:00:00Z', '2026-08-16T02:00:00Z', 'stripe'
);
select is(
  (select membership::text from public.orgs where id = '71000000-0000-0000-0000-000000000001'),
  'past_due',
  'a failed invoice with retries remaining moves the rung to past_due'
);

select public.operator_billing_apply_event(
  'evt_mock_ladder_03', 'invoice.payment_failed',
  '71000000-0000-0000-0000-000000000001', 'mock_sub_ladder', 'past_due',
  null, 4, '2026-09-16T00:00:00Z', '2026-08-16T03:00:00Z', 'stripe'
);
select is(
  (select membership::text from public.orgs where id = '71000000-0000-0000-0000-000000000001'),
  'grace',
  'a failed invoice with no further attempt scheduled moves the rung to grace'
);
select isnt(
  (select grace_started_at from public.operator_subscriptions where org_id = '71000000-0000-0000-0000-000000000001'),
  null,
  'entering grace records when the window opened'
);
select ok(
  (
    select grace_until > grace_started_at
    from public.operator_subscriptions
    where org_id = '71000000-0000-0000-0000-000000000001'
  ),
  'the grace window closes after it opens'
);

select public.operator_billing_apply_event(
  'evt_mock_ladder_04', 'customer.subscription.updated',
  '71000000-0000-0000-0000-000000000001', 'mock_sub_ladder', 'unpaid',
  null, 4, '2026-09-16T00:00:00Z', '2026-08-16T04:00:00Z', 'stripe'
);
select is(
  (select membership::text from public.orgs where id = '71000000-0000-0000-0000-000000000001'),
  'deactivated',
  'subscription status unpaid moves the rung to deactivated'
);

select public.operator_billing_apply_event(
  'evt_mock_ladder_05', 'invoice.paid',
  '71000000-0000-0000-0000-000000000001', 'mock_sub_ladder', 'active',
  null, 0, '2026-10-16T00:00:00Z', '2026-08-16T05:00:00Z', 'stripe'
);
select is(
  (select membership::text from public.orgs where id = '71000000-0000-0000-0000-000000000001'),
  'current',
  'a paid invoice reinstates the rung to current'
);

select public.operator_billing_apply_event(
  'evt_mock_ladder_06', 'customer.subscription.deleted',
  '71000000-0000-0000-0000-000000000001', 'mock_sub_ladder', 'canceled',
  null, 0, '2026-10-16T00:00:00Z', '2026-08-16T06:00:00Z', 'stripe'
);
select is(
  (select membership::text from public.orgs where id = '71000000-0000-0000-0000-000000000001'),
  'deactivated',
  'a deleted subscription moves the rung to deactivated'
);

select public.operator_billing_apply_event(
  'evt_mock_ladder_07', 'invoice.paid',
  '71000000-0000-0000-0000-000000000001', 'mock_sub_ladder', 'active',
  null, 0, '2026-11-16T00:00:00Z', '2026-08-16T07:00:00Z', 'stripe'
);
select is(
  (select membership::text from public.orgs where id = '71000000-0000-0000-0000-000000000001'),
  'current',
  'the ladder reinstates again after a deleted subscription'
);

select public.operator_billing_apply_event(
  'evt_mock_ladder_08', 'customer.subscription.updated',
  '71000000-0000-0000-0000-000000000001', 'mock_sub_ladder', 'incomplete_expired',
  null, 0, '2026-11-16T00:00:00Z', '2026-08-16T08:00:00Z', 'stripe'
);
select is(
  (select membership::text from public.orgs where id = '71000000-0000-0000-0000-000000000001'),
  'deactivated',
  'subscription status incomplete_expired moves the rung to deactivated'
);

select public.operator_billing_apply_event(
  'evt_mock_ladder_09', 'invoice.paid',
  '71000000-0000-0000-0000-000000000001', 'mock_sub_ladder', 'active',
  null, 0, '2026-12-16T00:00:00Z', '2026-08-16T09:00:00Z', 'stripe'
);
select is(
  (select membership::text from public.orgs where id = '71000000-0000-0000-0000-000000000001'),
  'current',
  'the ladder reinstates after an expired incomplete subscription'
);

select public.operator_billing_apply_event(
  'evt_mock_ladder_10', 'customer.subscription.updated',
  '71000000-0000-0000-0000-000000000001', 'mock_sub_ladder', 'canceled',
  null, 0, '2026-12-16T00:00:00Z', '2026-08-16T10:00:00Z', 'stripe'
);
select is(
  (select membership::text from public.orgs where id = '71000000-0000-0000-0000-000000000001'),
  'deactivated',
  'subscription status canceled moves the rung to deactivated'
);

select public.operator_billing_apply_event(
  'evt_mock_ladder_11', 'invoice.paid',
  '71000000-0000-0000-0000-000000000001', 'mock_sub_ladder', 'active',
  null, 0, '2027-01-16T00:00:00Z', '2026-08-16T11:00:00Z', 'stripe'
);
select is(
  (select membership::text from public.orgs where id = '71000000-0000-0000-0000-000000000001'),
  'current',
  'the ladder reinstates after a canceled subscription'
);

select public.operator_billing_apply_event(
  'evt_mock_ladder_12', 'customer.subscription.updated',
  '71000000-0000-0000-0000-000000000001', 'mock_sub_ladder', 'trialing',
  null, 0, '2027-01-16T00:00:00Z', '2026-08-16T12:00:00Z', 'stripe'
);
select is(
  (select membership::text from public.orgs where id = '71000000-0000-0000-0000-000000000001'),
  'trial',
  'subscription status trialing moves the rung to trial'
);

select public.operator_billing_apply_event(
  'evt_mock_ladder_13', 'customer.subscription.updated',
  '71000000-0000-0000-0000-000000000001', 'mock_sub_ladder', 'past_due',
  null, 1, '2027-01-16T00:00:00Z', '2026-08-16T13:00:00Z', 'stripe'
);
select is(
  (select membership::text from public.orgs where id = '71000000-0000-0000-0000-000000000001'),
  'past_due',
  'subscription status past_due moves the rung to past_due'
);

-- The three that must leave the rung alone.
select is(
  public.operator_billing_apply_event(
    'evt_mock_ladder_14', 'customer.subscription.updated',
    '71000000-0000-0000-0000-000000000001', 'mock_sub_ladder', 'paused',
    null, 0, '2027-01-16T00:00:00Z', '2026-08-16T14:00:00Z', 'stripe'
  ) ->> 'reason_code',
  'unknown_status',
  'a paused subscription is recorded rather than mapped to a rung'
);
select is(
  (select membership::text from public.orgs where id = '71000000-0000-0000-0000-000000000001'),
  'past_due',
  'a paused subscription leaves the rung where it was'
);

select is(
  public.operator_billing_apply_event(
    'evt_mock_ladder_15', 'customer.subscription.updated',
    '71000000-0000-0000-0000-000000000001', 'mock_sub_ladder', 'incomplete',
    null, 0, '2027-01-16T00:00:00Z', '2026-08-16T15:00:00Z', 'stripe'
  ) ->> 'reason_code',
  'unknown_status',
  'a subscription that has never been paid is recorded rather than mapped to a rung'
);
select is(
  (select membership::text from public.orgs where id = '71000000-0000-0000-0000-000000000001'),
  'past_due',
  'an incomplete subscription leaves the rung where it was'
);

select is(
  public.operator_billing_apply_event(
    'evt_mock_ladder_16', 'customer.subscription.updated',
    '71000000-0000-0000-0000-000000000001', 'mock_sub_ladder', 'future_status_we_do_not_know',
    null, 0, '2027-01-16T00:00:00Z', '2026-08-16T16:00:00Z', 'stripe'
  ) ->> 'reason_code',
  'unknown_status',
  'a status the provider has not published yet is recorded rather than guessed'
);
select is(
  (select membership::text from public.orgs where id = '71000000-0000-0000-0000-000000000001'),
  'past_due',
  'an unrecognized status leaves the rung where it was'
);

-- ---------------------------------------------------------------------------
-- Replay
-- ---------------------------------------------------------------------------

select is(
  public.operator_billing_apply_event(
    'evt_mock_ladder_05', 'invoice.paid',
    '71000000-0000-0000-0000-000000000001', 'mock_sub_ladder', 'active',
    null, 0, '2026-10-16T00:00:00Z', '2026-08-16T05:00:00Z', 'stripe'
  ) ->> 'reason_code',
  'duplicate_event',
  'a redelivered event reports itself as a duplicate'
);
select is(
  (
    select count(*)::integer
    from public.operator_billing_events
    where org_id = '71000000-0000-0000-0000-000000000001'
      and event_id = 'evt_mock_ladder_05'
  ),
  1,
  'a redelivered event adds no second trail row'
);
select is(
  (select membership::text from public.orgs where id = '71000000-0000-0000-0000-000000000001'),
  'past_due',
  'a redelivered event moves no rung'
);

-- ---------------------------------------------------------------------------
-- Ordering
-- ---------------------------------------------------------------------------

select is(
  public.operator_billing_apply_event(
    'evt_mock_ladder_17', 'invoice.payment_failed',
    '71000000-0000-0000-0000-000000000001', 'mock_sub_ladder', 'past_due',
    null, 4, '2026-09-16T00:00:00Z', '2026-08-16T02:30:00Z', 'stripe'
  ) ->> 'reason_code',
  'stale_event',
  'an event older than the one already recorded is refused'
);
select is(
  (select membership::text from public.orgs where id = '71000000-0000-0000-0000-000000000001'),
  'past_due',
  'a late failure cannot undo a newer signal'
);
select is(
  (
    select reason_code
    from public.operator_billing_events
    where org_id = '71000000-0000-0000-0000-000000000001'
      and event_id = 'evt_mock_ladder_17'
  ),
  'stale_event',
  'the refusal is on the record rather than silent'
);

-- ---------------------------------------------------------------------------
-- An organization with no subscription
-- ---------------------------------------------------------------------------

select is(
  public.operator_billing_apply_event(
    'evt_mock_ladder_18', 'invoice.paid',
    '71000000-0000-0000-0000-000000000002', 'mock_sub_unknown', 'active',
    null, 0, '2026-09-16T00:00:00Z', '2026-08-16T01:00:00Z', 'stripe'
  ) ->> 'reason_code',
  'no_subscription',
  'an event for an organization with no subscription is refused'
);
select is(
  (select membership::text from public.orgs where id = '71000000-0000-0000-0000-000000000002'),
  'trial',
  'an organization with no subscription keeps the rung it had'
);

-- ---------------------------------------------------------------------------
-- The audit trail
-- ---------------------------------------------------------------------------

select is(
  (
    select count(*)::integer
    from public.audit_log
    where org_id = '71000000-0000-0000-0000-000000000001'
      and action = 'billing.membership_change'
  ),
  13,
  'every rung change wrote exactly one attribution row and nothing else did'
);

select is(
  (
    select count(*)::integer
    from public.audit_log
    where org_id = '71000000-0000-0000-0000-000000000001'
      and action = 'billing.membership_change'
      and subject_type = 'org'
      and subject_id = '71000000-0000-0000-0000-000000000001'
      and client_id is null
      and actor_profile_id is null
  ),
  13,
  'billing attribution rows anchor on the organization and name no client or actor'
);

select results_eq(
  $$
    select distinct meta_key
    from public.audit_log,
      lateral jsonb_object_keys(meta) as meta_key
    where org_id = '71000000-0000-0000-0000-000000000001'
      and action = 'billing.membership_change'
    order by 1
  $$,
  $$ values ('from_state'), ('reason_code'), ('source'), ('status'), ('to_state') $$,
  'billing attribution metadata uses only allow-listed keys'
);

-- ---------------------------------------------------------------------------
-- Membership containment: the other three functions are privileged too
-- ---------------------------------------------------------------------------

select public.operator_billing_upsert_subscription(
  '71000000-0000-0000-0000-000000000003',
  'mock',
  'mock_cus_containment',
  'mock_sub_containment',
  'mock_si_base_containment',
  'mock_si_seat_containment',
  'mock_price_operator_base',
  'mock_price_operator_seat',
  'incomplete',
  '2026-09-16T00:00:00Z'
);
select is(
  (select membership::text from public.orgs where id = '71000000-0000-0000-0000-000000000003'),
  'trial',
  'starting a subscription does not move a rung — only an applied event does'
);

insert into public.operator_seat_sync_outbox (org_id, desired_quantity)
values ('71000000-0000-0000-0000-000000000003', 3);

select public.operator_billing_set_seat_quantity(
  '71000000-0000-0000-0000-000000000003',
  3,
  (select generation from public.operator_seat_sync_outbox where org_id = '71000000-0000-0000-0000-000000000003'),
  'route'
);
select is(
  (select membership::text from public.orgs where id = '71000000-0000-0000-0000-000000000003'),
  'trial',
  'recording a seat quantity does not move a rung'
);
select is(
  (select seat_quantity from public.operator_subscriptions where org_id = '71000000-0000-0000-0000-000000000003'),
  3,
  'recording a seat quantity writes the subscription row'
);
select is(
  (select status from public.operator_seat_sync_outbox where org_id = '71000000-0000-0000-0000-000000000003'),
  'synced',
  'recording the quantity the outbox asked for marks that row synced'
);

select public.operator_billing_change_plan(
  '71000000-0000-0000-0000-000000000003', 'agency', 'mock_price_operator_base_agency'
);
select is(
  (select plan::text from public.orgs where id = '71000000-0000-0000-0000-000000000003'),
  'agency',
  'a plan tier change writes the plan column through the guard'
);
select is(
  (select membership::text from public.orgs where id = '71000000-0000-0000-0000-000000000003'),
  'trial',
  'a plan tier change does not move a rung'
);

select is(
  (
    select count(*)::integer
    from public.audit_log
    where org_id = '71000000-0000-0000-0000-000000000003'
      and action = 'billing.membership_change'
  ),
  0,
  'no function other than the ladder writes a membership change'
);

-- ---------------------------------------------------------------------------
-- Re-attaching a subscription, and a seat write with nothing to write to
--
-- The service layer calls the upsert every time it reconciles rather than only
-- once, so the conflict branch is the path that actually runs in production and
-- it needs its own oracle. The seat write against an organization that has no
-- subscription is the same argument from the other side: it must report the
-- refusal rather than raise, because the drain treats a raise as retryable.
-- ---------------------------------------------------------------------------

select is(
  public.operator_billing_upsert_subscription(
    '71000000-0000-0000-0000-000000000003',
    'mock',
    'mock_cus_containment',
    'mock_sub_containment',
    'mock_si_base_containment',
    'mock_si_seat_containment',
    'mock_price_operator_base',
    'mock_price_operator_seat',
    'active',
    null
  ) ->> 'created',
  'false',
  'reconciling an organization that already has a subscription updates rather than duplicates'
);
select is(
  (
    select current_period_end
    from public.operator_subscriptions
    where org_id = '71000000-0000-0000-0000-000000000003'
  ),
  '2026-09-16T00:00:00Z'::timestamptz,
  'a reconcile that carries no period end keeps the one already recorded'
);

select is(
  public.operator_billing_set_seat_quantity(
    '71000000-0000-0000-0000-000000000002',
    2,
    '71000000-0000-0000-0000-000000000099',
    'route'
  ) ->> 'reason_code',
  'no_subscription',
  'a seat write against an organization with no subscription is refused rather than raised'
);

-- ---------------------------------------------------------------------------
-- Function shape and grants
-- 2026-08-17 R2C-07 carry: seat completion includes the outbox generation.
-- 2026-08-17 R2C-06 carry: two durable creation-intent RPCs raise this family to seven.
-- ---------------------------------------------------------------------------

-- 2026-08-17 R1C-04: the convergent equal-timestamp wrapper is the fifth billing RPC.

-- 2026-08-17 R3C-06: expired-checkout recovery added the eighth carried
-- operator-billing function. Bind both the inventory and the property so an
-- unrelated extra function cannot hide a regression in an existing one.
--
-- 2026-08-18 (integrator, round 4): the binding was `count(*) = 8`, so R4C-09
-- adding a ninth function correctly turned both assertions red while telling
-- the reader nothing about what appeared. A bare count is also the weaker
-- guard — it cannot distinguish "someone added a function" from "someone
-- deleted one and added another". The inventory is now the sorted name set, so
-- an addition fails with the new name in the diff and the fix is to add the
-- name deliberately rather than to bump a number under time pressure. The
-- property itself is derived over whatever is present, not over a count.
select is(
  (
    select array_agg(f.proname order by f.proname)
    from pg_proc as f
    join pg_namespace as n on n.oid = f.pronamespace
    where n.nspname = 'public'
      and f.proname like 'operator_billing_%'
  ),
  array[
    'operator_billing_apply_event',
    'operator_billing_apply_event_convergent',
    'operator_billing_change_plan',
    'operator_billing_claim_subscription_intent',
    'operator_billing_complete_subscription_intent',
    'operator_billing_fail_expired_checkout_intent',
    'operator_billing_review_subscription_intent',
    'operator_billing_set_seat_quantity',
    'operator_billing_upsert_subscription'
  ]::name[],
  'the operator-billing inventory is exactly the nine declared functions'
);

-- Postgres stores `set search_path = ''` as the proconfig element
-- `search_path=""`, quotes included, so the empty form is matched too rather
-- than assuming one spelling. Both properties below are derived over every
-- function the inventory assertion above pins, so a function added without
-- either hardening fails here by name.
select is(
  (
    select bool_and(f.prosecdef) and bool_and(exists (
      select 1
      from unnest(f.proconfig) as config_entry
      where config_entry in ('search_path=', 'search_path=""')
    ))
    from pg_proc as f
    join pg_namespace as n on n.oid = f.pronamespace
    where n.nspname = 'public'
      and f.proname like 'operator_billing_%'
  ),
  true,
  'every billing function is security definer and pins an empty search path'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.operator_billing_apply_event(text,text,uuid,text,text,timestamptz,integer,timestamptz,timestamptz,text)',
    'EXECUTE'
  ),
  'service_role may execute the ladder function'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.operator_billing_upsert_subscription(uuid,text,text,text,text,text,text,text,text,timestamptz)',
    'EXECUTE'
  ),
  'service_role may execute the subscription upsert'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.operator_billing_set_seat_quantity(uuid,integer,uuid,text)',
    'EXECUTE'
  ),
  'service_role may execute the seat quantity write'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.operator_billing_change_plan(uuid,text,text)',
    'EXECUTE'
  ),
  'service_role may execute the plan tier change'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.operator_billing_apply_event(text,text,uuid,text,text,timestamptz,integer,timestamptz,timestamptz,text)',
    'EXECUTE'
  ),
  'authenticated may not execute the ladder function'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.operator_billing_upsert_subscription(uuid,text,text,text,text,text,text,text,text,timestamptz)',
    'EXECUTE'
  ),
  'authenticated may not execute the subscription upsert'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.operator_billing_set_seat_quantity(uuid,integer,uuid,text)',
    'EXECUTE'
  ),
  'authenticated may not execute the seat quantity write'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.operator_billing_change_plan(uuid,text,text)',
    'EXECUTE'
  ),
  'authenticated may not execute the plan tier change'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.operator_billing_apply_event(text,text,uuid,text,text,timestamptz,integer,timestamptz,timestamptz,text)',
    'EXECUTE'
  ),
  'anon may not execute the ladder function'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.operator_billing_upsert_subscription(uuid,text,text,text,text,text,text,text,text,timestamptz)',
    'EXECUTE'
  ),
  'anon may not execute the subscription upsert'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.operator_billing_set_seat_quantity(uuid,integer,uuid,text)',
    'EXECUTE'
  ),
  'anon may not execute the seat quantity write'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.operator_billing_change_plan(uuid,text,text)',
    'EXECUTE'
  ),
  'anon may not execute the plan tier change'
);

set local role authenticated;
select throws_ok(
  $$
    select public.operator_billing_apply_event(
      'evt_mock_ladder_denied', 'invoice.paid',
      '71000000-0000-0000-0000-000000000001', 'mock_sub_ladder', 'active',
      null, 0, null, '2027-02-16T00:00:00Z', 'stripe'
    )
  $$,
  '42501',
  null,
  'an authenticated session cannot call the ladder function'
);
reset role;

set local role anon;
select throws_ok(
  $$
    select public.operator_billing_apply_event(
      'evt_mock_ladder_denied', 'invoice.paid',
      '71000000-0000-0000-0000-000000000001', 'mock_sub_ladder', 'active',
      null, 0, null, '2027-02-16T00:00:00Z', 'stripe'
    )
  $$,
  '42501',
  null,
  'an anonymous caller cannot call the ladder function'
);
reset role;

select * from finish();

rollback;
