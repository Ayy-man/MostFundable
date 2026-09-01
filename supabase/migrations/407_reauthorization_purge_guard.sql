-- A historical analysis-consent withdrawal must not purge a client after a
-- later grant has restored authorization. The queued job is durable evidence
-- of the old obligation, so both discovery and execution re-check current
-- authorization instead of deleting the job or its audit history.

create or replace function public.purge_derived_enrollment(
  p_enrollment_id uuid,
  p_closed_member_ref text
) returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_client_id uuid;
  v_enrollment_status public.enrollment_status;
  v_rows integer;
begin
  select enrollment.client_id, enrollment.status
  into v_client_id, v_enrollment_status
  from public.enrollments as enrollment
  where enrollment.id = p_enrollment_id
  for update;
  if v_client_id is null then return 0; end if;

  -- Cancellation is terminal. A consent-driven purge is not: a later signed
  -- grant wins, so an already queued or rediscovered job becomes a safe no-op.
  if v_enrollment_status <> 'cancelled'
    and private.analysis_authorized(v_client_id)
  then
    return 0;
  end if;

  update public.paid_refresh_requests as request
  set state = 'cancelled', analysis_run_id = null, updated_at = pg_catalog.clock_timestamp()
  where request.client_id = v_client_id
    and request.analysis_run_id in (
      select job.analysis_run_id from public.analysis_jobs as job
      where job.client_id = v_client_id and job.status not in ('succeeded', 'failed')
    );

  select private.purge_derived_enrollment_r2a05_base(p_enrollment_id, p_closed_member_ref)
  into v_rows;
  return v_rows;
end
$fn$;

create or replace function public.list_derived_purge_targets(
  p_stale_before timestamptz,
  p_limit integer default 500
)
returns table (enrollment_id uuid)
language sql
stable
security definer
set search_path = ''
as $fn$
  select enrollment.id
  from public.enrollments as enrollment
  where enrollment.updated_at < p_stale_before
    and (
      enrollment.status = 'cancelled'
      or (
        not private.analysis_authorized(enrollment.client_id)
        and exists (
          select 1
          from public.consent_revocations as revocation
          where revocation.client_id = enrollment.client_id
            and revocation.kind = 'analysis'
            and revocation.revoked_at + interval '30 days' <= pg_catalog.now()
        )
      )
    )
    and private.derived_purge_outstanding(enrollment.id)
  order by enrollment.updated_at, enrollment.id
  limit least(greatest(coalesce(p_limit, 500), 1), 1000);
$fn$;

revoke all on function public.purge_derived_enrollment(uuid, text)
  from public, anon, authenticated;
grant execute on function public.purge_derived_enrollment(uuid, text) to service_role;
revoke all on function public.list_derived_purge_targets(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.list_derived_purge_targets(timestamptz, integer) to service_role;
