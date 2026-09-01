-- R1C-15/R1D-02: a claimed analysis job cannot requeue after authorization is withdrawn.

create or replace function public.claim_analysis_job(
  p_analysis_run_id uuid,
  p_client_id uuid,
  p_worker_id uuid,
  p_lease_seconds integer
)
returns setof public.analysis_jobs
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_before public.analysis_jobs;
  v_after public.analysis_jobs;
  v_next_status public.analysis_job_status;
begin
  if p_analysis_run_id is null or p_client_id is null or p_worker_id is null
    or p_lease_seconds is null or p_lease_seconds < 5 or p_lease_seconds > 300 then
    raise exception using errcode = 'P0001', message = 'ANALYSIS_LEASE_INVALID';
  end if;

  select job_row.* into v_before
  from public.analysis_jobs as job_row
  where job_row.analysis_run_id = p_analysis_run_id
    and job_row.client_id = p_client_id
  for update;

  if not found then return; end if;

  if v_before.status in ('succeeded', 'failed', 'cancelled')
    or v_before.available_at > pg_catalog.now()
    or (
      v_before.status in ('running', 'persisted')
      and v_before.lease_until > pg_catalog.now()
    ) then
    return next v_before;
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
      lease_until = pg_catalog.now() + pg_catalog.make_interval(secs => p_lease_seconds),
      error_code = null,
      updated_at = pg_catalog.now()
  where id = v_before.id
  returning * into strict v_after;

  if v_before.status <> v_after.status then
    perform private.audit_analysis_job_transition(v_after, v_before.status::text, v_after.status::text);
  end if;
  return next v_after;
end
$fn$;

create or replace function public.fail_analysis_job(
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
as $fn$
declare
  v_before public.analysis_jobs;
  v_after public.analysis_jobs;
  v_next_status public.analysis_job_status;
begin
  if p_worker_id is null or p_error_code is null or p_retry is null
    or p_retry_after_seconds is null or p_retry_after_seconds < 0
    or p_retry_after_seconds > 3600 then
    raise exception using errcode = 'P0001', message = 'ANALYSIS_RETRY_INVALID';
  end if;

  select job_row.* into strict v_before
  from public.analysis_jobs as job_row
  where job_row.id = p_job_id
  for update;

  if v_before.status not in ('running', 'persisted')
    or v_before.lease_owner is distinct from p_worker_id
    or v_before.lease_until is null
    or v_before.lease_until <= pg_catalog.now() then
    raise exception using errcode = 'P0001', message = 'ANALYSIS_LEASE_MISMATCH';
  end if;

  v_next_status := case
    when not private.analysis_authorized(v_before.client_id) then 'cancelled'::public.analysis_job_status
    when not p_retry then 'failed'::public.analysis_job_status
    when v_before.status = 'persisted' then 'persisted'::public.analysis_job_status
    else 'queued'::public.analysis_job_status
  end;

  update public.analysis_jobs
  set status = v_next_status,
      available_at = case
        when p_retry and v_next_status <> 'cancelled' then pg_catalog.now() + pg_catalog.make_interval(secs => p_retry_after_seconds)
        else available_at
      end,
      lease_owner = null,
      lease_until = null,
      error_code = case when v_next_status = 'cancelled' then null else p_error_code end,
      updated_at = pg_catalog.now()
  where id = v_before.id
  returning * into strict v_after;

  if v_before.status <> v_after.status then
    perform private.audit_analysis_job_transition(v_after, v_before.status::text, v_after.status::text);
  end if;
  return next v_after;
exception
  when no_data_found then
    raise exception using errcode = 'P0001', message = 'ANALYSIS_JOB_NOT_FOUND';
end;
$fn$;

revoke all on function public.claim_analysis_job(uuid,uuid,uuid,integer) from public, anon, authenticated;
revoke all on function public.fail_analysis_job(uuid,uuid,public.analysis_job_error_code,boolean,integer) from public, anon, authenticated;
grant execute on function public.claim_analysis_job(uuid,uuid,uuid,integer) to service_role;
grant execute on function public.fail_analysis_job(uuid,uuid,public.analysis_job_error_code,boolean,integer) to service_role;
