-- R2C-02: claim and schedule only work owned by an enabled feature.

create or replace function public.claim_background_jobs(
  p_worker_id text,
  p_max_jobs integer,
  p_lease_seconds integer,
  p_allowed_jobs text[]
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
    or pg_catalog.char_length(p_worker_id) not between 1 and 64
    or p_max_jobs is null or p_max_jobs < 1
    or p_lease_seconds is null or p_lease_seconds not between 5 and 300
    or p_allowed_jobs is null then
    raise exception using errcode = '22023', message = 'invalid background job lease';
  end if;
  v_limit := least(p_max_jobs, 25);

  for v_before in
    select candidate.*
    from public.background_jobs as candidate
    where candidate.job = any(p_allowed_jobs)
      and ((candidate.status = 'queued' and candidate.available_at <= pg_catalog.now())
        or (candidate.status = 'running' and candidate.lease_until <= pg_catalog.now()))
    order by candidate.available_at, candidate.created_at, candidate.id
    for update skip locked
    limit v_limit
  loop
    if v_before.attempt_count >= 3 then
      update public.background_jobs set status = 'failed', lease_owner = null, lease_until = null,
        error_code = 'lease_exhausted', rows_processed = null, updated_at = pg_catalog.now(), completed_at = pg_catalog.now()
      where id = v_before.id returning * into strict v_after;
      perform private.audit_background_job_transition(v_after, v_before.status::text, 'failed');
      continue;
    end if;
    update public.background_jobs set status = 'running', attempt_count = attempt_count + 1,
      lease_owner = p_worker_id, lease_until = pg_catalog.now() + pg_catalog.make_interval(secs => p_lease_seconds),
      error_code = null, rows_processed = null, updated_at = pg_catalog.now(), completed_at = null
    where id = v_before.id returning * into strict v_after;
    perform private.audit_background_job_transition(v_after, v_before.status::text, 'running');
    return next v_after;
  end loop;
end
$fn$;

create or replace function public.claim_background_job(
  p_job_id uuid,
  p_worker_id text,
  p_lease_seconds integer,
  p_allowed_jobs text[]
)
returns setof public.background_jobs
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_before public.background_jobs;
  v_after public.background_jobs;
begin
  if p_job_id is null or p_worker_id is null
    or pg_catalog.char_length(p_worker_id) not between 1 and 64
    or p_lease_seconds is null or p_lease_seconds not between 5 and 300
    or p_allowed_jobs is null then
    raise exception using errcode = '22023', message = 'invalid background job lease';
  end if;
  select candidate.* into v_before from public.background_jobs as candidate
  where candidate.id = p_job_id and candidate.job = any(p_allowed_jobs)
    and (candidate.status = 'queued' or (candidate.status = 'running' and candidate.lease_until <= pg_catalog.now()))
  for update skip locked;
  if not found then return; end if;
  if v_before.attempt_count >= 3 then
    update public.background_jobs set status = 'failed', lease_owner = null, lease_until = null,
      error_code = 'lease_exhausted', rows_processed = null, updated_at = pg_catalog.now(), completed_at = pg_catalog.now()
    where id = v_before.id returning * into strict v_after;
    perform private.audit_background_job_transition(v_after, v_before.status::text, 'failed');
    return;
  end if;
  update public.background_jobs set status = 'running', attempt_count = attempt_count + 1,
    lease_owner = p_worker_id, lease_until = pg_catalog.now() + pg_catalog.make_interval(secs => p_lease_seconds),
    error_code = null, rows_processed = null, updated_at = pg_catalog.now(), completed_at = null
  where id = v_before.id returning * into strict v_after;
  perform private.audit_background_job_transition(v_after, v_before.status::text, 'running');
  return next v_after;
end
$fn$;

revoke execute on function public.claim_background_jobs(text, integer, integer) from service_role;
revoke execute on function public.claim_background_job(uuid, text, integer) from service_role;
revoke all on function public.claim_background_jobs(text, integer, integer, text[]) from public, anon, authenticated;
revoke all on function public.claim_background_job(uuid, text, integer, text[]) from public, anon, authenticated;
grant execute on function public.claim_background_jobs(text, integer, integer, text[]) to service_role;
grant execute on function public.claim_background_job(uuid, text, integer, text[]) to service_role;
