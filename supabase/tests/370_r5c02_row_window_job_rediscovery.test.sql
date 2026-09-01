begin;
set local search_path = public, extensions;

-- 2026-08-18 R5C-02 / R5C-03: an on-demand job whose window is a row identity has no next
-- window to mint, so migration 357's dated rediscovery cannot reach it and three attempts
-- became the whole life of the obligation. The class is asserted here from the catalog, not
-- from the three names the reviewers happened to report.
select plan(24);

-- ---------------------------------------------------------------------------
-- The class, derived.
-- ---------------------------------------------------------------------------

select is(
  (select pg_catalog.count(*) from private.row_window_job_queues() as entry
    where private.row_window_job_queue(entry.job) is distinct from entry.queue),
  0::bigint,
  'every bridged inner queue the catalog holds is reachable by its own job name'
);

select cmp_ok(
  (select pg_catalog.count(*) from private.row_window_job_queues()),
  '>=', 3::bigint,
  'the catalog predicate finds the bridged queues rather than an empty set'
);

-- The teeth for a queue added later: a status literal this mechanism cannot classify is what
-- would make it silently treat outstanding work as discharged.
select is(
  (select pg_catalog.count(*)
   from private.row_window_job_queues() as entry
   join pg_catalog.pg_attribute as att
     on att.attrelid = entry.queue and att.attname = 'status' and not att.attisdropped
   join pg_catalog.pg_enum as label on label.enumtypid = att.atttypid
   where not (label.enumlabel = any (
     private.row_window_queue_open_statuses() || private.row_window_queue_terminal_statuses()))),
  0::bigint,
  'every bridged queue status is classified as open or terminal'
);

-- A queue whose job name the shared table would refuse could never carry an outer tuple.
select is(
  (select pg_catalog.count(*)
   from private.row_window_job_queues() as entry
   where pg_catalog.strpos(
     (select pg_catalog.pg_get_constraintdef(con.oid)
      from pg_catalog.pg_constraint as con
      where con.conrelid = 'public.background_jobs'::regclass
        and con.conname = 'background_jobs_job_valid'),
     pg_catalog.quote_literal(entry.job)) = 0),
  0::bigint,
  'every bridged queue names a job the shared queue accepts'
);

select is(private.row_window_job_queue('analysis.run')::text, 'analysis_jobs',
  'analysis.run resolves to its durable inner queue');
select is(private.row_window_job_queue('outcomes.refresh_stats')::text, 'outcome_refresh_jobs',
  'outcomes.refresh_stats resolves to its durable inner queue');
select is(private.row_window_job_queue('notifications.dispatch')::text, 'notification_delivery_outbox',
  'notifications.dispatch resolves to its durable inner queue — the sibling nobody reported');
select ok(private.row_window_job_queue('purge.derived') is null,
  'purge.derived is a dated window with no inner queue and is not a member of this class');

select throws_ok(
  $$select * from public.rediscover_row_window_jobs(array['kpi.rollup'])$$,
  '55000', 'JOB_REDISCOVERY_QUEUE_UNRESOLVED',
  'a member the catalog cannot resolve fails loudly instead of sweeping past'
);

-- ---------------------------------------------------------------------------
-- Fixtures: one exhausted outer/inner pair per member, built the way the drainer leaves one.
-- ---------------------------------------------------------------------------

create temporary table r5f2_tuples (job text primary key, subject text, "window" text);

do $setup$
declare
  v_client uuid;
  v_event uuid := extensions.gen_random_uuid();
  v_notification uuid;
  v_analysis public.analysis_jobs;
  v_outcome public.outcome_refresh_jobs;
