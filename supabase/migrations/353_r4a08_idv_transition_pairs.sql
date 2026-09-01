-- R4A-08: IDV settlement accepts only the state machine's exact state/outcome pairs.
--
-- Migration 021 constrains `state` and `outcome` independently and nothing
-- constrains their relationship, so `('retry','passed')` persists and
-- manufactures the very fact R4A-04's settlement precondition is about to
-- require. The pair is validated before the row lock, so a contradictory call
-- changes nothing at all. No table-level CHECK: `idv_sessions` grants
-- `service_role` only SELECT, so this definer and the table owner are the only
-- writers.

begin;

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
begin
  if not (
    (p_outcome = 'retry' and p_next_state in ('quiz', 'retry'))
    or (p_outcome = 'pass' and p_next_state = 'passed')
    or (p_outcome = 'locked' and p_next_state = 'locked')
  ) then
    raise exception using errcode = '22023', message = 'ENROLLMENT_IDV_TRANSITION_INVALID';
  end if;

  -- The park and lock windows belong to the locked pair and to nothing else.
  if p_next_state = 'locked' then
    if p_parked_until is null or p_locked_until is null then
      raise exception using errcode = '22023', message = 'ENROLLMENT_IDV_LOCK_WINDOW_REQUIRED';
    end if;
  elsif p_parked_until is not null or p_locked_until is not null then
    raise exception using errcode = '22023', message = 'ENROLLMENT_IDV_LOCK_WINDOW_UNEXPECTED';
  end if;

  perform pg_catalog.set_config('app.actor_id', coalesce(p_actor_id::text, ''), true);
  select session.state into v_current_state
  from public.idv_sessions as session
  where session.enrollment_id = p_enrollment_id
  for no key update;

  if v_current_state is null or v_current_state in ('passed', 'locked') then return; end if;

  update public.idv_sessions
  set state = p_next_state,
      outcome = p_outcome,
      attempts_used = attempts_used + case when p_next_state in ('retry', 'locked') then 1 else 0 end,
      locked_until = p_locked_until,
      updated_at = pg_catalog.now()
  where enrollment_id = p_enrollment_id;

  if p_next_state = 'passed' then
    update public.enrollments set parked_until = null, updated_at = pg_catalog.now()
    where id = p_enrollment_id and status = 'enrolled';
  elsif p_next_state = 'locked' then
    update public.enrollments
    set status = 'parked', parked_until = p_parked_until, updated_at = pg_catalog.now()
    where id = p_enrollment_id;
  end if;
end;
$fn$;

revoke all on function public.enrollment_idv_settled(uuid,uuid,text,text,timestamptz,timestamptz)
  from public, anon, authenticated;
grant execute on function public.enrollment_idv_settled(uuid,uuid,text,text,timestamptz,timestamptz)
  to service_role;

commit;
