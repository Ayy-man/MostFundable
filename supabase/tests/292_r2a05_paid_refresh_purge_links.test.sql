begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into public.analysis_jobs(id,client_id,source_kind,source_id,analysis_run_id,trigger,status,lease_owner,lease_until,error_code) values
 ('29200000-0000-4000-8000-000000000001','a3000000-0000-0000-0000-000000000001','force_pull','29200000-0000-4000-8000-000000000101','29200000-0000-4000-8000-000000000201','force_pull','queued',null,null,null),
 ('29200000-0000-4000-8000-000000000002','a3000000-0000-0000-0000-000000000001','force_pull','29200000-0000-4000-8000-000000000102','29200000-0000-4000-8000-000000000202','force_pull','running','29200000-0000-4000-8000-000000000901',pg_catalog.now()+interval '1 minute',null),
 ('29200000-0000-4000-8000-000000000003','a3000000-0000-0000-0000-000000000001','force_pull','29200000-0000-4000-8000-000000000103','29200000-0000-4000-8000-000000000203','force_pull','succeeded',null,null,null),
 ('29200000-0000-4000-8000-000000000004','a3000000-0000-0000-0000-000000000001','force_pull','29200000-0000-4000-8000-000000000104','29200000-0000-4000-8000-000000000204','force_pull','failed',null,null,'source_unavailable');
insert into public.paid_refresh_requests(id,actor_profile_id,client_id,org_id,idempotency_key,amount_cents,currency,driver,state,provider_payment_ref,analysis_run_id) values
 ('29200000-0000-4000-8000-000000000101','a1000000-0000-0000-0000-000000000011','a3000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','r2a05-q',1900,'usd','mock','queued','pay-q','29200000-0000-4000-8000-000000000201'),
 ('29200000-0000-4000-8000-000000000102','a1000000-0000-0000-0000-000000000011','a3000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','r2a05-r',1900,'usd','mock','queued','pay-r','29200000-0000-4000-8000-000000000202'),
 ('29200000-0000-4000-8000-000000000103','a1000000-0000-0000-0000-000000000011','a3000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','r2a05-s',1900,'usd','mock','queued','pay-s','29200000-0000-4000-8000-000000000203'),
 ('29200000-0000-4000-8000-000000000104','a1000000-0000-0000-0000-000000000011','a3000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','r2a05-f',1900,'usd','mock','queued','pay-f','29200000-0000-4000-8000-000000000204');
insert into public.paid_refresh_payment_events(request_id,provider_event_key,provider_payment_ref,outcome,amount_cents,currency)
select id, 'event-'||id::text, provider_payment_ref, 'succeeded', amount_cents, currency from public.paid_refresh_requests where id::text like '29200000-%';

-- Migration 407 makes a historical consent-driven purge a no-op while a later
-- grant is active. Cancellation is terminal, so exercise the linked-work purge
-- under the state in which it is still required to execute.
update public.enrollments
set status = 'cancelled'
where id = 'a5000000-0000-0000-0000-000000000001';

select lives_ok($$select public.purge_derived_enrollment('a5000000-0000-0000-0000-000000000001','mock_clean_000001')$$,
  'linked paid-refresh work no longer blocks purge');
select is((select count(*) from public.analysis_jobs where id in ('29200000-0000-4000-8000-000000000001','29200000-0000-4000-8000-000000000002')),0::bigint,
  'queued and running jobs are deleted');
select is((select count(*) from public.analysis_jobs where id in ('29200000-0000-4000-8000-000000000003','29200000-0000-4000-8000-000000000004')),2::bigint,
  'succeeded and failed jobs are retained');
select is((select count(*) from public.paid_refresh_requests where id in ('29200000-0000-4000-8000-000000000101','29200000-0000-4000-8000-000000000102') and state='cancelled' and analysis_run_id is null),2::bigint,
  'nonterminal linked requests become terminal and detach their run');
select is((select count(*) from public.paid_refresh_requests where id in ('29200000-0000-4000-8000-000000000103','29200000-0000-4000-8000-000000000104') and state='queued' and analysis_run_id is not null),2::bigint,
  'terminal jobs and their request links remain intact');
select is((select count(*) from public.paid_refresh_payment_events where request_id::text like '29200000-%'),4::bigint,
  'all payment evidence survives');
select lives_ok($$select public.purge_derived_enrollment('a5000000-0000-0000-0000-000000000001',null)$$,
  'purge replay succeeds after the member handle is cleared');
select is((select count(*) from public.paid_refresh_requests where id::text like '29200000-%'),4::bigint,
  'replay retains every paid-refresh request');
select * from finish();
rollback;
