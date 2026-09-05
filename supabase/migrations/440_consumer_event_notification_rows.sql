-- B2: give the six read-time consumer event types a durable delivery row.
--
-- The consumer feed derives stage changes, plans, refresh results, onboarding steps, documents
-- and team messages straight from their source tables, so nothing about them was ever queued and
-- the email dispatcher (migration 434) could only ever see a credit alert or an application
-- update. This migration makes each source table's insert produce one `outcome_notifications`
-- row in the same transaction, which the existing queue trigger turns into the one in-app
-- delivery row that consumer email hangs off. The feed keeps deriving its rows at read time;
-- what changes is that every event a consumer can toggle now reaches the dispatcher.
--
-- The new enum labels are added outside the transaction, as migration 140 did, because a label
-- added inside one cannot be used until it commits.

alter type public.outcome_notification_kind add value if not exists 'stage_change';
alter type public.outcome_notification_kind add value if not exists 'analysis_complete';
alter type public.outcome_notification_kind add value if not exists 'refresh_result';
alter type public.outcome_notification_kind add value if not exists 'enrollment_milestone';
alter type public.outcome_notification_kind add value if not exists 'document';
alter type public.outcome_notification_kind add value if not exists 'team_message';

begin;

-- ---------------------------------------------------------------------------
-- One nullable source column per event, every one cascading from its source so the erasure
-- boundary (migration 350: "cascades from orgs, outcomes and profiles by design") holds.
-- ---------------------------------------------------------------------------

alter table public.outcome_notifications
  add column stage_history_id uuid references public.stage_history(id) on delete cascade,
  add column plan_id uuid references public.plans(id) on delete cascade,
  add column enrollment_milestone_client_id uuid,
  add column enrollment_milestone_kind public.enrollment_milestone_kind,
  add column consent_id uuid references public.consents(id) on delete cascade,
  add column document_upload_id uuid references public.document_uploads(id) on delete cascade,
  add column support_message_id uuid references public.support_messages(id) on delete cascade,
  add constraint outcome_notifications_enrollment_milestone_fkey
    foreign key (enrollment_milestone_client_id, enrollment_milestone_kind)
    references public.enrollment_milestones(client_id, kind) on delete cascade,
  add constraint outcome_notifications_enrollment_milestone_pair check (
    (enrollment_milestone_client_id is null) = (enrollment_milestone_kind is null)
  ),
  drop constraint outcome_notifications_exactly_one_source,
  add constraint outcome_notifications_exactly_one_source check (
    (outcome_id is not null)::integer
    + (monitoring_event_id is not null)::integer
    + (stage_history_id is not null)::integer
    + (plan_id is not null)::integer
    + (enrollment_milestone_client_id is not null)::integer
    + (consent_id is not null)::integer
    + (document_upload_id is not null)::integer
    + (support_message_id is not null)::integer
    = 1
  );

-- The same shape as `outcome_notifications_monitoring_unique`: one source, one recipient, one
-- kind, so a replayed insert is a no-op rather than a second email.
create unique index outcome_notifications_stage_history_unique
  on public.outcome_notifications(stage_history_id, recipient_profile_id, kind)
  where stage_history_id is not null;
create unique index outcome_notifications_plan_unique
  on public.outcome_notifications(plan_id, recipient_profile_id, kind)
  where plan_id is not null;
create unique index outcome_notifications_enrollment_milestone_unique
  on public.outcome_notifications(
    enrollment_milestone_client_id, enrollment_milestone_kind, recipient_profile_id, kind
  )
  where enrollment_milestone_client_id is not null;
create unique index outcome_notifications_consent_unique
  on public.outcome_notifications(consent_id, recipient_profile_id, kind)
  where consent_id is not null;
create unique index outcome_notifications_document_upload_unique
  on public.outcome_notifications(document_upload_id, recipient_profile_id, kind)
  where document_upload_id is not null;
create unique index outcome_notifications_support_message_unique
  on public.outcome_notifications(support_message_id, recipient_profile_id, kind)
  where support_message_id is not null;

comment on table public.outcome_notifications is
  'One durable row per consumer-facing event: application outcomes, credit alerts, and (from migration 440) stage changes, plans, refresh results, onboarding steps, documents and team messages. The per-source unique indexes are what make a replayed source insert produce no second delivery.';

