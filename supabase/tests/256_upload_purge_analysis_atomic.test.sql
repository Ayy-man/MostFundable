begin;
create extension if not exists pgtap with schema extensions;

-- 2026-08-17 R1C-12: purge state and the exact analysis tuple commit together.
select plan(7);

insert into auth.users(id,email) values ('25600000-0000-4000-8000-000000000001','actor@r1c12.test');
insert into public.orgs(id,name,slug) values ('25600000-0000-4000-8000-000000000101','R1C12 Org','r1c12-org');
insert into public.profiles(id,role,org_id,full_name,email) values
 ('25600000-0000-4000-8000-000000000001','consumer','25600000-0000-4000-8000-000000000101','R1C12 Actor','actor@r1c12.test')
on conflict(id) do update set role=excluded.role,org_id=excluded.org_id,org_role=null,full_name=excluded.full_name,email=excluded.email;
insert into public.clients(id,org_id,consumer_profile_id,display_name) values
 ('25600000-0000-4000-8000-000000000201','25600000-0000-4000-8000-000000000101','25600000-0000-4000-8000-000000000001','R1C12 Client');
-- 2026-08-17 R1D-02 carry: upload analysis requires current authorization.
insert into public.consents(id,client_id,kind,text_version,signed_at,ip,esig_ref) values
 ('25600000-0000-4000-8000-000000000211','25600000-0000-4000-8000-000000000201','monitoring','v1','2026-08-17','127.0.0.1','r1c12-doc'),
 ('25600000-0000-4000-8000-000000000212','25600000-0000-4000-8000-000000000201','analysis','v1','2026-08-17','127.0.0.1','r1c12-doc');
insert into public.enrollments(id,client_id,status,esig_doc_id,monitoring_consent_at,analysis_consent_at)
values('25600000-0000-4000-8000-000000000213','25600000-0000-4000-8000-000000000201','active','r1c12-doc','2026-08-17','2026-08-17');
-- 2026-08-17 R3C-03: isolate upload atomicity behind current paid access.
insert into public.consumer_subscriptions(
  id,client_id,enrollment_id,provider,customer_ref,subscription_ref,price_cents,status,idempotency_key
) values(
  '25600000-0000-4000-8000-000000000214','25600000-0000-4000-8000-000000000201','25600000-0000-4000-8000-000000000213',
  'mock','mock_r1c12_customer','mock_r1c12_subscription',1900,'active','r1c12-active-subscription'
);
insert into public.document_uploads(id,org_id,client_id,kind,bucket,object_path,display_name,mime_type,size_bytes,lifecycle,derived_features,uploaded_by)
values(
 '25600000-0000-4000-8000-000000000301','25600000-0000-4000-8000-000000000101','25600000-0000-4000-8000-000000000201','credit_report','credit-reports',
 '25600000-0000-4000-8000-000000000101/25600000-0000-4000-8000-000000000201/25600000-0000-4000-8000-000000000301/source.pdf','source.pdf','application/pdf',200,'delete_pending',
 jsonb_build_object('schemaVersion',1,'bureausPulled',jsonb_build_array('EQF'),'accounts','[]'::jsonb,'overallUtilizationPct',null,'inquiriesByBureau',jsonb_build_object('EQF',0,'EXP',0,'TUC',0),'negativesCount',0,'openRevolvingCount',0,'averageAgeMonths',null,'highestRevolvingLimitCents',null,'dti',jsonb_build_object('monthlyDebtPaymentsCents',0,'statedMonthlyIncomeCents',null,'ratioPct',null),'flags',jsonb_build_object('averageAgeTwoYearsOrMore',false,'cardWithTenKLimit',false,'fourOrMorePersonalAccountsOpen',false,'noNegativeItemsReported',true,'thinFile',true,'twoOrFewerInquiriesEveryBureau',true,'utilizationUnder30',true),'computedAt','2026-08-17T00:00:00.000Z'),
 '25600000-0000-4000-8000-000000000001');

select ok(public.mark_purged_and_enqueue_analysis('25600000-0000-4000-8000-000000000301'),'atomic RPC succeeds');
select is((select lifecycle::text from public.document_uploads where id='25600000-0000-4000-8000-000000000301'),'purged','upload becomes purged');
select is((select count(*) from public.analysis_jobs where source_id='25600000-0000-4000-8000-000000000301'),1::bigint,'the exact analysis source is durable');
select is((select count(*) from public.background_jobs where job='analysis.run' and subject='client:25600000-0000-4000-8000-000000000201'),1::bigint,'the existing analysis bridge tuple is durable');
select ok(public.mark_purged_and_enqueue_analysis('25600000-0000-4000-8000-000000000301'),'purged replay verifies the tuple');
select is((select count(*) from public.analysis_jobs where source_id='25600000-0000-4000-8000-000000000301'),1::bigint,'replay remains exactly once');
select throws_ok($$select public.mark_purged_and_enqueue_analysis('25600000-0000-4000-8000-000000000399')$$,'P0001','UPLOAD_PURGE_SOURCE_INVALID','unknown source cannot create a job');

select * from finish();
rollback;
