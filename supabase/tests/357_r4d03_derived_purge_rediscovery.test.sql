begin;
set local search_path = public, extensions;

-- 2026-08-18 R4D-03: three exhausted attempts must bound the tuple, never the obligation.
select plan(13);

-- The real cancellation transition, which is also the only producer `purge.derived` had.
select public.enrollment_cancel_sub('a5000000-0000-0000-0000-000000000001', null, null);

create temporary table r4f4_first as
select id, "window" from public.background_jobs
where job = 'purge.derived'
  and subject = 'enrollment:a5000000-0000-0000-0000-000000000001';

select is((select count(*) from r4f4_first), 1::bigint, 'cancellation enqueues exactly one purge tuple');

-- Exhaust the drainer's three attempts the way `drainJobs` does: claim, renew, fail.
do $probe$
declare
  v_id uuid := (select id from r4f4_first);
  v_attempt integer;
begin
  for v_attempt in 1..3 loop
    perform public.claim_background_jobs('r4f4-worker', 1, 60, array['purge.derived']);
    perform public.renew_background_job_lease(v_id, 'r4f4-worker', 60);
    perform public.fail_background_job(v_id, 'r4f4-worker', 'r4f4_probe_failure', v_attempt < 3, 0);
  end loop;
end;
$probe$;

select is(
  (select status::text || '|' || attempt_count from public.background_jobs where id = (select id from r4f4_first)),
  'failed|3',
  'the tuple is terminally failed after three attempts'
);

-- The dead end the finding is about: the same tuple comes back unchanged.
select is(
  (select status::text || '|' || attempt_count
   from public.enqueue_background_job(
     'purge.derived',
     'enrollment:a5000000-0000-0000-0000-000000000001',
     (select "window" from r4f4_first))),
  'failed|3',
  'conflict-ignore returns the dead row for the same window'
);

-- Rediscovery. On c2df7ae there is no selector at all, so every assertion below fails.
select is(
  (select count(*) from public.list_derived_purge_targets(pg_catalog.now() + interval '1 day')
   where enrollment_id = 'a5000000-0000-0000-0000-000000000001'),
  1::bigint,
  'the next tick rediscovers the enrollment whose tuple died'
);

select is(
  (select count(*) from public.list_derived_purge_targets(pg_catalog.now() - interval '15 minutes')
   where enrollment_id = 'a5000000-0000-0000-0000-000000000001'),
  0::bigint,
  'the age guard leaves a tuple that may still be executing alone'
);

-- The rediscovered tuple carries a fresh window, so it gets its own attempts.
select is(
  (select status::text || '|' || attempt_count
   from public.enqueue_background_job(
     'purge.derived',
     'enrollment:a5000000-0000-0000-0000-000000000001',
     pg_catalog.to_char(pg_catalog.now() + interval '1 day', 'YYYY-MM-DD'))),
  'queued|0',
  'the fresh window enqueues a new tuple with its own attempts'
);

select is(
  (select count(*) from public.background_jobs
   where job = 'purge.derived' and subject = 'enrollment:a5000000-0000-0000-0000-000000000001'),
  2::bigint,
  'the failed tuple is retained as evidence beside the retry'
);

-- A successful close-and-purge discharges the obligation.
select is(
  public.purge_derived_enrollment(
    'a5000000-0000-0000-0000-000000000001',
    (select crs_member_ref from public.enrollments where id = 'a5000000-0000-0000-0000-000000000001')
  ) >= 0,
  true,
  'the purge runs for the rediscovered enrollment'
);

-- R5D-01: purging the graph is only half the obligation migration 354 attached to this job.
-- Until the provider confirms the cancellation the enrollment is still a target, which is the
-- whole point of the extended selector — the original assertion below passed only because the
-- provider half was invisible to it.
select is(
  (select count(*) from public.list_derived_purge_targets(pg_catalog.now() + interval '2 days')
   where enrollment_id = 'a5000000-0000-0000-0000-000000000001'),
  1::bigint,
  'a purged graph with an unconfirmed provider cancellation is still rediscovered'
);

select public.consumer_subscription_provider_cancel_completed(
  'a5000000-0000-0000-0000-000000000001',
  (select provider_cancel_ref from public.consumer_subscriptions
   where enrollment_id = 'a5000000-0000-0000-0000-000000000001'));

select is(
  (select count(*) from public.list_derived_purge_targets(pg_catalog.now() + interval '2 days')
   where enrollment_id = 'a5000000-0000-0000-0000-000000000001'),
  0::bigint,
  'the following day rediscovers nothing once the graph is purged and the provider has confirmed'
);

-- The revocation producer's obligation, which is due 30 days after withdrawal.
insert into public.consent_revocations (consent_id, client_id, kind, revoked_at)
values (
  'a4000000-0000-0000-0000-000000000004',
  'a3000000-0000-0000-0000-000000000002',
  'analysis',
  pg_catalog.now() - interval '10 days'
);

select is(
  (select count(*) from public.list_derived_purge_targets(pg_catalog.now() + interval '1 day')
   where enrollment_id = 'a5000000-0000-0000-0000-000000000002'),
  0::bigint,
  'a withdrawal inside the 30-day window is not rediscovered early'
);

insert into public.consent_revocations (consent_id, client_id, kind, revoked_at)
values (
  'a4000000-0000-0000-0000-000000000006',
  'a3000000-0000-0000-0000-000000000003',
  'analysis',
  pg_catalog.now() - interval '30 days 1 minute'
);

select is(
  (select count(*) from public.list_derived_purge_targets(pg_catalog.now() + interval '1 day')
   where enrollment_id = 'a5000000-0000-0000-0000-000000000003'),
  1::bigint,
  'a due withdrawal is rediscovered without the enrollment being cancelled'
);

-- Metadata only: the selector may never hand derived content to the scheduler.
select is(
  pg_catalog.pg_get_function_result('public.list_derived_purge_targets(timestamptz,integer)'::regprocedure),
  'TABLE(enrollment_id uuid)',
  'the rediscovery query returns enrollment ids and nothing else'
);

select * from finish();
rollback;
