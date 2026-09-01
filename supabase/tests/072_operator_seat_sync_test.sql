-- 072_operator_seat_sync_test.sql — the executable contract for seat capture.
--
-- Two things are being proven here, and the second one is the reason this suite
-- opens and closes with an audit_log count. The first is arithmetic: a member
-- added to or taken off an organization produces the right billable quantity,
-- which is the overage above the included allowance. The second is that the
-- trigger stays out of everyone else's way — it enqueues nothing for an
-- organization with no subscription, and it writes no audit row, so Phase 1's
-- seed audit-composition assertion in 004_seed_isolation.test.sql is
-- arithmetically unchanged. That assertion is the exact one lane B tripped and
-- had to escalate; not repeating it is a design constraint, not a courtesy.
--
-- Fixture identifiers carry the 72000000 prefix and the whole file rolls back.

create extension if not exists pgtap with schema extensions;

begin;

set local search_path = public, extensions;

select plan(30);

create temporary table seat_sync_audit_snapshot on commit drop as
select count(*)::integer as opening from public.audit_log;

-- ---------------------------------------------------------------------------
-- Fixtures
--
-- Org A carries a subscription and an allowance of five, so its billable count
-- is the overage. Org B carries a subscription and an allowance of zero, so
-- every member counts and a member moving between the two changes both numbers
-- in a way one assertion can tell apart. Org C carries no subscription at all.
-- ---------------------------------------------------------------------------

insert into public.orgs (id, name, slug, seats_included)
values
  ('72000000-0000-0000-0000-000000000001', 'Seat Sync Org A', 'seat-sync-org-a', 5),
  ('72000000-0000-0000-0000-000000000002', 'Seat Sync Org B', 'seat-sync-org-b', 0),
  ('72000000-0000-0000-0000-000000000003', 'Seat Sync Org C', 'seat-sync-org-c', 5);

insert into public.operator_subscriptions (org_id, provider, base_price_ref, seat_price_ref)
values
  ('72000000-0000-0000-0000-000000000001', 'mock', 'mock_price_operator_base', 'mock_price_operator_seat'),
  ('72000000-0000-0000-0000-000000000002', 'mock', 'mock_price_operator_base', 'mock_price_operator_seat');

select has_function(
  'private',
  'operator_seat_outbox_enqueue',
  'the seat capture function exists'
);
select has_trigger(
  'public',
  'profiles',
  'profiles_operator_seat_sync',
  'members joining or leaving an organization are captured'
);
select has_trigger(
  'public',
  'profiles',
  'profiles_operator_seat_sync_update',
  'a member moving between organizations is captured'
);

-- ---------------------------------------------------------------------------
-- An organization with no subscription enqueues nothing
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, raw_app_meta_data)
select
  ('72000000-0000-0000-0000-0000000003' || lpad(n::text, 2, '0'))::uuid,
  'seat.sync.c' || n || '@test.example',
  jsonb_build_object(
    'app_role', 'operator_member',
    'full_name', 'Seat Sync C Member ' || n,
    'org_id', '72000000-0000-0000-0000-000000000003',
    'org_role', 'prep_specialist'
  )
from generate_series(1, 3) as n;

select is(
  (
    select count(*)::integer
    from public.operator_seat_sync_outbox
    where org_id = '72000000-0000-0000-0000-000000000003'
  ),
  0,
  'an organization with no subscription enqueues nothing, so seeding stays quiet'
);

-- ---------------------------------------------------------------------------
-- Seven members against an allowance of five
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, raw_app_meta_data)
select
  ('72000000-0000-0000-0000-0000000001' || lpad(n::text, 2, '0'))::uuid,
  'seat.sync.a' || n || '@test.example',
  jsonb_build_object(
    'app_role', 'operator_member',
    'full_name', 'Seat Sync A Member ' || n,
    'org_id', '72000000-0000-0000-0000-000000000001',
    'org_role', 'prep_specialist'
  )
from generate_series(1, 7) as n;

select is(
  (
    select count(*)::integer
    from public.operator_seat_sync_outbox
    where org_id = '72000000-0000-0000-0000-000000000001'
  ),
  1,
  'seven member additions leave exactly one outbox row'
);
select is(
  (
    select desired_quantity
    from public.operator_seat_sync_outbox
    where org_id = '72000000-0000-0000-0000-000000000001'
  ),
  2,
  'the billable quantity is the overage above the included allowance'
);
select is(
  (
    select status
    from public.operator_seat_sync_outbox
    where org_id = '72000000-0000-0000-0000-000000000001'
  ),
  'pending',
  'a captured seat change waits to be drained'
);

