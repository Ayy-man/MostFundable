begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

-- 2026-08-17 R3C-03 seed carry: remove Casey's governed demo subscription so this test can prove
-- that an active enrollment alone is insufficient before installing its isolated test row.
delete from public.consumer_subscriptions
where enrollment_id = 'a5000000-0000-0000-0000-000000000001';

insert into public.consents(id,client_id,kind,action,text_version,signed_at,ip,esig_ref,created_at)
values('29300000-0000-4000-8000-000000000001','a3000000-0000-0000-0000-000000000001','analysis','granted','analysis-r2a06-v2',
  pg_catalog.clock_timestamp()-interval '1 second','127.0.0.1','r2a06-v2',pg_catalog.clock_timestamp()-interval '1 second');
update public.enrollments set status='active' where id='a5000000-0000-0000-0000-000000000001';
select is(public.analysis_is_authorized('a3000000-0000-0000-0000-000000000001'),false,
  'R3C-03 refuses analysis without an active subscription');
insert into public.consumer_subscriptions(id,client_id,enrollment_id,provider,customer_ref,subscription_ref,price_cents,status,idempotency_key)
values('29300000-0000-4000-8000-000000000003','a3000000-0000-0000-0000-000000000001','a5000000-0000-0000-0000-000000000001',
  'mock','mock_r2a06_customer','mock_r2a06_subscription',1900,'active','r2a06-active-subscription');
insert into public.monitoring_events(id,client_id,event_type,occurred_at)
values('29300000-0000-4000-8000-000000000002','a3000000-0000-0000-0000-000000000001','ACCALERT',pg_catalog.now());
create temporary table r2a06_job as select * from public.enqueue_analysis_job(
  'a3000000-0000-0000-0000-000000000001','monitoring_event','29300000-0000-4000-8000-000000000002','alert');

select ok(public.analysis_is_authorized('a3000000-0000-0000-0000-000000000001'),'latest versioned grant authorizes analysis');
select lives_ok($$select public.enrollment_revoke_consent('a3000000-0000-0000-0000-000000000001','analysis','a1000000-0000-0000-0000-000000000011')$$,
  'one withdrawal revokes every effective analysis grant');
select is((select count(*) from public.consents c left join public.consent_revocations r on r.consent_id=c.id
  where c.client_id='a3000000-0000-0000-0000-000000000001' and c.kind='analysis' and c.action='granted' and r.id is null),0::bigint,
  'no older analysis grant remains effective');
select is(public.analysis_is_authorized('a3000000-0000-0000-0000-000000000001'),false,
  'latest withdrawal event denies analysis');
select throws_ok($$select public.enqueue_analysis_job('a3000000-0000-0000-0000-000000000001','monitoring_event','29300000-0000-4000-8000-000000000002','alert')$$,
  'P0001','ANALYSIS_NOT_AUTHORIZED','enqueue is denied after the versioned withdrawal');
select is((select status::text from public.analysis_jobs where id=(select id from r2a06_job)),'cancelled',
  'queued worker input is cancelled by withdrawal');
select lives_ok($$select public.enrollment_revoke_consent('a3000000-0000-0000-0000-000000000001','analysis','a1000000-0000-0000-0000-000000000011')$$,
  'withdrawal replay succeeds');
select is((select count(*) from public.consent_revocations where client_id='a3000000-0000-0000-0000-000000000001' and kind='analysis'),
  (select count(*) from public.consents where client_id='a3000000-0000-0000-0000-000000000001' and kind='analysis' and action='granted'),
  'withdrawal replay creates no duplicate revocations');
select * from finish();
rollback;
