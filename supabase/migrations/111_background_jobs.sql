begin;

create type public.background_job_status as enum (
  'queued',
  'running',
  'succeeded',
  'skipped',
  'failed'
);

create table public.background_jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  job text not null,
  subject text not null,
  "window" text not null,
  idempotency_key text generated always as (
    job || '|' || subject || '|' || "window"
  ) stored,
  status public.background_job_status not null default 'queued',
  attempt_count integer not null default 0,
  available_at timestamptz not null default pg_catalog.now(),
  lease_owner text,
  lease_until timestamptz,
  error_code text,
  rows_processed integer,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  completed_at timestamptz,
  constraint background_jobs_job_valid check (job in (
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
    'kpi.rollup'
  )),
  constraint background_jobs_subject_nonblank check (
    char_length(subject) between 1 and 160 and subject = btrim(subject)
  ),
  constraint background_jobs_window_nonblank check (
    char_length("window") between 1 and 160 and "window" = btrim("window")
  ),
  constraint background_jobs_idempotency_length check (char_length(idempotency_key) <= 400),
  constraint background_jobs_tuple_unique unique (job, subject, "window"),
  constraint background_jobs_idempotency_unique unique (idempotency_key),
  constraint background_jobs_attempt_nonnegative check (attempt_count >= 0),
  constraint background_jobs_lease_shape check (
    (lease_owner is null and lease_until is null)
    or (
      lease_owner is not null
      and char_length(lease_owner) between 1 and 64
      and lease_until is not null
    )
  ),
  constraint background_jobs_error_code_short check (
    error_code is null or char_length(error_code) between 1 and 64
  ),
  constraint background_jobs_rows_nonnegative check (
    rows_processed is null or rows_processed between 0 and 1000000
  ),
  constraint background_jobs_terminal_shape check (
    (status in ('queued', 'running') and completed_at is null)
    or (status in ('succeeded', 'skipped', 'failed') and completed_at is not null)
  ),
  constraint background_jobs_failed_code check (status <> 'failed' or error_code is not null)
);

create index background_jobs_claim_idx
  on public.background_jobs(available_at, created_at, id)
  where status = 'queued';

create function private.audit_background_job_transition(
  p_job public.background_jobs,
  p_from_state text,
  p_to_state text
)
returns void
language sql
security definer
set search_path = ''
as $fn$
  insert into public.audit_log (
    action,
    subject_type,
    subject_id,
    meta
  ) values (
    'background_job.transition',
    'background_job',
    p_job.id,
    pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'job', p_job.job,
      'from_state', p_from_state,
      'to_state', p_to_state,
      'status', p_job.status::text,
      'count', p_job.rows_processed,
      'reason_code', p_job.error_code
    ))
  );
$fn$;

create function public.enqueue_background_job(
  p_job text,
  p_subject text,
  p_window text
)
returns setof public.background_jobs
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_job public.background_jobs;
  v_inserted boolean := false;
begin
  insert into public.background_jobs (job, subject, "window")
  values (p_job, p_subject, p_window)
  on conflict (job, subject, "window") do nothing
  returning * into v_job;

  if v_job.id is null then
    select row_value.* into strict v_job
    from public.background_jobs as row_value
    where row_value.job = p_job
      and row_value.subject = p_subject
      and row_value."window" = p_window;
  else
    v_inserted := true;
  end if;

  if v_inserted then
    perform private.audit_background_job_transition(v_job, 'absent', 'queued');
  end if;

  return next v_job;
end;
$fn$;

create function public.claim_background_jobs(
  p_worker_id text,
  p_max_jobs integer,
  p_lease_seconds integer default 60
)
returns setof public.background_jobs
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_before public.background_jobs;
  v_after public.background_jobs;
  v_limit integer;
begin
  if p_worker_id is null
    or char_length(p_worker_id) not between 1 and 64
    or p_max_jobs is null
    or p_max_jobs < 1
    or p_lease_seconds is null
    or p_lease_seconds not between 5 and 300
  then
    raise exception using errcode = '22023', message = 'invalid background job lease';
  end if;

  v_limit := least(p_max_jobs, 25);

  for v_before in
    select candidate.*
    from public.background_jobs as candidate
    where candidate.status = 'queued'
      and candidate.available_at <= pg_catalog.now()
    order by candidate.available_at, candidate.created_at, candidate.id
    for update skip locked
    limit v_limit
  loop
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
  end loop;
end;
$fn$;

