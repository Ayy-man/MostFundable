begin;
create extension if not exists pgtap with schema extensions;

-- 2026-08-17 R1C-02/R1C-15/R1D-02/R1D-05: stop work now and purge only derived rows.
select plan(27);

-- Phase 8, 2026-08-19: migration 383 gave public.applications.bank_ref a foreign
-- key to public.banks_cache, so the lender handles this file files applications
-- under need catalog rows. Seeded here rather than in seed.sql because each
-- pgTAP file is its own transaction and rolls this back with everything else.
insert into public.banks_cache (bank_ref, name, application_questions)
select handle, handle, '[{"id":"a","label":"A","responseBasis":"x"},{"id":"b","label":"B","responseBasis":"x"},{"id":"c","label":"C","responseBasis":"x"},{"id":"d","label":"D","responseBasis":"x"}]'::jsonb
from unnest(array['r1d05_bank']) as handle
on conflict (bank_ref) do nothing;

insert into auth.users(id,email) values ('26000000-0000-4000-8000-000000000001','actor@r1d05.test');
insert into public.orgs(id,name,slug) values ('26000000-0000-4000-8000-000000000101','R1D05 Org','r1d05-org');
insert into public.profiles(id,role,org_id,full_name,email) values
 ('26000000-0000-4000-8000-000000000001','consumer','26000000-0000-4000-8000-000000000101','R1D05 Actor','actor@r1d05.test')
on conflict(id) do update set role=excluded.role,org_id=excluded.org_id,org_role=null,full_name=excluded.full_name,email=excluded.email;
insert into public.clients(id,org_id,consumer_profile_id,display_name) values
 ('26000000-0000-4000-8000-000000000201','26000000-0000-4000-8000-000000000101','26000000-0000-4000-8000-000000000001','R1D05 Client');
insert into public.consents(id,client_id,kind,text_version,signed_at,ip,esig_ref) values
 ('26000000-0000-4000-8000-000000000211','26000000-0000-4000-8000-000000000201','monitoring','v1','2026-08-17','127.0.0.1','test-doc'),
 ('26000000-0000-4000-8000-000000000212','26000000-0000-4000-8000-000000000201','analysis','v1','2026-08-17','127.0.0.1','test-doc');
insert into public.enrollments(id,client_id,crs_member_ref,status,esig_doc_id,monitoring_consent_at,analysis_consent_at)
values('26000000-0000-4000-8000-000000000301','26000000-0000-4000-8000-000000000201','mock_r1d05','active','test-doc','2026-08-17','2026-08-17');
insert into public.idv_sessions(id,enrollment_id,client_id,member_ref,driver,kind,state,max_attempts)
values('26000000-0000-4000-8000-000000000401','26000000-0000-4000-8000-000000000301','26000000-0000-4000-8000-000000000201','mock_r1d05','mock','sms','passed',2);
-- 2026-08-17 R3C-03: cancellation starts from a genuinely paid active state.
insert into public.consumer_subscriptions(id,client_id,enrollment_id,provider,customer_ref,subscription_ref,price_cents,status,idempotency_key)
values('26000000-0000-4000-8000-000000000402','26000000-0000-4000-8000-000000000201','26000000-0000-4000-8000-000000000301','mock','mock_customer','mock_subscription',1900,'active','r1d05');
insert into public.tracker_transition_receipts(event_key,client_id,source)
values('r1d05-receipt','26000000-0000-4000-8000-000000000201','seed');
insert into public.stage_history(id,client_id,to_stage,changed_by)
values('26000000-0000-4000-8000-000000000403','26000000-0000-4000-8000-000000000201','onboarding','26000000-0000-4000-8000-000000000001');
insert into public.applications(id,client_id,bank_ref,created_by)
values('26000000-0000-4000-8000-000000000404','26000000-0000-4000-8000-000000000201','r1d05_bank','26000000-0000-4000-8000-000000000001');
insert into public.outcomes(id,application_id,bank_ref,client_id,kind,amount_cents,recorded_by,recorded_by_kind)
values('26000000-0000-4000-8000-000000000405','26000000-0000-4000-8000-000000000404','r1d05_bank','26000000-0000-4000-8000-000000000201','approved',1000,'26000000-0000-4000-8000-000000000001','consumer');
insert into public.support_threads(id,kind,org_id,client_id,subject,created_by)
values('26000000-0000-4000-8000-000000000406','team_chat','26000000-0000-4000-8000-000000000101','26000000-0000-4000-8000-000000000201','R1D05 retained thread','26000000-0000-4000-8000-000000000001');

