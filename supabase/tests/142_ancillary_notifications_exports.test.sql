begin;

set local search_path = public, extensions;

select plan(44);

-- Phase 8, 2026-08-19: migration 383 gave public.applications.bank_ref a foreign
-- key to public.banks_cache, so the lender handles this file files applications
-- under need catalog rows. Seeded here rather than in seed.sql because each
-- pgTAP file is its own transaction and rolls this back with everything else.
insert into public.banks_cache (bank_ref, name, application_questions)
select handle, handle, '[{"id":"a","label":"A","responseBasis":"x"},{"id":"b","label":"B","responseBasis":"x"},{"id":"c","label":"C","responseBasis":"x"},{"id":"d","label":"D","responseBasis":"x"}]'::jsonb
from unnest(array['notification-bank']) as handle
on conflict (bank_ref) do nothing;

select has_table(
  'public', 'notification_delivery_outbox',
  'notification delivery outbox exists'
);
select has_type(
  'public', 'notification_delivery_status',
  'notification delivery status enum exists'
);
select is(
  (
    select is_nullable from information_schema.columns
    where table_schema = 'public' and table_name = 'outcome_notifications'
      and column_name = 'outcome_id'
  ),
  'YES',
  'the Phase-11 outcome source is widened to nullable'
);
select has_column(
  'public', 'outcome_notifications', 'client_id',
  'notifications carry their derived client id'
);
select has_column(
  'public', 'outcome_notifications', 'monitoring_event_id',
  'notifications accept the stored monitoring-event source'
);
select has_column(
  'public', 'outcome_notifications', 'delivered_at',
  'notifications expose durable in-app delivery state'
);
select is(
  (
    select count(*)::integer
    from pg_constraint as constraint_row
    join pg_class as relation on relation.oid = constraint_row.conrelid
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'outcome_notifications'
      and constraint_row.conname = 'outcome_notifications_exactly_one_source'
      and constraint_row.contype = 'c'
  ),
  1,
  'one notification has exactly one source constraint'
);
select has_index(
  'public', 'outcome_notifications', 'outcome_notifications_monitoring_unique',
  'monitoring-source notifications are idempotent'
);
select is(
  (
    select relation.relrowsecurity and relation.relforcerowsecurity
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'notification_delivery_outbox'
  ),
  true,
  'the outbox enables and forces row security'
);
select is(
  has_table_privilege('authenticated', 'public.notification_delivery_outbox', 'select'),
  false,
  'authenticated users cannot inspect the delivery outbox'
);
select is(
  has_table_privilege(
    'service_role', 'public.notification_delivery_outbox',
    'select,insert,update,delete'
  ),
  true,
  'service role has explicit delivery outbox privileges'
);
select is(
  to_regprocedure('public.review_outcome(uuid,public.outcome_review_state,uuid)') is not null,
  true,
  'the existing Phase-11 review writer still compiles'
);
select enum_has_labels(
  'public',
  'outcome_notification_kind',
  array['outcome_review_approved', 'outcome_review_removed', 'crs_alert', 'stage_change', 'analysis_complete', 'refresh_result', 'enrollment_milestone', 'document', 'team_message'],
  'the notification kind keeps both historical values, CRS alert and the migration 440 consumer event kinds'
);

insert into auth.users (id, email)
values
  ('73000000-0000-4000-8000-000000000011', 'owner@notification.test'),
  ('73000000-0000-4000-8000-000000000012', 'consumer@notification.test'),
  ('70000000-0000-4000-8000-000000000002', 'admin@notification.test');

insert into public.orgs (id, name, slug)
values (
  '73000000-0000-4000-8000-000000000001',
  'Notification Org',
  'notification-org'
);

