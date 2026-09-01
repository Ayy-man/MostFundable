begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(66);

select has_table('public', 'privacy_requests', 'privacy requests are durable records');
select has_type('public', 'privacy_request_kind', 'access and deletion use a closed kind');
select has_type('public', 'privacy_request_status', 'request state uses a closed lifecycle');
select has_index('public', 'privacy_requests', 'privacy_requests_one_open_kind', 'one open request per consumer and kind is structural');
select has_trigger('public', 'privacy_requests', 'privacy_requests_no_delete', 'request evidence cannot be deleted');
select has_trigger('public', 'privacy_requests', 'privacy_requests_no_truncate', 'request evidence cannot be truncated');
select ok(
  has_function_privilege('service_role', 'public.privacy_submit_request(uuid,public.privacy_request_kind)', 'execute'),
  'only the trusted server receives submission authority'
);
select ok(
  not has_function_privilege('authenticated', 'public.privacy_submit_request(uuid,public.privacy_request_kind)', 'execute'),
  'a browser cannot forge the actor on a submission RPC'
);
select ok(
  has_function_privilege('service_role', 'public.privacy_complete_deletion_request(uuid,uuid)', 'execute'),
  'the trusted server can enter the guarded deletion completion'
);
select ok(
  not has_function_privilege('service_role', 'private.privacy_erasure_blockers(uuid)', 'execute'),
  'the internal blocker predicate is not an application API'
);
select ok(has_table_privilege('authenticated', 'public.privacy_requests', 'select'), 'authenticated users may read under RLS');
select ok(not has_table_privilege('authenticated', 'public.privacy_requests', 'insert'), 'authenticated users cannot insert request rows directly');
select ok(not has_table_privilege('authenticated', 'public.privacy_requests', 'update'), 'authenticated users cannot alter request state directly');
select ok(not has_table_privilege('authenticated', 'public.privacy_requests', 'delete'), 'authenticated users cannot erase request evidence');

insert into public.orgs (id, name, slug) values
  ('41600000-0000-4000-8000-000000000100', 'Privacy Org', 'privacy-org'),
  ('41600000-0000-4000-8000-000000000101', 'Other Privacy Org', 'other-privacy-org');

insert into auth.users (id, email, raw_user_meta_data) values
  ('41600000-0000-4000-8000-000000000001', 'privacy-admin@test.example', '{}'::jsonb),
  ('41600000-0000-4000-8000-000000000002', 'jordan-private@test.example', '{"full_name":"Jordan Private"}'::jsonb),
  ('41600000-0000-4000-8000-000000000003', 'other-private@test.example', '{"full_name":"Other Private"}'::jsonb),
  ('41600000-0000-4000-8000-000000000004', 'privacy-operator@test.example', '{}'::jsonb);

insert into public.profiles (id, role, org_id, org_role, full_name, email, phone) values
  ('41600000-0000-4000-8000-000000000001', 'platform_admin', null, null, 'Privacy Admin', 'privacy-admin@test.example', null),
  ('41600000-0000-4000-8000-000000000002', 'consumer', '41600000-0000-4000-8000-000000000100', null, 'Jordan Private', 'jordan-private@test.example', '+15550000002'),
  ('41600000-0000-4000-8000-000000000003', 'consumer', '41600000-0000-4000-8000-000000000101', null, 'Other Private', 'other-private@test.example', '+15550000003'),
  ('41600000-0000-4000-8000-000000000004', 'operator_member', '41600000-0000-4000-8000-000000000100', 'owner', 'Privacy Operator', 'privacy-operator@test.example', null)
on conflict (id) do update set
  role = excluded.role,
  org_id = excluded.org_id,
  org_role = excluded.org_role,
  full_name = excluded.full_name,
  email = excluded.email,
  phone = excluded.phone,
  disabled_at = null;

