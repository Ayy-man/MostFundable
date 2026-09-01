-- R2A-08: recheck authorization under the job lock before persisting or finishing analysis.

alter function public.persist_analysis_result(uuid, uuid, uuid, uuid, integer, jsonb, integer, jsonb)
  rename to persist_analysis_result_r2a08_base;
alter function public.persist_analysis_result_r2a08_base(uuid, uuid, uuid, uuid, integer, jsonb, integer, jsonb)
  set schema private;

create function public.persist_analysis_result(
  p_job_id uuid, p_worker_id uuid, p_client_id uuid, p_analysis_run_id uuid,
  p_readiness_score integer, p_derived jsonb, p_plan_version integer, p_plan_body jsonb
) returns setof public.analysis_jobs
language plpgsql security definer set search_path = '' as $fn$
declare v_job public.analysis_jobs; v_from text;
begin
  select * into strict v_job from public.analysis_jobs where id = p_job_id for update;
  if v_job.client_id <> p_client_id or v_job.analysis_run_id <> p_analysis_run_id
    or v_job.status not in ('running','persisted') or v_job.lease_owner is distinct from p_worker_id
    or v_job.lease_until is null or v_job.lease_until <= pg_catalog.now() then
    raise exception using errcode='P0001', message='ANALYSIS_LEASE_MISMATCH';
  end if;
  if not private.analysis_authorized(v_job.client_id) then
    v_from := v_job.status::text;
    delete from public.plans where analysis_run_id = v_job.analysis_run_id;
    delete from public.analysis_runs where id = v_job.analysis_run_id;
    update public.analysis_jobs set status='cancelled', lease_owner=null, lease_until=null,
      error_code=null, updated_at=pg_catalog.now() where id=v_job.id returning * into strict v_job;
    perform private.audit_analysis_job_transition(v_job, v_from, 'cancelled');
    return next v_job; return;
  end if;
  return query select * from private.persist_analysis_result_r2a08_base(
    p_job_id,p_worker_id,p_client_id,p_analysis_run_id,p_readiness_score,p_derived,p_plan_version,p_plan_body);
end
$fn$;

alter function public.finish_analysis_job(uuid, uuid)
  rename to finish_analysis_job_r2a08_base;
alter function public.finish_analysis_job_r2a08_base(uuid, uuid)
  set schema private;

create function public.finish_analysis_job(p_job_id uuid, p_worker_id uuid)
returns setof public.analysis_jobs
language plpgsql security definer set search_path = '' as $fn$
declare v_job public.analysis_jobs; v_from text;
begin
  select * into strict v_job from public.analysis_jobs where id=p_job_id for update;
  if v_job.status <> 'persisted' or v_job.lease_owner is distinct from p_worker_id
    or v_job.lease_until is null or v_job.lease_until <= pg_catalog.now() then
    raise exception using errcode='P0001', message='ANALYSIS_LEASE_MISMATCH';
  end if;
  if not private.analysis_authorized(v_job.client_id) then
    v_from := v_job.status::text;
    delete from public.plans where analysis_run_id=v_job.analysis_run_id;
    delete from public.analysis_runs where id=v_job.analysis_run_id;
    update public.analysis_jobs set status='cancelled', lease_owner=null, lease_until=null,
      error_code=null, updated_at=pg_catalog.now() where id=v_job.id returning * into strict v_job;
    perform private.audit_analysis_job_transition(v_job, v_from, 'cancelled');
    return next v_job; return;
  end if;
  return query select * from private.finish_analysis_job_r2a08_base(p_job_id,p_worker_id);
end
$fn$;

revoke all on function private.persist_analysis_result_r2a08_base(uuid,uuid,uuid,uuid,integer,jsonb,integer,jsonb) from public,anon,authenticated,service_role;
revoke all on function private.finish_analysis_job_r2a08_base(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.persist_analysis_result(uuid,uuid,uuid,uuid,integer,jsonb,integer,jsonb) from public,anon,authenticated;
revoke all on function public.finish_analysis_job(uuid,uuid) from public,anon,authenticated;
grant execute on function public.persist_analysis_result(uuid,uuid,uuid,uuid,integer,jsonb,integer,jsonb) to service_role;
grant execute on function public.finish_analysis_job(uuid,uuid) to service_role;
