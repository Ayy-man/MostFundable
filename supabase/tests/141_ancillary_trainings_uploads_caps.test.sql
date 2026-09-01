begin;

set local search_path = public, extensions;

select plan(50);

select has_type('public', 'training_audience', 'training audience enum exists');
select has_type('public', 'training_source', 'training source enum exists');
select has_type('public', 'document_section', 'document section enum exists');
select has_type('public', 'document_upload_kind', 'document upload kind enum exists');
select has_type('public', 'document_upload_lifecycle', 'document lifecycle enum exists');
select has_type('public', 'pull_cap_reason', 'pull cap reason enum exists');

select has_table('public', 'trainings', 'trainings table exists');
select has_table('public', 'document_uploads', 'document uploads table exists');
select has_table('public', 'pull_caps', 'pull caps table exists');
select has_table('public', 'pull_cap_attempts', 'pull cap attempts table exists');

select results_eq(
  $$
    select column_name::text collate "C"
    from information_schema.columns
    where table_schema = 'public' and table_name = 'trainings'
    order by ordinal_position
  $$,
  $$
    values
      ('id'::text collate "C"), ('org_id'::text collate "C"),
      ('audience'::text collate "C"), ('source'::text collate "C"),
      ('title'::text collate "C"), ('video_url'::text collate "C"),
      ('body'::text collate "C"), ('published'::text collate "C"),
      ('published_at'::text collate "C"), ('published_by'::text collate "C"),
      ('attested'::text collate "C"), ('attested_at'::text collate "C"),
      ('attestation_text'::text collate "C"), ('created_by'::text collate "C"),
      ('created_at'::text collate "C"), ('updated_at'::text collate "C"),
      ('takedown_reason'::text collate "C"), ('taken_down_by'::text collate "C"),
      ('taken_down_at'::text collate "C"), ('source_object_path'::text collate "C"),
      ('source_file_name'::text collate "C"), ('source_mime_type'::text collate "C"),
      ('source_size_bytes'::text collate "C"), ('source_uploaded_at'::text collate "C")
  $$,
  'trainings exposes the publication evidence columns'
);

select enum_has_labels(
  'public',
  'document_section',
  array['articles', 'ein', 'tax_returns', 'bank_statements', 'other'],
  'company documents use exactly the five contracted sections'
);

select is(
  (
    select bool_and(relation.relrowsecurity and relation.relforcerowsecurity)
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in (
        'trainings', 'document_uploads', 'pull_caps', 'pull_cap_attempts'
      )
  ),
  true,
  'every Phase-17 table enables and forces row security'
);

select is(
  has_table_privilege('service_role', 'public.trainings', 'select,insert,update,delete'),
  true,
  'service role has explicit training mutation privileges'
);
select is(
  has_table_privilege('authenticated', 'public.document_uploads', 'insert'),
  false,
  'authenticated users cannot mutate upload metadata directly'
);
select is(
  has_function_privilege('service_role', 'private.derived_features_valid(jsonb)', 'execute'),
  true,
  'service role can evaluate the upload derived-feature constraint'
);
select is(
  (select count(*)::integer from storage.buckets where id in ('client-documents', 'credit-reports')),
  2,
  'both private Storage buckets exist'
);
select is(
  (
    select count(*)::integer from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname in (
        'ancillary_storage_select', 'ancillary_storage_insert', 'ancillary_storage_delete'
      )
  ),
  3,
  'Storage exposes only the three scoped Phase-17 policies'
);
select has_trigger(
  'public',
  'document_uploads',
  'document_uploads_identity_immutable',
  'upload identity and object path are immutable'
);

insert into auth.users (id, email)
values
  ('71000000-0000-4000-8000-000000000011', 'owner-a@ancillary.test'),
  ('71000000-0000-4000-8000-000000000012', 'consumer-a@ancillary.test'),
  ('72000000-0000-4000-8000-000000000021', 'owner-b@ancillary.test'),
  ('70000000-0000-4000-8000-000000000001', 'admin@ancillary.test');

insert into public.orgs (id, name, slug)
values
  ('71000000-0000-4000-8000-000000000001', 'Ancillary Org A', 'ancillary-org-a'),
  ('72000000-0000-4000-8000-000000000002', 'Ancillary Org B', 'ancillary-org-b');

insert into public.profiles (id, role, org_id, org_role, full_name, email)
values
  (
    '71000000-0000-4000-8000-000000000011', 'operator_member',
    '71000000-0000-4000-8000-000000000001', 'owner',
    'Owner A', 'owner-a@ancillary.test'
  ),
  (
    '71000000-0000-4000-8000-000000000012', 'consumer',
    '71000000-0000-4000-8000-000000000001', null,
    'Consumer A', 'consumer-a@ancillary.test'
  ),
  (
    '72000000-0000-4000-8000-000000000021', 'operator_member',
    '72000000-0000-4000-8000-000000000002', 'owner',
    'Owner B', 'owner-b@ancillary.test'
  ),
  (
    '70000000-0000-4000-8000-000000000001', 'platform_admin',
    null, null, 'Platform Admin', 'admin@ancillary.test'
  )
