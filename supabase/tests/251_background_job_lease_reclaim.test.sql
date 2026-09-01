begin;
create extension if not exists pgtap with schema extensions;

-- 2026-08-17 R1C-03: live leases stay exclusive; expired leases reclaim or exhaust.
select plan(14);

-- 2026-08-17 Round 2 carry: isolate FIFO assertions from durable seed jobs.
delete from public.background_jobs;

insert into public.background_jobs(id, job, subject, "window", status, attempt_count, lease_owner, lease_until)
values
  ('25100000-0000-4000-8000-000000000001', 'kpi.rollup', 'platform', 'r1c03-live', 'running', 1, 'worker-live', pg_catalog.now() + interval '5 minutes'),
  ('25100000-0000-4000-8000-000000000002', 'kpi.rollup', 'platform', 'r1c03-expired', 'running', 1, 'worker-dead', pg_catalog.now() - interval '1 second'),
  ('25100000-0000-4000-8000-000000000003', 'kpi.rollup', 'platform', 'r1c03-exhausted', 'running', 3, 'worker-dead', pg_catalog.now() - interval '1 second'),
  ('25100000-0000-4000-8000-000000000004', 'kpi.rollup', 'platform', 'r1c03-target', 'running', 1, 'worker-dead', pg_catalog.now() - interval '1 second');

select is(
  (select count(*) from public.claim_background_jobs('worker-fifo', 2, 60)),
  1::bigint,
  'FIFO reclaims the eligible expired row while exhausting the capped row'
);
select results_eq(
  $$select status::text, attempt_count, lease_owner from public.background_jobs where id = '25100000-0000-4000-8000-000000000002'$$,
  $$values ('running'::text, 2, 'worker-fifo'::text)$$,
  'expired reclaim increments attempts and transfers the lease'
);
select results_eq(
  $$select status::text, attempt_count, lease_owner from public.background_jobs where id = '25100000-0000-4000-8000-000000000001'$$,
  $$values ('running'::text, 1, 'worker-live'::text)$$,
  'a live lease is excluded'
);
select is(
  (select count(*) from public.claim_background_job('25100000-0000-4000-8000-000000000002', 'worker-simultaneous', 60)),
  0::bigint,
  'a second reclaimer cannot take the newly live lease'
);
select results_eq(
  $$select status::text, error_code, completed_at is not null from public.background_jobs where id = '25100000-0000-4000-8000-000000000003'$$,
  $$values ('failed'::text, 'lease_exhausted'::text, true)$$,
  'an exhausted expired lease becomes terminal'
);
select is(
  (select count(*) from public.audit_log where subject_id = '25100000-0000-4000-8000-000000000003' and meta->>'to_state' = 'failed'),
  1::bigint,
  'lease exhaustion is audited'
);

select is(
  (select count(*) from public.claim_background_job('25100000-0000-4000-8000-000000000004', 'worker-run-now', 60)),
  1::bigint,
  'run-now reclaims its requested expired row'
);
select results_eq(
  $$select attempt_count, lease_owner from public.background_jobs where id = '25100000-0000-4000-8000-000000000004'$$,
  $$values (2, 'worker-run-now'::text)$$,
  'targeted reclaim transfers only the requested lease'
);
select is(
  (select count(*) from public.claim_background_job('25100000-0000-4000-8000-000000000001', 'worker-run-now', 60)),
  0::bigint,
  'run-now cannot take a requested live lease'
);
select is(
  (select count(*) from public.audit_log where subject_id = '25100000-0000-4000-8000-000000000004' and meta->>'from_state' = 'running' and meta->>'to_state' = 'running'),
  1::bigint,
  'targeted reclaim is audited'
);

update public.background_jobs
set attempt_count = 3, lease_until = pg_catalog.now() - interval '1 second'
where id = '25100000-0000-4000-8000-000000000004';
select is(
  (select count(*) from public.claim_background_job('25100000-0000-4000-8000-000000000004', 'worker-final', 60)),
  0::bigint,
  'targeted reclaim also enforces the attempt cap'
);
select is(
  (select status from public.background_jobs where id = '25100000-0000-4000-8000-000000000004'),
  'failed'::public.background_job_status,
  'targeted exhaustion is terminal'
);
select ok(
  pg_get_functiondef('public.claim_background_jobs(text,integer,integer)'::regprocedure) like '%for update skip locked%',
  'FIFO candidates are locked with skip-locked concurrency discipline'
);
select ok(
  pg_get_functiondef('public.claim_background_job(uuid,text,integer)'::regprocedure) like '%candidate.id = p_job_id%',
  'targeted reclaim is constrained to its requested id'
);

select * from finish();
rollback;