begin
  select client.id into v_client
  from public.clients as client
  where client.consumer_profile_id is not null
  order by client.id
  limit 1;

  insert into public.analysis_jobs (client_id, source_kind, source_id, trigger)
  values (v_client, 'enrollment', extensions.gen_random_uuid(), 'force_pull')
  returning * into v_analysis;
  insert into r5f2_tuples values ('analysis.run', v_analysis.subject, v_analysis."window");

  insert into public.outcome_refresh_jobs (bank_ref, change_id)
  values ('r5f2-bank', extensions.gen_random_uuid())
  returning * into v_outcome;
  insert into r5f2_tuples values ('outcomes.refresh_stats', v_outcome.subject, v_outcome."window");

  insert into public.monitoring_events (id, client_id, event_type, occurred_at)
  values (v_event, v_client, 'ACCALERT', pg_catalog.now());
  select alert.notification_id into v_notification
  from public.insert_crs_alert_notification(v_event) as alert;
  perform public.enqueue_background_job(
    'notifications.dispatch', 'client:' || v_client::text, 'notification:' || v_notification::text);
  insert into r5f2_tuples
  values ('notifications.dispatch', 'client:' || v_client::text, 'notification:' || v_notification::text);
end
$setup$;

select is((select pg_catalog.count(*) from r5f2_tuples), 3::bigint,
  'one outer tuple exists for every member of the class');

-- Exhaust every pair: outer `failed|3` with a completion two hours old, inner `failed|3`.
do $exhaust$
declare
  v_row record;
begin
  for v_row in select * from r5f2_tuples loop
    update public.background_jobs
    set status = 'failed', attempt_count = 3, error_code = 'handler_failed',
        completed_at = pg_catalog.now() - interval '2 hours', updated_at = pg_catalog.now()
    where job = v_row.job and subject = v_row.subject and "window" = v_row."window";

    execute pg_catalog.format(
      'update %s set status = ''failed'', attempt_count = 3, error_code = %L, updated_at = pg_catalog.now()
        where job = $1 and subject = $2 and "window" = $3',
      private.row_window_job_queue(v_row.job),
      case v_row.job when 'analysis.run' then 'pull_failed' else 'r5f2_probe' end)
    using v_row.job, v_row.subject, v_row."window";
  end loop;
end
$exhaust$;

select is(
  (select pg_catalog.count(*) from public.background_jobs as outer_row
   join r5f2_tuples as fixture
     on fixture.job = outer_row.job and fixture.subject = outer_row.subject
    and fixture."window" = outer_row."window"
   where outer_row.status = 'failed' and outer_row.attempt_count = 3),
  3::bigint,
  'every member starts terminally failed at three attempts'
);

-- The dead end: re-enqueueing the same identity returns the same dead row.
select is(
  (select replayed.status::text || '|' || replayed.attempt_count
   from r5f2_tuples as fixture,
        public.enqueue_background_job(fixture.job, fixture.subject, fixture."window") as replayed
   where fixture.job = 'analysis.run'),
  'failed|3',
  'conflict-ignore hands the exhausted tuple straight back, which is why a dated cadence cannot help'
);

-- ---------------------------------------------------------------------------
-- The sweep.
-- ---------------------------------------------------------------------------

create temporary table r5f2_swept as
select * from public.rediscover_row_window_jobs(
  array['analysis.run', 'outcomes.refresh_stats', 'notifications.dispatch']);

select set_eq(
  $$select job from r5f2_swept$$,
  $$select job from r5f2_tuples$$,
  'every member of the class is rediscovered, including the one no reviewer reported'
);

select is(
  (select pg_catalog.count(*) from r5f2_swept where rediscovery_count <> 1),
  0::bigint,
  'each rediscovered tuple records exactly one cycle'
);

select is(
  (select pg_catalog.count(*) from public.background_jobs as outer_row
   join r5f2_tuples as fixture
     on fixture.job = outer_row.job and fixture.subject = outer_row.subject
    and fixture."window" = outer_row."window"
   where outer_row.status = 'queued' and outer_row.attempt_count = 0
     and outer_row.completed_at is null and outer_row.error_code is null),
  3::bigint,
  'every outer tuple is re-armed with a fresh attempt budget'
);

do $inner$
declare
  v_row record;
  v_status text;
  v_open integer := 0;
