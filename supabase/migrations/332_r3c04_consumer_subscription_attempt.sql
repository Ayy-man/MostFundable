-- R3C-04: durably reconcile outbound consumer subscription creation.

begin;

alter table public.consumer_subscriptions
  add column if not exists operation_id text,
  add column if not exists operation_state text not null default 'none',
  add column if not exists operation_started_at timestamptz,
  add column if not exists attempt_provider_subscription_ref text,
  add column if not exists attempt_provider_amount_cents integer,
  add column if not exists attempt_provider_currency text,
  add column if not exists attempt_provider_status text,
  add column if not exists attempt_provider_returned_at timestamptz;

alter table public.consumer_subscriptions
  add constraint consumer_subscription_operation_state_closed
    check (operation_state in ('none', 'dispatching', 'provider_returned', 'settled', 'review')),
  add constraint consumer_subscription_operation_shape
    check (
      (operation_state = 'none' and operation_id is null and operation_started_at is null
        and attempt_provider_subscription_ref is null and attempt_provider_returned_at is null)
      or
      (operation_state = 'dispatching' and operation_id is not null and operation_started_at is not null
        and attempt_provider_subscription_ref is null and attempt_provider_returned_at is null)
      or
      (operation_state in ('provider_returned', 'settled', 'review')
        and operation_id is not null and operation_started_at is not null
        and attempt_provider_subscription_ref is not null
        and attempt_provider_amount_cents is not null
        and attempt_provider_currency is not null
        and attempt_provider_status in ('active', 'incomplete', 'past_due')
        and attempt_provider_returned_at is not null)
    );

create or replace function public.begin_consumer_subscription_attempt(
  p_enrollment_id uuid,
  p_operation_id text
) returns setof public.consumer_subscriptions
language plpgsql security definer set search_path = '' as $fn$
declare
  v_subscription public.consumer_subscriptions%rowtype;
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

create or replace function public.record_consumer_subscription_provider_returned(
  p_enrollment_id uuid,
  p_operation_id text,
  p_subscription_ref text,
  p_amount_cents integer,
  p_currency text,
  p_status text
) returns setof public.consumer_subscriptions
language plpgsql security definer set search_path = '' as $fn$
declare
  v_subscription public.consumer_subscriptions%rowtype;
begin
  select * into v_subscription from public.consumer_subscriptions
  where enrollment_id = p_enrollment_id for update;
  if v_subscription.id is null then
    raise exception using errcode = 'P0002', message = 'CONSUMER_SUBSCRIPTION_NOT_FOUND';
  end if;
  if v_subscription.operation_id is distinct from p_operation_id
    or v_subscription.operation_state not in ('dispatching', 'provider_returned')
    or nullif(pg_catalog.btrim(p_subscription_ref), '') is null
    or p_amount_cents is null or p_amount_cents < 0
    or p_currency !~ '^[a-z]{3}$'
    or p_status not in ('active', 'incomplete', 'past_due') then
    raise exception using errcode = '22023', message = 'CONSUMER_SUBSCRIPTION_PROVIDER_RESULT_INVALID';
  end if;
  if v_subscription.operation_state = 'provider_returned' then
    if v_subscription.attempt_provider_subscription_ref <> p_subscription_ref
      or v_subscription.attempt_provider_amount_cents <> p_amount_cents
      or v_subscription.attempt_provider_currency <> p_currency
      or v_subscription.attempt_provider_status <> p_status then
      raise exception using errcode = '22023', message = 'CONSUMER_SUBSCRIPTION_PROVIDER_RESULT_MISMATCH';
    end if;
  else
    update public.consumer_subscriptions
    set operation_state = 'provider_returned',
        attempt_provider_subscription_ref = pg_catalog.btrim(p_subscription_ref),
        attempt_provider_amount_cents = p_amount_cents,
        attempt_provider_currency = p_currency,
        attempt_provider_status = p_status,
        attempt_provider_returned_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    where id = v_subscription.id returning * into strict v_subscription;
  end if;
  return next v_subscription;
end;
$fn$;

create or replace function private.consumer_subscription_attempt_guard()
returns trigger
language plpgsql security definer set search_path = '' as $fn$
begin
  if new.status = 'active' and old.status <> 'active' and new.operation_state <> 'none' then
    if new.operation_state <> 'provider_returned'
      or new.subscription_ref is distinct from new.attempt_provider_subscription_ref then
      raise exception using errcode = '23514', message = 'CONSUMER_SUBSCRIPTION_ATTEMPT_NOT_SETTLED';
    end if;
    new.operation_state := 'settled';
  elsif new.status = 'review_required' and new.operation_state = 'provider_returned' then
    new.operation_state := 'review';
  end if;
  return new;
end;
$fn$;

drop trigger if exists consumer_subscription_attempt_guard on public.consumer_subscriptions;
create trigger consumer_subscription_attempt_guard
  before update of status, subscription_ref on public.consumer_subscriptions
  for each row execute function private.consumer_subscription_attempt_guard();
alter table public.consumer_subscriptions enable always trigger consumer_subscription_attempt_guard;

revoke all on function public.begin_consumer_subscription_attempt(uuid,text) from public, anon, authenticated;
revoke all on function public.record_consumer_subscription_provider_returned(uuid,text,text,integer,text,text) from public, anon, authenticated;
grant execute on function public.begin_consumer_subscription_attempt(uuid,text) to service_role;
grant execute on function public.record_consumer_subscription_provider_returned(uuid,text,text,integer,text,text) to service_role;

commit;
