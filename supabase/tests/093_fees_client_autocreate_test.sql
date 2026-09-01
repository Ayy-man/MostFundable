-- 093_fees_client_autocreate_test.sql
--
-- FEES-03: a new client inherits its workspace's fee default. Two conditions
-- make that safe to attach to Phase 1's `clients` table, and both are load
-- bearing:
--
--   * The trigger returns early unless the org has actually configured a
--     default. Without it, `supabase db reset` would create fee rows for every
--     seeded client and 004_seed_isolation would start counting them.
--   * It writes no audit_log row. Lane B broke 004_seed_isolation by doing the
--     audit-composition version of this (12-CONTEXT D-06), and a Phase-1 test
--     failing because of another lane's migration is precisely the merge-day
--     failure the convention exists to prevent.
--
-- Every audit assertion below is a delta against a snapshot taken immediately
-- before the insert, because this file also opens and closes a legal gate, and
-- that legitimately does write audit rows.

begin;

create extension if not exists pgtap with schema extensions;

set local search_path = public, extensions;

select plan(32);

-- ---------------------------------------------------------------------------
-- Fixtures. Four organizations: no default, a percentage default, a package
-- default whose gate is later closed, and a package default whose gate stays
-- open.
-- ---------------------------------------------------------------------------

insert into public.orgs (id, name, slug)
values
  ('00000000-0000-0000-0000-0000000012a1', 'Phase 12 Seed Org None', 'phase-12-seed-none'),
  ('00000000-0000-0000-0000-0000000012a2', 'Phase 12 Seed Org Pct', 'phase-12-seed-pct'),
  ('00000000-0000-0000-0000-0000000012a3', 'Phase 12 Seed Org Closed', 'phase-12-seed-closed'),
  ('00000000-0000-0000-0000-0000000012a4', 'Phase 12 Seed Org Open', 'phase-12-seed-open');

insert into auth.users (id, email, raw_app_meta_data)
values
  (
    '00000000-0000-0000-0000-0000000012b0',
    'admin.phase12-seed@test.example',
    jsonb_build_object('app_role', 'platform_admin', 'full_name', 'Seed Platform Admin')
  ),
  (
    '00000000-0000-0000-0000-0000000012b1',
    'owner.none.phase12-seed@test.example',
    jsonb_build_object(
      'app_role', 'operator_member', 'full_name', 'Seed Org None Owner',
      'org_id', '00000000-0000-0000-0000-0000000012a1', 'org_role', 'owner'
    )
  ),
  (
    '00000000-0000-0000-0000-0000000012b2',
    'owner.pct.phase12-seed@test.example',
    jsonb_build_object(
      'app_role', 'operator_member', 'full_name', 'Seed Org Pct Owner',
      'org_id', '00000000-0000-0000-0000-0000000012a2', 'org_role', 'owner'
    )
  ),
  (
    '00000000-0000-0000-0000-0000000012b3',
    'owner.closed.phase12-seed@test.example',
    jsonb_build_object(
      'app_role', 'operator_member', 'full_name', 'Seed Org Closed Owner',
      'org_id', '00000000-0000-0000-0000-0000000012a3', 'org_role', 'owner'
    )
  ),
  (
    '00000000-0000-0000-0000-0000000012b4',
    'owner.open.phase12-seed@test.example',
    jsonb_build_object(
      'app_role', 'operator_member', 'full_name', 'Seed Org Open Owner',
      'org_id', '00000000-0000-0000-0000-0000000012a4', 'org_role', 'owner'
    )
  );

insert into public.profiles (id, role, org_id, org_role, full_name, email)
values
  ('00000000-0000-0000-0000-0000000012b0', 'platform_admin', null, null,
   'Seed Platform Admin', 'admin.phase12-seed@test.example'),
  ('00000000-0000-0000-0000-0000000012b1', 'operator_member', '00000000-0000-0000-0000-0000000012a1', 'owner',
   'Seed Org None Owner', 'owner.none.phase12-seed@test.example'),
  ('00000000-0000-0000-0000-0000000012b2', 'operator_member', '00000000-0000-0000-0000-0000000012a2', 'owner',
   'Seed Org Pct Owner', 'owner.pct.phase12-seed@test.example'),
  ('00000000-0000-0000-0000-0000000012b3', 'operator_member', '00000000-0000-0000-0000-0000000012a3', 'owner',
   'Seed Org Closed Owner', 'owner.closed.phase12-seed@test.example'),
  ('00000000-0000-0000-0000-0000000012b4', 'operator_member', '00000000-0000-0000-0000-0000000012a4', 'owner',
   'Seed Org Open Owner', 'owner.open.phase12-seed@test.example')
on conflict (id) do update
set
  role = excluded.role,
  org_id = excluded.org_id,
  org_role = excluded.org_role,
  full_name = excluded.full_name,
  email = excluded.email;

-- ===========================================================================
-- The trigger's shape.
-- ===========================================================================

select has_trigger(
  'public', 'clients', 'clients_fee_seed_from_default',
  'public.clients carries the fee seeding trigger'
);

