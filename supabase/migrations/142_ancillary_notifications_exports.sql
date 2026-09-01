alter table public.outcome_notifications
  add column client_id uuid references public.clients(id) on delete cascade,
  add column monitoring_event_id uuid references public.monitoring_events(id) on delete cascade,
  add column delivered_at timestamptz;

update public.outcome_notifications as notification
set client_id = outcome.client_id
from public.outcomes as outcome
where outcome.id = notification.outcome_id
  and notification.client_id is null;

alter table public.outcome_notifications
  alter column outcome_id drop not null,
  add constraint outcome_notifications_exactly_one_source check (
    (outcome_id is not null)::integer + (monitoring_event_id is not null)::integer = 1
  );

create unique index outcome_notifications_monitoring_unique
  on public.outcome_notifications(monitoring_event_id, recipient_profile_id, kind)
  where monitoring_event_id is not null;
create index outcome_notifications_recipient_delivered_idx
  on public.outcome_notifications(recipient_profile_id, delivered_at desc, created_at desc)
  where delivered_at is not null;

create function private.derive_outcome_notification_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client uuid;
  v_event_type text;
  v_org uuid;
  v_recipient uuid;
begin
  if (new.outcome_id is not null)::integer + (new.monitoring_event_id is not null)::integer <> 1 then
    raise exception using errcode = 'P0001', message = 'NOTIFICATION_SOURCE_INVALID';
  end if;

  if new.outcome_id is not null then
    select outcome.client_id, client.org_id, coalesce(client.assigned_to, outcome.recorded_by)
    into v_client, v_org, v_recipient
    from public.outcomes as outcome
    join public.clients as client on client.id = outcome.client_id
    where outcome.id = new.outcome_id;
  else
    select event.client_id, client.org_id, client.consumer_profile_id, event.event_type
    into v_client, v_org, v_recipient, v_event_type
    from public.monitoring_events as event
    join public.clients as client on client.id = event.client_id
    where event.id = new.monitoring_event_id;

    if v_event_type is distinct from 'ACCALERT' or new.kind <> 'crs_alert' then
      raise exception using errcode = 'P0001', message = 'NOTIFICATION_EVENT_INVALID';
    end if;
  end if;

  if v_client is null or v_org is null or v_recipient is null then
    raise exception using errcode = 'P0001', message = 'NOTIFICATION_RECIPIENT_UNAVAILABLE';
  end if;
  if (new.client_id is not null and new.client_id <> v_client)
    or (new.org_id is not null and new.org_id <> v_org)
    or (new.recipient_profile_id is not null and new.recipient_profile_id <> v_recipient) then
    raise exception using errcode = 'P0001', message = 'NOTIFICATION_SCOPE_INVALID';
  end if;

  new.client_id := v_client;
  new.org_id := v_org;
  new.recipient_profile_id := v_recipient;
  return new;
end;
$$;

create trigger outcome_notifications_derive_scope
before insert on public.outcome_notifications
for each row execute function private.derive_outcome_notification_scope();

create type public.notification_delivery_status as enum (
  'queued', 'running', 'delivered', 'failed'
);