insert into public.clients (
  id, org_id, consumer_profile_id, business_name, display_name
) values
  ('41600000-0000-4000-8000-000000000200', '41600000-0000-4000-8000-000000000100', '41600000-0000-4000-8000-000000000002', 'Jordan Ventures', 'Jordan Private'),
  ('41600000-0000-4000-8000-000000000201', '41600000-0000-4000-8000-000000000101', '41600000-0000-4000-8000-000000000003', 'Other Ventures', 'Other Private');

insert into public.consents (
  id, client_id, kind, text_version, signed_at, ip, esig_ref
) values
  ('41600000-0000-4000-8000-000000000210', '41600000-0000-4000-8000-000000000200', 'monitoring', 'v1', '2026-08-01', '127.0.0.1', 'privacy-esig'),
  ('41600000-0000-4000-8000-000000000211', '41600000-0000-4000-8000-000000000200', 'analysis', 'v1', '2026-08-01', '127.0.0.1', 'privacy-esig');

insert into public.enrollments (
  id, client_id, crs_member_ref, status, esig_doc_id,
  monitoring_consent_at, analysis_consent_at
) values (
  '41600000-0000-4000-8000-000000000220',
  '41600000-0000-4000-8000-000000000200',
  'privacy_monitoring_member',
  'active',
  'privacy-esig',
  '2026-08-01',
  '2026-08-01'
);

insert into public.consumer_subscriptions (
  id, client_id, enrollment_id, provider, customer_ref,
  subscription_ref, price_cents, status, idempotency_key
) values (
  '41600000-0000-4000-8000-000000000221',
  '41600000-0000-4000-8000-000000000200',
  '41600000-0000-4000-8000-000000000220',
  'mock',
  'privacy_customer',
  'privacy_subscription',
  4900,
  'active',
  'privacy-subscription-operation'
);

select is(
  (select private.privacy_erasure_blockers('41600000-0000-4000-8000-000000000200')),
  array[
    'active_subscription',
    'enrollment_cancellation_required',
    'monitoring_provider_cleanup_pending',
    'provider_cancellation_pending'
  ]::text[],
  'active billing and both unclosed providers block erasure independently'
);

select public.enrollment_cancel_sub(
  '41600000-0000-4000-8000-000000000220',
  '41600000-0000-4000-8000-000000000002',
  'privacy_request'
);
select is(
  (select private.privacy_erasure_blockers('41600000-0000-4000-8000-000000000200')),
  array['monitoring_provider_cleanup_pending', 'provider_cancellation_pending']::text[],
  'local cancellation cannot stand in for either provider confirmation'
);
select public.purge_derived_enrollment(
  '41600000-0000-4000-8000-000000000220',
  'privacy_monitoring_member'
);
select is(
  (select private.privacy_erasure_blockers('41600000-0000-4000-8000-000000000200')),
  array['provider_cancellation_pending']::text[],
  'monitoring cleanup does not hide an outstanding billing-provider cancellation'
);
select public.consumer_subscription_provider_cancel_completed(
  '41600000-0000-4000-8000-000000000220',
  'privacy_subscription'
);

insert into public.support_threads (
  id, kind, org_id, client_id, subject, created_by
) values (
  '41600000-0000-4000-8000-000000000230',
  'team_chat',
  '41600000-0000-4000-8000-000000000100',
  '41600000-0000-4000-8000-000000000200',
  'Jordan needs help',
  '41600000-0000-4000-8000-000000000002'
);
insert into public.support_messages (
  id, thread_id, author_profile_id, author_kind, body
) values (
  '41600000-0000-4000-8000-000000000231',
  '41600000-0000-4000-8000-000000000230',
  '41600000-0000-4000-8000-000000000002',
  'consumer',
  'My name and account details are private.'
);

