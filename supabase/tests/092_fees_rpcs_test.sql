-- 092_fees_rpcs_test.sql
--
-- The RPC surface is the only way `web/src/lib/fees/` reaches these tables, so
-- three properties have to hold for every function in 092 or the plan 12-03
-- policy proofs stop meaning anything:
--
--   1. prosecdef is false. A definer function runs as the owner, and the owner
--      is exactly the role plan 12-03 had to defeat with a trigger.
--   2. `anon` cannot execute it. PG 17 grants EXECUTE to PUBLIC on creation, so
--      this is the assertion that fires if a revoke line is ever dropped.
--   3. `authenticated` can execute application-facing functions. The retired
--      fee-basis writer is the one deliberate exception.
--
-- Then behaviour: the two writers that can carry a gated option must still be
-- stopped by the 091 trigger, and the three attributed columns must come from
-- the session rather than from an argument.

begin;

create extension if not exists pgtap with schema extensions;

set local search_path = public, extensions;

select plan(90);

-- ---------------------------------------------------------------------------
-- Fixtures. Org A stays ungated for the whole file; org B is opened part way
-- through by the RPC under test and closed again at the end.
-- ---------------------------------------------------------------------------

insert into public.orgs (id, name, slug)
values
  ('00000000-0000-0000-0000-000000001271', 'Phase 12 RPC Org A', 'phase-12-rpc-a'),
  ('00000000-0000-0000-0000-000000001272', 'Phase 12 RPC Org B', 'phase-12-rpc-b');

insert into auth.users (id, email, raw_app_meta_data)
values
  (
    '00000000-0000-0000-0000-000000001281',
    'owner.a.phase12-rpc@test.example',
    jsonb_build_object(
      'app_role', 'operator_member',
      'full_name', 'RPC Org A Owner',
      'org_id', '00000000-0000-0000-0000-000000001271',
      'org_role', 'owner'
    )
  ),
  (
    '00000000-0000-0000-0000-000000001282',
    'admin.phase12-rpc@test.example',
    jsonb_build_object(
      'app_role', 'platform_admin',
      'full_name', 'RPC Platform Admin'
    )
  ),
  (
    '00000000-0000-0000-0000-000000001283',
    'owner.b.phase12-rpc@test.example',
    jsonb_build_object(
      'app_role', 'operator_member',
      'full_name', 'RPC Org B Owner',
      'org_id', '00000000-0000-0000-0000-000000001272',
      'org_role', 'owner'
    )
  );

