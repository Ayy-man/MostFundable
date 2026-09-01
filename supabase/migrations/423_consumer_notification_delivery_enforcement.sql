-- Make consumer notification preferences authoritative at creation, dispatch and feed time.
-- Consumer event email stays disabled until a provider-backed consumer dispatcher exists.

begin;

update public.consumer_notification_preferences
set email_enabled = false
where email_enabled;

alter table public.consumer_notification_preferences
  add constraint consumer_notification_preferences_email_unavailable
  check (not email_enabled);

comment on table public.consumer_notification_preferences is
  'Per-consumer event delivery choices. Disabled in-app categories are excluded from the derived feed; consumer event email is unavailable until a dispatcher is added.';
comment on column public.consumer_notification_preferences.in_app_enabled is
  'Whether this event category may create or appear as a consumer in-app notification.';
comment on column public.consumer_notification_preferences.email_enabled is
  'Reserved for consumer event email. Constrained false until a provider-backed dispatcher exists.';

-- Remove queued work for consumers who had already opted out, but retain the undelivered
-- notification as a suppression tombstone. The source-specific unique key then prevents a later
-- retry from creating and delivering the event after the consumer turns the category back on.
delete from public.notification_delivery_outbox as outbox
using public.outcome_notifications as notification,
      public.consumer_notification_preferences as preference
where outbox.notification_id = notification.id
  and notification.recipient_profile_id = preference.profile_id
  and notification.kind = 'crs_alert'
  and notification.delivered_at is null
  and preference.event_type = 'monitoring_alert'
  and not preference.in_app_enabled;

-- This migration adds explicit lifecycle deletes for suppressed delivery work,
-- so the outbox no longer satisfies the erasure-boundary predicate. Remove the
-- older contract instead of leaving a stale exemption in the live inventory.
delete from private.erasure_deletion_contracts
where table_name = 'notification_delivery_outbox';