insert into public.banks_cache (bank_ref, name, source, application_questions)
values (
  'privacy-bank',
  'Privacy Test Bank',
  'manual',
  '[
    {"id":"projected-revenue","label":"Projected revenue","responseBasis":"Use current business records."},
    {"id":"projected-personal-income","label":"Projected personal income","responseBasis":"Use current personal records."},
    {"id":"projected-monthly-spend","label":"Projected monthly spend","responseBasis":"Use the current operating budget."},
    {"id":"projected-employees","label":"Projected employees","responseBasis":"Use the current staffing plan."}
  ]'::jsonb
);

insert into public.applications (
  id, client_id, bank_ref, created_by
) values (
  '41600000-0000-4000-8000-000000000232',
  '41600000-0000-4000-8000-000000000200',
  'privacy-bank',
  '41600000-0000-4000-8000-000000000004'
);
insert into public.application_notes (
  id, application_id, author_profile_id, author_kind, body
) values (
  '41600000-0000-4000-8000-000000000233',
  '41600000-0000-4000-8000-000000000232',
  '41600000-0000-4000-8000-000000000002',
  'consumer',
  'My application message also contains private details.'
);
select throws_ok(
  $$update public.application_notes
    set body = 'ordinary rewrite'
    where id = '41600000-0000-4000-8000-000000000233'$$,
  'P0001',
  'application_notes rows are append-only',
  'application notes remain append-only outside the erasure transaction'
);

insert into public.operator_tasks (
  id, org_id, client_id, title, notes, created_by
) values (
  '41600000-0000-4000-8000-000000000234',
  '41600000-0000-4000-8000-000000000100',
  '41600000-0000-4000-8000-000000000200',
  'Call Jordan Private',
  'Discuss Jordan Ventures account details.',
  '41600000-0000-4000-8000-000000000004'
);

insert into public.document_requests (
  id, org_id, client_id, requested_by, name, why
) values (
  '41600000-0000-4000-8000-000000000235',
  '41600000-0000-4000-8000-000000000100',
  '41600000-0000-4000-8000-000000000200',
  '41600000-0000-4000-8000-000000000004',
  'Jordan Private bank statement',
  'Needed to verify Jordan Ventures revenue.'
);

insert into public.document_uploads (
  id, org_id, client_id, kind, section, bucket, object_path,
  display_name, mime_type, size_bytes, lifecycle, uploaded_by
) values (
  '41600000-0000-4000-8000-000000000240',
  '41600000-0000-4000-8000-000000000100',
  '41600000-0000-4000-8000-000000000200',
  'company',
  'tax_returns',
  'client-documents',
  '41600000-0000-4000-8000-000000000100/41600000-0000-4000-8000-000000000200/41600000-0000-4000-8000-000000000240/jordan-tax.pdf',
  'jordan-tax.pdf',
  'application/pdf',
  12,
  'stored',
  '41600000-0000-4000-8000-000000000002'
);
insert into storage.objects (bucket_id, name, owner_id) values (
  'client-documents',
  '41600000-0000-4000-8000-000000000100/41600000-0000-4000-8000-000000000200/41600000-0000-4000-8000-000000000240/jordan-tax.pdf',
  '41600000-0000-4000-8000-000000000002'
);

insert into public.audit_log (
  org_id, client_id, actor_profile_id, action, subject_type, subject_id, meta
) values (
  '41600000-0000-4000-8000-000000000100',
  '41600000-0000-4000-8000-000000000200',
  '41600000-0000-4000-8000-000000000002',
  'privacy.test.baseline',
  'client',
  '41600000-0000-4000-8000-000000000200',
  '{}'::jsonb
);

