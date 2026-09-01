-- R4A-04 / R4C-08 (with R4D-02) / R4C-01: activation and the charge are gated by
-- IDV, current consent and the exact governed provider result inside the one
-- locked transaction that performs them.
--
-- Round 3 (migration 330) moved activation out of IDV settlement into payment
-- settlement and never gave the settlement RPC preconditions of its own: it
-- reads the subscription status, the null reference and the enrollment status,
-- and never reads `idv_sessions` or the current consent events. Both callers
-- happen to gate on `idvState === 'passed'` and on a state snapshot read before
-- the provider call, which is a check at the caller over an open authority, and
-- the consent snapshot is stale by the time the provider returns.
--
-- The verdict is explicit (`settled` | `cancel_pending`) so the service acts on
-- it rather than re-reading state that can go stale again. Refusals that are
-- unreachable authority holes (no passed IDV, a provider result that is not the
-- governed one) raise and change nothing; a consent withdrawn inside the
-- provider window is reachable and the provider has already charged, so that
-- path takes the durable cancellation obligation from migration 354 and closes
-- the enrollment through the existing cancellation rail.

begin;

-- The latest-event consent rule of migrations 293/295 without their
-- entitlement clause: at settlement the enrollment is not active yet, so
-- `private.monitoring_authorized` / `private.analysis_authorized` would answer
-- false for reasons that have nothing to do with consent.
create or replace function private.consent_currently_granted(
  p_client_id uuid,
  p_kind text
) returns boolean
language sql stable security definer set search_path = '' as $fn$
  select coalesce((
    select event.authorized
    from (
      select consent.signed_at as occurred_at, true as authorized, consent.id
      from public.consents as consent
      where consent.client_id = p_client_id
        and consent.kind = p_kind::public.consent_kind
        and consent.action = 'granted'
      union all
      select revocation.revoked_at, false, revocation.id
      from public.consent_revocations as revocation
      where revocation.client_id = p_client_id and revocation.kind = p_kind
    ) as event
    order by event.occurred_at desc, event.authorized asc, event.id desc
    limit 1
  ), false);
$fn$;

drop function if exists public.enrollment_settle_sub(uuid,uuid,text);
create function public.enrollment_settle_sub(
  p_enrollment_id uuid,
  p_actor_id uuid,
  p_subscription_ref text
) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  v_ref text := nullif(pg_catalog.btrim(p_subscription_ref), '');
  v_client_id uuid;
  v_enrollment_status text;
  v_subscription public.consumer_subscriptions%rowtype;
  v_idv_state text;
