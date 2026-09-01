create extension if not exists pgtap with schema extensions;

begin;

set local search_path = public, extensions;

select plan(34);

-- 2026-08-17 Round 2 carry: the local seed now owns durable job rows, so this
-- rolled-back unit starts from an empty queue before proving its own inventory.
delete from public.background_jobs;

select has_type('public', 'background_job_status', 'background job status exists');
select enum_has_labels(
  'public',
  'background_job_status',
  array['queued', 'running', 'succeeded', 'skipped', 'failed']::name[],
  'background job statuses are closed'
);
select has_table('public', 'background_jobs', 'background jobs table exists');
select has_function('public', 'enqueue_background_job', array['text', 'text', 'text'], 'enqueue RPC exists');
select has_function('public', 'claim_background_jobs', array['text', 'integer', 'integer'], 'claim RPC exists');
select has_function(
  'public',
  'complete_background_job',
  array['uuid', 'text', 'background_job_status', 'integer'],
  'complete RPC exists'
);
select has_function(
  'public',
  'fail_background_job',
  array['uuid', 'text', 'text', 'boolean', 'integer'],
  'failure RPC exists'
);

insert into public.background_jobs (job, subject, "window")
select key, 'global', '2026-08-16'
from unnest(array[
  'crs.alert_batch',
  'analysis.schedule_due',
  'analysis.run',
  'billing.accruals',
  'outcomes.refresh_stats',
  'vault.sync_banks',
  'vault.reimport_kb',
  'purge.derived',
  'purge.uploaded_reports',
  'notifications.dispatch',
  'tenancy.trial_expiry',
  'kpi.rollup'
]) as key;

select is((select count(*) from public.background_jobs), 12::bigint, 'all twelve frozen keys are accepted');
select throws_ok(
  $$insert into public.background_jobs (job, subject, "window") values ('unknown.job', 'global', '2026-08-16')$$,
  '23514',
  null,
  'unknown job keys are rejected'
);
select is(
  (select idempotency_key from public.background_jobs where job = 'billing.accruals'),
  'billing.accruals|global|2026-08-16',
  'generated idempotency key matches the tuple'
);
select throws_ok(
  $$insert into public.background_jobs (job, subject, "window") values ('billing.accruals', 'global', '2026-08-16')$$,
  '23505',
  null,
  'the tuple is unique'
);
select is(
  (select count(*) from public.enqueue_background_job('billing.accruals', 'global', '2026-08-16')),
  1::bigint,
  'enqueue replay returns the existing row'
);

select is(
  (select count(*) from public.claim_background_jobs('worker-a', 99, 60)),
  12::bigint,
  'claim leases only the available rows even when requested above the cap'
);
select is(
  (select count(*) from public.claim_background_jobs('worker-b', 25, 60)),
  0::bigint,
  'a second worker cannot claim leased rows'
);
select is((select min(attempt_count) from public.background_jobs), 1, 'claim increments attempt count');
select throws_ok(
  $$select * from public.complete_background_job(
      (select id from public.background_jobs where job = 'billing.accruals'),
      'worker-b', 'succeeded', 1
    )$$,
  '55000',
  'background job lease mismatch',
  'the wrong worker cannot complete a row'
);
select throws_ok(
  $$select * from public.fail_background_job(
      (select id from public.background_jobs where job = 'billing.accruals'),
      'worker-b', 'worker_failed', true, 30
    )$$,
  '55000',
  'background job lease mismatch',
  'the wrong worker cannot fail a row'
);
select lives_ok(
  $$select * from public.complete_background_job(
      (select id from public.background_jobs where job = 'billing.accruals'),
      'worker-a', 'succeeded', 2
    )$$,
  'lease owner can complete a row'
);
select is(
  (select status from public.background_jobs where job = 'billing.accruals'),
  'succeeded'::public.background_job_status,
  'completion persists terminal status'
);

