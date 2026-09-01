begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(11);

insert into public.orgs (id, name, slug)
values ('00000000-0000-0000-0000-000000004011', 'Flat fee trigger org', 'flat-fee-trigger-org');

insert into auth.users (id, email, raw_app_meta_data)
values
  (
    '00000000-0000-0000-0000-000000004012',
    'flat-fee-trigger@test.example',
    jsonb_build_object('app_role', 'operator_member', 'org_id', '00000000-0000-0000-0000-000000004011', 'org_role', 'owner')
  ),
  (
    '00000000-0000-0000-0000-000000004014',
    'flat-fee-admin@test.example',
    jsonb_build_object('app_role', 'platform_admin')
  );

insert into public.profiles (id, role, org_id, org_role, full_name, email)
values
  (
    '00000000-0000-0000-0000-000000004012',
    'operator_member',
    '00000000-0000-0000-0000-000000004011',
    'owner',
    'Flat Fee Owner',
    'flat-fee-trigger@test.example'
  ),
  (
    '00000000-0000-0000-0000-000000004014',
    'platform_admin',
    null,
    null,
    'Flat Fee Platform Admin',
    'flat-fee-admin@test.example'
  )
on conflict (id) do update
set role = excluded.role,
    org_id = excluded.org_id,
    org_role = excluded.org_role,
    full_name = excluded.full_name,
    email = excluded.email;

insert into public.clients (id, org_id, display_name)
values ('00000000-0000-0000-0000-000000004013', '00000000-0000-0000-0000-000000004011', 'Flat Fee Client');

select lives_ok(
  $$
    insert into public.fee_agreements (
      client_id, org_id, model, pct, upfront_cents, success_cents,
      trigger_cents, custom_total_cents, status, source
    ) values (
      '00000000-0000-0000-0000-000000004013',
      '00000000-0000-0000-0000-000000004011',
      'custom', null, null, null, 5000000, 700000, 'active', 'operator_override'
    )
  $$,
  'a funded threshold on a flat success fee does not require upfront-fee approval'
);

select is(
  (select total_cents from public.fee_ledger where client_id = '00000000-0000-0000-0000-000000004013'),
  0::bigint,
  'the flat fee is not due before any funded outcome is recorded'
);

select pg_catalog.set_config('app.governed_fee_basis_write', 'on', true);
update public.fee_ledger
set outcome_basis_cents = 4999999, outcome_basis_source = 'pgtap'
where client_id = '00000000-0000-0000-0000-000000004013';
select pg_catalog.set_config('app.governed_fee_basis_write', '', true);
select is(
  (select total_cents from public.fee_ledger where client_id = '00000000-0000-0000-0000-000000004013'),
  0::bigint,
  'one cent below the trigger still owes nothing'
);

select pg_catalog.set_config('app.governed_fee_basis_write', 'on', true);
update public.fee_ledger
set outcome_basis_cents = 5000000, outcome_basis_source = 'pgtap'
where client_id = '00000000-0000-0000-0000-000000004013';
select pg_catalog.set_config('app.governed_fee_basis_write', '', true);
select is(
  (select total_cents from public.fee_ledger where client_id = '00000000-0000-0000-0000-000000004013'),
  700000::bigint,
  'meeting the trigger makes the full flat fee due'
);

select pg_catalog.set_config('app.governed_fee_basis_write', 'on', true);
update public.fee_ledger
set outcome_basis_cents = 9000000, outcome_basis_source = 'pgtap'
where client_id = '00000000-0000-0000-0000-000000004013';
select pg_catalog.set_config('app.governed_fee_basis_write', '', true);
select is(
  (select total_cents from public.fee_ledger where client_id = '00000000-0000-0000-0000-000000004013'),
  700000::bigint,
  'funding above the trigger does not multiply the flat fee'
);

select throws_ok(
  $$
    update public.fee_agreements
    set upfront_cents = 100000
    where client_id = '00000000-0000-0000-0000-000000004013'
  $$,
  'PT403',
  'legal_gate',
  'a positive upfront amount remains legally gated'
);

select is(
  (select upfront_cents from public.fee_agreements where client_id = '00000000-0000-0000-0000-000000004013'),
  null::bigint,
  'the refused upfront amount was not stored'
);

insert into public.org_flags (
  org_id, upfront_fee_approved, legal_signoff_ref, approved_by, approved_at
) values (
  '00000000-0000-0000-0000-000000004011', true, 'TEST-LGL-401',
  '00000000-0000-0000-0000-000000004014', now()
);

select lives_ok(
  $$
    update public.fee_agreements
    set upfront_cents = 100000
    where client_id = '00000000-0000-0000-0000-000000004013'
  $$,
  'the approved workspace can combine an upfront amount with its success fee'
);

select pg_catalog.set_config('app.governed_fee_basis_write', 'on', true);
update public.fee_ledger
set outcome_basis_cents = 4999999, outcome_basis_source = 'pgtap'
where client_id = '00000000-0000-0000-0000-000000004013';
select pg_catalog.set_config('app.governed_fee_basis_write', '', true);
select is(
  (select total_cents from public.fee_ledger where client_id = '00000000-0000-0000-0000-000000004013'),
  100000::bigint,
  'below the funding trigger only the approved upfront amount is due'
);

select pg_catalog.set_config('app.governed_fee_basis_write', 'on', true);
update public.fee_ledger
set outcome_basis_cents = 5000000, outcome_basis_source = 'pgtap'
where client_id = '00000000-0000-0000-0000-000000004013';
select pg_catalog.set_config('app.governed_fee_basis_write', '', true);
select is(
  (select total_cents from public.fee_ledger where client_id = '00000000-0000-0000-0000-000000004013'),
  800000::bigint,
  'at the trigger the ledger includes both upfront and flat success amounts'
);

update public.fee_agreements
set model = 'percentage', pct = 10, trigger_cents = null, custom_total_cents = null
where client_id = '00000000-0000-0000-0000-000000004013';
select is(
  (select total_cents from public.fee_ledger where client_id = '00000000-0000-0000-0000-000000004013'),
  600000::bigint,
  'a percentage agreement also combines the approved upfront amount with the funded percentage'
);

select * from finish();
rollback;
