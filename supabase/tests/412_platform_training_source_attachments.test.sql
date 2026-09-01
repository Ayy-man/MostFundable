begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(29);

select has_column('public', 'trainings', 'source_object_path', 'training stores the private source object path');
select has_column('public', 'trainings', 'source_file_name', 'training stores the normalized source filename');
select has_column('public', 'trainings', 'source_mime_type', 'training stores the source media type');
select has_column('public', 'trainings', 'source_size_bytes', 'training stores the source size');
select has_column('public', 'trainings', 'source_uploaded_at', 'training stores the source upload time');
select ok(
  not has_column_privilege('authenticated', 'public.trainings', 'source_object_path', 'select'),
  'authenticated callers cannot select the private source object path'
);
select ok(
  has_column_privilege('authenticated', 'public.trainings', 'title', 'select'),
  'existing safe training fields remain directly readable under RLS'
);
select has_function(
  'public',
  'update_platform_training',
  array['uuid', 'uuid', 'training_audience', 'text', 'text', 'text', 'text', 'text', 'bigint'],
  'platform source replacement is one metadata and content transaction'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.update_platform_training(uuid,uuid,public.training_audience,text,text,text,text,text,bigint)',
    'execute'
  ),
  'only the trusted server can replace a platform training source'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.update_platform_training(uuid,uuid,public.training_audience,text,text,text,text,text,bigint)',
    'execute'
  ),
  'browser sessions cannot call the source replacement function'
);
select is(
  (select public from storage.buckets where id = 'platform-training-sources'),
  false,
  'the platform training source bucket is private'
);
select is(
  (select file_size_limit from storage.buckets where id = 'platform-training-sources'),
  6291456::bigint,
  'the source bucket enforces the six-megabyte limit'
);
select is(
  (select allowed_mime_types from storage.buckets where id = 'platform-training-sources'),
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ]::text[],
  'the source bucket accepts only PDF, Word, and text files'
);

insert into auth.users (id, email) values
  ('41200000-0000-4000-8000-000000000001', 'admin@training-source.test'),
  ('41200000-0000-4000-8000-000000000002', 'operator@training-source.test');

insert into public.orgs (id, name, slug) values
  ('41200000-0000-4000-8000-000000000010', 'Training source org', 'training-source-org');

insert into public.profiles (id, role, org_id, org_role, full_name, email) values
  ('41200000-0000-4000-8000-000000000001', 'platform_admin', null, null, 'Training Admin', 'admin@training-source.test'),
  ('41200000-0000-4000-8000-000000000002', 'operator_member', '41200000-0000-4000-8000-000000000010', 'owner', 'Training Operator', 'operator@training-source.test')
on conflict (id) do update set
  role = excluded.role,
  org_id = excluded.org_id,
  org_role = excluded.org_role,
  full_name = excluded.full_name,
  email = excluded.email;

insert into public.trainings (
  id,
  org_id,
  audience,
  source,
  title,
  video_url,
  body,
  created_by
) values
  (
    '41200000-0000-4000-8000-000000000101',
    null,
    'operator',
    'platform',
    'Legacy platform draft',
    'https://www.youtube.com/watch?v=legacy',
    'Existing rows remain readable without a source.',
    '41200000-0000-4000-8000-000000000001'
  ),
  (
    '41200000-0000-4000-8000-000000000102',
    '41200000-0000-4000-8000-000000000010',
    'client',
    'operator',
    'Operator draft',
    'https://vimeo.com/operator',
    'Operator authoring keeps its existing contract.',
    '41200000-0000-4000-8000-000000000002'
  );

