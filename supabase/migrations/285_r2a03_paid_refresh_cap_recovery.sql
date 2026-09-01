-- R2A-03 — paid or queued refresh work recovers its own expired capacity.

begin;

create or replace function public.reserve_paid_refresh_pull(
  p_client_id uuid,
  p_request_id uuid,
  p_lease_seconds integer default 900
)
returns table (allowed boolean, reason text)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_attempt public.pull_cap_attempts;
  v_cap public.pull_caps;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_org uuid;
  v_protected boolean;
  v_reason public.pull_cap_reason;
  v_request public.paid_refresh_requests;
begin
  if p_request_id is null or p_lease_seconds < 30 or p_lease_seconds > 3600 then
    raise exception using errcode = 'P0001', message = 'PULL_RESERVATION_INVALID';
  end if;

  select request.* into v_request
  from public.paid_refresh_requests as request
  where request.id = p_request_id
    and request.client_id = p_client_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'PAID_REFRESH_NOT_FOUND';
  end if;

  v_protected := v_request.state = 'queued' or exists (
    select 1
    from public.paid_refresh_payment_events as payment
    where payment.request_id = v_request.id
      and payment.outcome = 'succeeded'
  );

  select client.org_id into v_org
  from public.clients as client where client.id = p_client_id;
  if v_org is null or v_org <> v_request.org_id then
    raise exception using errcode = 'P0002', message = 'PULL_CAP_CLIENT_NOT_FOUND';
  end if;

  select cap.* into v_cap
  from public.pull_caps as cap
  where cap.client_id = p_client_id
  for update;

  if v_cap.client_id is null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_client_id::text, 0));
  end if;

  select attempt.* into v_attempt
  from public.pull_cap_attempts as attempt
  where attempt.client_id = p_client_id
    and attempt.cause = 'force_pull'
    and attempt.source_id = p_request_id
  for update;

  if v_attempt.id is not null and v_attempt.reservation_state = 'committed' then
    return query select true, null::text;
    return;
  end if;

  if v_protected then
    insert into public.pull_cap_attempts (
      client_id, org_id, cause, source_id, allowed, reason, decided_at,
      reservation_state, reservation_expires_at
    ) values (
      p_client_id, v_org, 'force_pull', p_request_id, true, null, v_now,
      'committed', null
    )
    on conflict (client_id, cause, source_id) do update
    set allowed = true,
        reason = null,
        decided_at = excluded.decided_at,
        reservation_state = 'committed',
        reservation_expires_at = null;

    return query select true, null::text;
    return;
  end if;

  if v_attempt.id is not null
     and v_attempt.reservation_state = 'reserved'
     and v_attempt.reservation_expires_at > v_now then
    return query select true, null::text;
    return;
  end if;

  if v_cap.client_id is not null and v_cap.min_interval_seconds is not null and exists (
    select 1 from public.pull_cap_attempts as attempt
    where attempt.client_id = p_client_id
      and attempt.allowed
      and attempt.reservation_state in ('reserved', 'committed')
      and (attempt.reservation_state = 'committed' or attempt.reservation_expires_at > v_now)
      and attempt.decided_at > v_now - pg_catalog.make_interval(secs => v_cap.min_interval_seconds)
      and attempt.source_id <> p_request_id
  ) then
    v_reason := 'minimum_interval';
  elsif v_cap.client_id is not null and v_cap.max_count is not null and (
    select pg_catalog.count(*) from public.pull_cap_attempts as attempt
    where attempt.client_id = p_client_id
      and attempt.allowed
      and attempt.reservation_state in ('reserved', 'committed')
      and (attempt.reservation_state = 'committed' or attempt.reservation_expires_at > v_now)
      and attempt.decided_at > v_now - pg_catalog.make_interval(secs => v_cap.count_window_seconds)
      and attempt.source_id <> p_request_id
  ) >= v_cap.max_count then
    v_reason := 'count_window';
  end if;

  insert into public.pull_cap_attempts (
    client_id, org_id, cause, source_id, allowed, reason, decided_at,
    reservation_state, reservation_expires_at
  ) values (
    p_client_id, v_org, 'force_pull', p_request_id, v_reason is null, v_reason, v_now,
    case when v_reason is null then 'reserved' else 'denied' end,
    case when v_reason is null then v_now + pg_catalog.make_interval(secs => p_lease_seconds) end
  )
  on conflict (client_id, cause, source_id) do update
  set allowed = excluded.allowed,
      reason = excluded.reason,
      decided_at = excluded.decided_at,
      reservation_state = excluded.reservation_state,
      reservation_expires_at = excluded.reservation_expires_at;

  return query select v_reason is null, v_reason::text;
end;
$fn$;

commit;
