begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into public.orgs (id, name, slug) values (
  '00000000-0000-0000-0000-000000000240',
  'Lane B Begin RPC Org',
  'lane-b-begin-rpc'
) on conflict do nothing;

insert into public.clients (id, org_id, display_name) values (
  '00000000-0000-0000-0000-000000000241',
  '00000000-0000-0000-0000-000000000240',
  'Lane B Begin RPC Client'
) on conflict do nothing;

select lives_ok(
  $$ select * from public.enrollment_begin(
    '00000000-0000-0000-0000-000000000241',
    null,
    '00000000-0000-4000-8000-000000000242',
    'Lane B Signer',
    'Lane B Signer',
    'agreement-2026-08-16.1',
    'monitoring-2026-08-16.1',
    'analysis-2026-08-16.1',
    '127.0.0.1',
    'lane-b-pgtap'
  ) $$,
  'enrollment_begin creates the merged Phase 1 record set'
);

select is((select count(*)::integer from public.esignatures where client_id = '00000000-0000-0000-0000-000000000241'), 1, 'one e-signature is retained');
select is((select count(*)::integer from public.consents where client_id = '00000000-0000-0000-0000-000000000241'), 2, 'two named consent grants are retained');
select is((select count(*)::integer from public.enrollments where client_id = '00000000-0000-0000-0000-000000000241'), 1, 'one enrollment is created');
select is((select count(*)::integer from public.enrollment_milestones where client_id = '00000000-0000-0000-0000-000000000241' and kind = 'agreement_signed'), 1, 'the signed milestone is recorded');

select lives_ok(
  $$ select * from public.enrollment_begin(
    '00000000-0000-0000-0000-000000000241',
    null,
    '00000000-0000-4000-8000-000000000242',
    'Lane B Signer',
    'Lane B Signer',
    'agreement-2026-08-16.1',
    'monitoring-2026-08-16.1',
    'analysis-2026-08-16.1',
    '127.0.0.1',
    'lane-b-pgtap'
  ) $$,
  'replaying the same draft returns without duplicating retained rows'
);

select is(
  (
    select (
      (select count(*) from public.esignatures where client_id = '00000000-0000-0000-0000-000000000241')
      + (select count(*) from public.consents where client_id = '00000000-0000-0000-0000-000000000241')
      + (select count(*) from public.enrollments where client_id = '00000000-0000-0000-0000-000000000241')
      + (select count(*) from public.enrollment_milestones where client_id = '00000000-0000-0000-0000-000000000241')
    )::integer
  ),
  5,
  'replay leaves the complete retained row count unchanged'
);

select * from finish();
rollback;