-- ---------------------------------------------------------------------------
-- The kind-to-category map, in one place, matching EVENT_TYPE_BY_KIND in
-- web/src/lib/notifications/email-dispatch.server.ts. Null means the kind is not a consumer
-- category (`outcome_review_removed`), so it is neither queued nor governed by a preference.
-- ---------------------------------------------------------------------------

create function private.consumer_notification_event_type(p_kind public.outcome_notification_kind)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select case p_kind::text
    when 'crs_alert' then 'monitoring_alert'
    when 'outcome_review_approved' then 'application_update'
    when 'stage_change' then 'stage_change'
    when 'analysis_complete' then 'analysis_complete'
    when 'refresh_result' then 'refresh_result'
    when 'enrollment_milestone' then 'enrollment_milestone'
    when 'document' then 'document'
    when 'team_message' then 'team_message'
    else null
  end;
$fn$;

revoke all on function private.consumer_notification_event_type(public.outcome_notification_kind)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Scope derivation: each new source resolves the client, the tenant and the consumer, and the
-- kind must be the one that source produces, the way an ACCALERT must be a `crs_alert`.
-- ---------------------------------------------------------------------------

create or replace function private.derive_outcome_notification_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client uuid;
  v_event_type text;
  v_expected_kind text;
  v_org uuid;
  v_recipient uuid;
begin
  if (new.outcome_id is not null)::integer
    + (new.monitoring_event_id is not null)::integer
    + (new.stage_history_id is not null)::integer
    + (new.plan_id is not null)::integer
    + (new.enrollment_milestone_client_id is not null)::integer
    + (new.consent_id is not null)::integer
    + (new.document_upload_id is not null)::integer
    + (new.support_message_id is not null)::integer <> 1 then
    raise exception using errcode = 'P0001', message = 'NOTIFICATION_SOURCE_INVALID';
  end if;

  if new.outcome_id is not null then
    select outcome.client_id, client.org_id, coalesce(client.assigned_to, outcome.recorded_by)
    into v_client, v_org, v_recipient
    from public.outcomes as outcome
    join public.clients as client on client.id = outcome.client_id
    where outcome.id = new.outcome_id;
  elsif new.monitoring_event_id is not null then
    select event.client_id, client.org_id, client.consumer_profile_id, event.event_type
    into v_client, v_org, v_recipient, v_event_type
    from public.monitoring_events as event
    join public.clients as client on client.id = event.client_id
    where event.id = new.monitoring_event_id;

    if v_event_type is distinct from 'ACCALERT' or new.kind::text <> 'crs_alert' then
      raise exception using errcode = 'P0001', message = 'NOTIFICATION_EVENT_INVALID';
    end if;
  elsif new.stage_history_id is not null then
    select history.client_id, client.org_id, client.consumer_profile_id, 'stage_change'
    into v_client, v_org, v_recipient, v_expected_kind
    from public.stage_history as history
    join public.clients as client on client.id = history.client_id
    where history.id = new.stage_history_id;
  elsif new.plan_id is not null then
    -- A plan built for a paid refresh is the refresh result; any other plan is a plan.
    select
      plan.client_id,
      client.org_id,
      client.consumer_profile_id,
      case when run.trigger = 'force_pull' then 'refresh_result' else 'analysis_complete' end
    into v_client, v_org, v_recipient, v_expected_kind
    from public.plans as plan
    join public.analysis_runs as run on run.id = plan.analysis_run_id
    join public.clients as client on client.id = plan.client_id
    where plan.id = new.plan_id;
  elsif new.enrollment_milestone_client_id is not null then
    select
      milestone.client_id,
      client.org_id,
      client.consumer_profile_id,
      case when milestone.completed_at is not null then 'enrollment_milestone' end
    into v_client, v_org, v_recipient, v_expected_kind
    from public.enrollment_milestones as milestone
    join public.clients as client on client.id = milestone.client_id
    where milestone.client_id = new.enrollment_milestone_client_id
      and milestone.kind = new.enrollment_milestone_kind;
  elsif new.consent_id is not null then
    select
      consent.client_id,
      client.org_id,
      client.consumer_profile_id,
      case when consent.action = 'granted' then 'enrollment_milestone' end
    into v_client, v_org, v_recipient, v_expected_kind
    from public.consents as consent
    join public.clients as client on client.id = consent.client_id
    where consent.id = new.consent_id;
  elsif new.document_upload_id is not null then
    select
      upload.client_id,
      client.org_id,
      client.consumer_profile_id,
      case when upload.kind = 'company' and upload.section is not null then 'document' end
    into v_client, v_org, v_recipient, v_expected_kind
    from public.document_uploads as upload
    join public.clients as client on client.id = upload.client_id
    where upload.id = new.document_upload_id;
  else
    -- Only a message from the team, in the client's team chat, that the client is meant to see.
    select
      thread.client_id,
      client.org_id,
      client.consumer_profile_id,
      case
        when thread.kind = 'team_chat'
          and message.author_kind <> 'consumer'
          and message.visibility = 'participants'
        then 'team_message'
      end
    into v_client, v_org, v_recipient, v_expected_kind
    from public.support_messages as message
    join public.support_threads as thread on thread.id = message.thread_id
    join public.clients as client on client.id = thread.client_id
    where message.id = new.support_message_id;
  end if;

  if new.outcome_id is null and new.monitoring_event_id is null
    and new.kind::text is distinct from v_expected_kind then
    raise exception using errcode = 'P0001', message = 'NOTIFICATION_EVENT_INVALID';
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

