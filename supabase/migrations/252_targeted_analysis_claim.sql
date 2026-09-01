-- R1C-05: bind an analysis.run background tuple to its exact inner analysis job.

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
  if p_analysis_run_id is null
    or p_client_id is null
    or p_worker_id is null
    or p_lease_seconds is null
    or p_lease_seconds < 5
    or p_lease_seconds > 300 then
    raise exception using errcode = 'P0001', message = 'ANALYSIS_LEASE_INVALID';
  end if;

  select job_row.* into v_before
  from public.analysis_jobs as job_row
  where job_row.analysis_run_id = p_analysis_run_id
    and job_row.client_id = p_client_id
  for update;

  if not found then return; end if;

  if v_before.status in ('succeeded', 'failed')
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
    perform private.audit_analysis_job_transition(
      v_after,
      v_before.status::text,
      v_after.status::text
    );
  end if;

  return next v_after;
end
$fn$;

revoke all on function public.claim_analysis_job(uuid, uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.claim_analysis_job(uuid, uuid, uuid, integer)
  to service_role;
