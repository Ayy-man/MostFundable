-- R1C-01: make Stripe webhook delivery admission an atomic, leased claim.

alter table public.stripe_webhook_events
  add column if not exists lease_owner uuid,
  add column if not exists lease_until timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.stripe_webhook_events'::regclass
      and conname = 'stripe_webhook_events_lease_pair'
  ) then
    alter table public.stripe_webhook_events
      add constraint stripe_webhook_events_lease_pair check (
        (lease_owner is null and lease_until is null)
        or (lease_owner is not null and lease_until is not null)
      );
  end if;
end
$$;

create index if not exists stripe_webhook_events_reclaim_idx
  on public.stripe_webhook_events(status, lease_until, received_at)
  where status in ('received', 'failed');

create or replace function public.claim_stripe_webhook_event(
  p_event_id text,
  p_event_type text,
  p_lease_owner uuid,
  p_lease_seconds integer default 300
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_claimed integer;
begin
  if nullif(pg_catalog.btrim(p_event_id), '') is null
    or nullif(pg_catalog.btrim(p_event_type), '') is null
    or p_lease_owner is null
    or p_lease_seconds < 30
    or p_lease_seconds > 900 then
    raise exception using errcode = '22023', message = 'invalid webhook claim';
  end if;

  insert into public.stripe_webhook_events (
    event_id, event_type, received_at, status, attempts,
    last_error_code, processed_at, lease_owner, lease_until
  ) values (
    p_event_id, p_event_type, pg_catalog.now(), 'received', 1,
    null, null, p_lease_owner,
    pg_catalog.now() + pg_catalog.make_interval(secs => p_lease_seconds)
  )
  on conflict (event_id) do update
  set received_at = pg_catalog.now(),
      status = 'received',
      attempts = public.stripe_webhook_events.attempts + 1,
      last_error_code = null,
      processed_at = null,
      lease_owner = excluded.lease_owner,
      lease_until = excluded.lease_until
  where public.stripe_webhook_events.event_type = excluded.event_type
    and (
      public.stripe_webhook_events.status = 'failed'
      or (
        public.stripe_webhook_events.status = 'received'
        and coalesce(
          public.stripe_webhook_events.lease_until,
          '-infinity'::timestamptz
        ) <= pg_catalog.now()
      )
    );

  get diagnostics v_claimed = row_count;
  return v_claimed = 1;
end
$fn$;

create or replace function public.finish_stripe_webhook_event(
  p_event_id text,
  p_lease_owner uuid,
  p_status text,
  p_error_code text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_finished integer;
begin
  if p_status not in ('processed', 'ignored', 'failed')
    or (p_status = 'failed' and nullif(pg_catalog.btrim(p_error_code), '') is null)
    or (p_status <> 'failed' and p_error_code is not null)
    or pg_catalog.length(p_error_code) > 64 then
    raise exception using errcode = '22023', message = 'invalid webhook finish';
  end if;

  update public.stripe_webhook_events as event
  set status = p_status,
      processed_at = pg_catalog.now(),
      last_error_code = p_error_code,
      lease_owner = null,
      lease_until = null
  where event.event_id = p_event_id
    and event.status = 'received'
    and event.lease_owner = p_lease_owner;

  get diagnostics v_finished = row_count;
  return v_finished = 1;
end
$fn$;

revoke all on function public.claim_stripe_webhook_event(text, text, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.finish_stripe_webhook_event(text, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.claim_stripe_webhook_event(text, text, uuid, integer)
  to service_role;
grant execute on function public.finish_stripe_webhook_event(text, uuid, text, text)
  to service_role;
