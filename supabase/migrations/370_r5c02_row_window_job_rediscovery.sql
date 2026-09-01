-- R5C-02 / R5C-03 / R5D-01 — one rediscovery mechanism for every on-demand job whose
-- window is a row identity.
--
-- Migration 357 gave `purge.derived` a rediscovery path by minting a fresh UTC-date window
-- every tick. That works only because its window is a date. `analysis.run`, `outcomes.
-- refresh_stats` and `notifications.dispatch` carry a row id in the window, so there is no
-- second window to mint: `enqueue_background_job`'s `on conflict do nothing` reads the same
-- dead tuple back forever and the obligation dies with the tuple's third attempt. Round 4
-- fixed the one instance the reviewer reported; the catalog already named the siblings.
--
-- So this is deliberately not three cadence providers. It is one sweep, and the set it works
-- on is derived from the catalog rather than listed here:
--
--   * an inner queue is any `public` table carrying the ten columns the bridged queue shape
--     uses (`job`, `subject`, `window`, `status`, `attempt_count`, `available_at`,
--     `lease_owner`, `lease_until`, `error_code`, `updated_at`) whose `job` column pins one
--     job name as its default — today `analysis_jobs`, `outcome_refresh_jobs` and
--     `notification_delivery_outbox`, tomorrow whatever else is built to that shape;
--   * the outer `background_jobs` row and the inner row are re-armed together, because
--     re-arming only the outer one hands the handler an inner row its claim function will
--     not take and the drain completes as `skipped` with the work still owed.
--
-- Re-arming is a write, and a cadence provider that writes is a departure from 357's rule
-- that `enqueue_background_job` is the sole writer. For a row-id window it is the only move
-- available: the tuple identity is fixed by the row, so rediscovery is necessarily "make this
-- tuple runnable again" rather than "insert the next one". `enqueue_background_job` remains
-- the only *inserter*; nothing here creates a tuple.
--
-- The tuple stays bounded and the obligation does not. Each re-arm restores the three-attempt
-- budget and increments `rediscovery_count`, and the wait before the next examination doubles
-- off fifteen minutes up to a twenty-four hour ceiling, so a chronically failing obligation
-- quiesces to one attempt a day instead of being abandoned or hot-looping.

begin;

alter table public.background_jobs
  add column if not exists rediscovery_count integer not null default 0;

alter table public.background_jobs
  drop constraint if exists background_jobs_rediscovery_nonnegative;
alter table public.background_jobs
  add constraint background_jobs_rediscovery_nonnegative check (rediscovery_count >= 0);

create index if not exists background_jobs_rediscovery_idx
  on public.background_jobs (job, completed_at)
  where status = 'failed';

comment on column public.background_jobs.rediscovery_count is
  'How many times a row-id-window tuple has been examined for rediscovery (R5C-02). Drives the backoff; never bounds the obligation.';

-- ---------------------------------------------------------------------------
-- The status vocabulary shared by every bridged inner queue.
--
-- These two functions are the one place a queue status is classified. They are asserted
-- exhaustive against `pg_enum` in the pgTAP file, so a future queue whose status type carries
-- a literal neither set names fails the test rather than being silently treated as terminal.
-- ---------------------------------------------------------------------------

create or replace function private.row_window_queue_open_statuses()
returns text[]
language sql
immutable
as $fn$ select array['queued', 'running', 'persisted']::text[]; $fn$;

create or replace function private.row_window_queue_terminal_statuses()
returns text[]
language sql
immutable
as $fn$ select array['succeeded', 'failed', 'delivered', 'cancelled', 'skipped']::text[]; $fn$;

-- The ten columns that make a table a bridged inner queue. Kept as a function so the sweep
-- and the pgTAP catalog assertion read the same definition.
create or replace function private.row_window_queue_columns()
returns text[]
language sql
immutable
as $fn$
  select array[
    'job', 'subject', 'window', 'status', 'attempt_count',
    'available_at', 'lease_owner', 'lease_until', 'error_code', 'updated_at'
  ]::text[];