select lives_ok(
  $$select * from public.fail_background_job(
      (select id from public.background_jobs where job = 'analysis.run'),
      'worker-a', 'worker_failed', true, 30
    )$$,
  'a transient failure requeues a leased row'
);
select is(
  (select status from public.background_jobs where job = 'analysis.run'),
  'queued'::public.background_job_status,
  'retry returns the row to queued state'
);
update public.background_jobs
set available_at = pg_catalog.now(), attempt_count = 2
where job = 'analysis.run';
select lives_ok(
  $$select * from public.claim_background_jobs('worker-c', 1, 60)$$,
  'the retry can be leased for attempt three'
);
select lives_ok(
  $$select * from public.fail_background_job(
      (select id from public.background_jobs where job = 'analysis.run'),
      'worker-c', 'attempt_limit', false, 0
    )$$,
  'attempt three can become terminal'
);
select is(
  (select status from public.background_jobs where job = 'analysis.run'),
  'failed'::public.background_job_status,
  'terminal failure is persisted'
);

insert into public.background_jobs (job, subject, "window")
select 'kpi.rollup', 'platform:' || value::text, '2026-08-' || lpad(value::text, 2, '0')
from generate_series(1, 30) as value;
select is(
  (select count(*) from public.claim_background_jobs('worker-cap', 99, 60)),
  25::bigint,
  'one claim is hard-capped at 25 rows'
);

select is(
  (select bool_and(relrowsecurity and relforcerowsecurity)
   from pg_class where oid = 'public.background_jobs'::regclass),
  true,
  'background jobs has enabled and forced RLS'
);
select ok(
  not has_table_privilege('anon', 'public.background_jobs', 'SELECT')
    and not has_table_privilege('authenticated', 'public.background_jobs', 'SELECT'),
  'browser roles cannot read the queue'
);
select ok(
  not has_function_privilege('authenticated', 'public.enqueue_background_job(text,text,text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.claim_background_jobs(text,integer,integer)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.complete_background_job(uuid,text,background_job_status,integer)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.fail_background_job(uuid,text,text,boolean,integer)', 'EXECUTE'),
  'browser roles cannot execute queue RPCs'
);
select ok(
  (select bool_and(prosecdef and coalesce(proconfig, '{}'::text[]) @> array['search_path=""'])
   from pg_proc where oid in (
     'public.enqueue_background_job(text,text,text)'::regprocedure,
     'public.claim_background_jobs(text,integer,integer)'::regprocedure,
     'public.complete_background_job(uuid,text,background_job_status,integer)'::regprocedure,
     'public.fail_background_job(uuid,text,text,boolean,integer)'::regprocedure
   )),
  'all queue RPCs are fixed-search-path security definers'
);
select ok(
  not exists (
    select 1
    from public.audit_log as event
    cross join lateral jsonb_object_keys(event.meta) as key
    where event.action = 'background_job.transition'
      and key not in ('job', 'from_state', 'to_state', 'status', 'count', 'reason_code')
  ),
  'transition audit rows contain metadata keys only'
);

insert into public.analysis_jobs (
  id, client_id, source_kind, source_id, analysis_run_id, trigger
)
values (
  '14111000-0000-0000-0000-000000000001',
  'a3000000-0000-0000-0000-000000000001',
  'enrollment',
  '14111000-0000-0000-0000-000000000002',
  '14111000-0000-0000-0000-000000000003',
  'scheduled'
);
select is(
  (select count(*) from public.background_jobs where idempotency_key =
    'analysis.run|client:a3000000-0000-0000-0000-000000000001|run:14111000-0000-0000-0000-000000000003'),
  1::bigint,
  'analysis insert bridges its exact tuple once'
);

insert into public.outcome_refresh_jobs (id, bank_ref, change_id)
values (
  '14111000-0000-0000-0000-000000000011',
  'bank-phase-14',
  '14111000-0000-0000-0000-000000000012'
);
select is(
  (select count(*) from public.background_jobs where idempotency_key =
    'outcomes.refresh_stats|bank:bank-phase-14|change:14111000-0000-0000-0000-000000000012'),
  1::bigint,
  'outcome insert bridges its exact tuple once'
);
select is(
  (select count(*) from public.enqueue_background_job(
    'outcomes.refresh_stats',
    'bank:bank-phase-14',
    'change:14111000-0000-0000-0000-000000000012'
  )),
  1::bigint,
  'bridge tuple replay returns one existing generic row'
);
select is(
  (select count(*) from pg_trigger where tgname in (
    'analysis_jobs_bridge_background',
    'outcome_refresh_jobs_bridge_background'
  ) and not tgisinternal),
  2::bigint,
  'both domain insert bridges are installed'
);

select * from finish();

rollback;
