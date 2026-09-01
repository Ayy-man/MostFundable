create type public.analysis_job_status as enum (
  'queued',
  'running',
  'persisted',
  'succeeded',
  'failed'
);

create type public.analysis_job_source_kind as enum (
  'enrollment',
  'monitoring_event'
);

create type public.analysis_job_error_code as enum (
  'source_unavailable',
  'pull_failed',
  'plan_rejected',
  'persistence_failed',
  'tracker_failed',
  'configuration_error'
);

create table public.analysis_jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  job text not null default 'analysis.run',
  client_id uuid not null references public.clients(id) on delete cascade,
  source_kind public.analysis_job_source_kind not null,
  source_id uuid not null,
  analysis_run_id uuid not null default extensions.gen_random_uuid(),
  trigger public.analysis_trigger not null,
  subject text generated always as ('client:'::text || client_id::text) stored,
  "window" text generated always as ('run:'::text || analysis_run_id::text) stored,
  idempotency_key text generated always as (
    job || '|'::text || 'client:'::text || client_id::text || '|'::text ||
    'run:'::text || analysis_run_id::text
  ) stored,
  status public.analysis_job_status not null default 'queued',
  attempt_count integer not null default 0,
  available_at timestamptz not null default now(),
  lease_owner uuid,
  lease_until timestamptz,
  error_code public.analysis_job_error_code,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint analysis_jobs_job_check check (job = 'analysis.run'),
  constraint analysis_jobs_attempt_count_check check (attempt_count >= 0),
  constraint analysis_jobs_lease_pair_check check (
    (lease_owner is null and lease_until is null)
    or (lease_owner is not null and lease_until is not null)
  ),
  constraint analysis_jobs_failed_error_check check (
    status <> 'failed' or error_code is not null
  ),
  constraint analysis_jobs_source_unique unique (job, subject, source_kind, source_id),
  constraint analysis_jobs_analysis_run_unique unique (analysis_run_id),
  constraint analysis_jobs_idempotency_unique unique (idempotency_key)
);

create index analysis_jobs_claim_idx
  on public.analysis_jobs(status, available_at, lease_until, created_at);
create index analysis_jobs_client_created_at_idx
  on public.analysis_jobs(client_id, created_at desc);
create index analysis_jobs_source_idx
  on public.analysis_jobs(source_kind, source_id);

alter table public.analysis_jobs enable row level security;
alter table public.analysis_jobs force row level security;

revoke all on table public.analysis_jobs from public, anon, authenticated;
grant all on table public.analysis_jobs to service_role;