insert into public.profiles (id, role, org_id, org_role, full_name, email)
values
  (
    '73000000-0000-4000-8000-000000000011', 'operator_member',
    '73000000-0000-4000-8000-000000000001', 'owner',
    'Notification Owner', 'owner@notification.test'
  ),
  (
    '73000000-0000-4000-8000-000000000012', 'consumer',
    '73000000-0000-4000-8000-000000000001', null,
    'Notification Consumer', 'consumer@notification.test'
  ),
  (
    '70000000-0000-4000-8000-000000000002', 'platform_admin',
    null, null, 'Notification Admin', 'admin@notification.test'
  )
on conflict (id) do update
set role = excluded.role,
    org_id = excluded.org_id,
    org_role = excluded.org_role,
    full_name = excluded.full_name,
    email = excluded.email;

insert into public.clients (id, org_id, consumer_profile_id, assigned_to, display_name)
values (
  '73000000-0000-4000-8000-000000000101',
  '73000000-0000-4000-8000-000000000001',
  '73000000-0000-4000-8000-000000000012',
  '73000000-0000-4000-8000-000000000011',
  'Notification Client'
);

insert into public.applications (
  id, client_id, bank_ref, created_by
)
values (
  '73000000-0000-4000-8000-000000000201',
  '73000000-0000-4000-8000-000000000101',
  'notification-bank',
  '73000000-0000-4000-8000-000000000011'
);

insert into public.outcomes (
  id, application_id, bank_ref, client_id, kind, amount_cents,
  recorded_by, recorded_by_kind
)
values (
  '73000000-0000-4000-8000-000000000301',
  '73000000-0000-4000-8000-000000000201',
  'notification-bank',
  '73000000-0000-4000-8000-000000000101',
  'approved', 500000,
  '73000000-0000-4000-8000-000000000011', 'operator'
);

insert into public.outcome_notifications (
  id, org_id, outcome_id, recipient_profile_id, kind
)
values (
  '73000000-0000-4000-8000-000000000401',
  '73000000-0000-4000-8000-000000000001',
  '73000000-0000-4000-8000-000000000301',
  '73000000-0000-4000-8000-000000000011',
  'outcome_review_approved'
);

select is(
  (
    select client_id = '73000000-0000-4000-8000-000000000101'
      and org_id = '73000000-0000-4000-8000-000000000001'
      and recipient_profile_id = '73000000-0000-4000-8000-000000000011'
    from public.outcome_notifications
    where id = '73000000-0000-4000-8000-000000000401'
  ),
  true,
  'the outcome source derives the exact client organization and recipient'
);
select is(
  (
    select count(*)::integer from public.notification_delivery_outbox
    where notification_id = '73000000-0000-4000-8000-000000000401'
  ),
  1,
  'an approved outcome notification queues one delivery'
);
select is(
  (
    select subject from public.notification_delivery_outbox
    where notification_id = '73000000-0000-4000-8000-000000000401'
  ),
  'client:73000000-0000-4000-8000-000000000101',
  'delivery subject uses the canonical client key'
);
select is(
  (
    select "window" from public.notification_delivery_outbox
    where notification_id = '73000000-0000-4000-8000-000000000401'
  ),
  'notification:73000000-0000-4000-8000-000000000401',
  'delivery window uses the canonical notification key'
);
select is(
  (
    select idempotency_key from public.notification_delivery_outbox
    where notification_id = '73000000-0000-4000-8000-000000000401'
  ),
  'notifications.dispatch|client:73000000-0000-4000-8000-000000000101|notification:73000000-0000-4000-8000-000000000401',
  'delivery idempotency serializes job subject and window exactly'
);

insert into public.outcome_notifications (
  id, org_id, outcome_id, recipient_profile_id, kind
)
values (
  '73000000-0000-4000-8000-000000000402',
  '73000000-0000-4000-8000-000000000001',
  '73000000-0000-4000-8000-000000000301',
  '73000000-0000-4000-8000-000000000011',
  'outcome_review_removed'
);

