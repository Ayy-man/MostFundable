begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

-- 2026-08-17 R3C-03 seed carry: remove Casey's governed demo subscription so the negative
-- authorization assertion and the test-specific active row remain isolated from seed state.
delete from public.consumer_subscriptions
where enrollment_id = 'a5000000-0000-0000-0000-000000000001';

update public.enrollments set status='active' where id='a5000000-0000-0000-0000-000000000001';
insert into public.monitoring_events(id,client_id,event_type,occurred_at) values
 ('29400000-0000-4000-8000-000000000001','a3000000-0000-0000-0000-000000000001','ACCALERT',pg_catalog.now()),
 ('29400000-0000-4000-8000-000000000002','a3000000-0000-0000-0000-000000000001','ACCALERT',pg_catalog.now());
select is(public.analysis_is_authorized('a3000000-0000-0000-0000-000000000001'),false,
  'R3C-03 refuses persistence work without an active subscription');
insert into public.consumer_subscriptions(id,client_id,enrollment_id,provider,customer_ref,subscription_ref,price_cents,status,idempotency_key)
values('29400000-0000-4000-8000-000000000003','a3000000-0000-0000-0000-000000000001','a5000000-0000-0000-0000-000000000001',
  'mock','mock_r2a08_customer','mock_r2a08_subscription',1900,'active','r2a08-active-subscription');
create temporary table r2a08_jobs as
select * from public.enqueue_analysis_job('a3000000-0000-0000-0000-000000000001','monitoring_event','29400000-0000-4000-8000-000000000001','alert')
union all
select * from public.enqueue_analysis_job('a3000000-0000-0000-0000-000000000001','monitoring_event','29400000-0000-4000-8000-000000000002','alert');
select * from public.claim_analysis_job((select analysis_run_id from r2a08_jobs order by source_id limit 1),'a3000000-0000-0000-0000-000000000001','29400000-0000-4000-8000-000000000901',60);
select * from public.claim_analysis_job((select analysis_run_id from r2a08_jobs order by source_id desc limit 1),'a3000000-0000-0000-0000-000000000001','29400000-0000-4000-8000-000000000902',60);

create temporary table r2a08_derived as select jsonb_build_object(
 'schemaVersion',1,'bureausPulled','[]'::jsonb,'accounts','[]'::jsonb,'overallUtilizationPct',null,
 'inquiriesByBureau',jsonb_build_object('EQF',0,'EXP',0,'TUC',0),'negativesCount',0,'openRevolvingCount',0,
 'averageAgeMonths',null,'highestRevolvingLimitCents',null,'dti',jsonb_build_object('monthlyDebtPaymentsCents',0,'statedMonthlyIncomeCents',null,'ratioPct',null),
 'flags',jsonb_build_object('averageAgeTwoYearsOrMore',false,'cardWithTenKLimit',false,'fourOrMorePersonalAccountsOpen',false,'noNegativeItemsReported',true,'thinFile',true,'twoOrFewerInquiriesEveryBureau',true,'utilizationUnder30',true),
 'computedAt','2026-08-17T00:00:00.000Z') value;
select is((select status::text from public.persist_analysis_result(
 (select id from r2a08_jobs order by source_id limit 1),'29400000-0000-4000-8000-000000000901','a3000000-0000-0000-0000-000000000001',
 (select analysis_run_id from r2a08_jobs order by source_id limit 1),0,(select value from r2a08_derived),null,null)),'persisted','authorized result reaches persisted');
select lives_ok($$select public.enrollment_revoke_consent('a3000000-0000-0000-0000-000000000001','analysis','a1000000-0000-0000-0000-000000000011')$$,
 'withdrawal lands while both leases are running');
select is((select status::text from public.finish_analysis_job((select id from r2a08_jobs order by source_id limit 1),'29400000-0000-4000-8000-000000000901')),'cancelled',
 'finish cancels a persisted result after withdrawal');
select is((select count(*) from public.analysis_runs where id=(select analysis_run_id from r2a08_jobs order by source_id limit 1)),0::bigint,
 'finish removes the no-longer-authorized analysis run');
select is((select status::text from public.persist_analysis_result(
 (select id from r2a08_jobs order by source_id desc limit 1),'29400000-0000-4000-8000-000000000902','a3000000-0000-0000-0000-000000000001',
 (select analysis_run_id from r2a08_jobs order by source_id desc limit 1),0,(select value from r2a08_derived),null,null)),'cancelled',
 'persist cancels a running result after withdrawal');
select is((select count(*) from public.analysis_runs where id in (select analysis_run_id from r2a08_jobs)),0::bigint,'zero derived run rows remain');
select is((select count(*) from public.plans where analysis_run_id in (select analysis_run_id from r2a08_jobs)),0::bigint,'zero derived plan rows remain');
select is((select count(*) from public.analysis_jobs where id in (select id from r2a08_jobs) and lease_owner is null and lease_until is null),2::bigint,
 'both cancelled jobs clear their leases');
select * from finish();
rollback;
