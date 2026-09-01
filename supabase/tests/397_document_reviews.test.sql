begin;
set local search_path = public, extensions;
select plan(12);

insert into auth.users (id, email) values
  ('39700000-0000-4000-8000-000000000111', 'review.operator@one.example'),
  ('39700000-0000-4000-8000-000000000112', 'review.consumer@one.example'),
  ('39700000-0000-4000-8000-000000000121', 'review.operator@two.example');
insert into public.orgs (id, name, slug, team_sees_all_clients) values
  ('39700000-0000-4000-8000-000000000001', 'Review One', 'review-one', true),
  ('39700000-0000-4000-8000-000000000002', 'Review Two', 'review-two', true);
insert into public.profiles (id, role, org_id, org_role, full_name, email) values
  ('39700000-0000-4000-8000-000000000111', 'operator_member', '39700000-0000-4000-8000-000000000001', 'owner', 'Review Operator One', 'review.operator@one.example'),
  ('39700000-0000-4000-8000-000000000112', 'consumer', '39700000-0000-4000-8000-000000000001', null, 'Review Consumer One', 'review.consumer@one.example'),
  ('39700000-0000-4000-8000-000000000121', 'operator_member', '39700000-0000-4000-8000-000000000002', 'owner', 'Review Operator Two', 'review.operator@two.example')
on conflict (id) do update set role = excluded.role, org_id = excluded.org_id, org_role = excluded.org_role, full_name = excluded.full_name, email = excluded.email;
insert into public.clients (id, org_id, consumer_profile_id, display_name, assigned_to) values
  ('39700000-0000-4000-8000-000000000101', '39700000-0000-4000-8000-000000000001', '39700000-0000-4000-8000-000000000112', 'Review Client One', '39700000-0000-4000-8000-000000000111');
insert into public.document_uploads (
  id, org_id, client_id, kind, section, bucket, object_path, display_name,
  mime_type, size_bytes, lifecycle, uploaded_by
) values (
  '39700000-0000-4000-8000-000000000201',
  '39700000-0000-4000-8000-000000000001',
  '39700000-0000-4000-8000-000000000101',
  'company', 'ein', 'client-documents',
  '39700000-0000-4000-8000-000000000001/39700000-0000-4000-8000-000000000101/39700000-0000-4000-8000-000000000201/ein.pdf',
  'EIN confirmation.pdf', 'application/pdf', 1024, 'stored',
  '39700000-0000-4000-8000-000000000112'
);
insert into public.document_reviews (id, org_id, upload_id, reviewed_by, reviewed_at) values (
  '39700000-0000-4000-8000-000000000202',
  '39700000-0000-4000-8000-000000000001',
  '39700000-0000-4000-8000-000000000201',
  '39700000-0000-4000-8000-000000000111',
  '2026-08-22T11:00:00Z'
);

select has_table('public', 'document_reviews', 'document reviews exist');
select is((select count(*)::integer from audit_log where action = 'document_review.recorded' and subject_id = '39700000-0000-4000-8000-000000000202'), 1, 'review writes one audit row');
select is((select meta from audit_log where action = 'document_review.recorded' and subject_id = '39700000-0000-4000-8000-000000000202'), '{"status":"reviewed"}'::jsonb, 'review audit metadata uses only status');
select throws_ok($$ insert into document_reviews (org_id, upload_id, reviewed_by) values ('39700000-0000-4000-8000-000000000001', '39700000-0000-4000-8000-000000000201', '39700000-0000-4000-8000-000000000111') $$, '23505', null, 'one upload accepts one review');

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"39700000-0000-4000-8000-000000000112"}';
select is((select count(*)::integer from document_reviews), 0, 'the consumer cannot read review bookkeeping');
select throws_ok($$ insert into document_reviews (org_id, upload_id, reviewed_by) values ('39700000-0000-4000-8000-000000000001', '39700000-0000-4000-8000-000000000201', '39700000-0000-4000-8000-000000000111') $$, '42501', 'permission denied for table document_reviews', 'the consumer cannot record a review');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"39700000-0000-4000-8000-000000000111"}';
select is((select count(*)::integer from document_reviews), 1, 'the own-organization operator reads the review');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"39700000-0000-4000-8000-000000000121"}';
select is((select count(*)::integer from document_reviews), 0, 'another organization operator reads no review');

reset role;
set local role anon;
select throws_ok($$ select * from document_reviews $$, '42501', 'permission denied for table document_reviews', 'anonymous cannot read reviews');

reset role;
set local role service_role;
select is((select count(*)::integer from document_reviews where id = '39700000-0000-4000-8000-000000000202'), 1, 'service maintenance can read reviews');

reset role;
select is((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.document_reviews'::regclass), true, 'review RLS is enabled and forced');
select throws_ok($$ update document_reviews set reviewed_at = now() where id = '39700000-0000-4000-8000-000000000202' $$, 'P0001', null, 'a review is immutable');

select * from finish();
rollback;
