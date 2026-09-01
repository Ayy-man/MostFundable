begin;
create extension if not exists pgtap with schema extensions;

-- 2026-08-17 R1D-01: source deletion retries need no parsed feature payload.
select plan(3);

insert into auth.users(id,email) values ('26300000-0000-4000-8000-000000000001','actor@r1d01.test');
insert into public.orgs(id,name,slug) values ('26300000-0000-4000-8000-000000000101','R1D01 Org','r1d01-org');
insert into public.profiles(id,role,org_id,full_name,email) values
 ('26300000-0000-4000-8000-000000000001','consumer','26300000-0000-4000-8000-000000000101','R1D01 Actor','actor@r1d01.test')
on conflict(id) do update set role=excluded.role,org_id=excluded.org_id,org_role=null,full_name=excluded.full_name,email=excluded.email;
insert into public.clients(id,org_id,consumer_profile_id,display_name) values
 ('26300000-0000-4000-8000-000000000201','26300000-0000-4000-8000-000000000101','26300000-0000-4000-8000-000000000001','R1D01 Client');

select lives_ok($$insert into public.document_uploads(id,org_id,client_id,kind,bucket,object_path,display_name,mime_type,size_bytes,lifecycle,derived_features,uploaded_by,failure_code)
values('26300000-0000-4000-8000-000000000301','26300000-0000-4000-8000-000000000101','26300000-0000-4000-8000-000000000201','credit_report','credit-reports','26300000-0000-4000-8000-000000000101/26300000-0000-4000-8000-000000000201/26300000-0000-4000-8000-000000000301/source.pdf','source.pdf','application/pdf',100,'delete_pending',null,'26300000-0000-4000-8000-000000000001','parse_source_delete_pending')$$,'parser failure may wait for source deletion');
select lives_ok($$update public.document_uploads set lifecycle='failed',failure_code='parse_failed' where id='26300000-0000-4000-8000-000000000301'$$,'successful source clearing reaches a terminal metadata state');
select throws_ok($$update public.document_uploads set lifecycle='parsed' where id='26300000-0000-4000-8000-000000000301'$$,'23514',null,'parsed state still requires closed derived features');

select * from finish();
rollback;
