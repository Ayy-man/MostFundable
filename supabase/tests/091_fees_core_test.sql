-- 091_fees_core_test.sql
--
-- The criterion-1 proof. ROADMAP Phase 12 says "package model unreachable
-- without org_flag", which is a claim about every writer, so the load-bearing
-- block below runs the same forbidden insert as three different roles:
-- `authenticated`, `service_role`, and the table owner. The last two are the
-- ones a policy-only design would fail, and they are the reason the gate is a
-- trigger.
--
-- Every errcode argument to throws_ok is exactly five bytes. pgTAP treats a
-- longer string as a *message* match, so a six-character 'PT403 ' would make
-- these cases pass for a reason unrelated to the SQLSTATE.
--
-- Vocabulary: a payment entered in error is reversed and an agreement withdrawn
-- is void. Neither of the two ordinary English words for those is used
-- anywhere, including in these comments and test names (12-CONTEXT D-09).

begin;

create extension if not exists pgtap with schema extensions;

set local search_path = public, extensions;

select plan(46);

-- ---------------------------------------------------------------------------
-- Fixtures.
-- ---------------------------------------------------------------------------

insert into public.orgs (id, name, slug)
values
  ('00000000-0000-0000-0000-000000001231', 'Phase 12 Fee Core Org A', 'phase-12-fee-core-a'),
  ('00000000-0000-0000-0000-000000001232', 'Phase 12 Fee Core Org B', 'phase-12-fee-core-b');

insert into auth.users (id, email, raw_app_meta_data)
values
  (
    '00000000-0000-0000-0000-000000001241',
    'owner.a.phase12-core@test.example',
    jsonb_build_object(
      'app_role', 'operator_member',
      'full_name', 'Fee Core Org A Owner',
      'org_id', '00000000-0000-0000-0000-000000001231',
      'org_role', 'owner'
    )
  ),
  (
    '00000000-0000-0000-0000-000000001242',
    'admin.phase12-core@test.example',
    jsonb_build_object(
      'app_role', 'platform_admin',
      'full_name', 'Fee Core Platform Admin'
    )
  ),
  (
    '00000000-0000-0000-0000-000000001243',
    'owner.b.phase12-core@test.example',
    jsonb_build_object(
      'app_role', 'operator_member',
      'full_name', 'Fee Core Org B Owner',
      'org_id', '00000000-0000-0000-0000-000000001232',
      'org_role', 'owner'
    )
  );

insert into public.profiles (id, role, org_id, org_role, full_name, email)
values
  (
    '00000000-0000-0000-0000-000000001241',
    'operator_member',
    '00000000-0000-0000-0000-000000001231',
    'owner',
    'Fee Core Org A Owner',
    'owner.a.phase12-core@test.example'
  ),
  (
    '00000000-0000-0000-0000-000000001242',
    'platform_admin',
    null,
    null,
    'Fee Core Platform Admin',
    'admin.phase12-core@test.example'
  ),
  (
    '00000000-0000-0000-0000-000000001243',
    'operator_member',
    '00000000-0000-0000-0000-000000001232',
    'owner',
    'Fee Core Org B Owner',
    'owner.b.phase12-core@test.example'
  )
on conflict (id) do update
set
  role = excluded.role,
  org_id = excluded.org_id,
  org_role = excluded.org_role,
  full_name = excluded.full_name,
  email = excluded.email;

insert into public.clients (id, org_id, display_name)
values
  ('00000000-0000-0000-0000-000000001251', '00000000-0000-0000-0000-000000001231', 'Fee Core Client A1'),
  ('00000000-0000-0000-0000-000000001252', '00000000-0000-0000-0000-000000001231', 'Fee Core Client A2'),
  ('00000000-0000-0000-0000-000000001253', '00000000-0000-0000-0000-000000001232', 'Fee Core Client B1'),
  ('00000000-0000-0000-0000-000000001254', '00000000-0000-0000-0000-000000001231', 'Fee Core Client A3');