select trigger_is(
  'public', 'clients', 'clients_fee_seed_from_default',
  'private', 'fee_seed_client_from_default',
  'and it runs private.fee_seed_client_from_default'
);

select is(
  (select prosecdef from pg_catalog.pg_proc
   where oid = 'private.fee_seed_client_from_default()'::regprocedure),
  false,
  'the seeding trigger is security invoker, so it can never create a fee row the caller could not have created'
);

select is(
  (select count(*)::integer from pg_catalog.pg_trigger
   where tgrelid = 'public.clients'::regclass and not tgisinternal),
  -- 2026-08-17 R1A-03 adds the governed-write guard; 2026-08-17 R2A-09
  -- adds fixed-action insert and metadata audit triggers; 2026-08-17 R3A-05
  -- adds the canonical insert-lifecycle normalizer. Migration 398 adds the
  -- assignment-history capture trigger. Migration 418 adds the affiliate
  -- commission recalculation trigger.
  9,
  'public.clients carries the role, fee seed, cap, governed-write, assignment, and commission triggers'
);

-- ===========================================================================
-- An organization with no configured default: nothing happens at all.
-- ===========================================================================

create temp table p12_audit_before_none as
select count(*)::integer as n from public.audit_log;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'authenticated', 'sub', '00000000-0000-0000-0000-0000000012b1')::text,
  true
);

select lives_ok(
  $$
    insert into public.clients (id, org_id, display_name)
    values ('00000000-0000-0000-0000-0000000012c1', '00000000-0000-0000-0000-0000000012a1', 'Seed Client None')
  $$,
  'a client can be created in an organization that has configured no fee default'
);

reset role;

select is(
  (select count(*)::integer from public.fee_agreements
   where client_id = '00000000-0000-0000-0000-0000000012c1'),
  0,
  'and no fee agreement is invented for it — this is what keeps supabase db reset from creating fee rows for every seeded client'
);

select is(
  (select count(*)::integer from public.fee_ledger
   where client_id = '00000000-0000-0000-0000-0000000012c1'),
  0,
  'and no ledger row either'
);

select is(
  (select count(*)::integer from public.audit_log),
  (select n + 1 from p12_audit_before_none),
  'and the fixed-action client-create audit is the only audit delta'
);

-- ===========================================================================
-- An organization with a percentage default: exactly one of each row.
-- ===========================================================================

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'authenticated', 'sub', '00000000-0000-0000-0000-0000000012b2')::text,
  true
);

select lives_ok(
  $$
    select public.fees_set_org_default(
      '00000000-0000-0000-0000-0000000012a2', 'percentage', 12.50, null, null, null, null
    )
  $$,
  'the workspace configures a percentage default'
);

reset role;

create temp table p12_audit_before_pct as
select count(*)::integer as n from public.audit_log;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'authenticated', 'sub', '00000000-0000-0000-0000-0000000012b2')::text,
  true
);

select lives_ok(
  $$
    insert into public.clients (id, org_id, display_name)
    values ('00000000-0000-0000-0000-0000000012c2', '00000000-0000-0000-0000-0000000012a2', 'Seed Client Pct')
  $$,
  'a client created in that organization inherits it'
);

-- Repeating the trigger's own statement must be a no-op rather than a
-- duplicate-key error, because a trigger that can throw on a second firing is a
-- trigger that can fail a Phase-1 write.
select lives_ok(
  $$
    insert into public.fee_agreements (
      client_id, org_id, model, pct, upfront_cents, success_cents,
      trigger_cents, custom_total_cents, status, source
    )
    select
      '00000000-0000-0000-0000-0000000012c2', defaults.org_id, defaults.model, defaults.pct,
      defaults.upfront_cents, defaults.success_cents, defaults.trigger_cents,
      defaults.custom_total_cents, 'draft', 'workspace_default'
    from public.org_fee_defaults as defaults
    where defaults.org_id = '00000000-0000-0000-0000-0000000012a2'
    on conflict (client_id) do nothing
  $$,
  'and running the seeding insert a second time does nothing rather than raising'
);

reset role;

select is(
  (select count(*)::integer from public.fee_agreements
   where client_id = '00000000-0000-0000-0000-0000000012c2'),
  1,
  'exactly one agreement exists after both'
);

select is(
  (select source from public.fee_agreements
   where client_id = '00000000-0000-0000-0000-0000000012c2'),
  'workspace_default',
  'it is marked as coming from the workspace default rather than from an operator'
);

select is(
  (select status::text from public.fee_agreements
   where client_id = '00000000-0000-0000-0000-0000000012c2'),
  'draft',
  'and it lands as a draft, because inheriting a default is not the same as agreeing one'
);

select is(
  (select model::text from public.fee_agreements
   where client_id = '00000000-0000-0000-0000-0000000012c2'),
  'percentage',
  'the model is carried across'
);

select is(
  (select pct from public.fee_agreements
   where client_id = '00000000-0000-0000-0000-0000000012c2'),
  12.50::numeric(5, 2),
  'and so is the rate'
);