select lives_ok(
  $$select * from public.privacy_submit_request(
    '41600000-0000-4000-8000-000000000002', 'deletion'
  )$$,
  'a consumer can submit their own deletion request'
);
select is(
  (select count(*) from public.privacy_submit_request(
    '41600000-0000-4000-8000-000000000002', 'deletion'
  )),
  1::bigint,
  'submission replay returns the one open request'
);
select is(
  (select count(*) from public.privacy_list_requests(
    '41600000-0000-4000-8000-000000000003', 100
  )),
  0::bigint,
  'another consumer cannot read the request'
);
select is(
  (select count(*) from public.privacy_list_requests(
    '41600000-0000-4000-8000-000000000002', 100
  )),
  1::bigint,
  'the consumer reads their own request'
);
select is(
  (select count(*) from public.privacy_list_requests(
    '41600000-0000-4000-8000-000000000001', 100
  )),
  1::bigint,
  'the platform administrator reads the queue'
);

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"41600000-0000-4000-8000-000000000002"}';
select is(
  (select count(*) from public.privacy_requests),
  1::bigint,
  'RLS lets the consumer select their own request directly'
);
reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"41600000-0000-4000-8000-000000000003"}';
select is(
  (select count(*) from public.privacy_requests),
  0::bigint,
  'RLS hides another consumer request from a direct table query'
);
reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"41600000-0000-4000-8000-000000000001"}';
select is(
  (select count(*) from public.privacy_requests),
  1::bigint,
  'RLS gives a platform administrator the review queue'
);
reset role;
select pg_catalog.set_config('request.jwt.claims', null, true);

select lives_ok(
  $$select * from public.privacy_review_request(
    (select id from public.privacy_requests where profile_id = '41600000-0000-4000-8000-000000000002'),
    '41600000-0000-4000-8000-000000000001'
  )$$,
  'the platform administrator can begin review'
);
select is(
  (select private.privacy_erasure_blockers('41600000-0000-4000-8000-000000000200')),
  array[]::text[],
  'confirmed subscription cancellation and a cleared CRS member leave no provider blocker'
);
select is(
  (select jsonb_array_length(public.privacy_request_erasure_targets(
    (select id from public.privacy_requests where profile_id = '41600000-0000-4000-8000-000000000002'),
    '41600000-0000-4000-8000-000000000001'
  ) -> 'targets')),
  1,
  'preflight returns the one private object only to the trusted server'
);
select throws_ok(
  $$select * from public.privacy_complete_deletion_request(
    (select id from public.privacy_requests where profile_id = '41600000-0000-4000-8000-000000000002'),
    '41600000-0000-4000-8000-000000000001'
  )$$,
  'P0001',
  'PRIVACY_STORAGE_NOT_EMPTY',
  'database anonymization refuses while a private object exists'
);

-- The real deletion worker removes the blob through the Storage API. Its
-- trusted database connection enables this transaction-local guard only after
-- the blob is gone, so mirror that metadata cleanup without weakening the
-- production trigger.
set local storage.allow_delete_query = 'true';
delete from storage.objects
where bucket_id = 'client-documents'
  and name = '41600000-0000-4000-8000-000000000100/41600000-0000-4000-8000-000000000200/41600000-0000-4000-8000-000000000240/jordan-tax.pdf';
set local storage.allow_delete_query = 'false';

select throws_ok(
  $$select * from public.privacy_complete_deletion_request(
    (select id from public.privacy_requests where profile_id = '41600000-0000-4000-8000-000000000002'),
    '41600000-0000-4000-8000-000000000001'
  )$$,
  'P0001',
  'PRIVACY_AUTH_DISABLE_NOT_VERIFIED',
  'database anonymization refuses an unverified auth-provider disable'
);

update auth.users
set email = 'deleted+41600000000040008000000000000002@privacy.invalid',
    phone = null,
    banned_until = pg_catalog.now() + interval '100 years',
    raw_user_meta_data = '{"full_name":"Jordan Private","privacy_erased":true}'::jsonb
where id = '41600000-0000-4000-8000-000000000002';