insert into public.profiles (id, role, org_id, org_role, full_name, email)
values
  (
    '00000000-0000-0000-0000-000000001281',
    'operator_member',
    '00000000-0000-0000-0000-000000001271',
    'owner',
    'RPC Org A Owner',
    'owner.a.phase12-rpc@test.example'
  ),
  (
    '00000000-0000-0000-0000-000000001282',
    'platform_admin',
    null,
    null,
    'RPC Platform Admin',
    'admin.phase12-rpc@test.example'
  ),
  (
    '00000000-0000-0000-0000-000000001283',
    'operator_member',
    '00000000-0000-0000-0000-000000001272',
    'owner',
    'RPC Org B Owner',
    'owner.b.phase12-rpc@test.example'
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
  ('00000000-0000-0000-0000-000000001291', '00000000-0000-0000-0000-000000001271', 'RPC Client A1'),
  ('00000000-0000-0000-0000-000000001292', '00000000-0000-0000-0000-000000001271', 'RPC Client A2'),
  ('00000000-0000-0000-0000-000000001293', '00000000-0000-0000-0000-000000001272', 'RPC Client B1');

-- ===========================================================================
-- The catalog contract: nine functions × existence, prosecdef, anon, authenticated.
-- ===========================================================================

select has_function(
  'public', 'org_flags_set_upfront_fee_approved',
  array['uuid', 'boolean', 'text']::name[],
  'org_flags_set_upfront_fee_approved takes an org, a boolean and a reference — and no approver'
);
select is(
  (select prosecdef from pg_catalog.pg_proc
   where oid = 'public.org_flags_set_upfront_fee_approved(uuid,boolean,text)'::regprocedure),
  false,
  'org_flags_set_upfront_fee_approved is security invoker, so the platform-admin policy still decides'
);
select is(
  has_function_privilege('anon', 'public.org_flags_set_upfront_fee_approved(uuid,boolean,text)', 'execute'),
  false,
  'anon cannot execute org_flags_set_upfront_fee_approved'
);
select is(
  has_function_privilege('authenticated', 'public.org_flags_set_upfront_fee_approved(uuid,boolean,text)', 'execute'),
  true,
  'authenticated can execute org_flags_set_upfront_fee_approved'
);

select has_function(
  'public', 'fees_upfront_gate_state',
  array['uuid']::name[],
  'fees_upfront_gate_state takes an org id'
);
select is(
  (select prosecdef from pg_catalog.pg_proc
   where oid = 'public.fees_upfront_gate_state(uuid)'::regprocedure),
  false,
  'fees_upfront_gate_state is security invoker'
);
select is(
  has_function_privilege('anon', 'public.fees_upfront_gate_state(uuid)', 'execute'),
  false,
  'anon cannot execute fees_upfront_gate_state'
);
select is(
  has_function_privilege('authenticated', 'public.fees_upfront_gate_state(uuid)', 'execute'),
  true,
  'authenticated can execute fees_upfront_gate_state'
);

select has_function(
  'public', 'fees_set_agreement',
  array['uuid', 'fee_model', 'numeric', 'bigint', 'bigint', 'bigint', 'bigint', 'fee_agreement_status']::name[],
  'fees_set_agreement takes typed columns rather than a jsonb blob a route never validated'
);
select is(
  (select prosecdef from pg_catalog.pg_proc
   where oid = 'public.fees_set_agreement(uuid,public.fee_model,numeric,bigint,bigint,bigint,bigint,public.fee_agreement_status)'::regprocedure),
  false,
  'fees_set_agreement is security invoker, so it cannot become a way around the fee_agreements policies'
);
select is(
  has_function_privilege('anon', 'public.fees_set_agreement(uuid,public.fee_model,numeric,bigint,bigint,bigint,bigint,public.fee_agreement_status)', 'execute'),
  false,
  'anon cannot execute fees_set_agreement'
);
select is(
  has_function_privilege('authenticated', 'public.fees_set_agreement(uuid,public.fee_model,numeric,bigint,bigint,bigint,bigint,public.fee_agreement_status)', 'execute'),
  true,
  'authenticated can execute fees_set_agreement'
);

select has_function(
  'public', 'fees_set_org_default',
  array['uuid', 'fee_model', 'numeric', 'bigint', 'bigint', 'bigint', 'bigint']::name[],
  'fees_set_org_default takes an org and the same typed shape'
);
select is(
  (select prosecdef from pg_catalog.pg_proc
   where oid = 'public.fees_set_org_default(uuid,public.fee_model,numeric,bigint,bigint,bigint,bigint)'::regprocedure),
  false,
  'fees_set_org_default is security invoker'
);
select is(
  has_function_privilege('anon', 'public.fees_set_org_default(uuid,public.fee_model,numeric,bigint,bigint,bigint,bigint)', 'execute'),
  false,
  'anon cannot execute fees_set_org_default'
);
select is(
  has_function_privilege('authenticated', 'public.fees_set_org_default(uuid,public.fee_model,numeric,bigint,bigint,bigint,bigint)', 'execute'),
  true,
  'authenticated can execute fees_set_org_default'
);

select has_function(
  'public', 'fees_record_payment',
  array['uuid', 'bigint', 'date', 'fee_payment_method', 'text', 'text']::name[],
  'fees_record_payment takes an amount, a date and a method — and no recorder'
);
select is(
  (select prosecdef from pg_catalog.pg_proc
   where oid = 'public.fees_record_payment(uuid,bigint,date,public.fee_payment_method,text,text)'::regprocedure),
  false,
  'fees_record_payment is security invoker'
);
select is(
  has_function_privilege('anon', 'public.fees_record_payment(uuid,bigint,date,public.fee_payment_method,text,text)', 'execute'),
  false,
  'anon cannot execute fees_record_payment'
);
select is(
  has_function_privilege('authenticated', 'public.fees_record_payment(uuid,bigint,date,public.fee_payment_method,text,text)', 'execute'),
  true,
  'authenticated can execute fees_record_payment'
);

select has_function(
  'public', 'fees_reverse_payment',
  array['uuid']::name[],
  'fees_reverse_payment takes a payment id'
);
select is(
  (select prosecdef from pg_catalog.pg_proc
   where oid = 'public.fees_reverse_payment(uuid)'::regprocedure),
  false,
  'fees_reverse_payment is security invoker'
);
select is(
  has_function_privilege('anon', 'public.fees_reverse_payment(uuid)', 'execute'),
  false,
  'anon cannot execute fees_reverse_payment'
);
select is(
  has_function_privilege('authenticated', 'public.fees_reverse_payment(uuid)', 'execute'),
  true,
  'authenticated can execute fees_reverse_payment'
);

select has_function(
  'public', 'fees_set_outcome_basis',
  array['uuid', 'bigint', 'text']::name[],
  'the retired fee-basis function remains present for migration compatibility'
);
select is(
  (select prosecdef from pg_catalog.pg_proc
   where oid = 'public.fees_set_outcome_basis(uuid,bigint,text)'::regprocedure),
  false,
  'fees_set_outcome_basis is security invoker'
);
select is(
  has_function_privilege('anon', 'public.fees_set_outcome_basis(uuid,bigint,text)', 'execute'),
  false,
  'anon cannot execute fees_set_outcome_basis'
);
select is(
  has_function_privilege('authenticated', 'public.fees_set_outcome_basis(uuid,bigint,text)', 'execute'),
  false,
  '2026-08-17 R2A-13: authenticated cannot execute the retired fee-basis writer'
);

select has_function(
  'public', 'fees_read_client_fees',
  array['uuid']::name[],
  'fees_read_client_fees takes a client id'
);
select is(
  (select prosecdef from pg_catalog.pg_proc
   where oid = 'public.fees_read_client_fees(uuid)'::regprocedure),
  false,
  'fees_read_client_fees is security invoker, so an unreachable client reads as empty rather than as data'
);
select is(
  has_function_privilege('anon', 'public.fees_read_client_fees(uuid)', 'execute'),
  false,
  'anon cannot execute fees_read_client_fees'
);
select is(
  has_function_privilege('authenticated', 'public.fees_read_client_fees(uuid)', 'execute'),
  true,
  'authenticated can execute fees_read_client_fees'
);

select has_function(
  'public', 'fees_list_org_receivables',
  array['uuid', 'integer', 'integer']::name[],
  'fees_list_org_receivables takes an org id and a bounded window'
);
select is(
  (select prosecdef from pg_catalog.pg_proc
   where oid = 'public.fees_list_org_receivables(uuid,integer,integer)'::regprocedure),
  false,
  'fees_list_org_receivables is security invoker, which is what keeps one tenant out of another''s receivables'
);
select is(
  has_function_privilege('anon', 'public.fees_list_org_receivables(uuid,integer,integer)', 'execute'),
  false,
  'anon cannot execute fees_list_org_receivables'
);
select is(
  has_function_privilege('authenticated', 'public.fees_list_org_receivables(uuid,integer,integer)', 'execute'),
  true,
  'authenticated can execute fees_list_org_receivables'
);

-- ===========================================================================
-- Behaviour, as an operator owner in the ungated org A.
-- ===========================================================================

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'authenticated', 'sub', '00000000-0000-0000-0000-000000001281')::text,
  true
);

