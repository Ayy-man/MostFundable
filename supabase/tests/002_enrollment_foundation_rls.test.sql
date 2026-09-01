begin;

set local search_path = public, extensions;

select plan(40);

select has_table('public', 'consents', 'consents table exists');
select has_table('public', 'enrollments', 'enrollments table exists');
select has_table('public', 'enrollment_milestones', 'enrollment milestones table exists');
select has_table('public', 'monitoring_events', 'monitoring events table exists');
select has_type('public', 'consent_kind', 'consent kind enum exists');
select has_type('public', 'consent_action', 'consent action enum exists');
select has_type('public', 'enrollment_status', 'enrollment status enum exists');
select has_type('public', 'enrollment_milestone_kind', 'milestone kind enum exists');
select has_type('public', 'crs_persona', 'persona enum exists');

select is(
  (
    select count(*)::integer
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in (
        'consents',
        'enrollments',
        'enrollment_milestones',
        'monitoring_events'
      )
      and relation.relrowsecurity
  ),
  4,
  'all enrollment tables enable row security'
);

select is(
  (
    select count(*)::integer
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in (
        'consents',
        'enrollments',
        'enrollment_milestones',
        'monitoring_events'
      )
      and relation.relforcerowsecurity
  ),
  4,
  'all enrollment tables force row security'
);

-- 2026-08-17 R1A-02: five browser-write policies were removed; the four
-- tenant-scoped read policies remain.
select is(
  (
    select count(*)::integer
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'consents',
        'enrollments',
        'enrollment_milestones',
        'monitoring_events'
      )
  ),
  4,
  'enrollment tables have their expected policies'
);

select is(
  (
    select count(*)::integer
    from pg_indexes
    where schemaname = 'public'
      and indexname in (
        'consents_client_id_idx',
        'consents_client_kind_signed_at_idx',
        'consents_supersedes_consent_id_idx',
        'enrollments_status_idx',
        'enrollments_parked_until_idx',
        'enrollment_milestones_completed_by_idx',
        'monitoring_events_client_occurred_at_idx',
        'monitoring_events_received_at_idx'
      )
  ),
  8,
  'enrollment relationship and lookup indexes exist'
);

select results_eq(
  $$
    select column_name::text collate "C"
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'monitoring_events'
    order by ordinal_position
  $$,
  $$
    values
      ('id'::text collate "C"),
      ('client_id'::text collate "C"),
      ('event_type'::text collate "C"),
      ('occurred_at'::text collate "C"),
      ('received_at'::text collate "C")
  $$,
  'monitoring events exposes only five routing and timing columns'
);

select results_eq(
  $$
    select enumlabel::text collate "C"
    from pg_enum
    join pg_type on pg_type.oid = pg_enum.enumtypid
    join pg_namespace on pg_namespace.oid = pg_type.typnamespace
    where pg_namespace.nspname = 'public'
      and pg_type.typname = 'crs_persona'
    order by enumsortorder
  $$,
  $$
    values
      ('clean'::text collate "C"),
      ('derog'::text collate "C"),
      ('thin_file'::text collate "C"),
      ('no_hit'::text collate "C")
  $$,
  'persona enum matches the frozen four-value contract'
);

select is(
  (
    select count(*)::integer
    from pg_trigger
    where not tgisinternal
      and tgname in (
        'consents_validate_supersession',
        'consents_prevent_change',
        'enrollments_validate_consents'
      )
  ),
  3,
  'consent and enrollment integrity triggers exist'
);

select is(
  (
    select bool_and(
      has_table_privilege(
        'service_role',
        format('public.%I', table_name),
        'select,insert,update,delete'
      )
    )
    from unnest(array[
      'consents',
      'enrollments',
      'enrollment_milestones',
      'monitoring_events'
    ]) as table_name
  ),
  true,
  'server role has explicit enrollment table privileges'
);

insert into auth.users (id, email)
values
  ('10000000-0000-0000-0000-000000000011', 'owner.one@enrollment.example'),
  ('10000000-0000-0000-0000-000000000012', 'consumer.one@enrollment.example'),
  ('10000000-0000-0000-0000-000000000013', 'affiliate.one@enrollment.example'),
  ('20000000-0000-0000-0000-000000000021', 'owner.two@enrollment.example'),
  ('20000000-0000-0000-0000-000000000022', 'consumer.two@enrollment.example');

insert into public.orgs (id, name, slug)
values
  ('11000000-0000-0000-0000-000000000001', 'Enrollment Org One', 'enrollment-org-one'),
  ('22000000-0000-0000-0000-000000000002', 'Enrollment Org Two', 'enrollment-org-two');

