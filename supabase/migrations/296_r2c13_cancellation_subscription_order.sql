-- R2C-13: cancel the settled subscription before flipping its active parent enrollment.

create or replace function public.enrollment_cancel_sub(
  p_enrollment_id uuid,
  p_actor_id uuid,
  p_reason text
) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_client_id uuid;
  v_cancelled_at timestamptz := pg_catalog.clock_timestamp();
  v_window text := pg_catalog.to_char(v_cancelled_at at time zone 'UTC', 'YYYY-MM-DD');
begin
  perform pg_catalog.set_config('app.actor_id', coalesce(p_actor_id::text, ''), true);
  select enrollment.client_id into v_client_id
  from public.enrollments as enrollment where enrollment.id=p_enrollment_id for update;
  if v_client_id is null then
    raise exception using errcode='P0002', message='ENROLLMENT_NOT_FOUND';
  end if;

  update public.consumer_subscriptions
  set status='cancelled', cancelled_at=coalesce(cancelled_at,v_cancelled_at), updated_at=v_cancelled_at
  where enrollment_id=p_enrollment_id;

  update public.enrollments
  set status='cancelled', parked_until=null, updated_at=v_cancelled_at
  where id=p_enrollment_id and status <> 'cancelled';

  update public.analysis_jobs
  set status='cancelled', lease_owner=null, lease_until=null, error_code=null, updated_at=v_cancelled_at
  where client_id=v_client_id and status='queued';

  perform public.enqueue_background_job('purge.derived','enrollment:'||p_enrollment_id::text,v_window);
  -- p_reason remains excluded from unrestricted persistence and audit metadata.
end
$fn$;

revoke all on function public.enrollment_cancel_sub(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.enrollment_cancel_sub(uuid,uuid,text) to service_role;
