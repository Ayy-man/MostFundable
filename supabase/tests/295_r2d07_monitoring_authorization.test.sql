begin;
create extension if not exists pgtap with schema extensions;
select plan(7);
-- 2026-08-17 R3C-03 seed carry: remove Casey's governed demo subscription so this test can prove
-- the active-enrollment-only denial before installing its isolated subscription fixture.
delete from public.consumer_subscriptions
where enrollment_id = 'a5000000-0000-0000-0000-000000000001';
insert into public.consents(id,client_id,kind,action,text_version,signed_at,ip,esig_ref,created_at)
values('29500000-0000-4000-8000-000000000001','a3000000-0000-0000-0000-000000000001','monitoring','granted','monitoring-r2d07-v2',
 pg_catalog.clock_timestamp()-interval '1 second','127.0.0.1','r2d07-v2',pg_catalog.clock_timestamp()-interval '1 second');
update public.enrollments set status='active' where id='a5000000-0000-0000-0000-000000000001';
select is(public.monitoring_is_authorized('a3000000-0000-0000-0000-000000000001'),false,
  'R3C-03 refuses monitoring without an active subscription');
insert into public.consumer_subscriptions(id,client_id,enrollment_id,provider,customer_ref,subscription_ref,price_cents,status,idempotency_key)
values('29500000-0000-4000-8000-000000000002','a3000000-0000-0000-0000-000000000001','a5000000-0000-0000-0000-000000000001',
  'mock','mock_r2d07_customer','mock_r2d07_subscription',1900,'active','r2d07-active-subscription');
select ok(public.monitoring_is_authorized('a3000000-0000-0000-0000-000000000001'),'latest monitoring grant authorizes the member');
select lives_ok($$select public.enrollment_revoke_consent('a3000000-0000-0000-0000-000000000001','monitoring','a1000000-0000-0000-0000-000000000011')$$,
 'monitoring withdrawal revokes all effective grants');
select is(public.monitoring_is_authorized('a3000000-0000-0000-0000-000000000001'),false,'latest monitoring withdrawal denies the member');
select is((select count(*) from public.consents c left join public.consent_revocations r on r.consent_id=c.id
 where c.client_id='a3000000-0000-0000-0000-000000000001' and c.kind='monitoring' and c.action='granted' and r.id is null),0::bigint,
 'no older monitoring grant remains effective');
select ok(public.analysis_is_authorized('a3000000-0000-0000-0000-000000000001'),'separate analysis authorization remains active');
select lives_ok($$select public.enrollment_revoke_consent('a3000000-0000-0000-0000-000000000001','monitoring','a1000000-0000-0000-0000-000000000011')$$,'monitoring withdrawal replays');
select * from finish();
rollback;