-- ---------------------------------------------------------------------------
-- A seat count decrease
-- ---------------------------------------------------------------------------

delete from auth.users
where id in (
  '72000000-0000-0000-0000-000000000106',
  '72000000-0000-0000-0000-000000000107'
);

select is(
  (
    select count(*)::integer
    from public.operator_seat_sync_outbox
    where org_id = '72000000-0000-0000-0000-000000000001'
  ),
  1,
  'a seat count decrease reuses the same outbox row rather than adding one'
);
select is(
  (
    select desired_quantity
    from public.operator_seat_sync_outbox
    where org_id = '72000000-0000-0000-0000-000000000001'
  ),
  0,
  'five members against an allowance of five is nothing billable'
);

-- ---------------------------------------------------------------------------
-- A member moving between two organizations changes both counts
-- ---------------------------------------------------------------------------

update public.profiles
set org_id = '72000000-0000-0000-0000-000000000002'
where id = '72000000-0000-0000-0000-000000000105';

select is(
  (
    select desired_quantity
    from public.operator_seat_sync_outbox
    where org_id = '72000000-0000-0000-0000-000000000001'
  ),
  0,
  'the organization the member left is recomputed'
);
select is(
  (
    select desired_quantity
    from public.operator_seat_sync_outbox
    where org_id = '72000000-0000-0000-0000-000000000002'
  ),
  1,
  'the organization the member joined is recomputed'
);

-- ---------------------------------------------------------------------------
-- Only operator members are seats
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, raw_app_meta_data)
values (
  '72000000-0000-0000-0000-000000000201',
  'seat.sync.consumer@test.example',
  jsonb_build_object(
    'app_role', 'consumer',
    'full_name', 'Seat Sync Consumer',
    'org_id', '72000000-0000-0000-0000-000000000001'
  )
);

select is(
  (
    select desired_quantity
    from public.operator_seat_sync_outbox
    where org_id = '72000000-0000-0000-0000-000000000001'
  ),
  0,
  'a consumer profile is not a seat'
);

select is(
  (
    select count(*)::integer
    from public.operator_seat_sync_outbox
    where org_id in (
      '72000000-0000-0000-0000-000000000001',
      '72000000-0000-0000-0000-000000000002',
      '72000000-0000-0000-0000-000000000003'
    )
  ),
  2,
  'across every change the outbox holds one row per subscribed organization and none for the rest'
);

-- ---------------------------------------------------------------------------
-- Nothing this suite did touched the audit trail
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::integer from public.audit_log),
  (select opening from seat_sync_audit_snapshot),
  'seat capture writes no audit row, so the seed audit composition is unchanged'
);

-- Postgres stores `set search_path = ''` as the proconfig element
-- `search_path=""`, quotes included, so the empty form is matched too rather
-- than assuming one spelling.
select ok(
  (
    select count(*)::integer
    from pg_proc as f
    join pg_namespace as n on n.oid = f.pronamespace
    where n.nspname = 'private'
      and f.proname = 'operator_seat_outbox_enqueue'
      and exists (
        select 1
        from unnest(f.proconfig) as config_entry
        where config_entry in ('search_path=', 'search_path=""')
      )
  ) = 1,
  'the seat capture function pins an empty search path'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'private.operator_seat_outbox_enqueue()',
    'EXECUTE'
  ),
  'the seat capture function is not callable by an authenticated session'
);

-- ---------------------------------------------------------------------------
-- Recording a drain failure (migration 073)
--
-- These run last on purpose. The final assertion calls
-- operator_billing_set_seat_quantity, which writes an attribution row, so it
-- has to land after the audit-composition assertion above rather than before
-- it. The whole file still rolls back.
-- 2026-08-17 R2C-07 carry: both drain verdicts bind the observed generation.
-- ---------------------------------------------------------------------------

select has_function(
  'public',
  'operator_seat_sync_record_failure',
  array['uuid', 'uuid', 'text'],
  'the drain failure recorder exists'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.operator_seat_sync_record_failure(uuid, uuid, text)',
    'EXECUTE'
  ),
  'the drain failure recorder is not callable by an authenticated session'
);
select ok(
  (
    select count(*)::integer
    from pg_proc as f
    join pg_namespace as n on n.oid = f.pronamespace
    where n.nspname = 'public'
      and f.proname = 'operator_seat_sync_record_failure'
      and exists (
        select 1
        from unnest(f.proconfig) as config_entry
        where config_entry in ('search_path=', 'search_path=""')
      )
  ) = 1,
  'the drain failure recorder pins an empty search path'
);

