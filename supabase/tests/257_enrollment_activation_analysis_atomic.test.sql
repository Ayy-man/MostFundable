begin;
create extension if not exists pgtap with schema extensions;

-- 2026-08-17 R1C-14/R3C-03: paid activation cannot commit without its initial
-- analysis tuple, while IDV completion alone leaves access inactive.
select plan(10);

insert into auth.users(id,email) values ('25700000-0000-4000-8000-000000000001','actor@r1c14.test');
insert into public.orgs(id,name,slug) values ('25700000-0000-4000-8000-000000000101','R1C14 Org','r1c14-org');
insert into public.profiles(id,role,org_id,full_name,email) values
 ('25700000-0000-4000-8000-000000000001','consumer','25700000-0000-4000-8000-000000000101','R1C14 Actor','actor@r1c14.test')
on conflict(id) do update set role=excluded.role,org_id=excluded.org_id,org_role=null,full_name=excluded.full_name,email=excluded.email;
insert into public.clients(id,org_id,consumer_profile_id,display_name) values
 ('25700000-0000-4000-8000-000000000201','25700000-0000-4000-8000-000000000101','25700000-0000-4000-8000-000000000001','R1C14 Client');
insert into public.consents(id,client_id,kind,text_version,signed_at,ip,esig_ref) values
 ('25700000-0000-4000-8000-000000000211','25700000-0000-4000-8000-000000000201','monitoring','v1','2026-08-17','127.0.0.1','test-doc'),
 ('25700000-0000-4000-8000-000000000212','25700000-0000-4000-8000-000000000201','analysis','v1','2026-08-17','127.0.0.1','test-doc');
insert into public.enrollments(id,client_id,status,esig_doc_id,monitoring_consent_at,analysis_consent_at)
values('25700000-0000-4000-8000-000000000301','25700000-0000-4000-8000-000000000201','enrolled','test-doc','2026-08-17','2026-08-17');
insert into public.consumer_subscriptions(
  id,client_id,enrollment_id,provider,customer_ref,price_cents,status,idempotency_key
) values(
  '25700000-0000-4000-8000-000000000302','25700000-0000-4000-8000-000000000201','25700000-0000-4000-8000-000000000301',
  'mock','mock_r1c14_customer',1900,'authorized','r1c14-authorized-subscription'
);
insert into public.idv_sessions(id,enrollment_id,client_id,member_ref,driver,kind,state,max_attempts)
values('25700000-0000-4000-8000-000000000401','25700000-0000-4000-8000-000000000301','25700000-0000-4000-8000-000000000201','mock_r1c14','mock','sms','sms_sent',2);

select lives_ok($$select public.enrollment_idv_settled('25700000-0000-4000-8000-000000000301','25700000-0000-4000-8000-000000000001','pass','passed',null,null)$$,
  'IDV completion succeeds without activating paid access');
select results_eq(
  $$select session.state, enrollment.status::text,
      (select count(*) from public.analysis_jobs where source_id='25700000-0000-4000-8000-000000000301')
    from public.idv_sessions as session
    join public.enrollments as enrollment on enrollment.id=session.enrollment_id
    where session.enrollment_id='25700000-0000-4000-8000-000000000301'$$,
  $$values ('passed'::text,'enrolled'::text,0::bigint)$$,
  'IDV alone leaves the enrollment inactive and creates no analysis tuple'
);

create function pg_temp.reject_analysis_insert() returns trigger language plpgsql as $$begin raise exception 'analysis unavailable' using errcode='55000'; end$$;
create trigger r1c14_reject before insert on public.analysis_jobs for each row execute function pg_temp.reject_analysis_insert();
select throws_ok($$select public.enrollment_settle_sub('25700000-0000-4000-8000-000000000301','25700000-0000-4000-8000-000000000001','mock_r1c14_subscription')$$,
  '55000','analysis unavailable','analysis outage aborts paid activation');
select results_eq(
  $$select enrollment.status::text, subscription.status,
      (select count(*) from public.analysis_jobs where source_id='25700000-0000-4000-8000-000000000301')
    from public.enrollments as enrollment
    join public.consumer_subscriptions as subscription on subscription.enrollment_id=enrollment.id
    where enrollment.id='25700000-0000-4000-8000-000000000301'$$,
  $$values ('enrolled'::text,'authorized'::text,0::bigint)$$,
  'failed enqueue rolls back enrollment and subscription activation together'
);
drop trigger r1c14_reject on public.analysis_jobs;

select lives_ok($$select public.enrollment_settle_sub('25700000-0000-4000-8000-000000000301','25700000-0000-4000-8000-000000000001','mock_r1c14_subscription')$$,
  'paid activation succeeds when the queue is writable');
select results_eq(
  $$select enrollment.status::text, subscription.status, subscription.subscription_ref
    from public.enrollments as enrollment
    join public.consumer_subscriptions as subscription on subscription.enrollment_id=enrollment.id
    where enrollment.id='25700000-0000-4000-8000-000000000301'$$,
  $$values ('active'::text,'active'::text,'mock_r1c14_subscription'::text)$$,
  'exact settlement activates the enrollment and subscription together'
);
select is((select count(*) from public.analysis_jobs where source_id='25700000-0000-4000-8000-000000000301'),1::bigint,'initial analysis source is durable');
select is((select count(*) from public.background_jobs where job='analysis.run' and subject='client:25700000-0000-4000-8000-000000000201'),1::bigint,'existing bridge receives exactly one tuple');
select lives_ok($$select public.enrollment_settle_sub('25700000-0000-4000-8000-000000000301','25700000-0000-4000-8000-000000000001','mock_r1c14_subscription')$$,
  'exact paid activation replay is idempotent');
select results_eq(
  $$select
      (select count(*) from public.enrollment_milestones where client_id='25700000-0000-4000-8000-000000000201' and kind='monitoring_connected'),
      (select count(*) from public.analysis_jobs where source_id='25700000-0000-4000-8000-000000000301'),
      (select count(*) from public.background_jobs where job='analysis.run' and subject='client:25700000-0000-4000-8000-000000000201')$$,
  $$values (1::bigint,1::bigint,1::bigint)$$,
  'paid activation replay creates no duplicate evidence'
);

select * from finish();
rollback;
