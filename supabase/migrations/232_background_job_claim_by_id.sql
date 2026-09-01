-- 232: targeted claim for run-now.
--
-- Phase 14 shipped run-now as "enqueue the tuple, then drain one row". The
-- drain is FIFO over the whole queue, so whenever anything else is already
-- queued (a cadence tick, another operator's accrual, an analysis run) the
-- admin's run-now executes and reports on that older job while its own tuple
-- stays queued. The flags-ON E2E sweep of 2026-08-17 hit exactly this: three
-- suites enqueue concurrently and every run-now drained a neighbour's job.
--
-- This RPC claims one specific queued job by id under the same lease and audit
-- discipline as claim_background_jobs. It ignores available_at on purpose —
-- "run now" means now, retry backoff included — and returns zero rows when the
-- job is not queued (running, succeeded, skipped, failed), leaving the caller
-- to report "not run" instead of running something else.

begin;

create or replace function public.claim_background_job(
  p_job_id uuid,
  p_worker_id text,
  p_lease_seconds integer default 60
)
returns setof public.background_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.background_jobs;
  v_after public.background_jobs;
begin
  if p_job_id is null
    or p_worker_id is null
    or char_length(p_worker_id) not between 1 and 64
    or p_lease_seconds is null
    or p_lease_seconds not between 5 and 300
  then
    raise exception using errcode = '22023', message = 'invalid background job lease';
  end if;

  select candidate.* into v_before
  from public.background_jobs as candidate
  where candidate.id = p_job_id
    and candidate.status = 'queued'
  for update skip locked;

  if not found then
    return;
  end if;

  update public.background_jobs
  set
    status = 'running',
    attempt_count = attempt_count + 1,
    lease_owner = p_worker_id,
    lease_until = pg_catalog.now() + pg_catalog.make_interval(secs => p_lease_seconds),
    error_code = null,
    rows_processed = null,
    updated_at = pg_catalog.now(),
    completed_at = null
  where id = v_before.id
  returning * into strict v_after;

  perform private.audit_background_job_transition(v_after, v_before.status::text, 'running');
  return next v_after;
end;
$$;

revoke all on function public.claim_background_job(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.claim_background_job(uuid, text, integer) to service_role;

commit;