-- ---------------------------------------------------------------------------
-- Queueing: every consumer category queues one in-app delivery, and the in-app preference is
-- checked here, at creation, the way `insert_crs_alert_notification` checks it for an alert. A
-- category the consumer has off keeps its source row as a suppression tombstone (the unique index
-- then refuses a replay after re-enable) and queues nothing, so neither the in-app dispatch nor
-- the email that rides on it can happen.
-- ---------------------------------------------------------------------------

create or replace function private.queue_outcome_notification_delivery()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_type text;
  v_in_app_enabled boolean;
begin
  v_event_type := private.consumer_notification_event_type(new.kind);
  if v_event_type is null then
    return new;
  end if;

  -- The same serialization point creation, dispatch and preference writes all use.
  perform 1
  from public.profiles as profile
  where profile.id = new.recipient_profile_id
  for update;

  select preference.in_app_enabled into v_in_app_enabled
  from public.consumer_notification_preferences as preference
  where preference.profile_id = new.recipient_profile_id
    and preference.event_type = v_event_type;

  if not coalesce(v_in_app_enabled, true) then
    return new;
  end if;

  insert into public.notification_delivery_outbox(notification_id, client_id)
  values (new.id, new.client_id)
  on conflict (notification_id) do nothing;
  return new;
end;
$$;

-- Opting a category out removes its queued, undelivered work for every kind in that category, not
-- only a credit alert's.
create or replace function private.enforce_consumer_notification_preference()
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

  if not new.in_app_enabled then
    delete from public.notification_delivery_outbox as outbox
    using public.outcome_notifications as notification
    where outbox.notification_id = notification.id
      and notification.recipient_profile_id = new.profile_id
      and private.consumer_notification_event_type(notification.kind) = new.event_type
      and notification.delivered_at is null;
  end if;
  return new;
end;
$$;

-- Dispatch rechecks the current preference for every consumer category, so a row queued before an
-- opt-out is dropped rather than delivered.
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
  v_event_type text;
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

    v_event_type := private.consumer_notification_event_type(v_kind);
    if v_event_type is not null then
      -- Use the same always-present lock as creation and the preference trigger. The preference
      -- row itself is read without another row lock, avoiding a profile/preference lock cycle.
      perform 1
      from public.profiles as profile
      where profile.id = v_recipient
      for update;

      select preference.in_app_enabled into v_in_app_enabled
      from public.consumer_notification_preferences as preference
      where preference.profile_id = v_recipient
        and preference.event_type = v_event_type;

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

