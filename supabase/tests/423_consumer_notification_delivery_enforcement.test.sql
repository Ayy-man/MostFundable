begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(29);

-- Migration 434 lifted the email-unavailable constraint when the consumer dispatcher arrived, and
-- test 434 owns the replacement assertions. What this file still guards is the in-app half: the
-- preference row governs creation, dispatch and the feed regardless of the email channel.
select has_column(
  'public',
  'consumer_notification_preferences',
  'email_enabled',
  'the email choice is still a durable per-consumer column'
);
select has_trigger(
  'public',
  'consumer_notification_preferences',
  'consumer_notification_preferences_enforce_delivery',
  'preference changes enforce pending in-app delivery immediately'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from pg_catalog.pg_proc as routine
    where routine.oid in (
      'public.insert_crs_alert_notification(uuid)'::regprocedure,
      'private.enforce_consumer_notification_preference()'::regprocedure,
      'public.dispatch_notification(text,text,uuid)'::regprocedure
    )
      and pg_catalog.strpos(pg_catalog.pg_get_functiondef(routine.oid), 'from public.profiles') > 0
      and pg_catalog.strpos(pg_catalog.pg_get_functiondef(routine.oid), 'for update') > 0
  ),
  3,
  'creation, first preference insert and dispatch serialize on the same profile row'
);

insert into auth.users (id, email)
values ('42300000-0000-4000-8000-000000000011', 'consumer@notification-enforcement.test');

insert into public.orgs (id, name, slug)
values (
  '42300000-0000-4000-8000-000000000001',
  'Notification Enforcement Org',
  'notification-enforcement-org'
);

insert into public.profiles (id, role, org_id, full_name, email)
values (
  '42300000-0000-4000-8000-000000000011',
  'consumer',
  '42300000-0000-4000-8000-000000000001',
  'Notification Consumer',
  'consumer@notification-enforcement.test'
)
on conflict (id) do update set
  role = excluded.role,
  org_id = excluded.org_id,
  full_name = excluded.full_name,
  email = excluded.email;

insert into public.clients (id, org_id, consumer_profile_id, display_name)
values (
  '42300000-0000-4000-8000-000000000101',
  '42300000-0000-4000-8000-000000000001',
  '42300000-0000-4000-8000-000000000011',
  'Notification Enforcement Client'
);

select is(
  (
    select pg_catalog.count(*)::integer
    from public.consumer_notification_preferences
    where profile_id = '42300000-0000-4000-8000-000000000011'
      and email_enabled
  ),
  2,
  'a new consumer is seeded with the two default email categories (migration 434)'
);

select lives_ok(
  $$
    update public.consumer_notification_preferences
    set email_enabled = true
    where profile_id = '42300000-0000-4000-8000-000000000011'
      and event_type = 'team_message'
  $$,
  'the email choice is writable now that a dispatcher exists'
);

insert into public.monitoring_events (id, client_id, event_type, occurred_at)
values
  (
    '42300000-0000-4000-8000-000000000201',
    '42300000-0000-4000-8000-000000000101',
    'ACCALERT',
    '2026-09-01T08:00:00Z'
  ),
  (
    '42300000-0000-4000-8000-000000000202',
    '42300000-0000-4000-8000-000000000101',
    'ACCALERT',
    '2026-09-01T08:01:00Z'
  ),
  (
    '42300000-0000-4000-8000-000000000203',
    '42300000-0000-4000-8000-000000000101',
    'ACCALERT',
    '2026-09-01T08:02:00Z'
  ),
  (
    '42300000-0000-4000-8000-000000000204',
    '42300000-0000-4000-8000-000000000101',
    'ACCALERT',
    '2026-09-01T08:03:00Z'
  ),
  (
    '42300000-0000-4000-8000-000000000205',
    '42300000-0000-4000-8000-000000000101',
    'ACCALERT',
    '2026-09-01T08:04:00Z'
  );

update public.consumer_notification_preferences
set in_app_enabled = false
where profile_id = '42300000-0000-4000-8000-000000000011'
  and event_type = 'monitoring_alert';