insert into public.monitoring_events(id,client_id,event_type,occurred_at)
values
 ('26000000-0000-4000-8000-000000000501','26000000-0000-4000-8000-000000000201','ACCALERT','2026-08-17'),
 ('26000000-0000-4000-8000-000000000502','26000000-0000-4000-8000-000000000201','ACCALERT','2026-08-17');
select * from public.enqueue_analysis_job('26000000-0000-4000-8000-000000000201','monitoring_event','26000000-0000-4000-8000-000000000501','alert');
create temporary table running_job as
select * from public.enqueue_analysis_job('26000000-0000-4000-8000-000000000201','monitoring_event','26000000-0000-4000-8000-000000000502','alert');
select * from public.claim_analysis_job(
  (select analysis_run_id from running_job),
  '26000000-0000-4000-8000-000000000201',
  '26000000-0000-4000-8000-000000000901',
  60
);

select ok(public.analysis_is_authorized('26000000-0000-4000-8000-000000000201'),'analysis begins authorized');
select lives_ok($$select public.enrollment_revoke_consent('26000000-0000-4000-8000-000000000201','analysis','26000000-0000-4000-8000-000000000001')$$,'analysis revocation commits');
select is(public.analysis_is_authorized('26000000-0000-4000-8000-000000000201'),false,'revocation stops authorization');
select is((select status::text from public.analysis_jobs where source_id='26000000-0000-4000-8000-000000000501'),'cancelled','queued analysis is cancelled');
select throws_ok($$select public.enqueue_analysis_job('26000000-0000-4000-8000-000000000201','monitoring_event','26000000-0000-4000-8000-000000000501','alert')$$,'P0001','ANALYSIS_NOT_AUTHORIZED','new work is refused after revocation');
select is((select count(*) from public.background_jobs where job='purge.derived' and subject='enrollment:26000000-0000-4000-8000-000000000301'),1::bigint,'revocation enqueues one derived purge');
select ok((select available_at >= revoked_at + interval '30 days' from public.background_jobs cross join lateral (select max(revoked_at) revoked_at from public.consent_revocations where client_id='26000000-0000-4000-8000-000000000201') r where job='purge.derived' and subject='enrollment:26000000-0000-4000-8000-000000000301'),'revocation purge waits thirty days');
select is((select status::text from public.fail_analysis_job(
  (select id from running_job),'26000000-0000-4000-8000-000000000901','source_unavailable',true,60
)),'cancelled','a claimed job cannot requeue after revocation');
select is((select status::text from public.claim_analysis_job(
  (select analysis_run_id from running_job),'26000000-0000-4000-8000-000000000201','26000000-0000-4000-8000-000000000902',60
)),'cancelled','targeted recovery treats cancellation as terminal');

create function pg_temp.reject_cancel_purge() returns trigger language plpgsql as $$begin if new.job='purge.derived' then raise exception 'queue unavailable' using errcode='55000'; end if; return new; end$$;
create trigger r1d05_reject before insert on public.background_jobs for each row execute function pg_temp.reject_cancel_purge();
select throws_ok($$select public.enrollment_cancel_sub('26000000-0000-4000-8000-000000000301','26000000-0000-4000-8000-000000000001','test')$$,'55000','queue unavailable','queue failure aborts cancellation');
select is((select status::text from public.enrollments where id='26000000-0000-4000-8000-000000000301'),'active','failed enqueue leaves enrollment active');
drop trigger r1d05_reject on public.background_jobs;
select lives_ok($$select public.enrollment_cancel_sub('26000000-0000-4000-8000-000000000301','26000000-0000-4000-8000-000000000001','test')$$,'cancellation and purge enqueue commit together');
select is((select status::text from public.enrollments where id='26000000-0000-4000-8000-000000000301'),'cancelled','enrollment is cancelled');
select is((select status from public.consumer_subscriptions where enrollment_id='26000000-0000-4000-8000-000000000301'),'cancelled','subscription intent is cancelled');