select is(
  (select count(*)::integer from public.fee_ledger
   where client_id = '00000000-0000-0000-0000-0000000012c2'),
  1,
  'a ledger row is created alongside it'
);

select is(
  (select total_cents from public.fee_ledger
   where client_id = '00000000-0000-0000-0000-0000000012c2'),
  0::bigint,
  'with a total of zero, because a percentage of an outcome nobody has approved yet is zero (D-08)'
);

select is(
  (select count(*)::integer from public.audit_log),
  (select n + 2 from p12_audit_before_pct),
  'and the fixed-action client and inherited-agreement audits are the only audit delta'
);

-- ===========================================================================
-- A package default with the gate open seeds a package agreement.
-- ===========================================================================

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'authenticated', 'sub', '00000000-0000-0000-0000-0000000012b0')::text,
  true
);
select lives_ok(
  $$
    select public.org_flags_set_upfront_fee_approved(
      '00000000-0000-0000-0000-0000000012a4', true, 'LGL-2026-0099'
    )
  $$,
  'a platform admin opens the gate for the open organization'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'authenticated', 'sub', '00000000-0000-0000-0000-0000000012b4')::text,
  true
);

select lives_ok(
  $$
    select public.fees_set_org_default(
      '00000000-0000-0000-0000-0000000012a4', 'package', null, 150000, 250000, null, null
    )
  $$,
  'the gated workspace can configure a package default'
);

select lives_ok(
  $$
    insert into public.clients (id, org_id, display_name)
    values ('00000000-0000-0000-0000-0000000012c4', '00000000-0000-0000-0000-0000000012a4', 'Seed Client Open')
  $$,
  'and a new client inherits it'
);

reset role;

select is(
  (select model::text from public.fee_agreements
   where client_id = '00000000-0000-0000-0000-0000000012c4'),
  'package',
  'the seeded agreement is the package one the workspace configured'
);

-- ===========================================================================
-- The same default with the gate closed seeds nothing, and does not take the
-- client creation down with it.
-- ===========================================================================

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'authenticated', 'sub', '00000000-0000-0000-0000-0000000012b0')::text,
  true
);
select lives_ok(
  $$
    select public.org_flags_set_upfront_fee_approved(
      '00000000-0000-0000-0000-0000000012a3', true, 'LGL-2026-0100'
    )
  $$,
  'the gate is opened for the third organization so a package default can be recorded'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'authenticated', 'sub', '00000000-0000-0000-0000-0000000012b3')::text,
  true
);
select lives_ok(
  $$
    select public.fees_set_org_default(
      '00000000-0000-0000-0000-0000000012a3', 'package', null, 150000, 250000, null, null
    )
  $$,
  'and the package default is recorded while it is open'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'authenticated', 'sub', '00000000-0000-0000-0000-0000000012b0')::text,
  true
);
select lives_ok(
  $$
    select public.org_flags_set_upfront_fee_approved(
      '00000000-0000-0000-0000-0000000012a3', false, null
    )
  $$,
  'then the gate is closed again, leaving a stale package default behind'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'authenticated', 'sub', '00000000-0000-0000-0000-0000000012b3')::text,
  true
);

select lives_ok(
  $$
    insert into public.clients (id, org_id, display_name)
    values ('00000000-0000-0000-0000-0000000012c3', '00000000-0000-0000-0000-0000000012a3', 'Seed Client Closed')
  $$,
  'creating a client still works, because a fee trigger must never be able to fail another lane''s write'
);

reset role;

select is(
  (select count(*)::integer from public.clients
   where id = '00000000-0000-0000-0000-0000000012c3'),
  1,
  'the client row is really there rather than rolled back'
);

select is(
  (select count(*)::integer from public.fee_agreements
   where client_id = '00000000-0000-0000-0000-0000000012c3'),
  0,
  'and no package agreement was seeded, because the gate trigger fires on the seeding insert too'
);

select is(
  (select count(*)::integer from public.fee_ledger
   where client_id = '00000000-0000-0000-0000-0000000012c3'),
  0,
  'and no ledger row, since the two inserts share the trigger''s single attempt'
);

-- ===========================================================================
-- The seed-isolation mirror.
-- ===========================================================================

select is(
  (select count(*)::integer from public.fee_agreements
   where client_id not in (
     '00000000-0000-0000-0000-0000000012c1',
     '00000000-0000-0000-0000-0000000012c2',
     '00000000-0000-0000-0000-0000000012c3',
     '00000000-0000-0000-0000-0000000012c4'
   )),
  0,
  'no fee agreement exists anywhere outside this file''s fixtures, so seeding the database creates none'
);

select is(
  (select count(*)::integer from public.fee_ledger
   where client_id not in (
     '00000000-0000-0000-0000-0000000012c1',
     '00000000-0000-0000-0000-0000000012c2',
     '00000000-0000-0000-0000-0000000012c3',
     '00000000-0000-0000-0000-0000000012c4'
   )),
  0,
  'and no ledger row either'
);

select * from finish();
rollback;