-- ===========================================================================
-- Criterion 1: the package model is unreachable without the org flag.
-- ===========================================================================
--
-- Org A has no org_flags row at all, which the gate treats identically to a row
-- reading false.

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'authenticated', 'sub', '00000000-0000-0000-0000-000000001241')::text,
  true
);

select throws_ok(
  $$
    insert into public.fee_agreements (client_id, org_id, model, upfront_cents, success_cents, source)
    values (
      '00000000-0000-0000-0000-000000001251',
      '00000000-0000-0000-0000-000000001231',
      'package', 150000, 250000, 'operator_override'
    )
  $$,
  'PT403',
  null,
  'an operator owner cannot write a package agreement for an ungated organization'
);

select throws_ok(
  $$
    insert into public.fee_agreements (client_id, org_id, model, pct, upfront_cents, source)
    values (
      '00000000-0000-0000-0000-000000001251',
      '00000000-0000-0000-0000-000000001231',
      'percentage', 10.00, 25000, 'operator_override'
    )
  $$,
  'PT403',
  null,
  'an operator owner cannot attach an upfront amount to any model for an ungated organization'
);

reset role;

-- service_role bypasses RLS entirely, which is exactly why a policy could not
-- carry criterion 1. It holds insert on this table (091 grants it on purpose,
-- so a refusal here cannot be a missing privilege) and is stopped anyway.
set local role service_role;

select throws_ok(
  $$
    insert into public.fee_agreements (client_id, org_id, model, upfront_cents, success_cents, source)
    values (
      '00000000-0000-0000-0000-000000001251',
      '00000000-0000-0000-0000-000000001231',
      'package', 150000, 250000, 'platform_admin'
    )
  $$,
  '42501',
  'FEE_AGREEMENT_ACTOR_MISMATCH',
  'service_role, which bypasses row level security, cannot write a package agreement'
);

select throws_ok(
  $$
    insert into public.fee_agreements (client_id, org_id, model, pct, upfront_cents, source)
    values (
      '00000000-0000-0000-0000-000000001251',
      '00000000-0000-0000-0000-000000001231',
      'percentage', 10.00, 25000, 'platform_admin'
    )
  $$,
  '42501',
  'FEE_AGREEMENT_ACTOR_MISMATCH',
  'service_role cannot attach an upfront amount either'
);

reset role;

-- The table owner. On this stack `postgres` is a superuser and therefore
-- bypasses row level security outright — `force row level security` removes the
-- owner's exemption but says nothing about BYPASSRLS or superuser — so a PT403
-- here is proof that the TRIGGER stopped the write and not a policy. This is
-- the case criterion 1 actually turns on, and the one a policy-only design
-- would fail.
select throws_ok(
  $$
    insert into public.fee_agreements (client_id, org_id, model, upfront_cents, success_cents, source)
    values (
      '00000000-0000-0000-0000-000000001251',
      '00000000-0000-0000-0000-000000001231',
      'package', 150000, 250000, 'platform_admin'
    )
  $$,
  '42501',
  'FEE_AGREEMENT_ACTOR_MISMATCH',
  'the table owner, which bypasses row level security, cannot write a package agreement'
);

select throws_ok(
  $$
    insert into public.fee_agreements (client_id, org_id, model, pct, upfront_cents, source)
    values (
      '00000000-0000-0000-0000-000000001251',
      '00000000-0000-0000-0000-000000001231',
      'percentage', 10.00, 25000, 'platform_admin'
    )
  $$,
  '42501',
  'FEE_AGREEMENT_ACTOR_MISMATCH',
  'the table owner cannot attach an upfront amount either'
);

-- 2026-08-17 R3A-10: the four cases above now stop at the earlier actor/source
-- guard. Clear the authenticated actor before the remaining legal-gate cases.
select pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);

select throws_ok(
  $$
    insert into public.fee_agreements (client_id, org_id, model, pct, trigger_cents, source)
    values (
      '00000000-0000-0000-0000-000000001251',
      '00000000-0000-0000-0000-000000001231',
      'percentage', 10.00, 25000, 'platform_admin'
    )
  $$,
  'PT403',
  null,
  'a trigger-payment amount is gated on the same flag as an upfront amount'
);