select results_eq(
  $$select notification_id, inserted from public.insert_crs_alert_notification(
    '42300000-0000-4000-8000-000000000201'
  )$$,
  $$values (null::uuid, false)$$,
  'an opted-out ACCALERT reports suppression without creating a notification id'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from public.outcome_notifications
    where monitoring_event_id = '42300000-0000-4000-8000-000000000201'
  ),
  1,
  'an opted-out ACCALERT retains one suppression tombstone'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from public.notification_delivery_outbox as outbox
    join public.outcome_notifications as notification on notification.id = outbox.notification_id
    where notification.monitoring_event_id = '42300000-0000-4000-8000-000000000201'
  ),
  0,
  'an opted-out ACCALERT queues no in-app delivery'
);

update public.consumer_notification_preferences
set in_app_enabled = true
where profile_id = '42300000-0000-4000-8000-000000000011'
  and event_type = 'monitoring_alert';

select results_eq(
  $$select inserted from public.insert_crs_alert_notification(
    '42300000-0000-4000-8000-000000000201'
  )$$,
  $$values (false)$$,
  're-enabling and retrying a suppressed source does not create another notification'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from public.notification_delivery_outbox as outbox
    join public.outcome_notifications as notification on notification.id = outbox.notification_id
    where notification.monitoring_event_id = '42300000-0000-4000-8000-000000000201'
  ),
  0,
  're-enabling does not turn the suppression tombstone into queued work'
);

select results_eq(
  $$select inserted from public.insert_crs_alert_notification(
    '42300000-0000-4000-8000-000000000202'
  )$$,
  $$values (true)$$,
  'an enabled ACCALERT creates its in-app notification'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from public.notification_delivery_outbox as outbox
    join public.outcome_notifications as notification on notification.id = outbox.notification_id
    where notification.monitoring_event_id = '42300000-0000-4000-8000-000000000202'
  ),
  1,
  'an enabled alert queues one in-app delivery'
);

update public.consumer_notification_preferences
set in_app_enabled = false
where profile_id = '42300000-0000-4000-8000-000000000011'
  and event_type = 'monitoring_alert';

select is(
  (
    select pg_catalog.count(*)::integer
    from public.outcome_notifications
    where monitoring_event_id = '42300000-0000-4000-8000-000000000202'
  ),
  1,
  'opting out retains an undelivered alert as a suppression tombstone'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from public.notification_delivery_outbox
    where client_id = '42300000-0000-4000-8000-000000000101'
  ),
  0,
  'opting out removes queued work while retaining the undelivered alert tombstone'
);

update public.consumer_notification_preferences
set in_app_enabled = true
where profile_id = '42300000-0000-4000-8000-000000000011'
  and event_type = 'monitoring_alert';

select results_eq(
  $$select inserted from public.insert_crs_alert_notification(
    '42300000-0000-4000-8000-000000000202'
  )$$,
  $$values (false)$$,
  'an alert queued before opt-out remains suppressed after re-enable and retry'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from public.notification_delivery_outbox as outbox
    join public.outcome_notifications as notification on notification.id = outbox.notification_id
    where notification.monitoring_event_id = '42300000-0000-4000-8000-000000000202'
  ),
  0,
  'a queued-then-suppressed alert is never requeued by retry'
);

delete from public.consumer_notification_preferences
where profile_id = '42300000-0000-4000-8000-000000000011'
  and event_type = 'monitoring_alert';

select results_eq(
  $$select inserted from public.insert_crs_alert_notification(
    '42300000-0000-4000-8000-000000000205'
  )$$,
  $$values (true)$$,
  'a missing preference row keeps the documented default-on behavior'
);

insert into public.consumer_notification_preferences (
  profile_id,
  event_type,
  in_app_enabled,
  email_enabled
) values (
  '42300000-0000-4000-8000-000000000011',
  'monitoring_alert',
  false,
  false
);

select is(
  (
    select pg_catalog.count(*)::integer
    from public.outcome_notifications
    where monitoring_event_id = '42300000-0000-4000-8000-000000000205'
  ),
  1,
  'the first opt-out preference insert retains the default-on alert as a tombstone'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from public.notification_delivery_outbox as outbox
    join public.outcome_notifications as notification on notification.id = outbox.notification_id
    where notification.monitoring_event_id = '42300000-0000-4000-8000-000000000205'
  ),
  0,
  'the first opt-out preference insert removes queued work for the default-on alert'
);

update public.consumer_notification_preferences
set in_app_enabled = true
where profile_id = '42300000-0000-4000-8000-000000000011'
  and event_type = 'monitoring_alert';

