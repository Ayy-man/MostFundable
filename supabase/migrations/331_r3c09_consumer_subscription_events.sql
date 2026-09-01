-- R3C-09: converge consumer subscription events and close paid access terminally.

begin;

alter table public.consumer_subscriptions
  add column if not exists last_provider_event_at timestamptz,
  add column if not exists last_provider_event_id text,
  add column if not exists last_provider_status text;

create or replace function public.consumer_subscription_apply_event(
  p_enrollment_id uuid,
  p_event_id text,
  p_event_type text,
  p_provider_status text,
  p_occurred_at timestamptz,
  p_source text default 'stripe'
) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  v_subscription public.consumer_subscriptions%rowtype;
  v_terminal boolean;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if nullif(pg_catalog.btrim(p_event_id), '') is null
    or p_occurred_at is null
    or p_source not in ('stripe', 'provider.snapshot') then
    raise exception using errcode = '22023', message = 'CONSUMER_SUBSCRIPTION_EVENT_INVALID';
  end if;

  select * into v_subscription
  from public.consumer_subscriptions
  where enrollment_id = p_enrollment_id
  for update;
  if v_subscription.id is null then
    raise exception using errcode = 'P0002', message = 'CONSUMER_SUBSCRIPTION_NOT_FOUND';
  end if;

  if v_subscription.last_provider_event_id = p_event_id then
    return pg_catalog.jsonb_build_object('applied', false, 'reason_code', 'duplicate_event');
  end if;
  if v_subscription.last_provider_event_at is not null and p_occurred_at < v_subscription.last_provider_event_at then
    return pg_catalog.jsonb_build_object('applied', false, 'reason_code', 'older_event');
  end if;
  if v_subscription.last_provider_event_at = p_occurred_at and p_source <> 'provider.snapshot' then
    return pg_catalog.jsonb_build_object('applied', false, 'reason_code', 'equal_timestamp');
  end if;

  v_terminal := p_event_type = 'customer.subscription.deleted'
    or p_provider_status in ('canceled', 'cancelled', 'unpaid', 'incomplete_expired');

  if v_subscription.status = 'cancelled' and not v_terminal then
    return pg_catalog.jsonb_build_object('applied', false, 'reason_code', 'terminal_closed');
  end if;

  update public.consumer_subscriptions
  set last_provider_event_at = p_occurred_at,
      last_provider_event_id = p_event_id,
      last_provider_status = case when v_terminal then coalesce(p_provider_status, 'canceled') else p_provider_status end,
      status = case when v_terminal then 'cancelled' else status end,
      cancelled_at = case when v_terminal then coalesce(cancelled_at, v_now) else cancelled_at end,
      updated_at = v_now
  where id = v_subscription.id;

  if v_terminal then
    update public.enrollments
    set status = 'cancelled', parked_until = null, updated_at = v_now
    where id = p_enrollment_id and status <> 'cancelled';
    update public.analysis_jobs
    set status = 'cancelled', lease_owner = null, lease_until = null, error_code = null, updated_at = v_now
    where client_id = v_subscription.client_id and status = 'queued';
    perform public.enqueue_background_job(
      'purge.derived',
      'enrollment:' || p_enrollment_id::text,
      pg_catalog.to_char(v_now at time zone 'UTC', 'YYYY-MM-DD')
    );
  end if;

  return pg_catalog.jsonb_build_object('applied', true, 'reason_code', 'applied');
end;
$fn$;

revoke all on function public.consumer_subscription_apply_event(uuid,text,text,text,timestamptz,text)
  from public, anon, authenticated;
grant execute on function public.consumer_subscription_apply_event(uuid,text,text,text,timestamptz,text)
  to service_role;

commit;