begin
  for v_row in select * from r5f2_tuples loop
    execute pg_catalog.format(
      'select status::text || ''|'' || attempt_count from %s
        where job = $1 and subject = $2 and "window" = $3',
      private.row_window_job_queue(v_row.job))
    into v_status using v_row.job, v_row.subject, v_row."window";
    if v_status = 'queued|0' then v_open := v_open + 1; end if;
  end loop;
  create temporary table r5f2_inner as select v_open as reopened;
end
$inner$;

select is((select reopened from r5f2_inner), 3,
  'the bridged inner row is re-armed with its outer tuple, or the handler would skip the work');

-- A tuple the sweep just re-armed is live, and a second pass must not touch it again.
select is(
  (select pg_catalog.count(*) from public.rediscover_row_window_jobs(
     array['analysis.run', 'outcomes.refresh_stats', 'notifications.dispatch'])),
  0::bigint,
  'a currently-runnable tuple is never re-armed a second time'
);

-- ---------------------------------------------------------------------------
-- Backoff, and the obligation that has genuinely gone away.
-- ---------------------------------------------------------------------------

do $again$
declare
  v_row r5f2_tuples;
begin
  select * into v_row from r5f2_tuples where job = 'analysis.run';
  update public.background_jobs
  set status = 'failed', attempt_count = 3, error_code = 'handler_failed',
      completed_at = pg_catalog.now(), updated_at = pg_catalog.now()
  where job = v_row.job and subject = v_row.subject and "window" = v_row."window";
end
$again$;

select is(
  (select pg_catalog.count(*) from public.rediscover_row_window_jobs(array['analysis.run'])),
  0::bigint,
  'a tuple that failed a moment ago waits out its backoff rather than hot-looping'
);

select is(
  (select pg_catalog.count(*) from public.rediscover_row_window_jobs(
     array['analysis.run'], pg_catalog.now() + interval '31 minutes')),
  1::bigint,
  'the second cycle opens at thirty minutes, twice the first wait'
);

do $discharged$
declare
  v_row r5f2_tuples;
begin
  select * into v_row from r5f2_tuples where job = 'outcomes.refresh_stats';
  update public.background_jobs
  set status = 'failed', attempt_count = 3, error_code = 'handler_failed',
      completed_at = pg_catalog.now() - interval '2 hours', updated_at = pg_catalog.now()
  where job = v_row.job and subject = v_row.subject and "window" = v_row."window";
  update public.outcome_refresh_jobs
  set status = 'succeeded', error_code = null, updated_at = pg_catalog.now()
  where job = v_row.job and subject = v_row.subject and "window" = v_row."window";
end
$discharged$;

select is(
  (select pg_catalog.count(*) from public.rediscover_row_window_jobs(array['outcomes.refresh_stats'])),
  0::bigint,
  'an obligation the domain already discharged is not re-armed'
);

select is(
  (select outer_row.status::text || '|' || outer_row.rediscovery_count
   from public.background_jobs as outer_row, r5f2_tuples as fixture
   where fixture.job = 'outcomes.refresh_stats' and outer_row.job = fixture.job
     and outer_row.subject = fixture.subject and outer_row."window" = fixture."window"),
  'failed|2',
  'a discharged obligation keeps its failure record and its backoff still grows'
);

-- ---------------------------------------------------------------------------
-- Shape and reach.
-- ---------------------------------------------------------------------------

select is(
  pg_catalog.pg_get_function_result(
    'public.rediscover_row_window_jobs(text[],timestamptz,integer)'::regprocedure),
  'TABLE(job text, subject text, "window" text, rediscovery_count integer)',
  'the sweep returns tuple metadata and nothing a job carries'
);

select ok(
  pg_catalog.has_function_privilege('service_role',
    'public.rediscover_row_window_jobs(text[],timestamptz,integer)'::regprocedure, 'execute'),
  'the tick can call the sweep'
);

select ok(
  not pg_catalog.has_function_privilege('authenticated',
    'public.rediscover_row_window_jobs(text[],timestamptz,integer)'::regprocedure, 'execute'),
  'no session-scoped role can re-arm a job'
);

select * from finish();
rollback;