select results_eq(
  $$select inserted from public.insert_crs_alert_notification(
    '42300000-0000-4000-8000-000000000205'
  )$$,
  $$values (false)$$,
  'retry cannot replay an alert suppressed by the first preference insert'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from public.notification_delivery_outbox as outbox
    join public.outcome_notifications as notification on notification.id = outbox.notification_id
    where notification.monitoring_event_id = '42300000-0000-4000-8000-000000000205'
  ),
  0,
  'the first-insert suppression tombstone remains without queued work after retry'
);
do $create_legacy_alert$
begin
  perform public.insert_crs_alert_notification(
    '42300000-0000-4000-8000-000000000203'
  );
end
$create_legacy_alert$;

-- Simulate a queued legacy row written before enforcement. The dispatch function must still check
-- the current preference instead of trusting an existing outbox row.
alter table public.consumer_notification_preferences
  disable trigger consumer_notification_preferences_enforce_delivery;
update public.consumer_notification_preferences
set in_app_enabled = false
where profile_id = '42300000-0000-4000-8000-000000000011'
  and event_type = 'monitoring_alert';
alter table public.consumer_notification_preferences
  enable trigger consumer_notification_preferences_enforce_delivery;

select results_eq(
  $$
    select status, rows
    from public.dispatch_notification(
      'client:42300000-0000-4000-8000-000000000101',
      (
        select 'notification:' || notification.id::text
        from public.outcome_notifications as notification
        where notification.monitoring_event_id = '42300000-0000-4000-8000-000000000203'
      ),
      '42300000-0000-4000-8000-000000000901'
    )
  $$,
  $$values ('skipped'::text, 0)$$,
  'dispatch rechecks a queued alert against the current preference'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from public.outcome_notifications
    where monitoring_event_id = '42300000-0000-4000-8000-000000000203'
  ),
  1,
  'dispatch retains the suppressed legacy alert as an idempotency tombstone'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from public.notification_delivery_outbox as outbox
    join public.outcome_notifications as notification on notification.id = outbox.notification_id
    where notification.monitoring_event_id = '42300000-0000-4000-8000-000000000203'
  ),
  0,
  'dispatch removes only queued work for the suppressed legacy alert'
);

update public.consumer_notification_preferences
set in_app_enabled = true
where profile_id = '42300000-0000-4000-8000-000000000011'
  and event_type = 'monitoring_alert';

select results_eq(
  $$select inserted from public.insert_crs_alert_notification(
    '42300000-0000-4000-8000-000000000203'
  )$$,
  $$values (false)$$,
  'retry cannot replay an alert suppressed at dispatch time'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from public.notification_delivery_outbox as outbox
    join public.outcome_notifications as notification on notification.id = outbox.notification_id
    where notification.monitoring_event_id = '42300000-0000-4000-8000-000000000203'
  ),
  0,
  'a dispatch-time suppression tombstone stays unqueued after re-enable'
);
do $create_deliverable_alert$
begin
  perform public.insert_crs_alert_notification(
    '42300000-0000-4000-8000-000000000204'
  );
end
$create_deliverable_alert$;

select results_eq(
  $$
    select status, rows
    from public.dispatch_notification(
      'client:42300000-0000-4000-8000-000000000101',
      (
        select 'notification:' || notification.id::text
        from public.outcome_notifications as notification
        where notification.monitoring_event_id = '42300000-0000-4000-8000-000000000204'
      ),
      '42300000-0000-4000-8000-000000000902'
    )
  $$,
  $$values ('ok'::text, 1)$$,
  'dispatch delivers an alert while the category remains enabled'
);

update public.consumer_notification_preferences
set in_app_enabled = false
where profile_id = '42300000-0000-4000-8000-000000000011'
  and event_type = 'monitoring_alert';

select is(
  (
    select pg_catalog.count(*)::integer
    from public.outcome_notifications
    where monitoring_event_id = '42300000-0000-4000-8000-000000000204'
      and delivered_at is not null
  ),
  1,
  'opting out retains a previously delivered source row for durable history'
);
select is(
  (
    select in_app_enabled
    from public.consumer_notification_preferences
    where profile_id = '42300000-0000-4000-8000-000000000011'
      and event_type = 'monitoring_alert'
  ),
  false,
  'the final opted-out preference remains authoritative'
);

select * from finish();
rollback;
