-- R1C-10: reserve pull capacity before payment and consume it only after durable enqueue.

alter table public.pull_cap_attempts
  add column reservation_state text not null default 'committed',
  add column reservation_expires_at timestamptz;

update public.pull_cap_attempts
set reservation_state = 'denied'
where not allowed;

alter table public.pull_cap_attempts
  add constraint pull_cap_attempts_reservation_state_closed check (
    reservation_state in ('reserved', 'committed', 'released', 'denied')
  ),
  add constraint pull_cap_attempts_reservation_shape check (
    (reservation_state = 'reserved' and allowed and reservation_expires_at is not null)
    or (reservation_state <> 'reserved' and reservation_expires_at is null)
  );

drop index if exists public.pull_cap_attempts_recent_allowed_idx;
create index pull_cap_attempts_recent_consuming_idx
  on public.pull_cap_attempts(client_id, decided_at desc)
  where allowed and reservation_state in ('reserved', 'committed');

create function public.reserve_paid_refresh_pull(
  p_client_id uuid,
  p_request_id uuid,
  p_lease_seconds integer default 900
)
returns table (allowed boolean, reason text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.pull_cap_attempts;
  v_cap public.pull_caps;
  v_now timestamptz := clock_timestamp();
  v_org uuid;
  v_reason public.pull_cap_reason;
begin
  if p_request_id is null or p_lease_seconds < 30 or p_lease_seconds > 3600 then
    raise exception using errcode = 'P0001', message = 'PULL_RESERVATION_INVALID';
  end if;

  select client.org_id into v_org
  from public.clients as client where client.id = p_client_id;
  if v_org is null then
    raise exception using errcode = 'P0002', message = 'PULL_CAP_CLIENT_NOT_FOUND';
  end if;

  select cap.* into v_cap
  from public.pull_caps as cap
  where cap.client_id = p_client_id
  for update;

  -- An uncapped client still needs a per-request row so retries keep one identity.
  if v_cap.client_id is null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_client_id::text, 0));
  end if;

  select attempt.* into v_attempt
  from public.pull_cap_attempts as attempt
  where attempt.client_id = p_client_id
    and attempt.cause = 'force_pull'
    and attempt.source_id = p_request_id
  for update;

  if v_attempt.id is not null
     and v_attempt.reservation_state = 'committed' then
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
      and attempt.decided_at > v_now - make_interval(secs => v_cap.min_interval_seconds)
      and attempt.source_id <> p_request_id
  ) then
    v_reason := 'minimum_interval';
  elsif v_cap.client_id is not null and v_cap.max_count is not null and (
    select count(*) from public.pull_cap_attempts as attempt
    where attempt.client_id = p_client_id
      and attempt.allowed
      and attempt.reservation_state in ('reserved', 'committed')
      and (attempt.reservation_state = 'committed' or attempt.reservation_expires_at > v_now)
      and attempt.decided_at > v_now - make_interval(secs => v_cap.count_window_seconds)
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
    case when v_reason is null then v_now + make_interval(secs => p_lease_seconds) end
  )
  on conflict (client_id, cause, source_id) do update
  set allowed = excluded.allowed,
      reason = excluded.reason,
      decided_at = excluded.decided_at,
      reservation_state = excluded.reservation_state,
      reservation_expires_at = excluded.reservation_expires_at;

  return query select v_reason is null, v_reason::text;
end;
$$;

create function public.commit_paid_refresh_pull(p_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.pull_cap_attempts
  set reservation_state = 'committed', reservation_expires_at = null
  where cause = 'force_pull' and source_id = p_request_id
    and allowed and reservation_state in ('reserved', 'committed');
  return found;
end;
$$;

create function public.release_paid_refresh_pull(p_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.pull_cap_attempts
  set reservation_state = 'released', reservation_expires_at = null
  where cause = 'force_pull' and source_id = p_request_id
    and reservation_state = 'reserved';
  return found;
end;
$$;

create or replace function public.assert_pull_allowed(
  p_client_id uuid,
  p_cause text,
  p_source_id uuid
)
returns table (allowed boolean, reason text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.pull_cap_attempts;
  v_cap public.pull_caps;
  v_cause public.analysis_trigger;
  v_now timestamptz := clock_timestamp();
  v_org uuid;
  v_reason public.pull_cap_reason;
begin
  if p_cause is null or p_cause not in ('scheduled', 'alert', 'upload', 'force_pull') then
    raise exception using errcode = 'P0001', message = 'PULL_CAP_CAUSE_INVALID';
  end if;
  if p_source_id is null then
    raise exception using errcode = 'P0001', message = 'PULL_CAP_SOURCE_INVALID';
  end if;
  v_cause := p_cause::public.analysis_trigger;
  select client.org_id into v_org from public.clients as client where client.id = p_client_id;
  if v_org is null then raise exception using errcode = 'P0002', message = 'PULL_CAP_CLIENT_NOT_FOUND'; end if;
  select cap.* into v_cap from public.pull_caps as cap where cap.client_id = p_client_id for update;
  if v_cap.client_id is null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_client_id::text, 0));
  end if;
  select attempt.* into v_attempt from public.pull_cap_attempts as attempt
  where attempt.client_id = p_client_id and attempt.cause = v_cause and attempt.source_id = p_source_id;
  if v_attempt.id is not null and v_attempt.reservation_state in ('committed', 'reserved') then
    return query select v_attempt.allowed, v_attempt.reason::text; return;
  elsif v_attempt.id is not null then
    return query select false, v_attempt.reason::text; return;
  end if;
  if v_cap.client_id is not null and v_cap.min_interval_seconds is not null and exists (
    select 1 from public.pull_cap_attempts a where a.client_id=p_client_id and a.allowed
      and a.reservation_state in ('reserved','committed')
      and (a.reservation_state='committed' or a.reservation_expires_at > v_now)
      and a.decided_at > v_now - make_interval(secs => v_cap.min_interval_seconds)
  ) then v_reason := 'minimum_interval';
  elsif v_cap.client_id is not null and v_cap.max_count is not null and (
    select count(*) from public.pull_cap_attempts a where a.client_id=p_client_id and a.allowed
      and a.reservation_state in ('reserved','committed')
      and (a.reservation_state='committed' or a.reservation_expires_at > v_now)
      and a.decided_at > v_now - make_interval(secs => v_cap.count_window_seconds)
  ) >= v_cap.max_count then v_reason := 'count_window'; end if;
  insert into public.pull_cap_attempts(client_id,org_id,cause,source_id,allowed,reason,decided_at,reservation_state)
  values(p_client_id,v_org,v_cause,p_source_id,v_reason is null,v_reason,v_now,case when v_reason is null then 'committed' else 'denied' end);
  if v_reason is not null then
    insert into public.audit_log(org_id,client_id,action,subject_type,subject_id,meta)
    select v_org,p_client_id,'pull.blocked','pull_cap_attempt',a.id,
      jsonb_build_object('source',p_cause,'reason_code',v_reason::text)
    from public.pull_cap_attempts a where a.client_id=p_client_id and a.cause=v_cause and a.source_id=p_source_id;
  end if;
  return query select v_reason is null, v_reason::text;
end;
$$;

revoke all on function public.reserve_paid_refresh_pull(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.commit_paid_refresh_pull(uuid) from public, anon, authenticated;
revoke all on function public.release_paid_refresh_pull(uuid) from public, anon, authenticated;
grant execute on function public.reserve_paid_refresh_pull(uuid, uuid, integer) to service_role;
grant execute on function public.commit_paid_refresh_pull(uuid) to service_role;
grant execute on function public.release_paid_refresh_pull(uuid) to service_role;
