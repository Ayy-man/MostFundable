-- R2A-05: cancel and detach paid-refresh requests before purging nonterminal jobs.

alter table public.paid_refresh_requests drop constraint paid_refresh_requests_state_closed;
alter table public.paid_refresh_requests add constraint paid_refresh_requests_state_closed check (
  state in ('initiated', 'payment_failed', 'requires_action', 'paid', 'queued', 'cancelled')
);
alter table public.paid_refresh_requests drop constraint paid_refresh_requests_state_shape;
alter table public.paid_refresh_requests add constraint paid_refresh_requests_state_shape check (
  (state = 'initiated' and provider_payment_ref is null and analysis_run_id is null)
  or (state in ('payment_failed', 'requires_action', 'paid') and provider_payment_ref is not null and analysis_run_id is null)
  or (state = 'queued' and provider_payment_ref is not null and analysis_run_id is not null)
  or (state = 'cancelled' and provider_payment_ref is not null and analysis_run_id is null)
);

alter function public.purge_derived_enrollment(uuid, text)
  rename to purge_derived_enrollment_r2a05_base;
alter function public.purge_derived_enrollment_r2a05_base(uuid, text)
  set schema private;

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
  v_rows integer;
begin
  select enrollment.client_id into v_client_id
  from public.enrollments as enrollment
  where enrollment.id = p_enrollment_id
  for update;
  if v_client_id is null then return 0; end if;

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

revoke all on function private.purge_derived_enrollment_r2a05_base(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.purge_derived_enrollment(uuid, text) from public, anon, authenticated;
grant execute on function public.purge_derived_enrollment(uuid, text) to service_role;