select is(
  (
    select count(*)::integer from public.notification_delivery_outbox
    where notification_id = '73000000-0000-4000-8000-000000000402'
  ),
  0,
  'the historical correction kind does not queue Phase-17 delivery'
);
select throws_ok(
  $$
    insert into public.outcome_notifications (
      org_id, outcome_id, monitoring_event_id, recipient_profile_id, kind
    ) values (
      '73000000-0000-4000-8000-000000000001',
      '73000000-0000-4000-8000-000000000301',
      '73000000-0000-4000-8000-000000000501',
      '73000000-0000-4000-8000-000000000011',
      'crs_alert'
    )
  $$,
  'P0001', 'NOTIFICATION_SOURCE_INVALID',
  'a notification cannot name both source kinds'
);
select throws_ok(
  $$
    insert into public.outcome_notifications (
      org_id, recipient_profile_id, kind
    ) values (
      '73000000-0000-4000-8000-000000000001',
      '73000000-0000-4000-8000-000000000011',
      'crs_alert'
    )
  $$,
  'P0001', 'NOTIFICATION_SOURCE_INVALID',
  'a notification cannot omit both source kinds'
);

insert into public.monitoring_events (id, client_id, event_type, occurred_at)
values
  (
    '73000000-0000-4000-8000-000000000501',
    '73000000-0000-4000-8000-000000000101',
    'ACCALERT', '2026-08-16T00:00:00Z'
  ),
  (
    '73000000-0000-4000-8000-000000000502',
    '73000000-0000-4000-8000-000000000101',
    'REPORTREF', '2026-08-16T00:01:00Z'
  );

select results_eq(
  $$select inserted from public.insert_crs_alert_notification(
    '73000000-0000-4000-8000-000000000501'
  )$$,
  $$values (true)$$,
  'the stored ACCALERT inserts one in-app notification'
);
select results_eq(
  $$select inserted from public.insert_crs_alert_notification(
    '73000000-0000-4000-8000-000000000501'
  )$$,
  $$values (false)$$,
  'a repeated ACCALERT call reports the existing notification'
);
select is(
  (
    select count(*)::integer from public.outcome_notifications
    where monitoring_event_id = '73000000-0000-4000-8000-000000000501'
      and kind = 'crs_alert'
  ),
  1,
  'the ACCALERT producer converges on one recipient row'
);
select is(
  (
    select count(*)::integer
    from public.notification_delivery_outbox as outbox
    join public.outcome_notifications as notification
      on notification.id = outbox.notification_id
    where notification.monitoring_event_id = '73000000-0000-4000-8000-000000000501'
  ),
  1,
  'the ACCALERT producer converges on one delivery outbox row'
);
select throws_ok(
  $$select * from public.insert_crs_alert_notification(
    '73000000-0000-4000-8000-000000000502'
  )$$,
  'P0001', 'NOTIFICATION_EVENT_INVALID',
  'another stored CRS event cannot enter the alert notification path'
);

select throws_ok(
  $$select * from public.dispatch_notification(
    'client:not-a-uuid', 'notification:not-a-uuid',
    '73000000-0000-4000-8000-000000000901'
  )$$,
  'P0001', 'NOTIFICATION_DISPATCH_KEY_INVALID',
  'dispatch rejects a noncanonical subject and window'
);
select results_eq(
  $$select * from public.dispatch_notification(
    'client:73000000-0000-4000-8000-000000000101',
    'notification:73000000-0000-4000-8000-000000000401',
    '73000000-0000-4000-8000-000000000901'
  )$$,
  $$values ('ok'::text, 1)$$,
  'dispatch atomically delivers the named queued row'
);
select is(
  (
    select notification.delivered_at = outbox.delivered_at
      and notification.delivered_at is not null
    from public.outcome_notifications as notification
    join public.notification_delivery_outbox as outbox
      on outbox.notification_id = notification.id
    where notification.id = '73000000-0000-4000-8000-000000000401'
  ),
  true,
  'notification and outbox persist one delivery timestamp'
);
select results_eq(
  $$select * from public.dispatch_notification(
    'client:73000000-0000-4000-8000-000000000101',
    'notification:73000000-0000-4000-8000-000000000401',
    '73000000-0000-4000-8000-000000000901'
  )$$,
  $$values ('skipped'::text, 0)$$,
  'dispatch replay skips without a second delivery'
);
select is(
  (
    select delivered_at is null from public.outcome_notifications
    where id = '73000000-0000-4000-8000-000000000402'
  ),
  true,
  'the historical correction row remains undispatched'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'role', 'authenticated',
    'sub', '73000000-0000-4000-8000-000000000011'
  )::text,
  true
);
select is(
  (
    select count(*)::integer from public.outcome_notifications
    where recipient_profile_id = '73000000-0000-4000-8000-000000000011'
  ),
  2,
  'the Phase-11 recipient can read its approved and historical rows'
);
select lives_ok(
  $$
    update public.outcome_notifications
    set read_at = clock_timestamp()
    where id = '73000000-0000-4000-8000-000000000401'
  $$,
  'the existing recipient read-state policy still works'
);
reset role;