create function private.audit_analysis_job_transition(
  p_job public.analysis_jobs,
  p_from_state text,
  p_to_state text
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_log (
    client_id,
    action,
    subject_type,
    subject_id,
    meta
  ) values (
    p_job.client_id,
    'analysis_job.transition',
    'analysis_job',
    p_job.id,
    jsonb_build_object(
      'job', p_job.job,
      'from_state', p_from_state,
      'to_state', p_to_state
    )
  );
$$;

create function public.enqueue_analysis_job(
  p_client_id uuid,
  p_source_kind public.analysis_job_source_kind,
  p_source_id uuid,
  p_trigger public.analysis_trigger
)
returns setof public.analysis_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.analysis_jobs;
  v_inserted boolean := false;
begin
  if p_source_kind = 'enrollment' then
    if p_trigger <> 'scheduled' or not exists (
      select 1
      from public.enrollments as enrollment
      where enrollment.id = p_source_id
        and enrollment.client_id = p_client_id
    ) then
      raise exception using errcode = 'P0001', message = 'ANALYSIS_SOURCE_INVALID';
    end if;
  elsif p_source_kind = 'monitoring_event' then
    if p_trigger <> 'alert' or not exists (
      select 1
      from public.monitoring_events as event
      where event.id = p_source_id
        and event.client_id = p_client_id
    ) then
      raise exception using errcode = 'P0001', message = 'ANALYSIS_SOURCE_INVALID';
    end if;
  else
    raise exception using errcode = 'P0001', message = 'ANALYSIS_SOURCE_INVALID';
  end if;

  insert into public.analysis_jobs (
    client_id,
    source_kind,
    source_id,
    trigger
  ) values (
    p_client_id,
    p_source_kind,
    p_source_id,
    p_trigger
  )
  on conflict on constraint analysis_jobs_source_unique do nothing
  returning * into v_job;

  if v_job.id is not null then
    v_inserted := true;
  else
    select job_row.*
    into strict v_job
    from public.analysis_jobs as job_row
    where job_row.job = 'analysis.run'
      and job_row.subject = 'client:'::text || p_client_id::text
      and job_row.source_kind = p_source_kind
      and job_row.source_id = p_source_id;
  end if;

  if v_inserted then
    perform private.audit_analysis_job_transition(v_job, 'absent', 'queued');
  end if;

  return next v_job;
end;
$$;

create function public.claim_analysis_job(
  p_worker_id uuid,
  p_lease_seconds integer
)
returns setof public.analysis_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.analysis_jobs;
  v_after public.analysis_jobs;
  v_next_status public.analysis_job_status;
begin
  if p_worker_id is null
    or p_lease_seconds is null
    or p_lease_seconds < 5
    or p_lease_seconds > 300 then
    raise exception using errcode = 'P0001', message = 'ANALYSIS_LEASE_INVALID';
  end if;

  select job_row.*
  into v_before
  from public.analysis_jobs as job_row
  where job_row.available_at <= now()
    and (
      job_row.status = 'queued'
      or (
        job_row.status in ('running', 'persisted')
        and (job_row.lease_until is null or job_row.lease_until <= now())
      )
    )
  order by job_row.available_at, job_row.created_at, job_row.id
  for update skip locked
  limit 1;

  if v_before.id is null then
    return;
  end if;

  v_next_status := case
    when v_before.status = 'persisted' then 'persisted'::public.analysis_job_status
    else 'running'::public.analysis_job_status
  end;

  update public.analysis_jobs
  set status = v_next_status,
      attempt_count = attempt_count + 1,
      lease_owner = p_worker_id,
      lease_until = now() + make_interval(secs => p_lease_seconds),
      error_code = null,
      updated_at = now()
  where id = v_before.id
  returning * into strict v_after;

  if v_before.status <> v_after.status then
    perform private.audit_analysis_job_transition(
      v_after,
      v_before.status::text,
      v_after.status::text
    );
  end if;

  return next v_after;
end;
$$;

create function public.persist_analysis_result(
  p_job_id uuid,
  p_worker_id uuid,
  p_client_id uuid,
  p_analysis_run_id uuid,
  p_readiness_score integer,
  p_derived jsonb,
  p_plan_version integer,
  p_plan_body jsonb
)
returns setof public.analysis_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.analysis_jobs;
  v_after public.analysis_jobs;
  v_run public.analysis_runs;
  v_plan public.plans;
  v_is_no_hit boolean;
begin
  select job_row.*
  into strict v_before
  from public.analysis_jobs as job_row
  where job_row.id = p_job_id
  for update;

  if v_before.client_id <> p_client_id
    or v_before.analysis_run_id <> p_analysis_run_id
    or v_before.status not in ('running', 'persisted')
    or v_before.lease_owner is distinct from p_worker_id
    or v_before.lease_until is null
    or v_before.lease_until <= now() then
    raise exception using errcode = 'P0001', message = 'ANALYSIS_LEASE_MISMATCH';
  end if;

  if not private.derived_features_valid(p_derived)
    or p_readiness_score < 0
    or p_readiness_score > 100 then
    raise exception using errcode = 'P0001', message = 'ANALYSIS_RESULT_INVALID';
  end if;

  v_is_no_hit :=
    jsonb_array_length(p_derived -> 'bureausPulled') = 0
    and jsonb_array_length(p_derived -> 'accounts') = 0;

  if (p_plan_version is null) <> (p_plan_body is null) then
    raise exception using errcode = 'P0001', message = 'ANALYSIS_RESULT_INVALID';
  end if;

  if p_plan_body is null then
    if not v_is_no_hit or p_readiness_score <> 0 then
      raise exception using errcode = 'P0001', message = 'ANALYSIS_RESULT_INVALID';
    end if;
  elsif p_plan_version < 1
    or jsonb_typeof(p_plan_body) <> 'object'
    or p_plan_body ->> 'readinessScore' is distinct from p_readiness_score::text then
    raise exception using errcode = 'P0001', message = 'ANALYSIS_RESULT_INVALID';
  end if;

  insert into public.analysis_runs (
    id,
    client_id,
    trigger,
    readiness_score,
    derived
  ) values (
    p_analysis_run_id,
    p_client_id,
    v_before.trigger,
    p_readiness_score,
    p_derived
  )
  on conflict (id) do nothing;

  select run_row.*
  into strict v_run
  from public.analysis_runs as run_row
  where run_row.id = p_analysis_run_id;

  if v_run.client_id <> p_client_id
    or v_run.trigger <> v_before.trigger
    or v_run.readiness_score <> p_readiness_score
    or v_run.derived <> p_derived then
    raise exception using errcode = 'P0001', message = 'ANALYSIS_RESULT_MISMATCH';
  end if;

  if p_plan_body is not null then
    insert into public.plans (
      id,
      client_id,
      analysis_run_id,
      version,
      body,
      readiness_score
    ) values (
      p_analysis_run_id,
      p_client_id,
      p_analysis_run_id,
      p_plan_version,
      p_plan_body,
      p_readiness_score
    )
    on conflict (analysis_run_id) do nothing;

    select plan_row.*
    into strict v_plan
    from public.plans as plan_row
    where plan_row.analysis_run_id = p_analysis_run_id;

    if v_plan.id <> p_analysis_run_id
      or v_plan.client_id <> p_client_id
      or v_plan.version <> p_plan_version
      or v_plan.body <> p_plan_body
      or v_plan.readiness_score <> p_readiness_score then
      raise exception using errcode = 'P0001', message = 'ANALYSIS_RESULT_MISMATCH';
    end if;
  elsif exists (
    select 1
    from public.plans as plan_row
    where plan_row.analysis_run_id = p_analysis_run_id
  ) then
    raise exception using errcode = 'P0001', message = 'ANALYSIS_RESULT_MISMATCH';
  end if;

  if v_before.status = 'running' then
    update public.analysis_jobs
    set status = 'persisted',
        error_code = null,
        updated_at = now()
    where id = v_before.id
    returning * into strict v_after;

    perform private.audit_analysis_job_transition(v_after, 'running', 'persisted');
  else
    v_after := v_before;
  end if;

  return next v_after;
exception
  when no_data_found then
    raise exception using errcode = 'P0001', message = 'ANALYSIS_JOB_NOT_FOUND';
end;
$$;

create function public.finish_analysis_job(
  p_job_id uuid,
  p_worker_id uuid
)
returns setof public.analysis_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.analysis_jobs;
  v_after public.analysis_jobs;
begin
  select job_row.*
  into strict v_before
  from public.analysis_jobs as job_row
  where job_row.id = p_job_id
  for update;

  if v_before.status <> 'persisted'
    or v_before.lease_owner is distinct from p_worker_id
    or v_before.lease_until is null
    or v_before.lease_until <= now() then
    raise exception using errcode = 'P0001', message = 'ANALYSIS_LEASE_MISMATCH';
  end if;

  update public.analysis_jobs
  set status = 'succeeded',
      lease_owner = null,
      lease_until = null,
      error_code = null,
      updated_at = now()
  where id = v_before.id
  returning * into strict v_after;

  perform private.audit_analysis_job_transition(v_after, 'persisted', 'succeeded');
  return next v_after;
exception
  when no_data_found then
    raise exception using errcode = 'P0001', message = 'ANALYSIS_JOB_NOT_FOUND';
end;
$$;

create function public.fail_analysis_job(
  p_job_id uuid,
  p_worker_id uuid,
  p_error_code public.analysis_job_error_code,
  p_retry boolean,
  p_retry_after_seconds integer
)
returns setof public.analysis_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.analysis_jobs;
  v_after public.analysis_jobs;
  v_next_status public.analysis_job_status;
begin
  if p_worker_id is null
    or p_error_code is null
    or p_retry is null
    or p_retry_after_seconds is null
    or p_retry_after_seconds < 0
    or p_retry_after_seconds > 3600 then
    raise exception using errcode = 'P0001', message = 'ANALYSIS_RETRY_INVALID';
  end if;

  select job_row.*
  into strict v_before
  from public.analysis_jobs as job_row
  where job_row.id = p_job_id
  for update;

  if v_before.status not in ('running', 'persisted')
    or v_before.lease_owner is distinct from p_worker_id
    or v_before.lease_until is null
    or v_before.lease_until <= now() then
    raise exception using errcode = 'P0001', message = 'ANALYSIS_LEASE_MISMATCH';
  end if;

  v_next_status := case
    when not p_retry then 'failed'::public.analysis_job_status
    when v_before.status = 'persisted' then 'persisted'::public.analysis_job_status
    else 'queued'::public.analysis_job_status
  end;

  update public.analysis_jobs
  set status = v_next_status,
      available_at = case
        when p_retry then now() + make_interval(secs => p_retry_after_seconds)
        else available_at
      end,
      lease_owner = null,
      lease_until = null,
      error_code = p_error_code,
      updated_at = now()
  where id = v_before.id
  returning * into strict v_after;

  if v_before.status <> v_after.status then
    perform private.audit_analysis_job_transition(
      v_after,
      v_before.status::text,
      v_after.status::text
    );
  end if;

  return next v_after;
exception
  when no_data_found then
    raise exception using errcode = 'P0001', message = 'ANALYSIS_JOB_NOT_FOUND';
end;
$$;

revoke all on function private.audit_analysis_job_transition(
  public.analysis_jobs,
  text,
  text
) from public;
revoke all on function public.enqueue_analysis_job(
  uuid,
  public.analysis_job_source_kind,
  uuid,
  public.analysis_trigger
) from public, anon, authenticated;
revoke all on function public.claim_analysis_job(uuid, integer)
  from public, anon, authenticated;
revoke all on function public.persist_analysis_result(
  uuid,
  uuid,
  uuid,
  uuid,
  integer,
  jsonb,
  integer,
  jsonb
) from public, anon, authenticated;
revoke all on function public.finish_analysis_job(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.fail_analysis_job(
  uuid,
  uuid,
  public.analysis_job_error_code,
  boolean,
  integer
) from public, anon, authenticated;

grant execute on function public.enqueue_analysis_job(
  uuid,
  public.analysis_job_source_kind,
  uuid,
  public.analysis_trigger
) to service_role;
grant execute on function public.claim_analysis_job(uuid, integer) to service_role;
grant execute on function public.persist_analysis_result(
  uuid,
  uuid,
  uuid,
  uuid,
  integer,
  jsonb,
  integer,
  jsonb
) to service_role;
grant execute on function public.finish_analysis_job(uuid, uuid) to service_role;
grant execute on function public.fail_analysis_job(
  uuid,
  uuid,
  public.analysis_job_error_code,
  boolean,
  integer
) to service_role;
