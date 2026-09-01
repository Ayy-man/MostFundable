begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(3);

insert into public.orgs (id, name, slug)
values ('00000000-0000-0000-0000-000000004031', 'Active receivables org', 'active-receivables-org');
insert into auth.users (id, email)
values ('00000000-0000-4000-8000-000000004035', 'active-receivables-operator@test.example');
insert into public.profiles (id, role, org_id, org_role, full_name, email)
values (
  '00000000-0000-4000-8000-000000004035',
  'operator_member',
  '00000000-0000-0000-0000-000000004031',
  'owner',
  'Active Receivables Operator',
  'active-receivables-operator@test.example'
)
on conflict (id) do update set
  role = excluded.role,
  org_id = excluded.org_id,
  org_role = excluded.org_role,
  full_name = excluded.full_name,
  email = excluded.email;

select pg_catalog.set_config('app.governed_client_write', 'on', true);
insert into public.clients (id, org_id, display_name, status, archived_at, archived_by)
values
  ('00000000-0000-0000-0000-000000004032', '00000000-0000-0000-0000-000000004031', 'Current Client', 'active', null, null),
  (
    '00000000-0000-0000-0000-000000004033',
    '00000000-0000-0000-0000-000000004031',
    'Reset Client',
    'archived',
    pg_catalog.now(),
    '00000000-0000-4000-8000-000000004035'
  ),
  ('00000000-0000-0000-0000-000000004034', '00000000-0000-0000-0000-000000004031', 'Unconfigured Client', 'active', null, null);
select pg_catalog.set_config('app.governed_client_write', '', true);

insert into public.fee_agreements (
  client_id, org_id, model, custom_total_cents, status, source
)
values
  ('00000000-0000-0000-0000-000000004032', '00000000-0000-0000-0000-000000004031', 'custom', 10000, 'active', 'operator_override'),
  ('00000000-0000-0000-0000-000000004033', '00000000-0000-0000-0000-000000004031', 'custom', 20000, 'active', 'operator_override');

select pg_catalog.set_config('app.governed_fee_basis_write', 'on', true);
update public.fee_ledger
set outcome_basis_cents = 4500000, outcome_basis_source = 'pgtap'
where client_id = '00000000-0000-0000-0000-000000004032';
select pg_catalog.set_config('app.governed_fee_basis_write', '', true);

select is(
  (select count(*) from public.fees_list_org_receivables('00000000-0000-0000-0000-000000004031', 50, 0)),
  2::bigint,
  'the current fee roster excludes an archived reset client and includes an unconfigured active client'
);

select is(
  (
    select display_name
    from public.fees_list_org_receivables('00000000-0000-0000-0000-000000004031', 50, 0)
    where client_id = '00000000-0000-0000-0000-000000004032'
  ),
  'Current Client'::text,
  'the active client remains visible'
);

select is(
  (select outcome_basis_cents from public.fees_list_org_receivables('00000000-0000-0000-0000-000000004031', 50, 0) where client_id = '00000000-0000-0000-0000-000000004032'),
  4500000::bigint,
  'the roster carries the funded basis already recorded in the fee ledger'
);

select * from finish();
rollback;