on conflict (id) do update
set role = excluded.role,
    org_id = excluded.org_id,
    org_role = excluded.org_role,
    full_name = excluded.full_name,
    email = excluded.email;

insert into public.clients (id, org_id, consumer_profile_id, assigned_to, display_name)
values (
  '71000000-0000-4000-8000-000000000101',
  '71000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000012',
  '71000000-0000-4000-8000-000000000011',
  'Ancillary Client A'
);

-- 2026-08-17 R1C-02 carry: upload source checks now run behind current
-- enrollment plus analysis authorization, so this source-lifecycle fixture
-- establishes that prerequisite explicitly.
select * from public.enrollment_begin(
  '71000000-0000-4000-8000-000000000101',
  '71000000-0000-4000-8000-000000000012',
  '71000000-0000-4000-8000-000000000401',
  'Consumer A', 'Consumer A', 'ancillary-agreement-v1',
  'ancillary-monitoring-v1', 'ancillary-analysis-v1',
  '192.0.2.141', 'pgTAP ancillary fixture'
);
-- 2026-08-17 R3C-03: this upload-lifecycle fixture needs the paid access
-- prerequisite before it can isolate source-state validation.
update public.enrollments
set status = 'active'
where client_id = '71000000-0000-4000-8000-000000000101';
insert into public.consumer_subscriptions (
  id, client_id, enrollment_id, provider, customer_ref, subscription_ref,
  price_cents, status, idempotency_key
)
select
  '71000000-0000-4000-8000-000000000402',
  '71000000-0000-4000-8000-000000000101',
  enrollment.id,
  'mock', 'mock_ancillary_customer', 'mock_ancillary_subscription',
  1900, 'active', 'ancillary-active-subscription'
from public.enrollments as enrollment
where enrollment.client_id = '71000000-0000-4000-8000-000000000101';

insert into public.trainings (
  id, org_id, audience, title, video_url, body, created_by
)
values
  (
    '71000000-0000-4000-8000-000000000201',
    '71000000-0000-4000-8000-000000000001',
    'client', 'Client training A', 'https://www.youtube.com/watch?v=test-a',
    'Neutral training body A.', '71000000-0000-4000-8000-000000000011'
  ),
  (
    '71000000-0000-4000-8000-000000000202',
    '71000000-0000-4000-8000-000000000001',
    'client', 'Client training B', 'https://vimeo.com/123456',
    'Neutral training body B.', '71000000-0000-4000-8000-000000000011'
  );

select throws_ok(
  $$select * from public.publish_training(
    '71000000-0000-4000-8000-000000000201',
    '71000000-0000-4000-8000-000000000011', false, 'Approved text'
  )$$,
  'P0001', 'TRAINING_ATTESTATION_REQUIRED',
  'publication rejects a false attestation'
);
select throws_ok(
  $$select * from public.publish_training(
    '71000000-0000-4000-8000-000000000201',
    '71000000-0000-4000-8000-000000000011', true, '   '
  )$$,
  'P0001', 'TRAINING_ATTESTATION_REQUIRED',
  'publication rejects blank approved text'
);
select throws_ok(
  $$select * from public.publish_training(
    '71000000-0000-4000-8000-000000000201',
    '72000000-0000-4000-8000-000000000021', true, 'Approved text'
  )$$,
  'P0001', 'TRAINING_ACTOR_FORBIDDEN',
  'publication rejects an operator from another organization'
);
select lives_ok(
  $$select * from public.publish_training(
    '71000000-0000-4000-8000-000000000201',
    '71000000-0000-4000-8000-000000000011', true, 'Approved text A'
  )$$,
  'the owning operator can publish one row'
);
select is(
  (select published from public.trainings where id = '71000000-0000-4000-8000-000000000201'),
  true,
  'publication persists the published state'
);
select is(
  (
    select published_at = attested_at and published_by = '71000000-0000-4000-8000-000000000011'
      and attested and attestation_text = 'Approved text A'
    from public.trainings where id = '71000000-0000-4000-8000-000000000201'
  ),
  true,
  'publication persists one actor timestamp and text snapshot'
);
select is(
  (
    select count(*)::integer from public.audit_log
    where subject_id = '71000000-0000-4000-8000-000000000201'
      and action = 'training.published'
  ),
  1,
  'publication writes one audit row in the same transaction'
);
select lives_ok(
  $$select * from public.publish_training(
    '71000000-0000-4000-8000-000000000202',
    '71000000-0000-4000-8000-000000000011', true, 'Approved text B'
  )$$,
  'a sibling row can be published independently'
);
select lives_ok(
  $$select * from public.unpublish_training(
    '71000000-0000-4000-8000-000000000201',
    '71000000-0000-4000-8000-000000000011'
  )$$,
  'the owning operator can unpublish the named row'
);
select is(
  (
    select not first.published and second.published
    from public.trainings as first
    cross join public.trainings as second
    where first.id = '71000000-0000-4000-8000-000000000201'
      and second.id = '71000000-0000-4000-8000-000000000202'
  ),
  true,
  'unpublish changes only the named row'
);
select is(
  (
    select published_at is not null and attestation_text = 'Approved text A'
    from public.trainings where id = '71000000-0000-4000-8000-000000000201'
  ),
  true,
  'unpublish preserves the last publication evidence'
);