-- The message is pinned as well as the code, because PostgREST surfaces the
-- message as the error body and criterion 2 quotes it verbatim.
select throws_ok(
  $$
    insert into public.fee_agreements (client_id, org_id, model, upfront_cents, source)
    values (
      '00000000-0000-0000-0000-000000001251',
      '00000000-0000-0000-0000-000000001231',
      'package', 150000, 'platform_admin'
    )
  $$,
  'PT403',
  'legal_gate',
  'the gate raises the exact message criterion 2 quotes'
);

-- A zero amount is not a gated amount. Without this the gate would be a ban on
-- the columns rather than on the commercial terms.
select lives_ok(
  $$
    insert into public.fee_agreements (client_id, org_id, model, pct, upfront_cents, source)
    values (
      '00000000-0000-0000-0000-000000001254',
      '00000000-0000-0000-0000-000000001231',
      'percentage', 12.50, 0, 'operator_override'
    )
  $$,
  'a percentage agreement with a zero upfront amount is not gated'
);

-- A workspace default is the scaled version of the same write, and Log #106 is
-- literally the request to make the upfront fee the default, so it carries the
-- same gate.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'authenticated', 'sub', '00000000-0000-0000-0000-000000001241')::text,
  true
);

select throws_ok(
  $$
    insert into public.org_fee_defaults (org_id, model, upfront_cents, success_cents, updated_by)
    values (
      '00000000-0000-0000-0000-000000001231',
      'package', 150000, 250000,
      '00000000-0000-0000-0000-000000001241'
    )
  $$,
  'PT403',
  null,
  'an operator owner cannot make the package model the workspace default'
);

reset role;
set local role service_role;

select throws_ok(
  $$
    insert into public.org_fee_defaults (org_id, model, upfront_cents, success_cents, updated_by)
    values (
      '00000000-0000-0000-0000-000000001231',
      'package', 150000, 250000,
      '00000000-0000-0000-0000-000000001241'
    )
  $$,
  'PT403',
  null,
  'service_role cannot make the package model the workspace default'
);

reset role;

select throws_ok(
  $$
    insert into public.org_fee_defaults (org_id, model, upfront_cents, success_cents, updated_by)
    values (
      '00000000-0000-0000-0000-000000001231',
      'package', 150000, 250000,
      '00000000-0000-0000-0000-000000001241'
    )
  $$,
  'PT403',
  null,
  'the table owner cannot make the package model the workspace default'
);

-- ===========================================================================
-- The un-gated path, and what revocation does to it.
-- ===========================================================================

insert into public.org_flags (
  org_id, upfront_fee_approved, legal_signoff_ref, approved_by, approved_at
) values (
  '00000000-0000-0000-0000-000000001231',
  true,
  'legal-2026-08-16-fee-core',
  '00000000-0000-0000-0000-000000001242',
  now()
);

-- Pinned to the operator-owner role on purpose: "succeeds as superuser" would
-- prove less than "succeeds as the role the application actually runs as".
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'authenticated', 'sub', '00000000-0000-0000-0000-000000001241')::text,
  true
);

select lives_ok(
  $$
    insert into public.fee_agreements (client_id, org_id, model, upfront_cents, success_cents, status, source)
    values (
      '00000000-0000-0000-0000-000000001251',
      '00000000-0000-0000-0000-000000001231',
      'package', 150000, 250000, 'active', 'operator_override'
    )
  $$,
  'an approved organization can write a package agreement'
);

reset role;

update public.org_flags
set
  upfront_fee_approved = false,
  legal_signoff_ref = null,
  approved_by = null,
  approved_at = null
where org_id = '00000000-0000-0000-0000-000000001231';

-- D-15: revocation is forward-looking. Voiding a live commercial agreement is
-- an operations decision, not something a boolean flip should do silently.
select is(
  (
    select count(*)::integer
    from public.fee_agreements
    where client_id = '00000000-0000-0000-0000-000000001251'
  ),
  1,
  'revoking the flag leaves an existing package agreement standing'
);

