begin;
create extension if not exists pgtap with schema extensions;
select plan(5);
delete from public.background_jobs;

insert into public.background_jobs(id, job, subject, "window") values
  ('29000000-0000-4000-8000-000000000001', 'billing.accruals', 'org:29000000-0000-4000-8000-000000000010', '2026-08'),
  ('29000000-0000-4000-8000-000000000002', 'purge.derived', 'enrollment:29000000-0000-4000-8000-000000000020', '2026-08-17');

select is((select count(*) from public.claim_background_jobs('r2c02', 25, 60, array['purge.derived'])), 1::bigint,
  'claim leases only jobs whose handler owner is enabled');
select results_eq($$select status::text, attempt_count from public.background_jobs where id='29000000-0000-4000-8000-000000000001'$$,
  $$values ('queued'::text, 0)$$, 'disabled work stays queued and consumes no attempt');
select is((select count(*) from public.claim_background_job('29000000-0000-4000-8000-000000000001', 'r2c02', 60, array['purge.derived'])), 0::bigint,
  'targeted claim cannot bypass handler ownership');
select is((select count(*) from public.claim_background_job('29000000-0000-4000-8000-000000000001', 'r2c02', 60, array['billing.accruals'])), 1::bigint,
  'queued work resumes when its owner is enabled');
select ok(
  not has_function_privilege('service_role', 'public.claim_background_jobs(text,integer,integer)', 'execute')
  and has_function_privilege('service_role', 'public.claim_background_jobs(text,integer,integer,text[])', 'execute'),
  'service workers can claim only through the allow-listed RPC');
select * from finish();
rollback;