insert into public.profiles (id, role, org_id, org_role, full_name, email)
values
  (
    '10000000-0000-0000-0000-000000000011',
    'operator_member',
    '11000000-0000-0000-0000-000000000001',
    'owner',
    'Enrollment Owner One',
    'owner.one@enrollment.example'
  ),
  (
    '10000000-0000-0000-0000-000000000012',
    'consumer',
    '11000000-0000-0000-0000-000000000001',
    null,
    'Enrollment Consumer One',
    'consumer.one@enrollment.example'
  ),
  (
    '10000000-0000-0000-0000-000000000013',
    'affiliate',
    '11000000-0000-0000-0000-000000000001',
    null,
    'Enrollment Affiliate One',
    'affiliate.one@enrollment.example'
  ),
  (
    '20000000-0000-0000-0000-000000000021',
    'operator_member',
    '22000000-0000-0000-0000-000000000002',
    'owner',
    'Enrollment Owner Two',
    'owner.two@enrollment.example'
  ),
  (
    '20000000-0000-0000-0000-000000000022',
    'consumer',
    '22000000-0000-0000-0000-000000000002',
    null,
    'Enrollment Consumer Two',
    'consumer.two@enrollment.example'
  )
on conflict (id) do update
set
  role = excluded.role,
  org_id = excluded.org_id,
  org_role = excluded.org_role,
  full_name = excluded.full_name,
  email = excluded.email;

insert into public.clients (id, org_id, consumer_profile_id, display_name, assigned_to)
values
  (
    '11000000-0000-0000-0000-000000000101',
    '11000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000012',
    'Enrollment Client One',
    '10000000-0000-0000-0000-000000000011'
  ),
  (
    '22000000-0000-0000-0000-000000000202',
    '22000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000022',
    'Enrollment Client Two',
    '20000000-0000-0000-0000-000000000021'
  );

select throws_ok(
  $$
    insert into public.enrollments (
      id,
      client_id,
      status,
      monitoring_consent_at,
      analysis_consent_at,
      esig_doc_id,
      idpass
    ) values (
      '11000000-0000-0000-0000-000000000301',
      '11000000-0000-0000-0000-000000000101',
      'enrolled',
      '2026-08-16T01:00:00Z',
      '2026-08-16T01:01:00Z',
      'esig-one',
      false
    )
  $$,
  'P0001',
  'enrollment requires a matching monitoring consent grant',
  'enrollment cannot precede matching consent grants'
);

insert into public.consents (
  id,
  client_id,
  kind,
  action,
  text_version,
  signed_at,
  ip,
  esig_ref
)
values
  (
    '11000000-0000-0000-0000-000000000401',
    '11000000-0000-0000-0000-000000000101',
    'monitoring',
    'granted',
    'monitoring-v1',
    '2026-08-16T01:00:00Z',
    '192.0.2.10',
    'esig-one'
  ),
  (
    '11000000-0000-0000-0000-000000000402',
    '11000000-0000-0000-0000-000000000101',
    'analysis',
    'granted',
    'analysis-v1',
    '2026-08-16T01:01:00Z',
    '192.0.2.10',
    'esig-one'
  ),
  (
    '22000000-0000-0000-0000-000000000403',
    '22000000-0000-0000-0000-000000000202',
    'monitoring',
    'granted',
    'monitoring-v1',
    '2026-08-16T02:00:00Z',
    '192.0.2.20',
    'esig-two'
  ),
  (
    '22000000-0000-0000-0000-000000000404',
    '22000000-0000-0000-0000-000000000202',
    'analysis',
    'granted',
    'analysis-v1',
    '2026-08-16T02:01:00Z',
    '192.0.2.20',
    'esig-two'
  );

select lives_ok(
  $$
    insert into public.enrollments (
      id,
      client_id,
      status,
      monitoring_consent_at,
      analysis_consent_at,
      esig_doc_id,
      idpass,
      persona_hint
    ) values (
      '11000000-0000-0000-0000-000000000301',
      '11000000-0000-0000-0000-000000000101',
      'active',
      '2026-08-16T01:00:00Z',
      '2026-08-16T01:01:00Z',
      'esig-one',
      true,
      'clean'
    )
  $$,
  'valid consent-backed enrollment succeeds'
);

select lives_ok(
  $$
    insert into public.enrollments (
      id,
      client_id,
      status,
      monitoring_consent_at,
      analysis_consent_at,
      esig_doc_id,
      idpass,
      parked_until,
      persona_hint
    ) values (
      '22000000-0000-0000-0000-000000000302',
      '22000000-0000-0000-0000-000000000202',
      'parked',
      '2026-08-16T02:00:00Z',
      '2026-08-16T02:01:00Z',
      'esig-two',
      false,
      '2026-08-19T02:01:00Z',
      'thin_file'
    )
  $$,
  'parked enrollment with a deadline succeeds'
);

select throws_ok(
  $$
    update public.enrollments
    set status = 'parked'
    where id = '11000000-0000-0000-0000-000000000301'
  $$,
  '23514',
  null,
  'parked state requires a deadline'
);

select throws_ok(
  $$
    update public.enrollments
    set status = 'active'
    where id = '22000000-0000-0000-0000-000000000302'
  $$,
  '23514',
  null,
  'non-parked state cannot retain a deadline'
);

