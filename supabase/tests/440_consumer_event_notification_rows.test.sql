begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(39);

-- ---------------------------------------------------------------------------
-- Shape: the six consumer event kinds, the category map, and one producer per source table.
-- ---------------------------------------------------------------------------

select enum_has_labels(
  'public',
  'outcome_notification_kind',
  array[
    'outcome_review_approved', 'outcome_review_removed', 'crs_alert',
    'stage_change', 'analysis_complete', 'refresh_result',
    'enrollment_milestone', 'document', 'team_message'
  ],
  'the notification kind carries one label per consumer event type'
);
select is(
  private.consumer_notification_event_type('crs_alert'),
  'monitoring_alert',
  'a credit alert still maps onto the monitoring category'
);
select is(
  private.consumer_notification_event_type('outcome_review_removed'),
  null,
  'a removed review is not a consumer category and is never queued'
);
select is(
  (
    select array_agg(private.consumer_notification_event_type(kind) order by kind::text)
    from unnest(enum_range(null::public.outcome_notification_kind)) as kind
    where private.consumer_notification_event_type(kind) is not null
  ),
  array[
    'analysis_complete', 'monitoring_alert', 'document', 'enrollment_milestone',
    'application_update', 'refresh_result', 'stage_change', 'team_message'
  ],
  'the database map reaches all eight consumer categories, as EVENT_TYPE_BY_KIND does'
);
select has_trigger('public', 'stage_history', 'stage_history_notify_consumer',
  'a stage change produces a delivery row');
select has_trigger('public', 'plans', 'plans_notify_consumer',
  'a plan produces a delivery row');
select has_trigger('public', 'enrollment_milestones', 'enrollment_milestones_notify_consumer',
  'a completed onboarding step produces a delivery row');
select has_trigger('public', 'consents', 'consents_notify_consumer',
  'a granted consent produces a delivery row');
select has_trigger('public', 'document_uploads', 'document_uploads_notify_consumer',
  'a company document produces a delivery row');
select has_trigger('public', 'support_messages', 'support_messages_notify_consumer',
  'a team message produces a delivery row');

-- ---------------------------------------------------------------------------
-- Fixture: one tenant, one consumer with an active client, one operator, and a second client
-- that has no consumer to notify.
-- ---------------------------------------------------------------------------

insert into auth.users (id, email)
values
  ('44000000-0000-4000-8000-000000000011', 'consumer@event-rows.test'),
  ('44000000-0000-4000-8000-000000000012', 'operator@event-rows.test');

insert into public.orgs (id, name, slug)
values ('44000000-0000-4000-8000-000000000001', 'Event Rows Org', 'event-rows-org');

insert into public.profiles (id, role, org_id, org_role, full_name, email)
values
  (
    '44000000-0000-4000-8000-000000000011',
    'consumer',
    '44000000-0000-4000-8000-000000000001',
    null,
    'Event Consumer',
    'consumer@event-rows.test'
  ),
  (
    '44000000-0000-4000-8000-000000000012',
    'operator_member',
    '44000000-0000-4000-8000-000000000001',
    'owner',
    'Event Operator',
    'operator@event-rows.test'
  )
on conflict (id) do update set
  role = excluded.role,
  org_id = excluded.org_id,
  org_role = excluded.org_role,
  full_name = excluded.full_name,
  email = excluded.email;

insert into public.clients (id, org_id, consumer_profile_id, display_name)
values
  (
    '44000000-0000-4000-8000-000000000101',
    '44000000-0000-4000-8000-000000000001',
    '44000000-0000-4000-8000-000000000011',
    'Event Rows Client'
  ),
  (
    '44000000-0000-4000-8000-000000000102',
    '44000000-0000-4000-8000-000000000001',
    null,
    'Client Without Consumer'
  );

-- ---------------------------------------------------------------------------
-- Stage change.
-- ---------------------------------------------------------------------------

insert into public.stage_history (id, client_id, from_stage, to_stage, changed_by)
values
  (
    '44000000-0000-4000-8000-000000000201',
    '44000000-0000-4000-8000-000000000101',
    'onboarding',
    'optimization',
    '44000000-0000-4000-8000-000000000012'
  ),
  (
    '44000000-0000-4000-8000-000000000202',
    '44000000-0000-4000-8000-000000000102',
    'onboarding',
    'optimization',
    '44000000-0000-4000-8000-000000000012'
  );

