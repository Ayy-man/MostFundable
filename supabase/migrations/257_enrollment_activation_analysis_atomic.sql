-- R1C-14: activation and its initial analysis source tuple commit together.

create or replace function public.enrollment_idv_settled(
  p_enrollment_id uuid,
  p_actor_id uuid,
  p_outcome text,
  p_next_state text,
  p_parked_until timestamptz,
  p_locked_until timestamptz
) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_current_state text;
  v_client_id uuid;
begin
  perform set_config('app.actor_id', coalesce(p_actor_id::text, ''), true);

  select s.state, s.client_id into v_current_state, v_client_id
  from public.idv_sessions s
  where s.enrollment_id = p_enrollment_id
  for no key update;

  if v_current_state is null or v_current_state in ('passed', 'locked') then
    return;
  end if;

  update public.idv_sessions
  set state = p_next_state,
      outcome = p_outcome,
      attempts_used = attempts_used + case when p_next_state in ('retry', 'locked') then 1 else 0 end,
      locked_until = p_locked_until,
      updated_at = pg_catalog.now()
  where enrollment_id = p_enrollment_id;

  if p_next_state = 'passed' then
    update public.enrollments set status = 'active', parked_until = null
    where id = p_enrollment_id;
    perform public.enrollment_record_milestone(v_client_id, 'monitoring_connected', p_actor_id);
    perform public.enqueue_analysis_job(v_client_id, 'enrollment', p_enrollment_id, 'scheduled');
  elsif p_next_state = 'locked' then
    update public.enrollments set status = 'parked', parked_until = p_parked_until
    where id = p_enrollment_id;
  end if;
end;
$fn$;
