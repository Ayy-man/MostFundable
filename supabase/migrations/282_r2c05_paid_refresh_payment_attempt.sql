-- R2C-05 — persist and reconcile the outbound paid-refresh payment attempt.

begin;

alter table public.paid_refresh_requests
  add column if not exists payment_attempt_state text not null default 'none',
  add column if not exists payment_idempotency_key text,
  add column if not exists payment_dispatch_started_at timestamptz,
  add column if not exists payment_provider_event_key text,
  add column if not exists payment_provider_payment_ref text,
  add column if not exists payment_provider_outcome text,
  add column if not exists payment_provider_returned_at timestamptz;

alter table public.paid_refresh_requests
  add constraint paid_refresh_requests_payment_attempt_state_closed check (
    payment_attempt_state in ('none', 'dispatching', 'provider_returned', 'recorded', 'needs_review')
  ),
  add constraint paid_refresh_requests_payment_attempt_key_bounded check (
    payment_idempotency_key is null
    or (char_length(payment_idempotency_key) between 1 and 255 and payment_idempotency_key = btrim(payment_idempotency_key))
  ),
  add constraint paid_refresh_requests_payment_attempt_shape check (
    (
      payment_attempt_state = 'none'
      and payment_idempotency_key is null
      and payment_dispatch_started_at is null
      and payment_provider_event_key is null
      and payment_provider_payment_ref is null
      and payment_provider_outcome is null
      and payment_provider_returned_at is null
    ) or (
      payment_attempt_state in ('dispatching', 'needs_review')
      and payment_idempotency_key is not null
      and payment_dispatch_started_at is not null
      and payment_provider_event_key is null
      and payment_provider_payment_ref is null
      and payment_provider_outcome is null
      and payment_provider_returned_at is null
    ) or (
      payment_attempt_state in ('provider_returned', 'recorded')
      and payment_idempotency_key is not null
      and payment_dispatch_started_at is not null
      and payment_provider_event_key is not null
      and payment_provider_payment_ref is not null
      and payment_provider_outcome in ('succeeded', 'requires_action', 'failed')
      and payment_provider_returned_at is not null
    )
  );