select is(
  private.audit_meta_valid(jsonb_build_object(
    'from_state', 'queued', 'to_state', 'running', 'job', 'analysis.run'
  )),
  true,
  'the prior queue audit shape remains accepted'
);
select is(
  private.audit_meta_valid(jsonb_build_object(
    'eventKey', 'event-1', 'from', 'a', 'to', 'b', 'status', 'ok'
  )),
  true,
  'the tracker audit keys added in migration 050 remain accepted'
);
select is(
  private.audit_meta_valid(jsonb_build_object(
    'dataset', 'analysis_runs',
    'format', 'csv',
    'filters', jsonb_build_object('client_id', '73000000-0000-4000-8000-000000000101'),
    'row_count', 0,
    'status', 'complete'
  )),
  true,
  'the exact export evidence shape is accepted'
);
select is(
  private.audit_meta_valid(jsonb_build_object(
    'dataset', 'unknown_table', 'format', 'csv', 'filters', '{}'::jsonb, 'row_count', 0
  )),
  false,
  'an unknown export dataset is rejected'
);
select is(
  private.audit_meta_valid(jsonb_build_object(
    'dataset', 'plans', 'format', 'xml', 'filters', '{}'::jsonb, 'row_count', 0
  )),
  false,
  'an unknown export format is rejected'
);
select is(
  private.audit_meta_valid(jsonb_build_object(
    'dataset', 'plans', 'format', 'json', 'filters', '{}'::jsonb, 'row_count', -1
  )),
  false,
  'a negative export row count is rejected'
);
select is(
  private.audit_meta_valid(jsonb_build_object(
    'dataset', 'plans', 'format', 'json',
    'filters', jsonb_build_object('client_id', jsonb_build_object('nested', true)),
    'row_count', 1
  )),
  false,
  'nested export filter values are rejected'
);
select is(
  private.audit_meta_valid(jsonb_build_object(
    'dataset', 'plans', 'format', 'json',
    'filters', jsonb_build_object('table_name', 'profiles'), 'row_count', 1
  )),
  false,
  'unknown export filter keys are rejected'
);
select is(
  private.audit_meta_valid(jsonb_build_object(
    'dataset', 'plans', 'format', 'json',
    'filters', jsonb_build_object(
      'client_id', '1', 'analysis_run_id', '2', 'bank_ref', '3', 'state', '4',
      'kind', '5', 'from', '6', 'to', '7', 'status', '8', 'extra', '9'
    ),
    'row_count', 1
  )),
  false,
  'more than eight export filters are rejected'
);
select is(
  private.audit_meta_valid(jsonb_build_object('unexpected_key', 'value')),
  false,
  'an unknown top-level audit key remains rejected'
);
select matches(
  pg_get_functiondef('private.queue_outcome_notification_delivery()'::regprocedure),
  'private.consumer_notification_event_type\(new.kind\)',
  'the delivery trigger queues exactly the kinds the consumer category map names (migration 440)'
);

select * from finish();

rollback;