select lives_ok(
  $$select * from public.privacy_complete_deletion_request(
    (select id from public.privacy_requests where profile_id = '41600000-0000-4000-8000-000000000002'),
    '41600000-0000-4000-8000-000000000001'
  )$$,
  'verified cleanup completes the deletion request'
);
select is(
  (select status::text from public.privacy_requests where profile_id = '41600000-0000-4000-8000-000000000002'),
  'completed',
  'the deletion request records completion only after every gate'
);
select is(
  (select full_name from public.profiles where id = '41600000-0000-4000-8000-000000000002'),
  'Deleted consumer 41600000'::text,
  'the profile name is pseudonymized'
);
select is(
  (select email from public.profiles where id = '41600000-0000-4000-8000-000000000002'),
  'deleted+41600000000040008000000000000002@privacy.invalid'::text,
  'the profile email matches the provider pseudonym'
);
select is(
  (select phone from public.profiles where id = '41600000-0000-4000-8000-000000000002'),
  null,
  'the direct profile phone is removed'
);
select ok(
  (select disabled_at is not null from public.profiles where id = '41600000-0000-4000-8000-000000000002'),
  'the local profile can no longer authenticate into a surface'
);
select is(
  (select display_name from public.clients where id = '41600000-0000-4000-8000-000000000200'),
  'Deleted client 41600000'::text,
  'the client display name is pseudonymized'
);
select is(
  (select business_name from public.clients where id = '41600000-0000-4000-8000-000000000200'),
  null,
  'the client business name is removed'
);
select is(
  (select status::text from public.clients where id = '41600000-0000-4000-8000-000000000200'),
  'archived',
  'the erased client is removed from active work'
);
select is(
  (select subject from public.support_threads where id = '41600000-0000-4000-8000-000000000230'),
  'Deleted consumer conversation'::text,
  'the client conversation subject is pseudonymized'
);
select is(
  (select body from public.support_messages where id = '41600000-0000-4000-8000-000000000231'),
  'Message removed following privacy request.'::text,
  'message PII is replaced without erasing the event record'
);
select is(
  (select body from public.application_notes where id = '41600000-0000-4000-8000-000000000233'),
  'Message removed following privacy request.'::text,
  'the append-only application message keeps its event but loses direct PII'
);
select ok(
  (select title = 'Deleted client task'
    and notes = 'Task details removed following privacy request.'
   from public.operator_tasks where id = '41600000-0000-4000-8000-000000000234'),
  'task workflow evidence remains while both free-text fields lose direct PII'
);
select ok(
  (select name = 'Deleted document request'
    and why = 'Request details removed following privacy request.'
   from public.document_requests where id = '41600000-0000-4000-8000-000000000235'),
  'document-request evidence remains while both free-text fields lose direct PII'
);
select throws_ok(
  $$update public.operator_tasks
    set notes = 'Reintroduced consumer details'
    where id = '41600000-0000-4000-8000-000000000234'$$,
  '23503',
  'TASK_CLIENT_INVALID',
  'a task linked to the erased client cannot be edited after archival'
);
select throws_ok(
  $$update public.document_requests
    set why = 'Reintroduced consumer details'
    where id = '41600000-0000-4000-8000-000000000235'$$,
  'P0001',
  'DOCUMENT_REQUEST_CLIENT_INACTIVE',
  'a document request cannot be edited after its client is archived'
);
select is(
  (select count(*) from public.document_uploads where id = '41600000-0000-4000-8000-000000000240'),
  1::bigint,
  'upload metadata stays available to immutable review evidence'
);
select ok(
  (select display_name = 'Deleted document'
    and object_path = '41600000-0000-4000-8000-000000000100/41600000-0000-4000-8000-000000000200/41600000-0000-4000-8000-000000000240/deleted-document'
    and lifecycle = 'failed'
    and failure_code = 'privacy_erased'
   from public.document_uploads where id = '41600000-0000-4000-8000-000000000240'),
  'upload metadata says the object was privacy-erased'
);
select is(
  (select count(*) from public.consents where client_id = '41600000-0000-4000-8000-000000000200'),
  2::bigint,
  'legally necessary consent evidence is retained'
);
select ok(
  (select status = 'cancelled'
    and subscription_ref = 'privacy_subscription'
    and provider_cancel_completed_at is not null
   from public.consumer_subscriptions where client_id = '41600000-0000-4000-8000-000000000200'),
  'billing and provider-cancellation evidence is retained'
);
select is(
  (select count(*) from public.audit_log
   where action = 'privacy.test.baseline'
     and client_id = '41600000-0000-4000-8000-000000000200'),
  1::bigint,
  'pre-existing audit evidence is retained'
);
select is(
  (select count(*) from public.audit_log
   where action = 'privacy.request.deletion_completed'
     and client_id = '41600000-0000-4000-8000-000000000200'),
  1::bigint,
  'deletion completion adds a fixed-action audit record'
);
select ok(
  (select banned_until > pg_catalog.now() from auth.users where id = '41600000-0000-4000-8000-000000000002'),
  'provider auth access remains disabled'
);
select is(
  (select raw_user_meta_data from auth.users where id = '41600000-0000-4000-8000-000000000002'),
  '{"privacy_erased":true}'::jsonb,
  'the final transaction strips identity metadata after provider disable is verified'
);