-- ---------------------------------------------------------------------------
-- The producers. Each fires after its source row is inserted, in the same transaction, and only
-- for a client that has a consumer to notify and is still active (the feed's own scope). A source
-- the feed would not show (an internal note, a consumer's own message, a revoked consent, a
-- milestone row without a completion) produces nothing. Nothing is backfilled: the rows that
-- existed before this migration were already shown in the feed and were never promised an email.
-- ---------------------------------------------------------------------------

create function private.consumer_notification_recipient_ready(p_client_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.clients as client
    where client.id = p_client_id
      and client.consumer_profile_id is not null
      and client.status = 'active'
  );
$fn$;

revoke all on function private.consumer_notification_recipient_ready(uuid)
  from public, anon, authenticated, service_role;

create function private.notify_consumer_stage_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.consumer_notification_recipient_ready(new.client_id) then
    insert into public.outcome_notifications (stage_history_id, kind)
    values (new.id, 'stage_change')
    on conflict do nothing;
  end if;
  return new;
end;
$$;

create function private.notify_consumer_plan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trigger public.analysis_trigger;
begin
  if private.consumer_notification_recipient_ready(new.client_id) then
    select run.trigger into v_trigger
    from public.analysis_runs as run
    where run.id = new.analysis_run_id;

    insert into public.outcome_notifications (plan_id, kind)
    values (
      new.id,
      (case when v_trigger = 'force_pull' then 'refresh_result' else 'analysis_complete' end)
        ::public.outcome_notification_kind
    )
    on conflict do nothing;
  end if;
  return new;
end;
$$;

create function private.notify_consumer_enrollment_milestone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.completed_at is not null
    and private.consumer_notification_recipient_ready(new.client_id) then
    insert into public.outcome_notifications (
      enrollment_milestone_client_id, enrollment_milestone_kind, kind
    )
    values (new.client_id, new.kind, 'enrollment_milestone')
    on conflict do nothing;
  end if;
  return new;
end;
$$;

create function private.notify_consumer_consent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.action = 'granted'
    and private.consumer_notification_recipient_ready(new.client_id) then
    insert into public.outcome_notifications (consent_id, kind)
    values (new.id, 'enrollment_milestone')
    on conflict do nothing;
  end if;
  return new;
end;
$$;

create function private.notify_consumer_document()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind = 'company'
    and new.section is not null
    and private.consumer_notification_recipient_ready(new.client_id) then
    insert into public.outcome_notifications (document_upload_id, kind)
    values (new.id, 'document')
    on conflict do nothing;
  end if;
  return new;
end;
$$;

create function private.notify_consumer_team_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client uuid;
begin
  if new.author_kind = 'consumer' or new.visibility <> 'participants' then
    return new;
  end if;

  select thread.client_id into v_client
  from public.support_threads as thread
  where thread.id = new.thread_id
    and thread.kind = 'team_chat';

  if v_client is not null and private.consumer_notification_recipient_ready(v_client) then
    insert into public.outcome_notifications (support_message_id, kind)
    values (new.id, 'team_message')
    on conflict do nothing;
  end if;
  return new;
end;
$$;

revoke all on function private.notify_consumer_stage_change() from public;
revoke all on function private.notify_consumer_plan() from public;
revoke all on function private.notify_consumer_enrollment_milestone() from public;
revoke all on function private.notify_consumer_consent() from public;
revoke all on function private.notify_consumer_document() from public;
revoke all on function private.notify_consumer_team_message() from public;

create trigger stage_history_notify_consumer
after insert on public.stage_history
for each row execute function private.notify_consumer_stage_change();

create trigger plans_notify_consumer
after insert on public.plans
for each row execute function private.notify_consumer_plan();

create trigger enrollment_milestones_notify_consumer
after insert on public.enrollment_milestones
for each row execute function private.notify_consumer_enrollment_milestone();

create trigger consents_notify_consumer
after insert on public.consents
for each row execute function private.notify_consumer_consent();

create trigger document_uploads_notify_consumer
after insert on public.document_uploads
for each row execute function private.notify_consumer_document();

create trigger support_messages_notify_consumer
after insert on public.support_messages
for each row execute function private.notify_consumer_team_message();

revoke all on function private.derive_outcome_notification_scope() from public;
revoke all on function private.queue_outcome_notification_delivery() from public;
revoke all on function private.enforce_consumer_notification_preference()
  from public, anon, authenticated, service_role;
revoke all on function public.dispatch_notification(text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.dispatch_notification(text, text, uuid) to service_role;

commit;
