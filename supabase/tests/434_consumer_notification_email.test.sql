begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(13);

select is(
  (
    select pg_catalog.count(*)::integer
    from pg_catalog.pg_constraint as constraint_row
    join pg_catalog.pg_class as relation on relation.oid = constraint_row.conrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'consumer_notification_preferences'
      and constraint_row.conname = 'consumer_notification_preferences_email_unavailable'
  ),
  0,
  'the email-unavailable constraint is gone now that a dispatcher exists'
);

select is(
  (
    select array_agg(category order by category)
    from (
      values ('monitoring_alert'), ('team_message')
    ) as expected(category)
    where private.consumer_notification_email_default(expected.category)
  ),
  array['monitoring_alert', 'team_message'],
  'the two interruptive categories default to email on'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from (
      values
        ('stage_change'),
        ('analysis_complete'),
        ('refresh_result'),
        ('enrollment_milestone'),
        ('document'),
        ('application_update')
    ) as quiet(category)
    where private.consumer_notification_email_default(quiet.category)
  ),
  0,
  'the six routine categories default to email off'
);

insert into auth.users (id, email)
values ('43400000-0000-4000-8000-000000000011', 'consumer@notification-email.test');

insert into public.orgs (id, name, slug)
values (
  '43400000-0000-4000-8000-000000000001',
  'Notification Email Org',
  'notification-email-org'
);

insert into public.profiles (id, role, org_id, full_name, email)
values (
  '43400000-0000-4000-8000-000000000011',
  'consumer',
  '43400000-0000-4000-8000-000000000001',
  'Email Consumer',
  'consumer@notification-email.test'
)
on conflict (id) do update set
  role = excluded.role,
  org_id = excluded.org_id,
  full_name = excluded.full_name,
  email = excluded.email;

insert into public.clients (id, org_id, consumer_profile_id, display_name)
values (
  '43400000-0000-4000-8000-000000000101',
  '43400000-0000-4000-8000-000000000001',
  '43400000-0000-4000-8000-000000000011',
  'Notification Email Client'
);

select is(
  (
    select array_agg(event_type order by event_type)
    from public.consumer_notification_preferences
    where profile_id = '43400000-0000-4000-8000-000000000011'
      and email_enabled
  ),
  array['monitoring_alert', 'team_message'],
  'a new consumer is seeded with email on for exactly the two default categories'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from public.consumer_notification_preferences
    where profile_id = '43400000-0000-4000-8000-000000000011'
      and in_app_enabled
  ),
  8,
  'every category still starts on in-app'
);

select lives_ok(
  $$
    update public.consumer_notification_preferences
    set email_enabled = true
    where profile_id = '43400000-0000-4000-8000-000000000011'
      and event_type = 'document'
  $$,
  'a consumer can now opt a quiet category into email'
);

insert into public.monitoring_events (id, client_id, event_type, occurred_at)
values (
  '43400000-0000-4000-8000-000000000201',
  '43400000-0000-4000-8000-000000000101',
  'ACCALERT',
  '2026-09-01T08:00:00Z'
);

select is(
  (select inserted from public.insert_crs_alert_notification('43400000-0000-4000-8000-000000000201')),
  true,
  'the alert creates one in-app notification and its queued delivery row'
);

create temporary table email_fixture as
select outbox.id as delivery_id
from public.notification_delivery_outbox as outbox
join public.outcome_notifications as notification on notification.id = outbox.notification_id
where notification.monitoring_event_id = '43400000-0000-4000-8000-000000000201'
  and outbox.channel = 'in_app';

select is(
  (select pg_catalog.count(*)::integer from email_fixture),
  1,
  'the in-app delivery row is the only row a consumer email can hang off'
);

select is(
  (
    select receipt.org_id
    from public.email_outbox as receipt
    where receipt.id = (
      select claimed.receipt_id
      from public.claim_email_delivery(
        (select delivery_id from email_fixture),
        'consumer_monitoring_alert',
        ' Consumer@Notification-Email.Test '
      ) as claimed
    )
  ),
  '43400000-0000-4000-8000-000000000001'::uuid,
  'the receipt takes its tenant from the client behind the in-app delivery row'
);

select is(
  (
    select claimed.attempt_count
    from public.claim_email_delivery(
      (select delivery_id from email_fixture),
      'consumer_monitoring_alert',
      'consumer@notification-email.test'
    ) as claimed
  ),
  2,
  'a retry re-claims the same receipt and counts the attempt instead of duplicating it'
);
select is(
  (select pg_catalog.count(*)::integer from public.email_outbox),
  1,
  'two claims leave exactly one receipt'
);

select throws_ok(
  $$
    select public.claim_email_delivery(
      (select delivery_id from email_fixture),
      'invented_template',
      'consumer@notification-email.test'
    )
  $$,
  'P0001',
  'EMAIL_CLAIM_INVALID',
  'an unregistered template cannot claim a delivery'
);

select throws_ok(
  $$
    select public.claim_email_delivery(
      (select delivery_id from email_fixture),
      'operator_card_failure',
      'consumer@notification-email.test'
    )
  $$,
  'P0001',
  'EMAIL_DELIVERY_NOT_FOUND',
  'the operator arm cannot claim a consumer in-app delivery row'
);

select * from finish();
rollback;