select throws_ok(
  $$
    update public.fee_agreements
    set success_cents = 300000
    where client_id = '00000000-0000-0000-0000-000000001251'
  $$,
  'PT403',
  null,
  'but any later edit to that agreement is refused once the flag is revoked'
);

-- ===========================================================================
-- Shape.
-- ===========================================================================

select throws_ok(
  $$
    insert into public.fee_agreements (client_id, org_id, model, source)
    values (
      '00000000-0000-0000-0000-000000001252',
      '00000000-0000-0000-0000-000000001231',
      'percentage', 'operator_override'
    )
  $$,
  '23514',
  null,
  'a percentage agreement must carry a percentage'
);

select throws_ok(
  $$
    insert into public.fee_agreements (client_id, org_id, model, source)
    values (
      '00000000-0000-0000-0000-000000001252',
      '00000000-0000-0000-0000-000000001231',
      'custom', 'operator_override'
    )
  $$,
  '23514',
  null,
  'a custom agreement must carry a total'
);

select throws_ok(
  $$
    insert into public.fee_agreements (client_id, org_id, model, pct, source)
    values (
      '00000000-0000-0000-0000-000000001252',
      '00000000-0000-0000-0000-000000001231',
      'percentage', -1, 'operator_override'
    )
  $$,
  '23514',
  null,
  'a negative percentage is refused'
);

select throws_ok(
  $$
    insert into public.fee_agreements (client_id, org_id, model, pct, source)
    values (
      '00000000-0000-0000-0000-000000001252',
      '00000000-0000-0000-0000-000000001231',
      'percentage', 101, 'operator_override'
    )
  $$,
  '23514',
  null,
  'a percentage above one hundred is refused'
);

select throws_ok(
  $$
    insert into public.fee_agreements (client_id, org_id, model, pct, success_cents, source)
    values (
      '00000000-0000-0000-0000-000000001252',
      '00000000-0000-0000-0000-000000001231',
      'percentage', 10, -1, 'operator_override'
    )
  $$,
  '23514',
  null,
  'a negative amount is refused'
);

select throws_ok(
  $$
    insert into public.fee_agreements (client_id, org_id, model, pct, source)
    values (
      '00000000-0000-0000-0000-000000001252',
      '00000000-0000-0000-0000-000000001231',
      'percentage', 10, 'guessed'
    )
  $$,
  '42501',
  'FEE_AGREEMENT_ACTOR_MISMATCH',
  'an agreement must say which of the three paths created it'
);

-- Deliberately a well-formed, un-gated row: the only thing wrong with it is
-- that client A1 already has an agreement. A malformed one would trip a shape
-- CHECK first and this case would pass without ever reaching the unique index.
select throws_ok(
  $$
    insert into public.fee_agreements (client_id, org_id, model, custom_total_cents, source)
    values (
      '00000000-0000-0000-0000-000000001251',
      '00000000-0000-0000-0000-000000001231',
      'custom', 400000, 'operator_override'
    )
  $$,
  '23505',
  null,
  'a client cannot hold two fee agreements'
);

select throws_ok(
  $$
    insert into public.fee_agreements (client_id, org_id, model, pct, source)
    values (
      '00000000-0000-0000-0000-000000001252',
      '00000000-0000-0000-0000-000000001232',
      'percentage', 10, 'operator_override'
    )
  $$,
  '22023',
  null,
  'a fee agreement cannot be filed under an organization that does not own the client'
);

-- ===========================================================================
-- The ledger.
-- ===========================================================================

insert into public.fee_agreements (client_id, org_id, model, pct, status, source)
values (
  '00000000-0000-0000-0000-000000001252',
  '00000000-0000-0000-0000-000000001231',
  'percentage', 10.00, 'active', 'operator_override'
);

select is(
  (
    select total_cents
    from public.fee_ledger
    where client_id = '00000000-0000-0000-0000-000000001252'
  ),
  0::bigint,
  'a percentage agreement with no recorded outcome basis totals nothing'
);

