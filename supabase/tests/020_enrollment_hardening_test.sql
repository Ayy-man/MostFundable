begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into public.orgs (id, name, slug) values
  (
    '00000000-0000-0000-0000-0000000000b0',
    'Lane B Test Org',
    'lane-b-test'
  )
  on conflict do nothing;

insert into public.clients (id, org_id, display_name) values
  (
    '00000000-0000-0000-0000-0000000000b1',
    '00000000-0000-0000-0000-0000000000b0',
    'Lane B Test Client'
  )
  on conflict do nothing;

select lives_ok(
  $$
    insert into public.consents (
      id,
      client_id,
      kind,
      text_version,
      signed_at,
      ip,
      esig_ref
    ) values (
      '00000000-0000-0000-0000-0000000000b2',
      '00000000-0000-0000-0000-0000000000b1',
      'analysis',
      'analysis-2026-08-16.1',
      '2026-08-16T00:00:00Z',
      '127.0.0.1',
      'lane-b-hardening-esig'
    )
  $$,
  'a new consent row can be appended'
);

select throws_ok(
  $$
    update public.consents
       set text_version = 'changed'
     where id = '00000000-0000-0000-0000-0000000000b2'
  $$,
  'P0001',
  null,
  'an existing consent row cannot be updated'
);

select throws_ok(
  $$
    delete from public.consents
     where id = '00000000-0000-0000-0000-0000000000b2'
  $$,
  'P0001',
  null,
  'an existing consent row cannot be deleted'
);

select throws_ok(
  $$ truncate public.consents cascade $$,
  'P0001',
  null,
  'the consent table cannot be truncated'
);

select is(
  (
    select tgenabled
    from pg_trigger
    where tgname = 'consents_append_only'
      and tgrelid = 'public.consents'::regclass
  ),
  'A',
  'the row guard remains enabled in replication mode'
);

select is(
  (
    select tgenabled
    from pg_trigger
    where tgname = 'consents_no_truncate'
      and tgrelid = 'public.consents'::regclass
  ),
  'A',
  'the table guard remains enabled in replication mode'
);

select is(
  has_table_privilege(
    'service_role',
    'public.consents',
    'select,insert,update,delete'
  ),
  true,
  'service_role retains the Phase 1 privilege contract while triggers enforce append-only writes'
);

select throws_ok(
  $$
    insert into public.consents (
      id, client_id, kind, text_version, signed_at, ip, esig_ref
    ) values (
      '00000000-0000-0000-0000-0000000000b3',
      '00000000-0000-0000-0000-0000000000b1',
      'monitoring',
      'monitoring-2026-08-16.1',
      '2026-08-16T00:00:00Z',
      '127.0.0.1',
      'lane-b-hardening-esig'
    );
    insert into public.enrollments (
      client_id,
      status,
      monitoring_consent_at,
      analysis_consent_at,
      esig_doc_id
    ) values (
      '00000000-0000-0000-0000-0000000000b1',
      'parked',
      '2026-08-16T00:00:00Z',
      '2026-08-16T00:00:00Z',
      'lane-b-hardening-esig'
    )
  $$,
  '23514',
  null,
  'a parked enrollment requires a deadline'
);

select has_index(
  'public',
  'enrollment_milestones',
  'uniq_milestone_client_kind',
  'milestone recording has an idempotency index'
);

select is(
  (
    select count(*)::integer
    from public.audit_log
    where action = 'consent.create'
      and subject_type = 'consent'
      and subject_id = '00000000-0000-0000-0000-0000000000b2'
  ),
  1,
  'one appended consent writes exactly one audit row'
);

insert into public.enrollment_milestones (
  client_id,
  kind,
  completed_at
) values (
  '00000000-0000-0000-0000-0000000000b1',
  'agreement_signed',
  pg_catalog.now()
);

select throws_ok(
  $$
    insert into public.enrollment_milestones (
      client_id,
      kind,
      completed_at
    ) values (
      '00000000-0000-0000-0000-0000000000b1',
      'agreement_signed',
      pg_catalog.now()
    )
  $$,
  '23505',
  null,
  'a repeated milestone conflicts with the original row'
);

select * from finish();
rollback;
