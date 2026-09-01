-- R3C-02 — advance one paid-refresh payment identity after required action.

begin;

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
  v_is_progression boolean;
begin
  select request.* into v_request
  from public.paid_refresh_requests as request
  where request.id = p_request_id
  for update;

  if v_request.id is null then
    raise exception using errcode = 'P0002', message = 'PAID_REFRESH_NOT_FOUND';
  end if;

  v_is_progression := v_request.payment_attempt_state = 'recorded'
    and v_request.payment_provider_outcome = 'requires_action'
    and p_outcome in ('succeeded', 'failed')
    and v_request.payment_provider_payment_ref = p_provider_payment_ref;

  if v_request.payment_idempotency_key is distinct from p_idempotency_key
     or (v_request.payment_attempt_state not in ('dispatching', 'provider_returned') and not v_is_progression)
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
  if v_request.state not in ('initiated', 'requires_action', 'payment_failed', 'paid', 'queued')
     or (v_request.state = 'requires_action' and p_outcome = 'requires_action') then
    raise exception using errcode = '55000', message = 'PAID_REFRESH_PAYMENT_TRANSITION_INVALID';
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

revoke all on function public.record_paid_refresh_provider_returned(uuid, text, text, text, text, integer, text) from public, anon, authenticated;
grant execute on function public.record_paid_refresh_provider_returned(uuid, text, text, text, text, integer, text) to service_role;

commit;