select throws_ok(
  $$
    select public.fees_set_agreement(
      '00000000-0000-0000-0000-000000001291', 'package',
      null, 150000, 250000, null, null, 'active'
    )
  $$,
  'PT403',
  'legal_gate',
  'the RPC did not become a way around the gate: a package agreement still raises PT403'
);

select throws_ok(
  $$
    select public.fees_set_org_default(
      '00000000-0000-0000-0000-000000001271', 'package',
      null, 150000, 250000, null, null
    )
  $$,
  'PT403',
  'legal_gate',
  'a workspace default carrying a package model raises PT403 too, so the gate cannot be pre-loaded'
);

select throws_ok(
  $$
    select public.fees_set_agreement(
      '00000000-0000-0000-0000-000000001293', 'percentage',
      10.00, null, null, null, null, 'draft'
    )
  $$,
  '42501',
  null,
  'a client in another organization is unknown to this caller, not a different error'
);

select lives_ok(
  $$
    select public.fees_set_agreement(
      '00000000-0000-0000-0000-000000001291', 'percentage',
      10.00, null, null, null, null, 'active'
    )
  $$,
  'an ungated percentage agreement goes through the RPC unimpeded'
);

select is(
  (select source from public.fee_agreements
   where client_id = '00000000-0000-0000-0000-000000001291'),
  'operator_override',
  'the RPC stamps source from the caller''s app role rather than accepting it as an argument'
);