select results_eq(
  $$
    select kind::text, client_id, org_id, recipient_profile_id
    from public.outcome_notifications
    where stage_history_id = '44000000-0000-4000-8000-000000000201'
  $$,
  $$
    values (
      'stage_change',
      '44000000-0000-4000-8000-000000000101'::uuid,
      '44000000-0000-4000-8000-000000000001'::uuid,
      '44000000-0000-4000-8000-000000000011'::uuid
    )
  $$,
  'a stage change writes one stage_change row scoped to the client, tenant and consumer'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from public.notification_delivery_outbox as outbox
    join public.outcome_notifications as notification on notification.id = outbox.notification_id
    where notification.stage_history_id = '44000000-0000-4000-8000-000000000201'
      and outbox.channel = 'in_app'
      and outbox.status = 'queued'
  ),
  1,
  'the stage change queues one in-app delivery, the row consumer email hangs off'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from public.outcome_notifications
    where stage_history_id = '44000000-0000-4000-8000-000000000202'
  ),
  0,
  'a client with no consumer produces no row'
);
select throws_ok(
  $$
    insert into public.outcome_notifications (stage_history_id, kind)
    values ('44000000-0000-4000-8000-000000000201', 'stage_change')
  $$,
  '23505',
  null,
  'a replayed stage change is refused by the per-source unique index'
);

-- ---------------------------------------------------------------------------
-- Plan and refresh result: the run trigger decides which the plan is.
-- ---------------------------------------------------------------------------

insert into public.analysis_runs (id, client_id, trigger, readiness_score, derived)
select run.id, '44000000-0000-4000-8000-000000000101', run.trigger, 62, '{
    "schemaVersion": 1,
    "bureausPulled": ["EQF"],
    "accounts": [
      {
        "accountRef": "account-one",
        "kind": "revolving",
        "balanceCents": 420000,
        "limitCents": 500000,
        "utilizationPct": 84,
        "ageMonths": 48,
        "isOpen": true,
        "isNegative": false
      }
    ],
    "overallUtilizationPct": 84,
    "inquiriesByBureau": {"EQF": 0, "EXP": 0, "TUC": 0},
    "negativesCount": 0,
    "openRevolvingCount": 1,
    "averageAgeMonths": 48,
    "highestRevolvingLimitCents": 500000,
    "dti": {
      "monthlyDebtPaymentsCents": 50000,
      "statedMonthlyIncomeCents": 500000,
      "ratioPct": 10
    },
    "flags": {
      "utilizationUnder30": false,
      "fourOrMorePersonalAccountsOpen": false,
      "averageAgeTwoYearsOrMore": true,
      "noNegativeItemsReported": true,
      "cardWithTenKLimit": false,
      "twoOrFewerInquiriesEveryBureau": true,
      "thinFile": true
    },
    "computedAt": "2026-09-05T05:00:00Z"
  }'::jsonb
from (
  values
    ('44000000-0000-4000-8000-000000000301'::uuid, 'scheduled'::public.analysis_trigger),
    ('44000000-0000-4000-8000-000000000302'::uuid, 'force_pull'::public.analysis_trigger)
) as run(id, trigger);

insert into public.plans (id, client_id, analysis_run_id, version, body, readiness_score)
values
  (
    '44000000-0000-4000-8000-000000000401',
    '44000000-0000-4000-8000-000000000101',
    '44000000-0000-4000-8000-000000000301',
    1,
    '{"schemaVersion": 1}'::jsonb,
    62
  ),
  (
    '44000000-0000-4000-8000-000000000402',
    '44000000-0000-4000-8000-000000000101',
    '44000000-0000-4000-8000-000000000302',
    2,
    '{"schemaVersion": 1}'::jsonb,
    62
  );

select is(
  (
    select kind::text from public.outcome_notifications
    where plan_id = '44000000-0000-4000-8000-000000000401'
  ),
  'analysis_complete',
  'a plan from a scheduled run is an analysis_complete row'
);
select is(
  (
    select kind::text from public.outcome_notifications
    where plan_id = '44000000-0000-4000-8000-000000000402'
  ),
  'refresh_result',
  'a plan from a paid force_pull run is a refresh_result row'
);
select throws_ok(
  $$
    insert into public.outcome_notifications (plan_id, kind)
    values ('44000000-0000-4000-8000-000000000401', 'refresh_result')
  $$,
  'P0001',
  'NOTIFICATION_EVENT_INVALID',
  'a plan row cannot claim the kind its run does not produce'
);

