-- R3C-03: paid consumer access begins only after exact subscription settlement.

begin;

create or replace function private.analysis_authorized(p_client_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $fn$
  select exists (
    select 1
    from public.enrollments as enrollment
    join public.consumer_subscriptions as subscription
      on subscription.enrollment_id = enrollment.id
     and subscription.client_id = enrollment.client_id
     and subscription.status = 'active'
    where enrollment.client_id = p_client_id and enrollment.status = 'active'
  ) and coalesce((
    select event.authorized
    from (
      select consent.signed_at as occurred_at, true as authorized, consent.id
      from public.consents as consent
      where consent.client_id = p_client_id and consent.kind = 'analysis' and consent.action = 'granted'
      union all
      select revocation.revoked_at, false, revocation.id
      from public.consent_revocations as revocation
      where revocation.client_id = p_client_id and revocation.kind = 'analysis'
    ) as event
    order by event.occurred_at desc, event.authorized asc, event.id desc limit 1
  ), false);
$fn$;

create or replace function private.monitoring_authorized(p_client_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $fn$
  select exists (
    select 1
    from public.enrollments as enrollment
    join public.consumer_subscriptions as subscription
      on subscription.enrollment_id = enrollment.id
     and subscription.client_id = enrollment.client_id
     and subscription.status = 'active'
    where enrollment.client_id = p_client_id and enrollment.status = 'active'
  ) and coalesce((
    select event.authorized
    from (
      select consent.signed_at as occurred_at, true as authorized, consent.id
      from public.consents as consent
      where consent.client_id = p_client_id and consent.kind = 'monitoring' and consent.action = 'granted'
      union all
      select revocation.revoked_at, false, revocation.id
      from public.consent_revocations as revocation
      where revocation.client_id = p_client_id and revocation.kind = 'monitoring'
    ) as event
    order by event.occurred_at desc, event.authorized asc, event.id desc limit 1
  ), false);
$fn$;

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

create or replace function public.enrollment_settle_sub(
  p_enrollment_id uuid,
  p_actor_id uuid,
  p_subscription_ref text
) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_client_id uuid;
  v_enrollment_status text;
  v_subscription_ref text;
  v_subscription_status text;
begin
  if nullif(pg_catalog.btrim(p_subscription_ref), '') is null then
    raise exception using errcode = '22023', message = 'ENROLLMENT_SUBSCRIPTION_REF_REQUIRED';
  end if;
  perform pg_catalog.set_config('app.actor_id', coalesce(p_actor_id::text, ''), true);

  select enrollment.client_id, enrollment.status::text into v_client_id, v_enrollment_status
  from public.enrollments as enrollment where enrollment.id = p_enrollment_id for update;
  if v_client_id is null then
    raise exception using errcode = 'P0002', message = 'ENROLLMENT_NOT_FOUND';
  end if;

  select subscription.status, subscription.subscription_ref
  into v_subscription_status, v_subscription_ref
  from public.consumer_subscriptions as subscription
  where subscription.enrollment_id = p_enrollment_id for update;

  if v_subscription_status = 'active' and v_subscription_ref = pg_catalog.btrim(p_subscription_ref) then return; end if;
  if v_subscription_status is distinct from 'authorized' or v_subscription_ref is not null then
    raise exception using errcode = '23514', message = 'ENROLLMENT_SUBSCRIPTION_SETTLEMENT_BLOCKED';
  end if;
  if v_enrollment_status not in ('enrolled', 'active') then
    raise exception using errcode = '23514', message = 'ENROLLMENT_ACTIVATION_BLOCKED';
  end if;

  update public.enrollments
  set status = 'active', parked_until = null, updated_at = pg_catalog.now()
  where id = p_enrollment_id;
  update public.consumer_subscriptions
  set status = 'active', subscription_ref = pg_catalog.btrim(p_subscription_ref),
      subscription_attempt_at = pg_catalog.now(), activated_at = pg_catalog.now(), updated_at = pg_catalog.now()
  where enrollment_id = p_enrollment_id;
  perform public.enrollment_record_milestone(v_client_id, 'monitoring_connected', p_actor_id);
  perform public.enqueue_analysis_job(v_client_id, 'enrollment', p_enrollment_id, 'scheduled');
end;
$fn$;

revoke all on function public.enrollment_settle_sub(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.enrollment_settle_sub(uuid,uuid,text) to service_role;

commit;