select lives_ok(
  $$
    insert into public.consents (
      id,
      client_id,
      kind,
      action,
      text_version,
      signed_at,
      ip,
      esig_ref,
      supersedes_consent_id
    ) values (
      '11000000-0000-0000-0000-000000000405',
      '11000000-0000-0000-0000-000000000101',
      'monitoring',
      'revoked',
      'monitoring-v1',
      '2026-08-16T03:00:00Z',
      '192.0.2.10',
      'esig-one',
      '11000000-0000-0000-0000-000000000401'
    )
  $$,
  'same-client consent event can link to its earlier grant'
);

select throws_ok(
  $$
    insert into public.consents (
      id,
      client_id,
      kind,
      action,
      text_version,
      signed_at,
      ip,
      esig_ref,
      supersedes_consent_id
    ) values (
      '22000000-0000-0000-0000-000000000406',
      '22000000-0000-0000-0000-000000000202',
      'monitoring',
      'revoked',
      'monitoring-v1',
      '2026-08-16T03:01:00Z',
      '192.0.2.20',
      'esig-two',
      '11000000-0000-0000-0000-000000000401'
    )
  $$,
  'P0001',
  'revoked consent must link to an earlier matching grant',
  'linked consent history cannot cross clients'
);

select throws_ok(
  $$
    update public.consents
    set text_version = 'changed'
    where id = '11000000-0000-0000-0000-000000000401'
  $$,
  'P0001',
  'consents rows are append-only',
  'consent rows cannot be updated in owner context'
);

select throws_ok(
  $$
    delete from public.consents
    where id = '11000000-0000-0000-0000-000000000401'
  $$,
  'P0001',
  'consents rows are append-only',
  'consent rows cannot be deleted in owner context'
);

select throws_ok(
  $$
    insert into public.enrollment_milestones (
      client_id,
      kind,
      completed_by
    ) values (
      '11000000-0000-0000-0000-000000000101',
      'agreement_signed',
      '10000000-0000-0000-0000-000000000011'
    )
  $$,
  '23514',
  null,
  'incomplete milestone cannot name an actor'
);

insert into public.enrollment_milestones (client_id, kind, completed_at, completed_by)
values
  (
    '11000000-0000-0000-0000-000000000101',
    'agreement_signed',
    '2026-08-16T01:02:00Z',
    '10000000-0000-0000-0000-000000000011'
  ),
  (
    '22000000-0000-0000-0000-000000000202',
    'agreement_signed',
    '2026-08-16T02:02:00Z',
    '20000000-0000-0000-0000-000000000021'
  );

insert into public.monitoring_events (id, client_id, event_type, occurred_at, received_at)
values
  (
    '11000000-0000-0000-0000-000000000501',
    '11000000-0000-0000-0000-000000000101',
    'test_alert',
    '2026-08-16T04:00:00Z',
    '2026-08-16T04:01:00Z'
  ),
  (
    '22000000-0000-0000-0000-000000000502',
    '22000000-0000-0000-0000-000000000202',
    'test_alert',
    '2026-08-16T04:00:00Z',
    '2026-08-16T04:01:00Z'
  );

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"10000000-0000-0000-0000-000000000011"}';

select is((select count(*)::integer from public.enrollments), 1, 'Org One owner sees one own enrollment');
select is(
  (
    select count(*)::integer
    from public.enrollments
    where client_id = '22000000-0000-0000-0000-000000000202'
  ),
  0,
  'Org One owner sees no Org Two enrollment'
);
select is((select count(*)::integer from public.monitoring_events), 1, 'Org One owner sees one own event');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"10000000-0000-0000-0000-000000000012"}';

select is((select count(*)::integer from public.consents), 3, 'consumer sees own consent history only');
select is((select count(*)::integer from public.enrollments), 1, 'consumer sees own enrollment only');
select is((select count(*)::integer from public.enrollment_milestones), 1, 'consumer sees own milestone only');
select is((select count(*)::integer from public.monitoring_events), 1, 'consumer sees own event only');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"10000000-0000-0000-0000-000000000013"}';

select is((select count(*)::integer from public.consents), 0, 'affiliate sees no consent rows');
select is((select count(*)::integer from public.enrollments), 0, 'affiliate sees no enrollment rows');
select is((select count(*)::integer from public.enrollment_milestones), 0, 'affiliate sees no milestone rows');
select is((select count(*)::integer from public.monitoring_events), 0, 'affiliate sees no event rows');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"20000000-0000-0000-0000-000000000022"}';

select is(
  (
    select count(*)::integer
    from public.enrollments
    where client_id = '11000000-0000-0000-0000-000000000101'
  ),
  0,
  'Org Two consumer sees no Org One enrollment'
);
select results_eq(
  $$ select client_id from public.enrollments order by client_id $$,
  $$ values ('22000000-0000-0000-0000-000000000202'::uuid) $$,
  'Org Two consumer sees exactly the linked enrollment'
);

reset role;

select * from finish();

rollback;