insert into public.document_uploads (
  id, org_id, client_id, kind, section, bucket, object_path,
  display_name, mime_type, size_bytes, lifecycle, uploaded_by
)
values
  (
    '71000000-0000-4000-8000-000000000301',
    '71000000-0000-4000-8000-000000000001',
    '71000000-0000-4000-8000-000000000101',
    'company', 'articles', 'client-documents',
    '71000000-0000-4000-8000-000000000001/71000000-0000-4000-8000-000000000101/71000000-0000-4000-8000-000000000301/a.pdf',
    'a.pdf', 'application/pdf', 100, 'stored',
    '71000000-0000-4000-8000-000000000012'
  ),
  (
    '71000000-0000-4000-8000-000000000302',
    '71000000-0000-4000-8000-000000000001',
    '71000000-0000-4000-8000-000000000101',
    'company', 'articles', 'client-documents',
    '71000000-0000-4000-8000-000000000001/71000000-0000-4000-8000-000000000101/71000000-0000-4000-8000-000000000302/b.pdf',
    'b.pdf', 'application/pdf', 101, 'stored',
    '71000000-0000-4000-8000-000000000012'
  );

select is(
  (
    select count(*)::integer from public.document_uploads
    where client_id = '71000000-0000-4000-8000-000000000101'
      and section = 'articles'
  ),
  2,
  'one section accepts more than one company document'
);
select throws_ok(
  $$
    update public.document_uploads
    set derived_features = '{}'::jsonb
    where id = '71000000-0000-4000-8000-000000000301'
  $$,
  '23514', null,
  'company documents cannot carry derived output'
);

create temporary table ancillary_derived_fixture (value jsonb not null) on commit drop;
insert into ancillary_derived_fixture values (
  jsonb_build_object(
    'schemaVersion', 1,
    'bureausPulled', jsonb_build_array('EQF'),
    'accounts', '[]'::jsonb,
    'overallUtilizationPct', null,
    'inquiriesByBureau', jsonb_build_object('EQF', 0, 'EXP', 0, 'TUC', 0),
    'negativesCount', 0,
    'openRevolvingCount', 0,
    'averageAgeMonths', null,
    'highestRevolvingLimitCents', null,
    'dti', jsonb_build_object(
      'monthlyDebtPaymentsCents', 0,
      'statedMonthlyIncomeCents', null,
      'ratioPct', null
    ),
    'flags', jsonb_build_object(
      'averageAgeTwoYearsOrMore', false,
      'cardWithTenKLimit', false,
      'fourOrMorePersonalAccountsOpen', false,
      'noNegativeItemsReported', true,
      'thinFile', true,
      'twoOrFewerInquiriesEveryBureau', true,
      'utilizationUnder30', true
    ),
    'computedAt', '2026-08-16T00:00:00.000Z'
  )
);

insert into public.document_uploads (
  id, org_id, client_id, kind, bucket, object_path,
  display_name, mime_type, size_bytes, lifecycle, uploaded_by
)
values (
  '71000000-0000-4000-8000-000000000303',
  '71000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000101',
  'credit_report', 'credit-reports',
  '71000000-0000-4000-8000-000000000001/71000000-0000-4000-8000-000000000101/71000000-0000-4000-8000-000000000303/source.pdf',
  'source.pdf', 'application/pdf', 200, 'stored',
  '71000000-0000-4000-8000-000000000012'
);

select throws_ok(
  $$select * from public.enqueue_analysis_job(
    '71000000-0000-4000-8000-000000000101', 'document_upload',
    '71000000-0000-4000-8000-000000000303', 'upload'
  )$$,
  'P0001', 'ANALYSIS_SOURCE_INVALID',
  'a stored upload cannot enqueue analysis'
);

update public.document_uploads
set lifecycle = 'parsed',
    derived_features = (select value from ancillary_derived_fixture),
    updated_at = clock_timestamp()
where id = '71000000-0000-4000-8000-000000000303';