select is(
  (select model::text from public.fee_agreements
   where client_id = '00000000-0000-0000-0000-000000001291'),
  'percentage',
  'the agreement is stored with the model the caller asked for'
);

select lives_ok(
  $$
    select public.fees_set_agreement(
      '00000000-0000-0000-0000-000000001292', 'percentage',
      15.00, null, null, null, null, 'draft'
    )
  $$,
  'a second client in the same organization can hold its own agreement'
);

select throws_ok(
  $$
    select public.org_flags_set_upfront_fee_approved(
      '00000000-0000-0000-0000-000000001271', true, 'LGL-FORGED'
    )
  $$,
  '22023',
  null,
  -- Two mechanisms refuse this and the BEFORE trigger gets there first, since
  -- row triggers run ahead of the policy's WITH CHECK. 22023 is therefore the
  -- honest expectation: the caller is refused because they are not a platform
  -- administrator, which is what private.validate_org_flag_approver() says.
  -- The 42501 path is proved separately in 090's test, where an operator owner
  -- updating the table directly affects zero rows.
  'an operator owner cannot open their own legal gate through the RPC'
);

select is(
  (select count(*)::integer from public.org_flags
   where org_id = '00000000-0000-0000-0000-000000001271'),
  0,
  'and the refused call left no row behind'
);

-- 2026-08-17 R2A-13: only the outcome trigger may set this derived value.

select throws_ok(
  $$
    select public.fees_set_outcome_basis(
      '00000000-0000-0000-0000-000000001291', 1000000, 'outcome_approved'
    )
  $$,
  '42501',
  null,
  'an authenticated caller cannot supply an arbitrary fee basis'
);

select is(
  (select outcome_basis_cents from public.fee_ledger
   where client_id = '00000000-0000-0000-0000-000000001291'),
  0::bigint,
  'the refused call leaves the derived basis at its trigger-owned default'
);

select is(
  (select outcome_basis_source from public.fee_ledger
   where client_id = '00000000-0000-0000-0000-000000001291'),
  null::text,
  'the refused call leaves the derived source empty'
);

select is(
  (select total_cents from public.fee_ledger
   where client_id = '00000000-0000-0000-0000-000000001291'),
  0::bigint,
  'the refused call leaves the percentage total at zero'
);

select throws_ok(
  $$
    select public.fees_set_outcome_basis(
      '00000000-0000-0000-0000-000000001291', -1, 'outcome_approved'
    )
  $$,
  '42501',
  null,
  'the retired writer refuses every caller-controlled amount'
);

select throws_ok(
  $$
    select public.fees_set_outcome_basis(
      '00000000-0000-0000-0000-000000001293', 500000, 'outcome_approved'
    )
  $$,
  '42501',
  null,
  'the retired writer also exposes no cross-organization path'
);

-- Recorded payments.

select lives_ok(
  $$
    select public.fees_record_payment(
      '00000000-0000-0000-0000-000000001291', 25000, date '2026-08-16',
      'bank_transfer', 'WIRE-0001', 'first instalment'
    )
  $$,
  'an operator owner can record a payment against a visible client'
);

select is(
  (select recorded_by from public.fee_payments
   where client_id = '00000000-0000-0000-0000-000000001291'),
  '00000000-0000-0000-0000-000000001281'::uuid,
  'recorded_by comes from the session, so a caller cannot file a payment under another person''s name'
);

select is(
  (select paid_cents from public.fee_ledger
   where client_id = '00000000-0000-0000-0000-000000001291'),
  25000::bigint,
  'the recorded payment reaches paid_cents through the ledger''s own derivation'
);

select is(
  (select balance_cents from public.fee_ledger
   where client_id = '00000000-0000-0000-0000-000000001291'),
  (-25000)::bigint,
  'and the generated balance follows both'
);

select is(
  (select approved from public.fees_upfront_gate_state('00000000-0000-0000-0000-000000001271')),
  false,
  'an organization with no flag row reads as not approved rather than as no row at all'
);

select is(
  (select count(*)::integer from public.fees_upfront_gate_state('00000000-0000-0000-0000-000000001271')),
  1,
  'and the reader always returns exactly one row, so a caller never has to handle an empty set'
);

-- The client read.

select is(
  (select jsonb_array_length(public.fees_read_client_fees('00000000-0000-0000-0000-000000001291') -> 'payments')),
  1,
  'fees_read_client_fees returns the recorded payment'
);