select throws_ok(
  $$
    insert into public.fee_ledger (client_id, org_id, balance_cents)
    values (
      '00000000-0000-0000-0000-000000001253',
      '00000000-0000-0000-0000-000000001232',
      500
    )
  $$,
  '428C9',
  null,
  'the balance cannot be supplied on insert'
);

select throws_ok(
  $$
    update public.fee_ledger
    set balance_cents = 500
    where client_id = '00000000-0000-0000-0000-000000001252'
  $$,
  '428C9',
  null,
  'the balance cannot be written directly'
);

-- 2026-08-17 R3A-01: this fixture supplies a synthetic outcome basis for the
-- calculation assertions, so mark only that setup write as governed.
select pg_catalog.set_config('app.governed_fee_basis_write', 'on', true);
update public.fee_ledger
set outcome_basis_cents = 100000
where client_id = '00000000-0000-0000-0000-000000001252';
select pg_catalog.set_config('app.governed_fee_basis_write', '', true);

select is(
  (
    select total_cents
    from public.fee_ledger
    where client_id = '00000000-0000-0000-0000-000000001252'
  ),
  10000::bigint,
  'a ten percent fee on a hundred thousand cent basis totals ten thousand cents'
);

-- A hand-written total is not forbidden, it is derived over. That holds for
-- every role without any privilege check, which is the same argument D-07 makes
-- for the generated balance column.
update public.fee_ledger
set total_cents = 999999
where client_id = '00000000-0000-0000-0000-000000001252';

select is(
  (
    select total_cents
    from public.fee_ledger
    where client_id = '00000000-0000-0000-0000-000000001252'
  ),
  10000::bigint,
  'a total written by hand is replaced by the derived one'
);

-- ===========================================================================
-- Recorded payments.
-- ===========================================================================

select throws_ok(
  $$
    insert into public.fee_payments (client_id, org_id, amount_cents, received_on, method, recorded_by)
    values (
      '00000000-0000-0000-0000-000000001252',
      '00000000-0000-0000-0000-000000001231',
      0, current_date, 'bank_transfer',
      '00000000-0000-0000-0000-000000001241'
    )
  $$,
  '23514',
  null,
  'a payment of nothing is refused'
);

select throws_ok(
  $$
    insert into public.fee_payments (client_id, org_id, amount_cents, received_on, method, recorded_by)
    values (
      '00000000-0000-0000-0000-000000001252',
      '00000000-0000-0000-0000-000000001231',
      -5000, current_date, 'bank_transfer',
      '00000000-0000-0000-0000-000000001241'
    )
  $$,
  '23514',
  null,
  'a negative payment is refused'
);

insert into public.fee_payments (
  id, client_id, org_id, amount_cents, received_on, method, reference, recorded_by
) values
  (
    '00000000-0000-0000-0000-000000001261',
    '00000000-0000-0000-0000-000000001252',
    '00000000-0000-0000-0000-000000001231',
    5000, current_date, 'bank_transfer', 'BACS-0001',
    '00000000-0000-0000-0000-000000001241'
  ),
  (
    '00000000-0000-0000-0000-000000001262',
    '00000000-0000-0000-0000-000000001252',
    '00000000-0000-0000-0000-000000001231',
    3000, current_date, 'card', 'BACS-0002',
    '00000000-0000-0000-0000-000000001241'
  );

select is(
  (
    select paid_cents
    from public.fee_ledger
    where client_id = '00000000-0000-0000-0000-000000001252'
  ),
  8000::bigint,
  'the ledger paid figure is the sum of the recorded payments'
);

select is(
  (
    select balance_cents
    from public.fee_ledger
    where client_id = '00000000-0000-0000-0000-000000001252'
  ),
  2000::bigint,
  'the balance follows total minus paid without ever being written'
);

select throws_ok(
  $$
    delete from public.fee_payments
    where id = '00000000-0000-0000-0000-000000001261'
  $$,
  '42501',
  null,
  'a recorded payment cannot be deleted'
);

select throws_ok(
  $$
    update public.fee_payments
    set amount_cents = 9999
    where id = '00000000-0000-0000-0000-000000001261'
  $$,
  '42501',
  null,
  'a recorded payment amount cannot be rewritten'
);