create table public.notification_delivery_outbox (
  id uuid primary key default extensions.gen_random_uuid(),
  notification_id uuid not null unique
    references public.outcome_notifications(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  job text not null default 'notifications.dispatch',
  subject text generated always as ('client:'::text || client_id::text) stored,
  "window" text generated always as (
    'notification:'::text || notification_id::text
  ) stored,
  idempotency_key text generated always as (
    job || '|'::text || 'client:'::text || client_id::text || '|'::text
    || 'notification:'::text || notification_id::text
  ) stored,
  status public.notification_delivery_status not null default 'queued',
  attempt_count integer not null default 0,
  available_at timestamptz not null default now(),
  lease_owner uuid,
  lease_until timestamptz,
  error_code text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_delivery_job_check check (job = 'notifications.dispatch'),
  constraint notification_delivery_attempt_nonnegative check (attempt_count >= 0),
  constraint notification_delivery_lease_pair check (
    (lease_owner is null and lease_until is null)
    or (lease_owner is not null and lease_until is not null)
  ),
  constraint notification_delivery_error_bound check (
    error_code is null or char_length(error_code) between 1 and 64
  ),
  constraint notification_delivery_state_shape check (
    (status = 'delivered' and delivered_at is not null and error_code is null)
    or (status = 'failed' and delivered_at is null and error_code is not null)
    or (status in ('queued', 'running') and delivered_at is null and error_code is null)
  ),
  constraint notification_delivery_idempotency_unique unique (idempotency_key)
);

create index notification_delivery_claim_idx
  on public.notification_delivery_outbox(status, available_at, lease_until, created_at);

alter table public.notification_delivery_outbox enable row level security;
alter table public.notification_delivery_outbox force row level security;
revoke all on table public.notification_delivery_outbox from public, anon, authenticated;
grant all on table public.notification_delivery_outbox to service_role;

create function private.queue_outcome_notification_delivery()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind in ('outcome_review_approved', 'crs_alert') then
    insert into public.notification_delivery_outbox(notification_id, client_id)
    values (new.id, new.client_id)
    on conflict (notification_id) do nothing;
  end if;
  return new;
end;
$$;

create trigger outcome_notifications_queue_delivery
after insert on public.outcome_notifications
for each row execute function private.queue_outcome_notification_delivery();

insert into public.notification_delivery_outbox(notification_id, client_id)
select notification.id, notification.client_id
from public.outcome_notifications as notification
where notification.kind = 'outcome_review_approved'
  and notification.client_id is not null
on conflict (notification_id) do nothing;

create function public.insert_crs_alert_notification(p_monitoring_event_id uuid)
returns table (notification_id uuid, inserted boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing uuid;
  v_notification uuid;
  v_recipient uuid;
begin
  select client.consumer_profile_id into v_recipient
  from public.monitoring_events as event
  join public.clients as client on client.id = event.client_id
  where event.id = p_monitoring_event_id
    and event.event_type = 'ACCALERT';

  if v_recipient is null then
    raise exception using errcode = 'P0001', message = 'NOTIFICATION_EVENT_INVALID';
  end if;

  select row.id into v_existing
  from public.outcome_notifications as row
  where row.monitoring_event_id = p_monitoring_event_id
    and row.recipient_profile_id = v_recipient
    and row.kind = 'crs_alert';
  if v_existing is not null then
    return query select v_existing, false;
    return;
  end if;

  insert into public.outcome_notifications(monitoring_event_id, kind)
  values (p_monitoring_event_id, 'crs_alert')
  returning id into strict v_notification;

  return query select v_notification, true;
end;
$$;

create function public.dispatch_notification(
  p_subject text,
  p_window text,
  p_worker uuid
)
returns table (status text, rows integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outbox public.notification_delivery_outbox;
  v_at timestamptz;
begin
  if p_worker is null
    or p_subject is null
    or p_subject !~ '^client:[0-9a-fA-F-]{36}$'
    or p_window is null
    or p_window !~ '^notification:[0-9a-fA-F-]{36}$' then
    raise exception using errcode = 'P0001', message = 'NOTIFICATION_DISPATCH_KEY_INVALID';
  end if;

  select outbox.* into v_outbox
  from public.notification_delivery_outbox as outbox
  where outbox.subject = p_subject
    and outbox."window" = p_window
  for update;

  if v_outbox.id is null then
    return query select 'skipped'::text, 0;
    return;
  end if;
  if v_outbox.status = 'delivered' then
    return query select 'skipped'::text, 0;
    return;
  end if;

  v_at := clock_timestamp();
  update public.notification_delivery_outbox
  set status = 'delivered',
      attempt_count = attempt_count + 1,
      lease_owner = null,
      lease_until = null,
      error_code = null,
      delivered_at = v_at,
      updated_at = v_at
  where id = v_outbox.id;

  update public.outcome_notifications
  set delivered_at = v_at
  where id = v_outbox.notification_id;

  return query select 'ok'::text, 1;
end;
$$;

revoke all on function private.derive_outcome_notification_scope() from public;
revoke all on function private.queue_outcome_notification_delivery() from public;
revoke all on function public.insert_crs_alert_notification(uuid)
  from public, anon, authenticated;
revoke all on function public.dispatch_notification(text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.insert_crs_alert_notification(uuid) to service_role;
grant execute on function public.dispatch_notification(text, text, uuid) to service_role;

create or replace function private.audit_meta_valid(p_meta jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  filter_item jsonb;
  filter_key text;
  item jsonb;
  meta_key text;
  numeric_value numeric;
begin
  if p_meta is null or jsonb_typeof(p_meta) <> 'object' then
    return false;
  end if;

  for meta_key in select key from jsonb_object_keys(p_meta) as key
  loop
    if meta_key not in (
      'count',
      'dataset',
      'driver',
      'eventKey',
      'field_names',
      'filters',
      'format',
      'from',
      'from_state',
      'job',
      'reason_code',
      'row_count',
      'source',
      'status',
      'to',
      'to_state',
      'version'
    ) then
      return false;
    end if;

    if meta_key in ('count', 'row_count') then
      if jsonb_typeof(p_meta -> meta_key) <> 'number' then
        return false;
      end if;
      numeric_value := (p_meta ->> meta_key)::numeric;
      if numeric_value < 0 or numeric_value <> trunc(numeric_value) then
        return false;
      end if;
    elsif meta_key = 'dataset' then
      if jsonb_typeof(p_meta -> meta_key) <> 'string'
        or p_meta ->> meta_key not in (
          'analysis_runs', 'plans', 'checklist_item_state',
          'bank_outcome_stats', 'bank_retrieval_index'
        ) then
        return false;
      end if;
    elsif meta_key = 'format' then
      if jsonb_typeof(p_meta -> meta_key) <> 'string'
        or p_meta ->> meta_key not in ('csv', 'json') then
        return false;
      end if;
    elsif meta_key = 'filters' then
      if jsonb_typeof(p_meta -> meta_key) <> 'object'
        or (
          select count(*) from jsonb_object_keys(p_meta -> meta_key)
        ) > 8 then
        return false;
      end if;
      for filter_key, filter_item in
        select key, value from jsonb_each(p_meta -> meta_key)
      loop
        if filter_key not in (
          'client_id', 'analysis_run_id', 'bank_ref', 'state',
          'kind', 'from', 'to', 'status'
        ) then
          return false;
        end if;
        if jsonb_typeof(filter_item) in ('array', 'object')
          or length(filter_item #>> '{}') > 128 then
          return false;
        end if;
      end loop;
    elsif meta_key = 'field_names' then
      if jsonb_typeof(p_meta -> meta_key) <> 'array'
        or jsonb_array_length(p_meta -> meta_key) > 32 then
        return false;
      end if;
      for item in select value from jsonb_array_elements(p_meta -> meta_key)
      loop
        if jsonb_typeof(item) <> 'string' or length(item #>> '{}') > 64 then
          return false;
        end if;
      end loop;
    elsif jsonb_typeof(p_meta -> meta_key) <> 'string'
      or length(p_meta ->> meta_key) > 128 then
      return false;
    end if;
  end loop;

  return true;
exception
  when others then
    return false;
end;
$$;
