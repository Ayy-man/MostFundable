begin;
set local search_path = public, extensions;

-- 2026-08-17 R3C-07: a batch owner renews each row before execution.
select plan(6);

insert into public.background_jobs(id,job,subject,"window",status,attempt_count,available_at)
values
 ('33600000-0000-4000-8000-000000000001','kpi.rollup','global','2026-08-17','queued',0,pg_catalog.now()),
 ('33600000-0000-4000-8000-000000000002','kpi.rollup','global','2026-08-18','queued',0,pg_catalog.now());
create temporary table claimed as select * from public.claim_background_jobs('r3c-worker-a',2,60,array['kpi.rollup']);
select is((select max(attempt_count) from claimed),0,'batch claim does not count execution attempts');
update public.background_jobs set lease_until=pg_catalog.now()-interval '1 second' where id='33600000-0000-4000-8000-000000000002';
select ok((public.renew_background_job_lease('33600000-0000-4000-8000-000000000002','r3c-worker-a',60)->>'renewed')::boolean,'owner renews the waiting row before execution');
select is((select attempt_count from public.background_jobs where id='33600000-0000-4000-8000-000000000002'),1,'execution start counts one attempt');
select is((select count(*) from public.claim_background_jobs('r3c-worker-b',2,60,array['kpi.rollup']) where id='33600000-0000-4000-8000-000000000002'),0::bigint,'another worker cannot reclaim the renewed waiting row');
select ok((public.renew_background_job_lease('33600000-0000-4000-8000-000000000002','r3c-worker-a',60)->>'renewed')::boolean,'long-handler renewal remains owner-bound');
select is((select attempt_count from public.background_jobs where id='33600000-0000-4000-8000-000000000002'),1,'long-handler renewal does not count another attempt');

select * from finish();
rollback;
