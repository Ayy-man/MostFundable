-- R2C-08: preserve the outer outcomes tuple when claiming its inner job.

create or replace function public.claim_outcome_refresh_job(
  p_bank_ref text,
  p_change_id uuid,
  p_worker_id text,
  p_lease_seconds integer default 60
)
returns setof public.outcome_refresh_jobs
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_before public.outcome_refresh_jobs;
  v_job public.outcome_refresh_jobs;
begin
  if p_bank_ref is null or p_bank_ref = '' or p_change_id is null
    or p_worker_id is null or p_worker_id = '' then
    raise exception using errcode = '22023', message = 'a targeted refresh claim requires its tuple and worker';
  end if;

  select candidate.* into v_before
  from public.outcome_refresh_jobs as candidate
  where candidate.bank_ref = p_bank_ref and candidate.change_id = p_change_id
  for update;
  if not found then return; end if;
  if v_before.status in ('succeeded', 'failed') then
    return next v_before;
    return;
  end if;
  if v_before.status <> 'queued' or v_before.available_at > pg_catalog.now() then return; end if;

  update public.outcome_refresh_jobs as job
  set status = 'running', attempt_count = job.attempt_count + 1,
    lease_owner = p_worker_id,
    lease_until = pg_catalog.now() + pg_catalog.make_interval(secs => greatest(p_lease_seconds, 1)),
    updated_at = pg_catalog.now()
  where job.id = v_before.id returning job.* into strict v_job;
  perform private.audit_outcome_refresh_transition(v_job, 'queued', 'running');
  return next v_job;
end
$fn$;

revoke all on function public.claim_outcome_refresh_job(text, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.claim_outcome_refresh_job(text, uuid, text, integer) to service_role;
