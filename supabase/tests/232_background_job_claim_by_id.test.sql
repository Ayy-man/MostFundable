create extension if not exists pgtap with schema extensions;

begin;

set local search_path = public, extensions;

select plan(13);

select has_function(
  'public',
  'claim_background_job',
  array['uuid', 'text', 'integer'],
  'targeted claim RPC exists'
);
select is(
  (select prosecdef from pg_proc where oid = 'public.claim_background_job(uuid,text,integer)'::regprocedure),
  true,
  'targeted claim is security definer'
);
-- 2026-08-17 R2C-02 carry: workers use the allow-listed overload; the legacy overload is owner-only.
select ok(
  not has_function_privilege('anon', 'public.claim_background_job(uuid, text, integer)', 'execute')
    and not has_function_privilege('authenticated', 'public.claim_background_job(uuid, text, integer)', 'execute')
    and not has_function_privilege('service_role', 'public.claim_background_job(uuid, text, integer)', 'execute')
    and has_function_privilege('service_role', 'public.claim_background_job(uuid, text, integer, text[])', 'execute'),
  'service_role may execute only the allow-listed targeted claim'
);

-- An older queued neighbour and the run-now target, enqueued in that order.
select lives_ok(
  $$select * from public.enqueue_background_job('billing.accruals', 'org:00000000-0000-0000-0000-00000000f232', '2098-08')$$,
  'older neighbour job enqueues'
);
select lives_ok(
  $$select * from public.enqueue_background_job('kpi.rollup', 'platform', '2098-08-17')$$,
  'run-now target enqueues behind it'
);
-- Push the target into retry backoff: a FIFO claim must not see it, run-now must.
update public.background_jobs
set available_at = pg_catalog.now() + interval '10 minutes'
where job = 'kpi.rollup' and subject = 'platform' and "window" = '2098-08-17';

select is(
  (select count(*) from public.claim_background_job(
    (select id from public.background_jobs where job = 'kpi.rollup' and subject = 'platform' and "window" = '2098-08-17'),
    'worker-run-now', 60)),
  1::bigint,
  'the targeted claim leases exactly the requested job, backoff included'
);
select is(
  (select status from public.background_jobs where job = 'billing.accruals' and "window" = '2098-08'),
  'queued'::public.background_job_status,
  'the older neighbour is left queued'
);
select is(
  (select status from public.background_jobs where job = 'kpi.rollup' and "window" = '2098-08-17'),
  'running'::public.background_job_status,
  'the target is running under the run-now worker'
);
select is(
  (select lease_owner from public.background_jobs where job = 'kpi.rollup' and "window" = '2098-08-17'),
  'worker-run-now',
  'lease owner is the run-now worker'
);
select is(
  (select count(*) from public.claim_background_job(
    (select id from public.background_jobs where job = 'kpi.rollup' and "window" = '2098-08-17'),
    'worker-second', 60)),
  0::bigint,
  'a running job cannot be claimed again'
);
select is(
  (select count(*) from public.claim_background_job(extensions.gen_random_uuid(), 'worker-run-now', 60)),
  0::bigint,
  'an unknown id claims nothing'
);
select throws_ok(
  $$select * from public.claim_background_job(
      (select id from public.background_jobs where job = 'billing.accruals' and "window" = '2098-08'),
      'worker-run-now', 1)$$,
  '22023',
  'invalid background job lease',
  'lease bounds are enforced like the FIFO claim'
);
select lives_ok(
  $$select * from public.complete_background_job(
      (select id from public.background_jobs where job = 'kpi.rollup' and "window" = '2098-08-17'),
      'worker-run-now', 'succeeded', 1
    )$$,
  'the run-now worker completes its targeted lease'
);

select * from finish();

rollback;
