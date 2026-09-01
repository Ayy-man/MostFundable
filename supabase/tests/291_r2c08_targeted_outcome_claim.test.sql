begin;
create extension if not exists pgtap with schema extensions;
select plan(5);
delete from public.outcome_refresh_jobs;

insert into public.outcome_refresh_jobs(id, bank_ref, change_id) values
  ('29100000-0000-4000-8000-000000000001', 'bank-b', '29100000-0000-4000-8000-000000000012'),
  ('29100000-0000-4000-8000-000000000002', 'bank-a', '29100000-0000-4000-8000-000000000011');

select results_eq(
  $$select bank_ref, change_id from public.claim_outcome_refresh_job('bank-a','29100000-0000-4000-8000-000000000011','r2c08',60)$$,
  $$values ('bank-a'::text,'29100000-0000-4000-8000-000000000011'::uuid)$$,
  'targeted claim leases the represented row despite reverse FIFO order');
select is((select status from public.outcome_refresh_jobs where bank_ref='bank-b'), 'queued'::public.outcome_job_status,
  'the different inner row remains queued');
select is((select count(*) from public.claim_outcome_refresh_job('missing','29100000-0000-4000-8000-000000000099','r2c08',60)), 0::bigint,
  'an unavailable target returns no claim');
update public.outcome_refresh_jobs set status='succeeded', lease_owner=null, lease_until=null where bank_ref='bank-a';
select results_eq(
  $$select status::text from public.claim_outcome_refresh_job('bank-a','29100000-0000-4000-8000-000000000011','r2c08',60)$$,
  $$values ('succeeded'::text)$$, 'a terminal represented row is distinguishable from unavailable work');
select ok(has_function_privilege('service_role','public.claim_outcome_refresh_job(text,uuid,text,integer)','execute')
  and not has_function_privilege('authenticated','public.claim_outcome_refresh_job(text,uuid,text,integer)','execute'),
  'only the worker can use the targeted claim');
select * from finish();
rollback;
