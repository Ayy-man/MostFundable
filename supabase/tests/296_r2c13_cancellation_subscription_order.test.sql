begin;
create extension if not exists pgtap with schema extensions;
select plan(5);
-- 2026-08-17 R3C-03 seed carry: replace Casey's governed demo subscription with the isolated row
-- whose cancellation order and active-parent guard this test owns.
delete from public.consumer_subscriptions
where enrollment_id = 'a5000000-0000-0000-0000-000000000001';
update public.enrollments set status='active', parked_until=null where id='a5000000-0000-0000-0000-000000000001';
insert into public.consumer_subscriptions(id,client_id,enrollment_id,provider,customer_ref,subscription_ref,price_cents,status,idempotency_key)
values('29600000-0000-4000-8000-000000000001','a3000000-0000-0000-0000-000000000001','a5000000-0000-0000-0000-000000000001',
 'mock','customer-r2c13','subscription-r2c13',1900,'active','r2c13-active');
delete from public.background_jobs where job='purge.derived' and subject='enrollment:a5000000-0000-0000-0000-000000000001';

select lives_ok($$select public.enrollment_cancel_sub('a5000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000011','r2c13')$$,
 'cancellation with an active settled subscription succeeds');
select is((select status from public.consumer_subscriptions where id='29600000-0000-4000-8000-000000000001'),'cancelled','subscription is cancelled first');
select is((select status::text from public.enrollments where id='a5000000-0000-0000-0000-000000000001'),'cancelled','parent enrollment is cancelled atomically');
select is((select count(*) from public.background_jobs where job='purge.derived' and subject='enrollment:a5000000-0000-0000-0000-000000000001'),1::bigint,
 'cancellation enqueues the derived purge');
select throws_ok($$update public.consumer_subscriptions set status='active' where id='29600000-0000-4000-8000-000000000001'$$,
 '23514',null,'the active-parent guard still rejects a non-cancel shape');
select * from finish();
rollback;