-- ---------------------------------------------------------------------------
-- Onboarding steps: a completed milestone and a granted consent; nothing for an open milestone.
-- ---------------------------------------------------------------------------

insert into public.enrollment_milestones (client_id, kind, completed_at, completed_by)
values (
  '44000000-0000-4000-8000-000000000101',
  'agreement_signed',
  '2026-09-01T09:00:00Z',
  '44000000-0000-4000-8000-000000000012'
);
insert into public.enrollment_milestones (client_id, kind)
values ('44000000-0000-4000-8000-000000000101', 'documents_uploaded');

select results_eq(
  $$
    select kind::text, enrollment_milestone_kind::text
    from public.outcome_notifications
    where enrollment_milestone_client_id = '44000000-0000-4000-8000-000000000101'
  $$,
  $$values ('enrollment_milestone', 'agreement_signed')$$,
  'only the completed milestone produces an enrollment_milestone row'
);

insert into public.consents (id, client_id, kind, text_version, signed_at, ip, esig_ref)
values (
  '44000000-0000-4000-8000-000000000501',
  '44000000-0000-4000-8000-000000000101',
  'monitoring',
  'monitoring-2026-09-01.1',
  '2026-09-01T09:05:00Z',
  '127.0.0.1',
  '44000000-0000-4000-8000-000000000502'
);

select is(
  (
    select kind::text from public.outcome_notifications
    where consent_id = '44000000-0000-4000-8000-000000000501'
  ),
  'enrollment_milestone',
  'a granted consent produces an enrollment_milestone row'
);
select throws_ok(
  $$
    insert into public.outcome_notifications (consent_id, kind)
    values ('44000000-0000-4000-8000-000000000501', 'document')
  $$,
  'P0001',
  'NOTIFICATION_EVENT_INVALID',
  'a consent row cannot carry another category'
);

-- ---------------------------------------------------------------------------
-- Documents: a company document, never a credit report.
-- ---------------------------------------------------------------------------

insert into public.document_uploads (
  id, org_id, client_id, kind, section, bucket, object_path,
  display_name, mime_type, size_bytes, lifecycle, uploaded_by
)
values
  (
    '44000000-0000-4000-8000-000000000601',
    '44000000-0000-4000-8000-000000000001',
    '44000000-0000-4000-8000-000000000101',
    'company', 'articles', 'client-documents',
    '44000000-0000-4000-8000-000000000001/44000000-0000-4000-8000-000000000101/44000000-0000-4000-8000-000000000601/a.pdf',
    'a.pdf', 'application/pdf', 100, 'stored',
    '44000000-0000-4000-8000-000000000012'
  ),
  (
    '44000000-0000-4000-8000-000000000602',
    '44000000-0000-4000-8000-000000000001',
    '44000000-0000-4000-8000-000000000101',
    'credit_report', null, 'credit-reports',
    '44000000-0000-4000-8000-000000000001/44000000-0000-4000-8000-000000000101/44000000-0000-4000-8000-000000000602/r.pdf',
    'r.pdf', 'application/pdf', 100, 'stored',
    '44000000-0000-4000-8000-000000000012'
  );

select is(
  (
    select kind::text from public.outcome_notifications
    where document_upload_id = '44000000-0000-4000-8000-000000000601'
  ),
  'document',
  'a company document produces a document row'
);
select is(
  (
    select pg_catalog.count(*)::integer from public.outcome_notifications
    where document_upload_id = '44000000-0000-4000-8000-000000000602'
  ),
  0,
  'a credit report upload produces nothing'
);

-- ---------------------------------------------------------------------------
-- Team messages: from the team, in team chat, visible to the client.
-- ---------------------------------------------------------------------------

insert into public.support_threads (id, kind, org_id, client_id, subject, created_by)
values (
  '44000000-0000-4000-8000-000000000701',
  'team_chat',
  '44000000-0000-4000-8000-000000000001',
  '44000000-0000-4000-8000-000000000101',
  'Team chat',
  '44000000-0000-4000-8000-000000000012'
);