select is(
  (select public.fees_read_client_fees('00000000-0000-0000-0000-000000001291') -> 'agreement' ->> 'model'),
  'percentage',
  'and the agreement alongside it'
);

select is(
  (select public.fees_read_client_fees('00000000-0000-0000-0000-000000001291') -> 'ledger' ->> 'balance_cents'),
  '-25000',
  'and the ledger, so one call fills the client fee panel'
);

select is(
  (select jsonb_array_length(public.fees_read_client_fees('00000000-0000-0000-0000-000000001293') -> 'payments')),
  0,
  'a client in another organization reads as empty rather than as an error that would confirm it exists'
);

-- Reversal.

select is(
  (select (public.fees_reverse_payment(
     (select id from public.fee_payments where client_id = '00000000-0000-0000-0000-000000001291')
   )).reversed_at is not null),
  true,
  'fees_reverse_payment stamps reversed_at'
);

select is(
  (select reversed_by from public.fee_payments
   where client_id = '00000000-0000-0000-0000-000000001291'),
  '00000000-0000-0000-0000-000000001281'::uuid,
  'reversed_by comes from the session for the same reason recorded_by does'
);

select is(
  (select paid_cents from public.fee_ledger
   where client_id = '00000000-0000-0000-0000-000000001291'),
  0::bigint,
  'a reversed payment stops counting toward paid_cents, and the row still exists'
);

select is(
  (select count(*)::integer from public.fee_payments
   where client_id = '00000000-0000-0000-0000-000000001291'),
  1,
  'nothing was deleted to achieve that'
);

select is(
  (select public.fees_reverse_payment(
     (select id from public.fee_payments where client_id = '00000000-0000-0000-0000-000000001291')
   ) is null),
  true,
  'reversing an already-reversed payment returns nothing, which is the same answer as a payment that is not visible'
);

select is(
  (select public.fees_reverse_payment('00000000-0000-0000-0000-0000000012ff'::uuid) is null),
  true,
  'and so does a payment id that does not exist'
);

-- Workspace defaults and the receivables list.

select lives_ok(
  $$
    select public.fees_set_org_default(
      '00000000-0000-0000-0000-000000001271', 'percentage',
      12.50, null, null, null, null
    )
  $$,
  'an operator owner can set an ungated workspace default'
);

select is(
  (select updated_by from public.org_fee_defaults
   where org_id = '00000000-0000-0000-0000-000000001271'),
  '00000000-0000-0000-0000-000000001281'::uuid,
  'updated_by comes from the session as well'
);

select is(
  (select count(*)::integer from public.fees_list_org_receivables('00000000-0000-0000-0000-000000001271')),
  2,
  'the receivables list returns the two clients in this organization that have fee rows'
);

select is(
  (select count(*)::integer from public.fees_list_org_receivables('00000000-0000-0000-0000-000000001272')),
  0,
  'and asking for another organization returns nothing, because the function reads under the caller''s own visibility'
);

select is(
  (select balance_cents from public.fees_list_org_receivables('00000000-0000-0000-0000-000000001271')
   where client_id = '00000000-0000-0000-0000-000000001291'),
  0::bigint,
  -- The payment was reversed above, so paid_cents and the trigger-derived total
  -- are both zero. The list reads the ledger's generated column directly.
  'the listed balance is the ledger''s generated column rather than a second arithmetic'
);

reset role;

-- ===========================================================================
-- The platform admin opens org B's gate.
-- ===========================================================================

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'authenticated', 'sub', '00000000-0000-0000-0000-000000001282')::text,
  true
);

select throws_ok(
  $$
    select public.org_flags_set_upfront_fee_approved(
      '00000000-0000-0000-0000-000000001272', true, '   '
    )
  $$,
  '22023',
  null,
  'even a platform admin cannot approve without a written sign-off reference'
);

select lives_ok(
  $$
    select public.org_flags_set_upfront_fee_approved(
      '00000000-0000-0000-0000-000000001272', true, 'LGL-2026-0042'
    )
  $$,
  'a platform admin with a reference can open the gate'
);

select is(
  (select upfront_fee_approved from public.org_flags
   where org_id = '00000000-0000-0000-0000-000000001272'),
  true,
  'the flag is set'
);

select is(
  (select approved_by from public.org_flags
   where org_id = '00000000-0000-0000-0000-000000001272'),
  '00000000-0000-0000-0000-000000001282'::uuid,
  'approved_by is the calling admin, taken from the session because the signature has no approver to accept'
);