select is(
  (select title from public.trainings where id = '41200000-0000-4000-8000-000000000101'),
  'Legacy platform draft'::text,
  'a legacy platform row without a source remains readable'
);
select throws_ok(
  $$select * from public.publish_training(
    '41200000-0000-4000-8000-000000000101',
    '41200000-0000-4000-8000-000000000001',
    true,
    'Approved platform attestation'
  )$$,
  'P0001',
  'TRAINING_SOURCE_REQUIRED',
  'a platform draft without a persisted source cannot newly publish'
);
select lives_ok(
  $$select * from public.publish_training(
    '41200000-0000-4000-8000-000000000102',
    '41200000-0000-4000-8000-000000000002',
    true,
    'Approved operator attestation'
  )$$,
  'an operator training still publishes without a platform source'
);
select throws_ok(
  $$update public.trainings set
    source_object_path = id::text || '/source',
    source_file_name = 'operator.pdf',
    source_mime_type = 'application/pdf',
    source_size_bytes = 10,
    source_uploaded_at = now()
  where id = '41200000-0000-4000-8000-000000000102'$$,
  '23514',
  null,
  'an operator training cannot acquire platform source metadata'
);
select throws_ok(
  $$update public.trainings set
    source_object_path = id::text || '/source',
    source_file_name = '../unsafe.pdf',
    source_mime_type = 'application/pdf',
    source_size_bytes = 10,
    source_uploaded_at = now()
  where id = '41200000-0000-4000-8000-000000000101'$$,
  '23514',
  null,
  'unsafe display filenames are rejected by the database'
);
select throws_ok(
  $$update public.trainings set
    source_object_path = id::text || '/source',
    source_file_name = 'oversize.pdf',
    source_mime_type = 'application/pdf',
    source_size_bytes = 6291457,
    source_uploaded_at = now()
  where id = '41200000-0000-4000-8000-000000000101'$$,
  '23514',
  null,
  'oversized source metadata is rejected by the database'
);
select throws_ok(
  $$update public.trainings set
    source_object_path = id::text || '/source',
    source_file_name = 'mismatch.txt',
    source_mime_type = 'application/pdf',
    source_size_bytes = 10,
    source_uploaded_at = now()
  where id = '41200000-0000-4000-8000-000000000101'$$,
  '23514',
  null,
  'a filename and media-type mismatch is rejected'
);
select throws_ok(
  $$select * from public.update_platform_training(
    '41200000-0000-4000-8000-000000000102',
    '41200000-0000-4000-8000-000000000001',
    'client',
    'Wrong source',
    'https://vimeo.com/wrong',
    'Wrong scope',
    'source.pdf',
    'application/pdf',
    10
  )$$,
  'P0001',
  'TRAINING_ACTOR_FORBIDDEN',
  'platform source replacement refuses an operator-owned row'
);
select throws_ok(
  $$select * from public.update_platform_training(
    '41200000-0000-4000-8000-000000000101',
    '41200000-0000-4000-8000-000000000002',
    'operator',
    'Wrong actor',
    'https://vimeo.com/wrong',
    'Wrong actor',
    'source.pdf',
    'application/pdf',
    10
  )$$,
  'P0001',
  'TRAINING_ACTOR_FORBIDDEN',
  'an operator cannot attach a platform source'
);
select lives_ok(
  $$select * from public.update_platform_training(
    '41200000-0000-4000-8000-000000000101',
    '41200000-0000-4000-8000-000000000001',
    'operator',
    'Sourced platform draft',
    'https://www.loom.com/share/sourced',
    'The source metadata is stored with this draft.',
    'policy-guide.pdf',
    'application/pdf',
    1024
  )$$,
  'a platform administrator can atomically attach source metadata'
);
select is(
  (select source_object_path from public.trainings where id = '41200000-0000-4000-8000-000000000101'),
  '41200000-0000-4000-8000-000000000101/source'::text,
  'the database derives the private object path from the training id'
);
select is(
  (select source_file_name from public.trainings where id = '41200000-0000-4000-8000-000000000101'),
  'policy-guide.pdf'::text,
  'the normalized source filename is stored against the training'
);
select is(
  (select count(*) from public.audit_log where subject_id = '41200000-0000-4000-8000-000000000101' and action = 'training.updated'),
  1::bigint,
  'source replacement records one fixed-action audit event'
);
select lives_ok(
  $$select * from public.publish_training(
    '41200000-0000-4000-8000-000000000101',
    '41200000-0000-4000-8000-000000000001',
    true,
    'Approved platform attestation'
  )$$,
  'a platform training with complete source metadata can publish'
);
select ok(
  (select published and source_object_path is not null from public.trainings where id = '41200000-0000-4000-8000-000000000101'),
  'publication preserves the source metadata'
);
select throws_ok(
  $$update public.trainings set source_file_name = null where id = '41200000-0000-4000-8000-000000000101'$$,
  '23514',
  null,
  'partial source metadata is rejected'
);

select * from finish();
rollback;