select throws_ok(
  $$
    update public.fee_payments
    set reversed_at = now()
    where id = '00000000-0000-0000-0000-000000001261'
  $$,
  '23514',
  null,
  'a reversal must name who made it'
);

select lives_ok(
  $$
    update public.fee_payments
    set reversed_at = now(), reversed_by = '00000000-0000-0000-0000-000000001241'
    where id = '00000000-0000-0000-0000-000000001261'
  $$,
  'a payment entered in error can be reversed'
);

select is(
  (
    select paid_cents
    from public.fee_ledger
    where client_id = '00000000-0000-0000-0000-000000001252'
  ),
  3000::bigint,
  'a reversed payment stops counting toward the paid figure'
);

select throws_ok(
  $$
    insert into public.fee_payments (client_id, org_id, amount_cents, received_on, method, reference, recorded_by)
    values (
      '00000000-0000-0000-0000-000000001252',
      '00000000-0000-0000-0000-000000001231',
      1000, current_date, 'bank_transfer', 'BACS-0002',
      '00000000-0000-0000-0000-000000001241'
    )
  $$,
  '23505',
  null,
  'the same bank reference cannot be entered twice for one client'
);

select lives_ok(
  $$
    insert into public.fee_payments (client_id, org_id, amount_cents, received_on, method, recorded_by)
    values
      (
        '00000000-0000-0000-0000-000000001252',
        '00000000-0000-0000-0000-000000001231',
        100, current_date, 'cash',
        '00000000-0000-0000-0000-000000001241'
      ),
      (
        '00000000-0000-0000-0000-000000001252',
        '00000000-0000-0000-0000-000000001231',
        200, current_date, 'cash',
        '00000000-0000-0000-0000-000000001241'
      )
  $$,
  'two payments with no reference coexist, because the index is partial'
);

-- ===========================================================================
-- Row level security.
-- ===========================================================================

select is(
  (
    select bool_and(relrowsecurity)
    from pg_class
    where oid in (
      'public.fee_agreements'::regclass,
      'public.fee_ledger'::regclass,
      'public.fee_payments'::regclass,
      'public.org_fee_defaults'::regclass
    )
  ),
  true,
  'row level security is enabled on all four fee tables'
);

select is(
  (
    select bool_and(relforcerowsecurity)
    from pg_class
    where oid in (
      'public.fee_agreements'::regclass,
      'public.fee_ledger'::regclass,
      'public.fee_payments'::regclass,
      'public.org_fee_defaults'::regclass
    )
  ),
  true,
  'row level security is forced on all four fee tables'
);

insert into public.org_fee_defaults (org_id, model, pct, updated_by)
values (
  '00000000-0000-0000-0000-000000001231',
  'percentage', 15.00,
  '00000000-0000-0000-0000-000000001241'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'authenticated', 'sub', '00000000-0000-0000-0000-000000001243')::text,
  true
);

select is(
  (
    (select count(*) from public.fee_agreements)
    + (select count(*) from public.fee_ledger)
    + (select count(*) from public.fee_payments)
    + (select count(*) from public.org_fee_defaults)
  ),
  0::bigint,
  'an operator owner in another organization reads zero rows from every fee table'
);

reset role;

select policies_are(
  'public',
  'fee_agreements',
  array['fee_agreements_read', 'fee_agreements_operator_write']::name[],
  'fee_agreements carries exactly its read and operator-write policies'
);

select policies_are(
  'public',
  'fee_ledger',
  array['fee_ledger_read', 'fee_ledger_operator_write']::name[],
  'fee_ledger carries exactly its read and operator-write policies'
);

select policies_are(
  'public',
  'fee_payments',
  array['fee_payments_read', 'fee_payments_operator_write']::name[],
  'fee_payments carries exactly its read and operator-write policies'
);

select policies_are(
  'public',
  'org_fee_defaults',
  array['org_fee_defaults_read', 'org_fee_defaults_owner_write']::name[],
  'org_fee_defaults carries exactly its read and owner-write policies'
);

select * from finish();

rollback;