select throws_ok(
  $$select * from public.enqueue_analysis_job(
    '71000000-0000-4000-8000-000000000101', 'document_upload',
    '71000000-0000-4000-8000-000000000303', 'upload'
  )$$,
  'P0001', 'ANALYSIS_SOURCE_INVALID',
  'a parsed upload cannot enqueue before source deletion'
);

update public.document_uploads
set lifecycle = 'purged', purged_at = clock_timestamp(), updated_at = clock_timestamp()
where id = '71000000-0000-4000-8000-000000000303';

select lives_ok(
  $$select * from public.enqueue_analysis_job(
    '71000000-0000-4000-8000-000000000101', 'document_upload',
    '71000000-0000-4000-8000-000000000303', 'upload'
  )$$,
  'a purged derived upload can enqueue through the existing queue'
);
select matches(
  pg_get_functiondef(
    'public.enqueue_analysis_job(uuid,public.analysis_job_source_kind,uuid,public.analysis_trigger)'::regprocedure
  ),
  '(?s)p_source_kind = ''enrollment''.*p_trigger <> ''scheduled''',
  'the enrollment source validation remains present'
);
select matches(
  pg_get_functiondef(
    'public.enqueue_analysis_job(uuid,public.analysis_job_source_kind,uuid,public.analysis_trigger)'::regprocedure
  ),
  '(?s)p_source_kind = ''monitoring_event''.*p_trigger <> ''alert''',
  'the monitoring source validation remains present'
);

select throws_ok(
  $$select * from public.set_pull_cap(
    '71000000-0000-4000-8000-000000000101', null, 1, null,
    '70000000-0000-4000-8000-000000000001'
  )$$,
  '23514', null,
  'count and window cannot be configured separately'
);
select results_eq(
  $$select * from public.assert_pull_allowed(
    '71000000-0000-4000-8000-000000000101', 'scheduled',
    '71000000-0000-4000-8000-000000000401'
  )$$,
  $$values (true, null::text)$$,
  'no cap row means uncapped'
);
select is(
  (
    select count(*)::integer from public.pull_cap_attempts
    where source_id = '71000000-0000-4000-8000-000000000401'
  ),
  1,
  'an uncapped replay records one durable decision'
);
select throws_ok(
  $$select * from public.set_pull_cap(
    '71000000-0000-4000-8000-000000000101', null, 1, 3600,
    '71000000-0000-4000-8000-000000000011'
  )$$,
  'P0001', 'PULL_CAP_ACTOR_FORBIDDEN',
  'only a platform admin may set a cap'
);
select lives_ok(
  $$select * from public.set_pull_cap(
    '71000000-0000-4000-8000-000000000101', null, 1, 3600,
    '70000000-0000-4000-8000-000000000001'
  )$$,
  'a platform admin can set the count-window cap'
);
select results_eq(
  $$select * from public.assert_pull_allowed(
    '71000000-0000-4000-8000-000000000101', 'alert',
    '71000000-0000-4000-8000-000000000402'
  )$$,
  $$values (false, 'count_window'::text)$$,
  'a prior allowed pull blocks the next source inside a one-count window'
);
select is(
  (
    select count(*)::integer from public.audit_log
    where action = 'pull.blocked'
      and client_id = '71000000-0000-4000-8000-000000000101'
  ),
  1,
  'a blocked attempt writes one metadata-only audit row'
);
select results_eq(
  $$select * from public.assert_pull_allowed(
    '71000000-0000-4000-8000-000000000101', 'alert',
    '71000000-0000-4000-8000-000000000402'
  )$$,
  $$values (false, 'count_window'::text)$$,
  'replay returns the original blocked decision'
);
select is(
  (
    select count(*)::integer from public.pull_cap_attempts
    where source_id = '71000000-0000-4000-8000-000000000402'
  ),
  1,
  'replay does not create a second attempt'
);
select is(
  public.clear_pull_cap(
    '71000000-0000-4000-8000-000000000101',
    '70000000-0000-4000-8000-000000000001'
  ),
  true,
  'a platform admin can clear one client cap'
);
select is(
  (
    select count(*)::integer from public.audit_log
    where action = 'pull_cap.cleared'
      and client_id = '71000000-0000-4000-8000-000000000101'
  ),
  1,
  'clearing a cap is atomic with its audit row'
);
select lives_ok(
  $$select * from public.set_pull_cap(
    '71000000-0000-4000-8000-000000000101', 3600, null, null,
    '70000000-0000-4000-8000-000000000001'
  )$$,
  'a minimum interval may be configured without a count window'
);
select results_eq(
  $$select * from public.assert_pull_allowed(
    '71000000-0000-4000-8000-000000000101', 'upload',
    '71000000-0000-4000-8000-000000000403'
  )$$,
  $$values (false, 'minimum_interval'::text)$$,
  'the minimum interval blocks a new upload source after an allowed pull'
);

select * from finish();

rollback;