$fn$;

-- ---------------------------------------------------------------------------
-- Catalog-derived resolution: which table holds this job's durable inner rows.
-- ---------------------------------------------------------------------------

-- Every bridged inner queue the catalog knows about, with the job name its `job` default pins.
-- Nothing is listed: a table built to this shape joins the set, and the pgTAP file asserts
-- the mechanism's properties over whatever this returns rather than over three names.
create or replace function private.row_window_job_queues()
returns table (queue regclass, job text)
language sql
stable
security definer
set search_path = ''
as $fn$
  select cls.oid::regclass,
         pg_catalog.btrim(
           pg_catalog.left(pg_catalog.pg_get_expr(def.adbin, def.adrelid), -6), '''')
  from pg_catalog.pg_class as cls
  join pg_catalog.pg_namespace as nsp on nsp.oid = cls.relnamespace
  join pg_catalog.pg_attribute as att
    on att.attrelid = cls.oid and att.attname = 'job' and not att.attisdropped
  join pg_catalog.pg_attrdef as def
    on def.adrelid = att.attrelid and def.adnum = att.attnum
  where cls.relkind = 'r'
    and nsp.nspname = 'public'
    and cls.oid <> 'public.background_jobs'::regclass
    and pg_catalog.pg_get_expr(def.adbin, def.adrelid) like '''%''::text'
    and (
      select pg_catalog.count(*)
      from pg_catalog.pg_attribute as shape
      where shape.attrelid = cls.oid
        and shape.attnum > 0
        and not shape.attisdropped
        and shape.attname = any (private.row_window_queue_columns())
    ) = pg_catalog.cardinality(private.row_window_queue_columns());
$fn$;

create or replace function private.row_window_job_queue(p_job text)
returns regclass
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_tables regclass[];
begin
  select pg_catalog.array_agg(entry.queue order by entry.queue::text)
  into v_tables
  from private.row_window_job_queues() as entry
  where entry.job = p_job;

  if v_tables is null then
    return null;
  end if;
  if pg_catalog.cardinality(v_tables) > 1 then
    raise exception using errcode = '55000',
      message = 'JOB_REDISCOVERY_QUEUE_AMBIGUOUS';
  end if;
  return v_tables[1];
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Re-arm one inner row. Returns true when the obligation is outstanding and the domain side
-- is now claimable — which is exactly the condition for re-arming the outer tuple.
-- ---------------------------------------------------------------------------

create or replace function private.revive_row_window_queue_row(
  p_job text,
  p_subject text,
  p_window text,
  p_now timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_table regclass := private.row_window_job_queue(p_job);
  v_status text;
begin
  if v_table is null then
    raise exception using errcode = '55000',
      message = 'JOB_REDISCOVERY_QUEUE_UNRESOLVED';
  end if;

  execute pg_catalog.format(
    'select row_value.status::text from %s as row_value
      where row_value.job = $1 and row_value.subject = $2 and row_value."window" = $3
      for update', v_table)
  into v_status
  using p_job, p_subject, p_window;

  if v_status is null then
    -- No durable inner row: the obligation was discharged or never existed on this side.
    return false;
  end if;

  if v_status = 'failed' then
    execute pg_catalog.format(
      'update %s as row_value
          set status = ''queued'', attempt_count = 0, available_at = $4,
              lease_owner = null, lease_until = null, error_code = null, updated_at = $4
        where row_value.job = $1 and row_value.subject = $2 and row_value."window" = $3',
      v_table)
    using p_job, p_subject, p_window, p_now;
    return true;
  end if;

  -- Already open on the domain side (queued, leased, or mid-persist): the outer tuple is the
  -- only thing standing between the obligation and a worker.
  return v_status = any (private.row_window_queue_open_statuses());
end;
$fn$;

-- ---------------------------------------------------------------------------
-- The sweep. Metadata in, metadata out: it returns the tuples it re-armed so the caller can
-- account for them, and it never invents one.
-- ---------------------------------------------------------------------------

create or replace function private.row_window_rediscovery_delay(p_count integer)
returns interval
language sql
immutable
as $fn$
  select least(
    interval '24 hours',
    interval '15 minutes' * pg_catalog.power(2::double precision, least(greatest(coalesce(p_count, 0), 0), 10))
  );
$fn$;

create or replace function public.rediscover_row_window_jobs(
  p_jobs text[],
  p_now timestamptz default pg_catalog.now(),
  p_limit integer default 200
)
returns table (job text, subject text, "window" text, rediscovery_count integer)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_job text;
  v_row public.background_jobs;
  v_revived boolean;
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 1000);
  v_now timestamptz := coalesce(p_now, pg_catalog.now());
begin
  if p_jobs is null or pg_catalog.cardinality(p_jobs) = 0 then
    return;
  end if;

  -- Fail loudly on a member the catalog cannot resolve, rather than sweeping past it. A new
  -- on-demand row-id-window job built without an inner queue is a wiring error, not a no-op.
  foreach v_job in array p_jobs loop
    if private.row_window_job_queue(v_job) is null then
      raise exception using errcode = '55000',
        message = 'JOB_REDISCOVERY_QUEUE_UNRESOLVED';
    end if;
  end loop;

  for v_row in
    select candidate.*
    from public.background_jobs as candidate
    where candidate.job = any (p_jobs)
      and candidate.status = 'failed'
      and candidate.completed_at is not null
      and candidate.completed_at
        + private.row_window_rediscovery_delay(candidate.rediscovery_count) <= v_now
    order by candidate.completed_at, candidate.id
    for update skip locked
    limit v_limit
  loop
    v_revived := private.revive_row_window_queue_row(
      v_row.job, v_row.subject, v_row."window", v_now);

    if v_revived then
      update public.background_jobs as dead
      set status = 'queued',
          attempt_count = 0,
          available_at = v_now,
          lease_owner = null,
          lease_until = null,
          error_code = null,
          rows_processed = null,
          completed_at = null,
          rediscovery_count = dead.rediscovery_count + 1,
          updated_at = v_now
      where dead.id = v_row.id
      returning * into v_row;

      perform private.audit_background_job_transition(v_row, 'failed', 'queued');

      job := v_row.job;
      subject := v_row.subject;
      "window" := v_row."window";
      rediscovery_count := v_row.rediscovery_count;
      return next;
    else
      -- The obligation is gone. Keep the failure record and let the backoff grow, so a dead
      -- row settles at one cheap re-check a day instead of being examined every tick.
      update public.background_jobs as dead
      set rediscovery_count = dead.rediscovery_count + 1,
          updated_at = v_now
      where dead.id = v_row.id;
    end if;
  end loop;
end;
$fn$;

revoke all on function private.row_window_queue_open_statuses()
  from public, anon, authenticated, service_role;
revoke all on function private.row_window_queue_terminal_statuses()
  from public, anon, authenticated, service_role;
revoke all on function private.row_window_queue_columns()
  from public, anon, authenticated, service_role;
revoke all on function private.row_window_job_queues()
  from public, anon, authenticated, service_role;
revoke all on function private.row_window_job_queue(text)
  from public, anon, authenticated, service_role;
revoke all on function private.revive_row_window_queue_row(text, text, text, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.row_window_rediscovery_delay(integer)
  from public, anon, authenticated, service_role;
revoke all on function public.rediscover_row_window_jobs(text[], timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.rediscover_row_window_jobs(text[], timestamptz, integer)
  to service_role;

comment on function public.rediscover_row_window_jobs(text[], timestamptz, integer) is
  'R5C-02: re-arms exhausted on-demand row-id-window tuples and their bridged inner rows. Bounds the tuple, never the obligation.';

commit;
