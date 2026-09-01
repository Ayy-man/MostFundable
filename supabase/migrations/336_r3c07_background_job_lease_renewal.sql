-- R3C-07: renew owner-bound leases and count attempts only when execution starts.

alter table public.background_jobs add column if not exists execution_started_at timestamptz;

create or replace function public.claim_background_jobs(
  p_worker_id text, p_max_jobs integer, p_lease_seconds integer, p_allowed_jobs text[]
) returns setof public.background_jobs
language plpgsql security definer set search_path = '' as $fn$
declare v_before public.background_jobs; v_after public.background_jobs; v_limit integer;
begin
  if p_worker_id is null or pg_catalog.char_length(p_worker_id) not between 1 and 64
    or p_max_jobs is null or p_max_jobs < 1 or p_lease_seconds is null or p_lease_seconds not between 5 and 300
    or p_allowed_jobs is null then raise exception using errcode='22023',message='invalid background job lease'; end if;
  v_limit := least(p_max_jobs,25);
  for v_before in select candidate.* from public.background_jobs candidate
    where candidate.job=any(p_allowed_jobs) and ((candidate.status='queued' and candidate.available_at<=pg_catalog.now())
      or (candidate.status='running' and candidate.lease_until<=pg_catalog.now()))
    order by candidate.available_at,candidate.created_at,candidate.id for update skip locked limit v_limit
  loop
    if v_before.attempt_count >= 3 then
      update public.background_jobs set status='failed',lease_owner=null,lease_until=null,execution_started_at=null,
        error_code='lease_exhausted',rows_processed=null,updated_at=pg_catalog.now(),completed_at=pg_catalog.now()
      where id=v_before.id returning * into strict v_after;
      perform private.audit_background_job_transition(v_after,v_before.status::text,'failed'); continue;
    end if;
    update public.background_jobs set status='running',lease_owner=p_worker_id,
      lease_until=pg_catalog.now()+pg_catalog.make_interval(secs=>p_lease_seconds),execution_started_at=null,
      error_code=null,rows_processed=null,updated_at=pg_catalog.now(),completed_at=null
    where id=v_before.id returning * into strict v_after;
    perform private.audit_background_job_transition(v_after,v_before.status::text,'running'); return next v_after;
  end loop;
end;
$fn$;

create or replace function public.claim_background_job(
  p_job_id uuid,p_worker_id text,p_lease_seconds integer,p_allowed_jobs text[]
) returns setof public.background_jobs
language plpgsql security definer set search_path = '' as $fn$
declare v_before public.background_jobs; v_after public.background_jobs;
begin
  if p_job_id is null or p_worker_id is null or pg_catalog.char_length(p_worker_id) not between 1 and 64
    or p_lease_seconds is null or p_lease_seconds not between 5 and 300 or p_allowed_jobs is null
    then raise exception using errcode='22023',message='invalid background job lease'; end if;
  select candidate.* into v_before from public.background_jobs candidate where candidate.id=p_job_id
    and candidate.job=any(p_allowed_jobs) and (candidate.status='queued' or (candidate.status='running' and candidate.lease_until<=pg_catalog.now()))
    for update skip locked;
  if not found then return; end if;
  if v_before.attempt_count>=3 then
    update public.background_jobs set status='failed',lease_owner=null,lease_until=null,execution_started_at=null,
      error_code='lease_exhausted',rows_processed=null,updated_at=pg_catalog.now(),completed_at=pg_catalog.now()
    where id=v_before.id returning * into strict v_after;
    perform private.audit_background_job_transition(v_after,v_before.status::text,'failed'); return;
  end if;
  update public.background_jobs set status='running',lease_owner=p_worker_id,
    lease_until=pg_catalog.now()+pg_catalog.make_interval(secs=>p_lease_seconds),execution_started_at=null,
    error_code=null,rows_processed=null,updated_at=pg_catalog.now(),completed_at=null
  where id=v_before.id returning * into strict v_after;
  perform private.audit_background_job_transition(v_after,v_before.status::text,'running'); return next v_after;
end;
$fn$;

create or replace function public.renew_background_job_lease(
  p_job_id uuid,p_worker_id text,p_lease_seconds integer default 60
) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare v_job public.background_jobs%rowtype;
begin
  if p_job_id is null or p_worker_id is null or pg_catalog.char_length(p_worker_id) not between 1 and 64
    or p_lease_seconds is null or p_lease_seconds not between 5 and 300
    then raise exception using errcode='22023',message='invalid background job lease renewal'; end if;
  select * into v_job from public.background_jobs where id=p_job_id for update;
  if v_job.id is null or v_job.status<>'running' or v_job.lease_owner is distinct from p_worker_id then
    return pg_catalog.jsonb_build_object('renewed',false,'attempt_count',null);
  end if;
  update public.background_jobs set
    attempt_count=attempt_count+case when execution_started_at is null then 1 else 0 end,
    execution_started_at=coalesce(execution_started_at,pg_catalog.now()),
    lease_until=pg_catalog.now()+pg_catalog.make_interval(secs=>p_lease_seconds),updated_at=pg_catalog.now()
  where id=p_job_id returning * into strict v_job;
  return pg_catalog.jsonb_build_object('renewed',true,'attempt_count',v_job.attempt_count);
end;
$fn$;

revoke all on function public.renew_background_job_lease(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.renew_background_job_lease(uuid,text,integer) to service_role;
