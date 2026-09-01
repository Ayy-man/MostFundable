begin;
set local search_path = public, extensions;
select plan(14);

insert into auth.users (id, email) values
  ('39600000-0000-4000-8000-000000000111', 'request.operator@one.example'),
  ('39600000-0000-4000-8000-000000000112', 'request.consumer@one.example'),
  ('39600000-0000-4000-8000-000000000121', 'request.operator@two.example');
insert into public.orgs (id, name, slug, team_sees_all_clients) values
  ('39600000-0000-4000-8000-000000000001', 'Request One', 'request-one', true),
  ('39600000-0000-4000-8000-000000000002', 'Request Two', 'request-two', true);
insert into public.profiles (id, role, org_id, org_role, full_name, email) values
  ('39600000-0000-4000-8000-000000000111', 'operator_member', '39600000-0000-4000-8000-000000000001', 'owner', 'Request Operator One', 'request.operator@one.example'),
  ('39600000-0000-4000-8000-000000000112', 'consumer', '39600000-0000-4000-8000-000000000001', null, 'Request Consumer One', 'request.consumer@one.example'),
  ('39600000-0000-4000-8000-000000000121', 'operator_member', '39600000-0000-4000-8000-000000000002', 'owner', 'Request Operator Two', 'request.operator@two.example')
on conflict (id) do update set role = excluded.role, org_id = excluded.org_id, org_role = excluded.org_role, full_name = excluded.full_name, email = excluded.email;
insert into public.clients (id, org_id, consumer_profile_id, display_name, assigned_to) values
  ('39600000-0000-4000-8000-000000000101', '39600000-0000-4000-8000-000000000001', '39600000-0000-4000-8000-000000000112', 'Request Client One', '39600000-0000-4000-8000-000000000111');

insert into public.document_requests (id, org_id, client_id, requested_by, name, why, created_at) values (
  '39600000-0000-4000-8000-000000000201',
  '39600000-0000-4000-8000-000000000001',
  '39600000-0000-4000-8000-000000000101',
  '39600000-0000-4000-8000-000000000111',
  'Bank statement',
  'Please send the latest statement for checklist review.',
  '2026-08-20T10:00:00Z'
);

select has_table('public', 'document_requests', 'document requests exist');
select is((select count(*)::integer from audit_log where action = 'document_request.created' and subject_id = '39600000-0000-4000-8000-000000000201'), 1, 'request creation writes one audit row');
select is((select meta from audit_log where action = 'document_request.created' and subject_id = '39600000-0000-4000-8000-000000000201'), '{"status":"open"}'::jsonb, 'request audit metadata uses only status');

insert into public.document_uploads (
  id, org_id, client_id, kind, section, bucket, object_path, display_name,
  mime_type, size_bytes, lifecycle, uploaded_by, created_at, updated_at
) values (
  '39600000-0000-4000-8000-000000000202',
  '39600000-0000-4000-8000-000000000001',
  '39600000-0000-4000-8000-000000000101',
  'company', 'bank_statements', 'client-documents',
  '39600000-0000-4000-8000-000000000001/39600000-0000-4000-8000-000000000101/39600000-0000-4000-8000-000000000202/bank-statement.pdf',
  'Bank statement.pdf', 'application/pdf', 1024, 'stored',
  '39600000-0000-4000-8000-000000000112',
  '2026-08-22T10:00:00Z', '2026-08-22T10:00:00Z'
);

select is((select fulfilled_upload_id from document_requests where id = '39600000-0000-4000-8000-000000000201'), '39600000-0000-4000-8000-000000000202'::uuid, 'a matching stored upload fulfils the request');
create temp table first_fulfilment as select fulfilled_at from document_requests where id = '39600000-0000-4000-8000-000000000201';
update document_uploads set lifecycle = 'stored' where id = '39600000-0000-4000-8000-000000000202';
select is((select fulfilled_at from document_requests where id = '39600000-0000-4000-8000-000000000201'), (select fulfilled_at from first_fulfilment), 'the upload transition fulfils the request once');

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"39600000-0000-4000-8000-000000000112"}';
select is((select count(*)::integer from document_requests), 1, 'the consumer reads their own request');
select throws_ok($$ insert into document_requests (org_id, client_id, requested_by, name, why) values ('39600000-0000-4000-8000-000000000001', '39600000-0000-4000-8000-000000000101', '39600000-0000-4000-8000-000000000111', 'Tax return', 'Please send it.') $$, '42501', 'permission denied for table document_requests', 'the consumer cannot create a request');
select throws_ok($$ update document_requests set why = 'A different note.' $$, '42501', 'permission denied for table document_requests', 'the consumer cannot update a request');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"39600000-0000-4000-8000-000000000111"}';
select is((select count(*)::integer from document_requests), 1, 'the own-organization operator reads the request');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"39600000-0000-4000-8000-000000000121"}';
select is((select count(*)::integer from document_requests), 0, 'another organization operator reads no request');

reset role;
set local role anon;
select throws_ok($$ select * from document_requests $$, '42501', 'permission denied for table document_requests', 'anonymous cannot read requests');

reset role;
set local role service_role;
select is((select count(*)::integer from document_requests where id = '39600000-0000-4000-8000-000000000201'), 1, 'service maintenance can read requests');

reset role;
select is((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.document_requests'::regclass), true, 'request RLS is enabled and forced');
select is((select count(*)::integer from audit_log where action = 'document_request.created' and subject_id = '39600000-0000-4000-8000-000000000201'), 1, 'fulfilment does not duplicate the creation audit');

select * from finish();
rollback;