create function public.complete_background_job(
  p_job_id uuid,
  p_worker_id text,
  p_status public.background_job_status,
  p_rows_processed integer default 0
)
returns setof public.background_jobs
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_job public.background_jobs;
begin
  if p_status not in ('succeeded', 'skipped')
    or p_rows_processed is null
    or p_rows_processed not between 0 and 1000000
  then
    raise exception using errcode = '22023', message = 'invalid background job completion';
  end if;

  update public.background_jobs as queued_job
  set
    status = p_status,
    lease_owner = null,
    lease_until = null,
    error_code = null,
    rows_processed = p_rows_processed,
    updated_at = pg_catalog.now(),
    completed_at = pg_catalog.now()
  where queued_job.id = p_job_id
    and queued_job.status = 'running'
    and queued_job.lease_owner = p_worker_id
    and queued_job.lease_until > pg_catalog.now()
  returning queued_job.* into v_job;

  if v_job.id is null then
    raise exception using errcode = '55000', message = 'background job lease mismatch';
  end if;

  perform private.audit_background_job_transition(v_job, 'running', p_status::text);
  return next v_job;
end;
$fn$;

create function public.fail_background_job(
  p_job_id uuid,
  p_worker_id text,
  p_error_code text,
  p_retry boolean,
  p_retry_after_seconds integer default 30
)
returns setof public.background_jobs
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_job public.background_jobs;
  v_next_status public.background_job_status;
begin
  if p_error_code is null
    or char_length(p_error_code) not between 1 and 64
    or p_retry is null
    or p_retry_after_seconds is null
    or p_retry_after_seconds not between 0 and 900
  then
    raise exception using errcode = '22023', message = 'invalid background job failure';
  end if;

  v_next_status := case when p_retry then 'queued' else 'failed' end;

  update public.background_jobs as queued_job
  set
    status = v_next_status,
    available_at = case
      when p_retry then pg_catalog.now() + pg_catalog.make_interval(secs => p_retry_after_seconds)
      else queued_job.available_at
    end,
    lease_owner = null,
    lease_until = null,
    error_code = p_error_code,
    rows_processed = null,
    updated_at = pg_catalog.now(),
    completed_at = case when p_retry then null else pg_catalog.now() end
  where queued_job.id = p_job_id
    and queued_job.status = 'running'
    and queued_job.lease_owner = p_worker_id
    and queued_job.lease_until > pg_catalog.now()
  returning queued_job.* into v_job;

  if v_job.id is null then
    raise exception using errcode = '55000', message = 'background job lease mismatch';
  end if;

  perform private.audit_background_job_transition(v_job, 'running', v_next_status::text);
  return next v_job;
end;
$fn$;

create function private.bridge_background_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  perform public.enqueue_background_job(new.job, new.subject, new."window");
  return null;
end;
$fn$;

create trigger analysis_jobs_bridge_background
after insert on public.analysis_jobs
for each row execute function private.bridge_background_job();

create trigger outcome_refresh_jobs_bridge_background
after insert on public.outcome_refresh_jobs
for each row execute function private.bridge_background_job();

insert into public.background_jobs (job, subject, "window", status)
select source.job, source.subject, source."window", 'queued'::public.background_job_status
from public.analysis_jobs as source
where source.status in ('queued', 'running', 'persisted')
on conflict (job, subject, "window") do nothing;

insert into public.background_jobs (job, subject, "window", status)
select source.job, source.subject, source."window", 'queued'::public.background_job_status
from public.outcome_refresh_jobs as source
where source.status in ('queued', 'running')
on conflict (job, subject, "window") do nothing;

alter table public.background_jobs enable row level security;
alter table public.background_jobs force row level security;
revoke all on table public.background_jobs from public, anon, authenticated;
grant all on table public.background_jobs to service_role;

revoke all on function private.audit_background_job_transition(public.background_jobs, text, text) from public;
revoke all on function private.bridge_background_job() from public;
revoke all on function public.enqueue_background_job(text, text, text) from public, anon, authenticated;
revoke all on function public.claim_background_jobs(text, integer, integer) from public, anon, authenticated;
revoke all on function public.complete_background_job(uuid, text, public.background_job_status, integer) from public, anon, authenticated;
revoke all on function public.fail_background_job(uuid, text, text, boolean, integer) from public, anon, authenticated;

grant execute on function public.enqueue_background_job(text, text, text) to service_role;
grant execute on function public.claim_background_jobs(text, integer, integer) to service_role;
grant execute on function public.complete_background_job(uuid, text, public.background_job_status, integer) to service_role;
grant execute on function public.fail_background_job(uuid, text, text, boolean, integer) to service_role;

comment on table public.background_jobs is
  'Shared metadata-only queue. Domain handlers remain in their owning modules.';

commit;