insert into public.support_messages (id, thread_id, author_profile_id, author_kind, body, visibility)
values
  (
    '44000000-0000-4000-8000-000000000801',
    '44000000-0000-4000-8000-000000000701',
    '44000000-0000-4000-8000-000000000012',
    'operator',
    'Please sign in when you have a moment.',
    'participants'
  ),
  (
    '44000000-0000-4000-8000-000000000802',
    '44000000-0000-4000-8000-000000000701',
    '44000000-0000-4000-8000-000000000012',
    'operator',
    'Staff note the client must never hear about.',
    'internal'
  ),
  (
    '44000000-0000-4000-8000-000000000803',
    '44000000-0000-4000-8000-000000000701',
    '44000000-0000-4000-8000-000000000011',
    'consumer',
    'Will do.',
    'participants'
  );

select is(
  (
    select kind::text from public.outcome_notifications
    where support_message_id = '44000000-0000-4000-8000-000000000801'
  ),
  'team_message',
  'an operator message in team chat produces a team_message row'
);
select is(
  (
    select pg_catalog.count(*)::integer from public.outcome_notifications
    where support_message_id = '44000000-0000-4000-8000-000000000802'
  ),
  0,
  'an internal note produces nothing'
);
select is(
  (
    select pg_catalog.count(*)::integer from public.outcome_notifications
    where support_message_id = '44000000-0000-4000-8000-000000000803'
  ),
  0,
  'the consumer''s own message produces nothing'
);
select throws_ok(
  $$
    insert into public.outcome_notifications (support_message_id, kind)
    values ('44000000-0000-4000-8000-000000000802', 'team_message')
  $$,
  'P0001',
  'NOTIFICATION_EVENT_INVALID',
  'an internal note cannot be made a team message by hand'
);

-- ---------------------------------------------------------------------------
-- Source exclusivity.
-- ---------------------------------------------------------------------------

select throws_ok(
  $$
    insert into public.outcome_notifications (stage_history_id, plan_id, kind)
    values (
      '44000000-0000-4000-8000-000000000201',
      '44000000-0000-4000-8000-000000000401',
      'stage_change'
    )
  $$,
  'P0001',
  'NOTIFICATION_SOURCE_INVALID',
  'a row names exactly one source'
);

-- Every produced row so far is queued, one delivery each.
select is(
  (
    select pg_catalog.count(*)::integer
    from public.notification_delivery_outbox as outbox
    join public.outcome_notifications as notification on notification.id = outbox.notification_id
    where notification.client_id = '44000000-0000-4000-8000-000000000101'
      and outbox.channel = 'in_app'
      and outbox.status = 'queued'
  ),
  7,
  'each of the seven produced rows queued exactly one in-app delivery'
);

-- ---------------------------------------------------------------------------
-- Preferences stay authoritative for every category, not only credit alerts.
-- ---------------------------------------------------------------------------

update public.consumer_notification_preferences
set in_app_enabled = false
where profile_id = '44000000-0000-4000-8000-000000000011'
  and event_type = 'document';

select is(
  (
    select pg_catalog.count(*)::integer
    from public.notification_delivery_outbox as outbox
    join public.outcome_notifications as notification on notification.id = outbox.notification_id
    where notification.document_upload_id = '44000000-0000-4000-8000-000000000601'
  ),
  0,
  'opting a category out removes its queued, undelivered work'
);
select is(
  (
    select pg_catalog.count(*)::integer from public.outcome_notifications
    where document_upload_id = '44000000-0000-4000-8000-000000000601'
  ),
  1,
  'the source row stays as the suppression tombstone'
);

insert into public.document_uploads (
  id, org_id, client_id, kind, section, bucket, object_path,
  display_name, mime_type, size_bytes, lifecycle, uploaded_by
)
values (
  '44000000-0000-4000-8000-000000000603',
  '44000000-0000-4000-8000-000000000001',
  '44000000-0000-4000-8000-000000000101',
  'company', 'ein', 'client-documents',
  '44000000-0000-4000-8000-000000000001/44000000-0000-4000-8000-000000000101/44000000-0000-4000-8000-000000000603/e.pdf',
  'e.pdf', 'application/pdf', 100, 'stored',
  '44000000-0000-4000-8000-000000000012'
);