select lives_ok(
  $$select * from public.privacy_submit_request(
    '41600000-0000-4000-8000-000000000003', 'access'
  )$$,
  'a second consumer can request access to their data'
);
select lives_ok(
  $$select * from public.privacy_review_request(
    (select id from public.privacy_requests where profile_id = '41600000-0000-4000-8000-000000000003' and status = 'submitted'),
    '41600000-0000-4000-8000-000000000001'
  )$$,
  'the access request enters review'
);
select lives_ok(
  $$select * from public.privacy_complete_access_request(
    (select id from public.privacy_requests where profile_id = '41600000-0000-4000-8000-000000000003' and status = 'in_review'),
    '41600000-0000-4000-8000-000000000001',
    'Delivered through the verified support channel.'
  )$$,
  'an administrator can record a manually delivered access copy'
);
select is(
  (select completion_note from public.privacy_requests
   where profile_id = '41600000-0000-4000-8000-000000000003' and status = 'completed'),
  'Delivered through the verified support channel.'::text,
  'the access completion records how fulfillment was verified'
);
select is(
  (select full_name from public.profiles where id = '41600000-0000-4000-8000-000000000003'),
  'Other Private'::text,
  'access completion does not anonymize the consumer'
);
select lives_ok(
  $$select * from public.privacy_submit_request(
    '41600000-0000-4000-8000-000000000003', 'access'
  )$$,
  'a closed access request does not block a later request'
);
select lives_ok(
  $$select * from public.privacy_review_request(
    (select id from public.privacy_requests where profile_id = '41600000-0000-4000-8000-000000000003' and status = 'submitted'),
    '41600000-0000-4000-8000-000000000001'
  )$$,
  'the later access request can enter review'
);
select lives_ok(
  $$select * from public.privacy_deny_request(
    (select id from public.privacy_requests where profile_id = '41600000-0000-4000-8000-000000000003' and status = 'in_review'),
    '41600000-0000-4000-8000-000000000001',
    '  Duplicate of the fulfilled request.  '
  )$$,
  'an administrator can deny with a bounded reason'
);
select is(
  (select denial_reason from public.privacy_requests
   where profile_id = '41600000-0000-4000-8000-000000000003' and status = 'denied'),
  'Duplicate of the fulfilled request.'::text,
  'the consumer-readable denial reason is normalized'
);
select hasnt_column(
  'public',
  'privacy_requests',
  'raw_bureau_data',
  'the workflow adds no raw bureau persistence'
);
select is(
  (select count(*) from public.privacy_list_requests(
    '41600000-0000-4000-8000-000000000001', 100
  )),
  3::bigint,
  'the admin queue retains completed and denied request history'
);

select * from finish();
rollback;