select is(
  (
    select public.operator_seat_sync_record_failure(
      '72000000-0000-0000-0000-000000000001',
      (select generation from public.operator_seat_sync_outbox where org_id = '72000000-0000-0000-0000-000000000001'),
      'provider_unavailable'
    )
  )->>'reason_code',
  'recorded',
  'a failed drain against a pending row is recorded'
);
select is(
  (
    select attempts
    from public.operator_seat_sync_outbox
    where org_id = '72000000-0000-0000-0000-000000000001'
  ),
  1,
  'the first recorded failure counts one attempt'
);
select is(
  (
    select status || '/' || coalesce(last_error_code, 'null') || '/' ||
           coalesce(processed_at::text, 'null')
    from public.operator_seat_sync_outbox
    where org_id = '72000000-0000-0000-0000-000000000001'
  ),
  'pending/provider_unavailable/null',
  'the row stays pending with a short error code and no processed_at, so the next drain picks it up'
);

select is(
  (
    select public.operator_seat_sync_record_failure(
      '72000000-0000-0000-0000-000000000001',
      (select generation from public.operator_seat_sync_outbox where org_id = '72000000-0000-0000-0000-000000000001'),
      'provider_unavailable'
    )
  )->>'attempts',
  '2',
  'a second failure increments the attempt count rather than resetting it'
);

select is(
  (
    select public.operator_seat_sync_record_failure(
      '72000000-0000-0000-0000-000000000003',
      '72000000-0000-0000-0000-000000000099',
      'provider_unavailable'
    )
  )->>'reason_code',
  'no_outbox_row',
  'an organization with nothing queued is reported rather than silently written'
);

-- The race the function exists to refuse: the quantity landed and the webhook
-- marked the row synced while the drain was still waiting on the provider.
select is(
  (
    select public.operator_billing_set_seat_quantity(
      '72000000-0000-0000-0000-000000000001',
      0,
      (select generation from public.operator_seat_sync_outbox where org_id = '72000000-0000-0000-0000-000000000001'),
      'test'
    )
  )->>'outbox_status',
  'synced',
  'a successful sync closes the outbox row'
);

select is(
  (
    select public.operator_seat_sync_record_failure(
      '72000000-0000-0000-0000-000000000001',
      (select generation from public.operator_seat_sync_outbox where org_id = '72000000-0000-0000-0000-000000000001'),
      'provider_unavailable'
    )
  )->>'reason_code',
  'not_pending',
  'a row a successful sync already closed is not reopened by a late failure report'
);
select is(
  (
    select attempts
    from public.operator_seat_sync_outbox
    where org_id = '72000000-0000-0000-0000-000000000001'
  ),
  2,
  'the refused report leaves the attempt count where the successful sync left it'
);

-- ---------------------------------------------------------------------------
-- Migration 074: the three properties that let this trigger fire for GoTrue.
--
-- pgTAP runs as an owner that holds every privilege, so a behavioural test here
-- cannot see the failure these assert against — deleting a user through
-- Supabase Auth cascades to public.profiles and fires this trigger as
-- supabase_auth_admin, which holds no grant on the three tables it reads and
-- writes. The e2e suite is what caught it; these keep the fix from being
-- reverted by someone reading migration 072 in isolation.
-- ---------------------------------------------------------------------------
select is(
  (
    select p.prosecdef
    from pg_proc as p
    join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname = 'operator_seat_outbox_enqueue'
  ),
  true,
  'the seat outbox trigger runs as its owner, so every writer of public.profiles can fire it'
);

select is(
  (
    select r.rolbypassrls
    from pg_proc as p
    join pg_roles as r on r.oid = p.proowner
    join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname = 'operator_seat_outbox_enqueue'
  ),
  true,
  'its owner bypasses row security, which is what lets it write the FORCE RLS outbox with no insert policy'
);

select ok(
  (
    -- Postgres stores the empty setting quoted, as search_path="". ANY is a
    -- grammar construct rather than a pg_catalog entry, so it stays bare.
    select 'search_path=""' = any(p.proconfig)
    from pg_proc as p
    join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname = 'operator_seat_outbox_enqueue'
  ),
  'and it still pins an empty search_path, which is the half that makes a definer function safe'
);

select * from finish();

rollback;