select is(
  (select legal_signoff_ref from public.org_flags
   where org_id = '00000000-0000-0000-0000-000000001272'),
  'LGL-2026-0042',
  'the reference is stored trimmed'
);

select is(
  (select approved_at is not null from public.org_flags
   where org_id = '00000000-0000-0000-0000-000000001272'),
  true,
  'and stamped with a time'
);

select is(
  (select approved from public.fees_upfront_gate_state('00000000-0000-0000-0000-000000001272')),
  true,
  'the reader agrees with the table'
);

select is(
  (select signoff_ref from public.fees_upfront_gate_state('00000000-0000-0000-0000-000000001272')),
  'LGL-2026-0042',
  'and hands back the reference the operator surface displays'
);

reset role;

-- ===========================================================================
-- Org B's owner can now do what org A's owner cannot.
-- ===========================================================================

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'authenticated', 'sub', '00000000-0000-0000-0000-000000001283')::text,
  true
);

select lives_ok(
  $$
    select public.fees_set_agreement(
      '00000000-0000-0000-0000-000000001293', 'package',
      null, 150000, 250000, 50000, null, 'active'
    )
  $$,
  'with the gate open, the same package call that raised PT403 for org A succeeds for org B'
);

select is(
  (select model::text from public.fee_agreements
   where client_id = '00000000-0000-0000-0000-000000001293'),
  'package',
  'and the package agreement is what was stored'
);

select is(
  (select total_cents from public.fee_ledger
   where client_id = '00000000-0000-0000-0000-000000001293'),
  450000::bigint,
  'a package total is the sum of its three amounts, with no basis involved'
);

reset role;

-- ===========================================================================
-- Revocation is forward-looking, through the RPC as well as through the table.
-- ===========================================================================

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'authenticated', 'sub', '00000000-0000-0000-0000-000000001282')::text,
  true
);

select lives_ok(
  $$
    select public.org_flags_set_upfront_fee_approved(
      '00000000-0000-0000-0000-000000001272', false, null
    )
  $$,
  'a platform admin can close the gate again'
);

select is(
  (select legal_signoff_ref from public.org_flags
   where org_id = '00000000-0000-0000-0000-000000001272'),
  null,
  'and the sign-off fields are cleared with it, so a stale reference cannot look like a live approval'
);

select is(
  (select approved from public.fees_upfront_gate_state('00000000-0000-0000-0000-000000001272')),
  false,
  'the reader agrees'
);

reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'authenticated', 'sub', '00000000-0000-0000-0000-000000001283')::text,
  true
);

select is(
  (select count(*)::integer from public.fee_agreements
   where client_id = '00000000-0000-0000-0000-000000001293' and model = 'package'),
  1,
  'the agreement written while the gate was open still exists after it closes (ask-12-4)'
);

select lives_ok(
  $$
    select public.fees_set_agreement(
      '00000000-0000-0000-0000-000000001293', 'package',
      null, 150000, 250000, 50000, null, 'void'
    )
  $$,
  'the RPC can still void the agreement, because withdrawing gated terms remains possible after approval closes'
);

reset role;

-- ===========================================================================
-- 2026-08-17 R2A-09 carry: mutation RPCs remain invoker functions; the one
-- fixed-action audit trigger is deliberately a definer after direct insert was revoked.
-- ===========================================================================

select is(
  (select count(*)::integer
   from pg_catalog.pg_proc as proc
   join pg_catalog.pg_namespace as ns on ns.oid = proc.pronamespace
   where proc.prosecdef
     and proc.proname <> 'org_flags_audit'
     and (
       (ns.nspname = 'public' and (proc.proname like 'fees\_%' or proc.proname = 'org_flags_set_upfront_fee_approved'))
       or (ns.nspname = 'private' and (proc.proname like 'fee\_%' or proc.proname like 'org\_flags%' or proc.proname like 'validate\_org\_flag%' or proc.proname like 'validate\_fee\_%'))
     )),
  0,
  'all fee and organization-flag mutation functions remain security invoker'
);
select is(
  (
    select proc.prosecdef
    from pg_catalog.pg_proc as proc
    join pg_catalog.pg_namespace as ns on ns.oid = proc.pronamespace
    where ns.nspname = 'private' and proc.proname = 'org_flags_audit'
  ),
  true,
  'the fixed-action organization-flags audit trigger owns its insert privilege'
);

select * from finish();
rollback;