select is(
  (
    select pg_catalog.count(*)::integer from public.outcome_notifications
    where document_upload_id = '44000000-0000-4000-8000-000000000603'
  ),
  1,
  'a document uploaded while the category is off still writes its tombstone row'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from public.notification_delivery_outbox as outbox
    join public.outcome_notifications as notification on notification.id = outbox.notification_id
    where notification.document_upload_id = '44000000-0000-4000-8000-000000000603'
  ),
  0,
  'a document uploaded while the category is off queues nothing'
);

update public.consumer_notification_preferences
set in_app_enabled = true
where profile_id = '44000000-0000-4000-8000-000000000011'
  and event_type = 'document';

select is(
  (
    select pg_catalog.count(*)::integer
    from public.notification_delivery_outbox as outbox
    join public.outcome_notifications as notification on notification.id = outbox.notification_id
    where notification.document_upload_id in (
      '44000000-0000-4000-8000-000000000601',
      '44000000-0000-4000-8000-000000000603'
    )
  ),
  0,
  're-enabling never replays a suppressed document'
);

-- Dispatch rechecks the current preference for a queued row of any category.
alter table public.consumer_notification_preferences
  disable trigger consumer_notification_preferences_enforce_delivery;
update public.consumer_notification_preferences
set in_app_enabled = false
where profile_id = '44000000-0000-4000-8000-000000000011'
  and event_type = 'team_message';
alter table public.consumer_notification_preferences
  enable trigger consumer_notification_preferences_enforce_delivery;

select results_eq(
  $$
    select status, rows
    from public.dispatch_notification(
      'client:44000000-0000-4000-8000-000000000101',
      (
        select 'notification:' || notification.id::text
        from public.outcome_notifications as notification
        where notification.support_message_id = '44000000-0000-4000-8000-000000000801'
      ),
      '44000000-0000-4000-8000-000000000901'
    )
  $$,
  $$values ('skipped'::text, 0)$$,
  'dispatch drops a queued team message the consumer has since turned off'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from public.notification_delivery_outbox as outbox
    join public.outcome_notifications as notification on notification.id = outbox.notification_id
    where notification.support_message_id = '44000000-0000-4000-8000-000000000801'
  ),
  0,
  'the dropped team message leaves no queued work'
);

select results_eq(
  $$
    select status, rows
    from public.dispatch_notification(
      'client:44000000-0000-4000-8000-000000000101',
      (
        select 'notification:' || notification.id::text
        from public.outcome_notifications as notification
        where notification.stage_history_id = '44000000-0000-4000-8000-000000000201'
      ),
      '44000000-0000-4000-8000-000000000902'
    )
  $$,
  $$values ('ok'::text, 1)$$,
  'dispatch delivers a stage change while its category is on'
);
select isnt(
  (
    select delivered_at from public.outcome_notifications
    where stage_history_id = '44000000-0000-4000-8000-000000000201'
  ),
  null,
  'the delivered stage change carries its delivery time'
);

-- ---------------------------------------------------------------------------
-- The email receipt hangs off the same delivery row, through the template the event maps to.
-- ---------------------------------------------------------------------------

create temporary table stage_delivery as
select outbox.id as delivery_id
from public.notification_delivery_outbox as outbox
join public.outcome_notifications as notification on notification.id = outbox.notification_id
where notification.stage_history_id = '44000000-0000-4000-8000-000000000201';

select is(
  (
    select claim.status
    from stage_delivery
    cross join lateral public.claim_email_delivery(
      stage_delivery.delivery_id, 'consumer_stage_change', 'consumer@event-rows.test'
    ) as claim
  ),
  'pending',
  'a stage change delivery can claim its consumer email receipt'
);

-- ---------------------------------------------------------------------------
-- Erasure boundary: a row follows its source.
-- ---------------------------------------------------------------------------

delete from public.document_uploads where id = '44000000-0000-4000-8000-000000000603';

select is(
  (
    select pg_catalog.count(*)::integer from public.outcome_notifications
    where document_upload_id = '44000000-0000-4000-8000-000000000603'
  ),
  0,
  'deleting a source cascades its notification row away'
);

select * from finish();
rollback;