insert into public.analysis_runs(id,client_id,trigger,readiness_score,derived)
values(
 '26000000-0000-4000-8000-000000000601','26000000-0000-4000-8000-000000000201','scheduled',0,
 jsonb_build_object('schemaVersion',1,'bureausPulled',jsonb_build_array('EQF'),'accounts','[]'::jsonb,'overallUtilizationPct',null,'inquiriesByBureau',jsonb_build_object('EQF',0,'EXP',0,'TUC',0),'negativesCount',0,'openRevolvingCount',0,'averageAgeMonths',null,'highestRevolvingLimitCents',null,'dti',jsonb_build_object('monthlyDebtPaymentsCents',0,'statedMonthlyIncomeCents',null,'ratioPct',null),'flags',jsonb_build_object('averageAgeTwoYearsOrMore',false,'cardWithTenKLimit',false,'fourOrMorePersonalAccountsOpen',false,'noNegativeItemsReported',true,'thinFile',true,'twoOrFewerInquiriesEveryBureau',true,'utilizationUnder30',true),'computedAt','2026-08-17T00:00:00.000Z')
);
insert into public.plans(id,client_id,analysis_run_id,version,body,readiness_score)
values('26000000-0000-4000-8000-000000000602','26000000-0000-4000-8000-000000000201','26000000-0000-4000-8000-000000000601',1,'{}',0);
insert into public.checklist_templates(id,kind,key,title,sort_order)
values('26000000-0000-4000-8000-000000000603','personal_credit','r1d05','R1D05',0);
insert into public.checklist_items(id,client_id,template_id,title,sort_order)
values('26000000-0000-4000-8000-000000000604','26000000-0000-4000-8000-000000000201','26000000-0000-4000-8000-000000000603','R1D05',0);
insert into public.checklist_item_state(checklist_item_id,client_id)
values('26000000-0000-4000-8000-000000000604','26000000-0000-4000-8000-000000000201');

select is(public.purge_derived_enrollment('26000000-0000-4000-8000-000000000301','mock_r1d05'),8,'purge reports the deleted derived rows');
select is((select count(*) from public.analysis_runs where client_id='26000000-0000-4000-8000-000000000201'),0::bigint,'analysis runs are deleted');
select is((select count(*) from public.plans where client_id='26000000-0000-4000-8000-000000000201'),0::bigint,'plans are deleted');
select is((select count(*) from public.checklist_items where client_id='26000000-0000-4000-8000-000000000201'),0::bigint,'plan checklist rows are deleted');
select is((select count(*) from public.monitoring_events where client_id='26000000-0000-4000-8000-000000000201'),0::bigint,'monitoring events are deleted');
select is((select crs_member_ref from public.enrollments where id='26000000-0000-4000-8000-000000000301'),null,'closed provider handle is cleared');
select is((select count(*) from public.consents where client_id='26000000-0000-4000-8000-000000000201'),2::bigint,'consent history survives');
select is((select count(*) from public.consent_revocations where client_id='26000000-0000-4000-8000-000000000201'),1::bigint,'revocation history survives');
select is((select count(*) from public.idv_sessions where client_id='26000000-0000-4000-8000-000000000201'),1::bigint,'IDV history survives');
select is((select count(*) from public.tracker_transition_receipts where client_id='26000000-0000-4000-8000-000000000201'),1::bigint,'tracker receipt survives');
select is((select count(*) from public.applications where client_id='26000000-0000-4000-8000-000000000201'),1::bigint,'application survives');
select is((select count(*) from public.outcomes where client_id='26000000-0000-4000-8000-000000000201'),1::bigint,'outcome survives');
select is((select count(*) from public.support_threads where client_id='26000000-0000-4000-8000-000000000201'),1::bigint,'support thread survives');

select * from finish();
rollback;
