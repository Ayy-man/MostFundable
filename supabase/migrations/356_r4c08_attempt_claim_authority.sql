-- R4C-08 / R4D-02: the server-owned dispatch claim carries the same authority as
-- the settlement it leads to.
--
-- `service.ts` evaluates consent once, on a snapshot read before `recordSetup`,
-- the attempt claim and the provider call. Migration 355 closes the window
-- after the provider returned; this closes the window before it, so a
-- withdrawal that commits before dispatch prevents the charge instead of
-- producing one that has to be cancelled afterwards. Nothing has been
-- dispatched at this point, so a refusal raises and changes nothing.

begin;

create or replace function public.begin_consumer_subscription_attempt(
  p_enrollment_id uuid,
  p_operation_id text
) returns setof public.consumer_subscriptions
language plpgsql security definer set search_path = '' as $fn$
declare
  v_subscription public.consumer_subscriptions%rowtype;
  v_idv_state text;
begin
  if nullif(pg_catalog.btrim(p_operation_id), '') is null or pg_catalog.char_length(p_operation_id) > 255 then
    raise exception using errcode = '22023', message = 'CONSUMER_SUBSCRIPTION_OPERATION_INVALID';
  end if;
  select * into v_subscription from public.consumer_subscriptions
  where enrollment_id = p_enrollment_id for update;
  if v_subscription.id is null then
    raise exception using errcode = 'P0002', message = 'CONSUMER_SUBSCRIPTION_NOT_FOUND';
  end if;
  if v_subscription.operation_id is not null and v_subscription.operation_id <> p_operation_id then
    raise exception using errcode = '22023', message = 'CONSUMER_SUBSCRIPTION_OPERATION_MISMATCH';
  end if;

  if v_subscription.operation_state = 'none' then
    select session.state into v_idv_state
    from public.idv_sessions as session
    where session.enrollment_id = p_enrollment_id for update;
    if v_idv_state is distinct from 'passed' then
      raise exception using errcode = '23514', message = 'ENROLLMENT_IDV_NOT_PASSED';
    end if;
    if not private.consent_currently_granted(v_subscription.client_id, 'monitoring')
      or not private.consent_currently_granted(v_subscription.client_id, 'analysis') then
      raise exception using errcode = '23514', message = 'ENROLLMENT_SUBSCRIPTION_CONSENT_WITHDRAWN';
    end if;

    update public.consumer_subscriptions
    set operation_id = p_operation_id,
        operation_state = 'dispatching',
        operation_started_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    where id = v_subscription.id returning * into strict v_subscription;
  end if;
  return next v_subscription;
end;
$fn$;

revoke all on function public.begin_consumer_subscription_attempt(uuid,text)
  from public, anon, authenticated;
grant execute on function public.begin_consumer_subscription_attempt(uuid,text) to service_role;

commit;