create or replace function public.insert_crs_alert_notification(p_monitoring_event_id uuid)
returns table (notification_id uuid, inserted boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivered_at timestamptz;
  v_existing uuid;
  v_in_app_enabled boolean;
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

  -- The profile row exists before any preference row, so it is the shared serialization point for
  -- alert creation, dispatch and a consumer's first opt-out insert as well as later updates.
  perform 1
  from public.profiles as profile
  where profile.id = v_recipient
  for update;

  select preference.in_app_enabled into v_in_app_enabled
  from public.consumer_notification_preferences as preference
  where preference.profile_id = v_recipient
    and preference.event_type = 'monitoring_alert';

  select row.id, row.delivered_at into v_existing, v_delivered_at
  from public.outcome_notifications as row
  where row.monitoring_event_id = p_monitoring_event_id
    and row.recipient_profile_id = v_recipient
    and row.kind = 'crs_alert';
  if v_existing is not null then
    if not coalesce(v_in_app_enabled, true) and v_delivered_at is null then
      delete from public.notification_delivery_outbox as outbox
      where outbox.notification_id = v_existing;
      return query select null::uuid, false;
    else
      return query select v_existing, false;
    end if;
    return;
  end if;

  insert into public.outcome_notifications(monitoring_event_id, kind)
  values (p_monitoring_event_id, 'crs_alert')
  returning id into strict v_notification;

  if not coalesce(v_in_app_enabled, true) then
    -- The insert trigger creates the normal in-app outbox row. Remove only that work item and keep
    -- this source row as the durable record that the event was suppressed under the then-current
    -- preference; re-enabling the category must never replay it.
    delete from public.notification_delivery_outbox as outbox
    where outbox.notification_id = v_notification;
    return query select null::uuid, false;
    return;
  end if;

  return query select v_notification, true;
end;
$$;

create function private.enforce_consumer_notification_preference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1
  from public.profiles as profile
  where profile.id = new.profile_id
  for update;

  if new.event_type = 'monitoring_alert' and not new.in_app_enabled then
    delete from public.notification_delivery_outbox as outbox
    using public.outcome_notifications as notification
    where outbox.notification_id = notification.id
      and notification.recipient_profile_id = new.profile_id
      and notification.kind = 'crs_alert'
      and notification.delivered_at is null;
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_consumer_notification_preference()
  from public, anon, authenticated, service_role;

create trigger consumer_notification_preferences_enforce_delivery
after insert or update of in_app_enabled on public.consumer_notification_preferences
for each row execute function private.enforce_consumer_notification_preference();

create or replace function public.dispatch_notification(
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
  v_at timestamptz;
  v_channel public.notification_delivery_channel;
  v_delivery_status public.notification_delivery_status;
  v_in_app_enabled boolean;
  v_kind public.outcome_notification_kind;
  v_notification_id uuid;
  v_outbox public.notification_delivery_outbox;
  v_recipient uuid;
begin
  if p_worker is null
    or p_subject is null
    or p_window is null
    or not (
      (p_subject ~ '^client:[0-9a-fA-F-]{36}$' and p_window ~ '^notification:[0-9a-fA-F-]{36}$')
      or (p_subject ~ '^org:[0-9a-fA-F-]{36}$' and p_window ~ '^billing-event:[0-9a-fA-F-]{36}$')
    ) then
    raise exception using errcode = 'P0001', message = 'NOTIFICATION_DISPATCH_KEY_INVALID';
  end if;

  select outbox.channel, outbox.notification_id, outbox.status
  into v_channel, v_notification_id, v_delivery_status
  from public.notification_delivery_outbox as outbox
  where outbox.dispatch_subject = p_subject
    and outbox.dispatch_window = p_window;

  if v_channel is null or v_delivery_status = 'delivered' then
    return query select 'skipped'::text, 0;
    return;
  end if;

  if v_channel = 'in_app' then
    select notification.kind, notification.recipient_profile_id
    into v_kind, v_recipient
    from public.outcome_notifications as notification
    where notification.id = v_notification_id;

    if v_kind = 'crs_alert' then
      -- Use the same always-present lock as creation and the preference trigger. The preference
      -- row itself is read without another row lock, avoiding a profile/preference lock cycle.
      perform 1
      from public.profiles as profile
      where profile.id = v_recipient
      for update;

      select preference.in_app_enabled into v_in_app_enabled
      from public.consumer_notification_preferences as preference
      where preference.profile_id = v_recipient
        and preference.event_type = 'monitoring_alert';

      if not coalesce(v_in_app_enabled, true) then
        delete from public.notification_delivery_outbox
        where notification_id = v_notification_id;
        return query select 'skipped'::text, 0;
        return;
      end if;
    end if;
  end if;

  select outbox.* into v_outbox
  from public.notification_delivery_outbox as outbox
  where outbox.dispatch_subject = p_subject
    and outbox.dispatch_window = p_window
  for update;

  if v_outbox.id is null or v_outbox.status = 'delivered' then
    return query select 'skipped'::text, 0;
    return;
  end if;

  v_at := pg_catalog.clock_timestamp();
  update public.notification_delivery_outbox
  set status = 'delivered',
      attempt_count = attempt_count + 1,
      lease_owner = null,
      lease_until = null,
      error_code = null,
      delivered_at = v_at,
      updated_at = v_at
  where id = v_outbox.id;

  if v_outbox.channel = 'in_app' then
    update public.outcome_notifications
    set delivered_at = v_at
    where id = v_outbox.notification_id;
  end if;

  return query select 'ok'::text, 1;
end;
$$;

revoke all on function public.insert_crs_alert_notification(uuid)
  from public, anon, authenticated;
revoke all on function public.dispatch_notification(text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.insert_crs_alert_notification(uuid) to service_role;
grant execute on function public.dispatch_notification(text, text, uuid) to service_role;

commit;
