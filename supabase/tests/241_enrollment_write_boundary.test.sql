begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

select ok(
  not has_table_privilege('authenticated', 'public.consents', 'INSERT')
  and not has_table_privilege('authenticated', 'public.enrollments', 'INSERT')
  and not has_table_privilege('authenticated', 'public.enrollments', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.enrollment_milestones', 'INSERT')
  and not has_table_privilege('authenticated', 'public.enrollment_milestones', 'UPDATE'),
  'authenticated sessions have no direct enrollment write grants'
);

set local role authenticated;
set local request.jwt.claims =
  '{"role":"authenticated","sub":"a1000000-0000-0000-0000-000000000014"}';

select throws_ok(
  $$insert into public.consents (
      client_id, kind, text_version, signed_at, ip, esig_ref
    ) values (
      'a3000000-0000-0000-0000-000000000004', 'monitoring', 'spoofed',
      pg_catalog.now(), '127.0.0.1', 'spoofed'
    )$$,
  '42501', null, 'a consumer cannot insert consent evidence directly'
);
select throws_ok(
  $$insert into public.enrollments (
      client_id, status, monitoring_consent_at, analysis_consent_at, esig_doc_id
    ) values (
      'a3000000-0000-0000-0000-000000000004', 'active', pg_catalog.now(),
      pg_catalog.now(), 'spoofed'
    )$$,
  '42501', null, 'a consumer cannot insert enrollment state directly'
);
select throws_ok(
  $$insert into public.enrollment_milestones (client_id, kind)
    values ('a3000000-0000-0000-0000-000000000004', 'agreement_signed')$$,
  '42501', null, 'a consumer cannot insert enrollment milestones directly'
);

reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"role":"authenticated","sub":"a1000000-0000-0000-0000-000000000001"}';

select throws_ok(
  $$insert into public.consents (
      client_id, kind, text_version, signed_at, ip, esig_ref
    ) values (
      'a3000000-0000-0000-0000-000000000001', 'monitoring', 'spoofed',
      pg_catalog.now(), '127.0.0.1', 'spoofed'
    )$$,
  '42501', null, 'an operator cannot insert consent evidence directly'
);
select throws_ok(
  $$update public.enrollments set status = 'active'
    where id = 'a5000000-0000-0000-0000-000000000001'$$,
  '42501', null, 'an operator cannot update enrollment state directly'
);
select throws_ok(
  $$insert into public.enrollment_milestones (client_id, kind)
    values ('a3000000-0000-0000-0000-000000000001', 'agreement_signed')$$,
  '42501', null, 'an operator cannot insert enrollment milestones directly'
);

reset role;
set local role service_role;

select lives_ok(
  $$select * from public.enrollment_begin(
    'a3000000-0000-0000-0000-000000000004',
    'a1000000-0000-0000-0000-000000000014',
    '24100000-0000-4000-8000-000000000001',
    'Enrollment Boundary Test',
    'Enrollment Boundary Test',
    'agreement-r1a-02',
    'monitoring-r1a-02',
    'analysis-r1a-02',
    '127.0.0.1',
    'pgTAP'
  )$$,
  'the service-role enrollment_begin RPC remains the positive write path'
);

select * from finish();
rollback;