begin
  if v_ref is null then
    raise exception using errcode = '22023', message = 'ENROLLMENT_SUBSCRIPTION_REF_REQUIRED';
  end if;
  perform pg_catalog.set_config('app.actor_id', coalesce(p_actor_id::text, ''), true);

  select enrollment.client_id, enrollment.status::text into v_client_id, v_enrollment_status
  from public.enrollments as enrollment where enrollment.id = p_enrollment_id for update;
  if v_client_id is null then
    raise exception using errcode = 'P0002', message = 'ENROLLMENT_NOT_FOUND';
  end if;

  select * into v_subscription
  from public.consumer_subscriptions as subscription
  where subscription.enrollment_id = p_enrollment_id for update;

  if v_subscription.status = 'active' and v_subscription.subscription_ref = v_ref then
    return pg_catalog.jsonb_build_object('verdict', 'settled', 'reason_code', 'replay',
      'subscription_ref', v_ref);
  end if;

  -- R4C-07: the provider created a subscription for an enrollment that is
  -- already closed. Retain the reference, take the obligation, grant nothing.
  if v_subscription.id is not null
    and v_subscription.subscription_ref is null
    and (v_enrollment_status = 'cancelled' or v_subscription.status = 'cancelled') then
    perform private.require_provider_cancel(p_enrollment_id, v_ref, 'enrollment_cancelled');
    perform public.enqueue_background_job(
      'purge.derived',
      'enrollment:' || p_enrollment_id::text,
      pg_catalog.to_char(pg_catalog.clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD'));
    return pg_catalog.jsonb_build_object('verdict', 'cancel_pending',
      'reason_code', 'enrollment_cancelled', 'subscription_ref', v_ref);
  end if;

  if v_subscription.status is distinct from 'authorized' or v_subscription.subscription_ref is not null then
    raise exception using errcode = '23514', message = 'ENROLLMENT_SUBSCRIPTION_SETTLEMENT_BLOCKED';
  end if;
  if v_enrollment_status not in ('enrolled', 'active') then
    raise exception using errcode = '23514', message = 'ENROLLMENT_ACTIVATION_BLOCKED';
  end if;

  -- R4C-01: an `invoice.paid` may enter the gate for a retained exact-price
  -- `incomplete` attempt, so the retained result is revalidated here rather
  -- than trusted from whichever caller reached this function.
  if v_subscription.operation_state <> 'none' then
    if v_subscription.operation_state <> 'provider_returned'
      or v_subscription.attempt_provider_subscription_ref is distinct from v_ref then
      raise exception using errcode = '23514', message = 'ENROLLMENT_SUBSCRIPTION_ATTEMPT_MISMATCH';
    end if;
    if v_subscription.attempt_provider_amount_cents is distinct from v_subscription.price_cents
      or v_subscription.attempt_provider_currency is distinct from v_subscription.currency then
      raise exception using errcode = '23514', message = 'ENROLLMENT_SUBSCRIPTION_AMOUNT_MISMATCH';
    end if;
    if v_subscription.attempt_provider_status not in ('active', 'incomplete') then
      raise exception using errcode = '23514', message = 'ENROLLMENT_SUBSCRIPTION_ATTEMPT_NOT_PAYABLE';
    end if;
    if v_subscription.last_provider_status is not null
      and v_subscription.last_provider_status not in ('active', 'incomplete') then
      raise exception using errcode = '23514', message = 'ENROLLMENT_SUBSCRIPTION_EVENT_ORDER_BLOCKED';
    end if;
  end if;

  -- R4A-04: the persisted identity fact, locked in this transaction. The unique
  -- index on `enrollment_id` makes "exactly one row" structural.
  select session.state into v_idv_state
  from public.idv_sessions as session
  where session.enrollment_id = p_enrollment_id for update;
  if v_idv_state is distinct from 'passed' then
    raise exception using errcode = '23514', message = 'ENROLLMENT_IDV_NOT_PASSED';
  end if;

  -- R4C-08 / R4D-02: both named consents on the latest-event rule, evaluated
  -- here rather than from the caller's pre-provider snapshot.
  if not private.consent_currently_granted(v_client_id, 'monitoring')
    or not private.consent_currently_granted(v_client_id, 'analysis') then
    perform private.require_provider_cancel(p_enrollment_id, v_ref, 'consent_withdrawn');
    perform public.enrollment_cancel_sub(p_enrollment_id, p_actor_id, 'consent_withdrawn');
    return pg_catalog.jsonb_build_object('verdict', 'cancel_pending',
      'reason_code', 'consent_withdrawn', 'subscription_ref', v_ref);
  end if;

  update public.enrollments
  set status = 'active', parked_until = null, updated_at = pg_catalog.now()
  where id = p_enrollment_id;
  update public.consumer_subscriptions
  set status = 'active', subscription_ref = v_ref,
      subscription_attempt_at = pg_catalog.now(), activated_at = pg_catalog.now(), updated_at = pg_catalog.now()
  where enrollment_id = p_enrollment_id;
  perform public.enrollment_record_milestone(v_client_id, 'monitoring_connected', p_actor_id);
  perform public.enqueue_analysis_job(v_client_id, 'enrollment', p_enrollment_id, 'scheduled');
  return pg_catalog.jsonb_build_object('verdict', 'settled', 'reason_code', 'activated',
    'subscription_ref', v_ref);
end;
$fn$;

revoke all on function private.consent_currently_granted(uuid,text)
  from public, anon, authenticated, service_role;
revoke all on function public.enrollment_settle_sub(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.enrollment_settle_sub(uuid,uuid,text) to service_role;

commit;