create or replace function public.begin_paid_refresh_payment_attempt(
  p_request_id uuid,
  p_idempotency_key text
) returns table (
  payment_attempt_state text,
  payment_idempotency_key text,
  payment_dispatch_started_at timestamptz,
  payment_provider_event_key text,
  payment_provider_payment_ref text,
  payment_provider_outcome text,
  payment_provider_returned_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_request public.paid_refresh_requests;
begin
  select request.* into v_request
  from public.paid_refresh_requests as request
  where request.id = p_request_id
  for update;

  if v_request.id is null then
    raise exception using errcode = 'P0002', message = 'PAID_REFRESH_NOT_FOUND';
  end if;
  if nullif(btrim(p_idempotency_key), '') is null
     or char_length(p_idempotency_key) > 255 then
    raise exception using errcode = '22023', message = 'PAID_REFRESH_PAYMENT_ATTEMPT_INVALID';
  end if;
  if v_request.payment_idempotency_key is not null
     and v_request.payment_idempotency_key <> p_idempotency_key then
    raise exception using errcode = '22023', message = 'PAID_REFRESH_PAYMENT_ATTEMPT_MISMATCH';
  end if;

  if v_request.payment_attempt_state = 'none' then
    update public.paid_refresh_requests
    set payment_attempt_state = 'dispatching',
        payment_idempotency_key = p_idempotency_key,
        payment_dispatch_started_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    where id = p_request_id
    returning * into strict v_request;
  end if;

  return query select
    v_request.payment_attempt_state,
    v_request.payment_idempotency_key,
    v_request.payment_dispatch_started_at,
    v_request.payment_provider_event_key,
    v_request.payment_provider_payment_ref,
    v_request.payment_provider_outcome,
    v_request.payment_provider_returned_at;
end;
$fn$;

create or replace function public.record_paid_refresh_provider_returned(
  p_request_id uuid,
  p_idempotency_key text,
  p_provider_event_key text,
  p_provider_payment_ref text,
  p_outcome text,
  p_amount_cents integer,
  p_currency text
) returns table (
  payment_attempt_state text,
  payment_idempotency_key text,
  payment_dispatch_started_at timestamptz,
  payment_provider_event_key text,
  payment_provider_payment_ref text,
  payment_provider_outcome text,
  payment_provider_returned_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_request public.paid_refresh_requests;
begin
  select request.* into v_request
  from public.paid_refresh_requests as request
  where request.id = p_request_id
  for update;

  if v_request.id is null then
    raise exception using errcode = 'P0002', message = 'PAID_REFRESH_NOT_FOUND';
  end if;
  if v_request.payment_idempotency_key is distinct from p_idempotency_key
     or v_request.payment_attempt_state not in ('dispatching', 'provider_returned')
     or p_amount_cents is distinct from v_request.amount_cents
     or p_currency is distinct from v_request.currency
     or p_outcome not in ('succeeded', 'requires_action', 'failed')
     or nullif(btrim(p_provider_event_key), '') is null
     or nullif(btrim(p_provider_payment_ref), '') is null then
    raise exception using errcode = '22023', message = 'PAID_REFRESH_PROVIDER_RESULT_MISMATCH';
  end if;

  if v_request.payment_attempt_state = 'provider_returned' then
    if v_request.payment_provider_event_key <> p_provider_event_key
       or v_request.payment_provider_payment_ref <> p_provider_payment_ref
       or v_request.payment_provider_outcome <> p_outcome then
      raise exception using errcode = '22023', message = 'PAID_REFRESH_PROVIDER_RESULT_REPLAY_MISMATCH';
    end if;
  else
    update public.paid_refresh_requests
    set payment_attempt_state = 'provider_returned',
        payment_provider_event_key = p_provider_event_key,
        payment_provider_payment_ref = p_provider_payment_ref,
        payment_provider_outcome = p_outcome,
        payment_provider_returned_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    where id = p_request_id
    returning * into strict v_request;
  end if;

  return query select
    v_request.payment_attempt_state,
    v_request.payment_idempotency_key,
    v_request.payment_dispatch_started_at,
    v_request.payment_provider_event_key,
    v_request.payment_provider_payment_ref,
    v_request.payment_provider_outcome,
    v_request.payment_provider_returned_at;
end;
$fn$;

create or replace function public.mark_paid_refresh_payment_needs_review(
  p_request_id uuid,
  p_idempotency_key text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  update public.paid_refresh_requests
  set payment_attempt_state = 'needs_review',
      updated_at = pg_catalog.clock_timestamp()
  where id = p_request_id
    and payment_attempt_state in ('dispatching', 'needs_review')
    and payment_idempotency_key = p_idempotency_key;
  return found;
end;
$fn$;

create or replace function public.record_paid_refresh_payment_event(
  p_request_id uuid,
  p_provider_event_key text,
  p_provider_payment_ref text,
  p_outcome text,
  p_amount_cents integer,
  p_currency text
)
returns setof public.paid_refresh_payment_events
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_request public.paid_refresh_requests;
  v_event public.paid_refresh_payment_events;
  v_previous_state text;
  v_next_state text;
begin
  select request.* into v_request
  from public.paid_refresh_requests as request
  where request.id = p_request_id
  for update;
  if v_request.id is null then
    raise exception using errcode = 'P0002', message = 'PAID_REFRESH_NOT_FOUND';
  end if;

  if p_amount_cents is distinct from v_request.amount_cents
    or p_currency is distinct from v_request.currency
    or p_outcome is null
    or p_outcome not in ('succeeded', 'requires_action', 'failed') then
    raise exception using errcode = '22023', message = 'PAID_REFRESH_PAYMENT_MISMATCH';
  end if;

  if v_request.payment_attempt_state not in ('none', 'provider_returned', 'recorded') then
    raise exception using errcode = '55000', message = 'PAID_REFRESH_PAYMENT_ATTEMPT_INCOMPLETE';
  end if;
  if v_request.payment_attempt_state in ('provider_returned', 'recorded')
     and (
       v_request.payment_provider_event_key <> p_provider_event_key
       or v_request.payment_provider_payment_ref <> p_provider_payment_ref
       or v_request.payment_provider_outcome <> p_outcome
     ) then
    raise exception using errcode = '22023', message = 'PAID_REFRESH_PROVIDER_RESULT_REPLAY_MISMATCH';
  end if;

  select event.* into v_event
  from public.paid_refresh_payment_events as event
  where event.provider_event_key = p_provider_event_key;
  if v_event.id is not null then
    if v_event.request_id <> p_request_id
      or v_event.provider_payment_ref <> p_provider_payment_ref
      or v_event.outcome <> p_outcome
      or v_event.amount_cents <> p_amount_cents
      or v_event.currency <> p_currency then
      raise exception using errcode = '22023', message = 'PAID_REFRESH_EVENT_REPLAY_MISMATCH';
    end if;
    if v_request.payment_attempt_state = 'provider_returned' then
      update public.paid_refresh_requests
      set payment_attempt_state = 'recorded', updated_at = pg_catalog.clock_timestamp()
      where id = p_request_id;
    end if;
    return next v_event;
    return;
  end if;

  if v_request.state in ('paid', 'queued') and p_outcome <> 'succeeded' then
    raise exception using errcode = '55000', message = 'PAID_REFRESH_ALREADY_PAID';
  end if;

  insert into public.paid_refresh_payment_events (
    request_id, provider_event_key, provider_payment_ref,
    outcome, amount_cents, currency
  ) values (
    p_request_id, p_provider_event_key, p_provider_payment_ref,
    p_outcome, p_amount_cents, p_currency
  )
  returning * into strict v_event;

  v_previous_state := v_request.state;
  v_next_state := case p_outcome
    when 'succeeded' then 'paid'
    when 'requires_action' then 'requires_action'
    else 'payment_failed'
  end;

  update public.paid_refresh_requests
  set state = v_next_state,
      provider_payment_ref = p_provider_payment_ref,
      payment_attempt_state = case
        when payment_attempt_state = 'provider_returned' then 'recorded'
        else payment_attempt_state
      end,
      updated_at = pg_catalog.clock_timestamp()
  where id = p_request_id
  returning * into strict v_request;

  perform private.audit_paid_refresh_transition(
    v_request, v_previous_state, v_next_state, p_outcome
  );

  return next v_event;
end;
$fn$;

drop function public.read_paid_refresh_request(uuid);
create function public.read_paid_refresh_request(p_request_id uuid)
returns table (
  request_id uuid,
  actor_profile_id uuid,
  client_id uuid,
  amount_cents integer,
  currency text,
  driver text,
  state text,
  provider_payment_ref text,
  analysis_run_id uuid,
  payment_succeeded boolean,
  latest_payment_outcome text,
  payment_attempt_state text,
  payment_idempotency_key text,
  payment_dispatch_started_at timestamptz,
  payment_provider_event_key text,
  payment_provider_payment_ref text,
  payment_provider_outcome text,
  payment_provider_returned_at timestamptz
)
language sql
security definer
set search_path = ''
as $fn$
  select
    request.id,
    request.actor_profile_id,
    request.client_id,
    request.amount_cents,
    request.currency,
    request.driver,
    request.state,
    request.provider_payment_ref,
    request.analysis_run_id,
    exists (
      select 1 from public.paid_refresh_payment_events as succeeded_event
      where succeeded_event.request_id = request.id
        and succeeded_event.outcome = 'succeeded'
        and succeeded_event.amount_cents = request.amount_cents
        and succeeded_event.currency = request.currency
    ),
    (
      select event.outcome
      from public.paid_refresh_payment_events as event
      where event.request_id = request.id
      order by event.occurred_at desc, event.id desc
      limit 1
    ),
    request.payment_attempt_state,
    request.payment_idempotency_key,
    request.payment_dispatch_started_at,
    request.payment_provider_event_key,
    request.payment_provider_payment_ref,
    request.payment_provider_outcome,
    request.payment_provider_returned_at
  from public.paid_refresh_requests as request
  where request.id = p_request_id;
$fn$;

revoke all on function public.begin_paid_refresh_payment_attempt(uuid, text) from public, anon, authenticated;
revoke all on function public.record_paid_refresh_provider_returned(uuid, text, text, text, text, integer, text) from public, anon, authenticated;
revoke all on function public.mark_paid_refresh_payment_needs_review(uuid, text) from public, anon, authenticated;
revoke all on function public.read_paid_refresh_request(uuid) from public, anon, authenticated;
grant execute on function public.begin_paid_refresh_payment_attempt(uuid, text) to service_role;
grant execute on function public.record_paid_refresh_provider_returned(uuid, text, text, text, text, integer, text) to service_role;
grant execute on function public.mark_paid_refresh_payment_needs_review(uuid, text) to service_role;
grant execute on function public.read_paid_refresh_request(uuid) to service_role;

commit;
