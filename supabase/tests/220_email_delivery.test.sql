create extension if not exists pgtap with schema extensions;

begin;

set local search_path = public, extensions;

select plan(57);

-- Phase 8, 2026-08-19: migration 383 gave public.applications.bank_ref a foreign
-- key to public.banks_cache, so the lender handles this file files applications
-- under need catalog rows. Seeded here rather than in seed.sql because each
-- pgTAP file is its own transaction and rolls this back with everything else.
insert into public.banks_cache (bank_ref, name, application_questions)
select handle, handle, '[{"id":"a","label":"A","responseBasis":"x"},{"id":"b","label":"B","responseBasis":"x"},{"id":"c","label":"C","responseBasis":"x"},{"id":"d","label":"D","responseBasis":"x"}]'::jsonb
from unnest(array['email-bank']) as handle
on conflict (bank_ref) do nothing;

select has_type('public', 'notification_delivery_channel', 'delivery channel enum exists');
select enum_has_labels(
  'public', 'notification_delivery_channel', array['in_app', 'email']::name[],
  'delivery channels are closed to in-app and email'
);
select has_type('public', 'email_outbox_status', 'email receipt status enum exists');
select enum_has_labels(
  'public', 'email_outbox_status', array['pending', 'accepted', 'failed']::name[],
  'email receipt states are closed'
);
select has_table('public', 'email_outbox', 'email receipt outbox exists');
select has_view(
  'public', 'notification_delivery_dispatch_view',
  'dispatch projection exists'
);

select is(
  (
    select array_agg(column_name::text order by ordinal_position)
    from information_schema.columns
    where table_schema = 'public' and table_name = 'email_outbox'
  ),
  array[
    'id', 'org_id', 'delivery_id', 'template', 'recipient_hash', 'status',
    'provider_ref', 'error_code', 'attempt_count', 'created_at', 'updated_at',
    'accepted_at'
  ]::text[],
  'email outbox has the exact receipt-only columns'
);
select is(
  (
    select array_agg(column_name::text order by ordinal_position)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'notification_delivery_dispatch_view'
  ),
  array[
    'id', 'channel', 'dispatch_subject', 'dispatch_window', 'org_id',
    'billing_event_id', 'email_template', 'status'
  ]::text[],
  'dispatch view has the exact ordered projection'
);
select is(
  (
    select count(*)::integer
    from information_schema.columns
    where table_schema = 'public'
      and table_name in ('email_outbox', 'notification_delivery_dispatch_view')
      and column_name ~ '(body|content|html|text|recipient|address|payload)'
      and column_name <> 'recipient_hash'
  ),
  0,
  'receipt tables expose no raw recipient or message-content column'
);

select ok(
  (
    select relrowsecurity and relforcerowsecurity
    from pg_class
    where oid = 'public.email_outbox'::regclass
  ),
  'email outbox enables and forces row security'
);
select is(
  has_table_privilege('authenticated', 'public.email_outbox', 'select'),
  false,
  'authenticated users cannot read email receipts'
);
select is(
  has_table_privilege('service_role', 'public.email_outbox', 'select,insert,update,delete'),
  true,
  'service role owns email receipt operations'
);
select is(
  has_table_privilege('authenticated', 'public.notification_delivery_dispatch_view', 'select'),
  false,
  'authenticated users cannot read the dispatch projection'
);
select is(
  has_table_privilege('service_role', 'public.notification_delivery_dispatch_view', 'select'),
  true,
  'service role can read the dispatch projection'
);

select has_function(
  'public', 'enqueue_operator_card_failure_email', array['uuid', 'text'],
  'eligible billing events have a narrow enqueue function'
);
select has_function(
  'public', 'claim_email_delivery', array['uuid', 'text', 'text'],
  'email receipt claim function exists'
);
select has_function(
  'public', 'accept_email_delivery', array['uuid', 'text'],
  'email receipt accept function exists'
);
select has_function(
  'public', 'fail_email_delivery', array['uuid', 'text'],
  'email receipt failure function exists'
);
select function_privs_are(
  'public', 'enqueue_operator_card_failure_email', array['uuid', 'text'],
  'service_role', array['EXECUTE'],
  'only the service role receives enqueue execution'
);

select has_check(
  'public', 'notification_delivery_outbox',
  'notification outbox has source and template checks'
);
select has_index(
  'public', 'notification_delivery_outbox',
  'notification_delivery_email_billing_event_unique',
  'email queue rows are unique per billing event'
);
select col_has_default(
  'public', 'notification_delivery_outbox', 'channel',
  'existing inserts default to the in-app channel'
);
select col_is_unique(
  'public', 'email_outbox', 'delivery_id',
  'one delivery has at most one provider receipt'
);

insert into auth.users (id, email)
values
  ('82000000-0000-4000-8000-000000000011', 'owner@email.test'),
  ('82000000-0000-4000-8000-000000000012', 'consumer@email.test');

insert into public.orgs (id, name, slug)
values
  ('82000000-0000-4000-8000-000000000001', 'Email Org', 'email-org'),
  ('82000000-0000-4000-8000-000000000002', 'Other Email Org', 'other-email-org');

insert into public.profiles (id, role, org_id, org_role, full_name, email)
values
  (
    '82000000-0000-4000-8000-000000000011', 'operator_member',
    '82000000-0000-4000-8000-000000000001', 'owner',
    'Email Owner', 'owner@email.test'
  ),
  (
    '82000000-0000-4000-8000-000000000012', 'consumer',
    '82000000-0000-4000-8000-000000000001', null,
    'Email Consumer', 'consumer@email.test'
  )
on conflict (id) do update
set role = excluded.role,
    org_id = excluded.org_id,
    org_role = excluded.org_role,
    full_name = excluded.full_name,
    email = excluded.email;

insert into public.clients (id, org_id, consumer_profile_id, assigned_to, display_name)
values (
  '82000000-0000-4000-8000-000000000101',
  '82000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000012',
  '82000000-0000-4000-8000-000000000011',
  'Email Client'
);

insert into public.operator_billing_events (
  id, org_id, event_id, event_type, to_membership, reason_code, applied, occurred_at
) values
  (
    '82000000-0000-4000-8000-000000000201',
    '82000000-0000-4000-8000-000000000001', 'evt_email_due',
    'invoice.payment_failed', 'past_due', 'applied', true, now()
  ),
  (
    '82000000-0000-4000-8000-000000000202',
    '82000000-0000-4000-8000-000000000001', 'evt_email_grace',
    'invoice.payment_failed', 'grace', 'applied', true, now()
  ),
  (
    '82000000-0000-4000-8000-000000000203',
    '82000000-0000-4000-8000-000000000001', 'evt_email_unapplied',
    'invoice.payment_failed', 'past_due', 'stale_event', false, now()
  ),
  (
    '82000000-0000-4000-8000-000000000204',
    '82000000-0000-4000-8000-000000000001', 'evt_email_current',
    'invoice.paid', 'current', 'applied', true, now()
  );

select is(
  (
    select inserted
    from public.enqueue_operator_card_failure_email(
      '82000000-0000-4000-8000-000000000001', 'evt_email_due'
    )
  ),
  true,
  'an applied past-due event queues one email row'
);
select is(
  (
    select inserted
    from public.enqueue_operator_card_failure_email(
      '82000000-0000-4000-8000-000000000001', 'evt_email_due'
    )
  ),
  false,
  'replay reuses the existing queue row'
);
select is(
  (
    select count(*)::integer
    from public.notification_delivery_outbox
    where billing_event_id = '82000000-0000-4000-8000-000000000201'
  ),
  1,
  'replay cannot widen the email queue'
);
select is(
  (
    select inserted
    from public.enqueue_operator_card_failure_email(
      '82000000-0000-4000-8000-000000000001', 'evt_email_grace'
    )
  ),
  true,
  'an applied grace event queues one email row'
);
select throws_ok(
  $$select * from public.enqueue_operator_card_failure_email(
    '82000000-0000-4000-8000-000000000002', 'evt_email_due'
  )$$,
  'P0001', 'EMAIL_EVENT_NOT_ELIGIBLE',
  'a wrong organization cannot enqueue an event'
);
select throws_ok(
  $$select * from public.enqueue_operator_card_failure_email(
    '82000000-0000-4000-8000-000000000001', 'evt_email_unapplied'
  )$$,
  'P0001', 'EMAIL_EVENT_NOT_ELIGIBLE',
  'an unapplied event cannot enqueue'
);
select throws_ok(
  $$select * from public.enqueue_operator_card_failure_email(
    '82000000-0000-4000-8000-000000000001', 'evt_email_current'
  )$$,
  'P0001', 'EMAIL_EVENT_NOT_ELIGIBLE',
  'a non-target rung cannot enqueue'
);
select throws_ok(
  $$insert into public.notification_delivery_outbox(
    channel, notification_id, client_id, org_id, billing_event_id, email_template
  ) values (
    'email', extensions.gen_random_uuid(),
    '82000000-0000-4000-8000-000000000101',
    '82000000-0000-4000-8000-000000000001',
    '82000000-0000-4000-8000-000000000201',
    'operator_card_failure'
  )$$,
  '23514', null,
  'a fabricated mixed source is refused'
);
select throws_ok(
  $$update public.notification_delivery_outbox
    set email_template = 'unknown_template'
    where billing_event_id = '82000000-0000-4000-8000-000000000201'$$,
  '23514', null,
  'an unknown email template is refused'
);
select throws_ok(
  $$update public.notification_delivery_outbox
    set channel = 'sms'
    where billing_event_id = '82000000-0000-4000-8000-000000000201'$$,
  '22P02', null,
  'an unknown delivery channel is refused'
);

select is(
  (
    select dispatch_subject
    from public.notification_delivery_outbox
    where billing_event_id = '82000000-0000-4000-8000-000000000201'
  ),
  'org:82000000-0000-4000-8000-000000000001',
  'email dispatch uses the organization subject grammar'
);
select is(
  (
    select dispatch_window
    from public.notification_delivery_outbox
    where billing_event_id = '82000000-0000-4000-8000-000000000201'
  ),
  'billing-event:82000000-0000-4000-8000-000000000201',
  'email dispatch uses the billing-event window grammar'
);

select lives_ok(
  $$select * from public.claim_email_delivery(
    (
      select id from public.notification_delivery_outbox
      where billing_event_id = '82000000-0000-4000-8000-000000000201'
    ),
    'operator_card_failure',
    ' Owner@Email.Test '
  )$$,
  'the receipt claim accepts a transient recipient'
);
select is(
  (
    select recipient_hash from public.email_outbox
    where delivery_id = (
      select id from public.notification_delivery_outbox
      where billing_event_id = '82000000-0000-4000-8000-000000000201'
    )
  ),
  encode(digest('owner@email.test', 'sha256'), 'hex'),
  'claim stores only the normalized recipient digest'
);
select is(
  (
    select count(*)::integer
    from public.email_outbox
    where row_to_json(email_outbox)::text ilike '%owner@email.test%'
  ),
  0,
  'no receipt text contains the raw recipient'
);
select is(
  (
    select attempt_count from public.email_outbox
    where delivery_id = (
      select id from public.notification_delivery_outbox
      where billing_event_id = '82000000-0000-4000-8000-000000000201'
    )
  ),
  1,
  'first claim records one attempt'
);
select lives_ok(
  $$select * from public.fail_email_delivery(
    (select id from public.email_outbox limit 1),
    'PROVIDER_UNAVAILABLE'
  )$$,
  'a stable failure code can close the attempt'
);
select is(
  (select status::text from public.email_outbox limit 1),
  'failed',
  'a stable provider failure is recorded'
);
select lives_ok(
  $$select * from public.claim_email_delivery(
    (
      select id from public.notification_delivery_outbox
      where billing_event_id = '82000000-0000-4000-8000-000000000201'
    ),
    'operator_card_failure',
    'owner@email.test'
  )$$,
  'a failed receipt can be reclaimed'
);
select is(
  (select attempt_count from public.email_outbox limit 1),
  2,
  'reclaim reopens the same receipt and increments attempts'
);
select is(
  (select count(*)::integer from public.email_outbox),
  1,
  'claim replay creates no second receipt'
);
select lives_ok(
  $$select * from public.accept_email_delivery(
    (select id from public.email_outbox limit 1),
    'provider_email_1'
  )$$,
  'a provider reference can accept the receipt'
);
select is(
  (select status::text from public.email_outbox limit 1),
  'accepted',
  'provider acceptance closes the receipt'
);
select is(
  (select provider_ref from public.email_outbox limit 1),
  'provider_email_1',
  'accepted receipt retains only the provider reference'
);
select throws_ok(
  $$select * from public.accept_email_delivery(
    (select id from public.email_outbox limit 1), repeat('x', 256)
  )$$,
  'P0001', 'EMAIL_PROVIDER_REF_INVALID',
  'an overlong provider reference is refused'
);

select is(
  (
    select status from public.dispatch_notification(
      'org:82000000-0000-4000-8000-000000000001',
      'billing-event:82000000-0000-4000-8000-000000000201',
      extensions.gen_random_uuid()
    )
  ),
  'ok',
  'email dispatch acknowledges the application queue row'
);
select is(
  (
    select status from public.dispatch_notification(
      'org:82000000-0000-4000-8000-000000000001',
      'billing-event:82000000-0000-4000-8000-000000000201',
      extensions.gen_random_uuid()
    )
  ),
  'skipped',
  'email acknowledgement replay is idempotent'
);

insert into public.applications (id, client_id, bank_ref, created_by)
values (
  '82000000-0000-4000-8000-000000000301',
  '82000000-0000-4000-8000-000000000101',
  'email-bank',
  '82000000-0000-4000-8000-000000000011'
);
insert into public.outcomes (
  id, application_id, bank_ref, client_id, kind, amount_cents,
  recorded_by, recorded_by_kind
) values (
  '82000000-0000-4000-8000-000000000302',
  '82000000-0000-4000-8000-000000000301',
  'email-bank',
  '82000000-0000-4000-8000-000000000101',
  'approved', 100000,
  '82000000-0000-4000-8000-000000000011', 'operator'
);
insert into public.outcome_notifications (
  id, org_id, outcome_id, recipient_profile_id, kind
) values (
  '82000000-0000-4000-8000-000000000401',
  '82000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000302',
  '82000000-0000-4000-8000-000000000011',
  'outcome_review_approved'
);

insert into public.outcome_notifications (
  id, org_id, outcome_id, recipient_profile_id, kind
) values (
  '82000000-0000-4000-8000-000000000402',
  '82000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000302',
  '82000000-0000-4000-8000-000000000011',
  'outcome_review_removed'
);

select is(
  (
    select count(*)::integer from public.notification_delivery_outbox
    where notification_id = '82000000-0000-4000-8000-000000000402'
  ),
  0,
  'the existing trigger still excludes the non-dispatch notification kind'
);

select is(
  (
    select channel::text from public.notification_delivery_outbox
    where notification_id = '82000000-0000-4000-8000-000000000401'
  ),
  'in_app',
  'the existing trigger still creates an in-app row'
);
select is(
  (
    select dispatch_subject || '|' || dispatch_window
    from public.notification_delivery_outbox
    where notification_id = '82000000-0000-4000-8000-000000000401'
  ),
  'client:82000000-0000-4000-8000-000000000101|notification:82000000-0000-4000-8000-000000000401',
  'in-app dispatch keys remain byte-equal to the Phase-17 grammar'
);
select is(
  (
    select status from public.dispatch_notification(
      'client:82000000-0000-4000-8000-000000000101',
      'notification:82000000-0000-4000-8000-000000000401',
      extensions.gen_random_uuid()
    )
  ),
  'ok',
  'in-app dispatch still succeeds'
);
select isnt(
  (
    select delivered_at from public.outcome_notifications
    where id = '82000000-0000-4000-8000-000000000401'
  ),
  null,
  'in-app acknowledgement still updates the outcome notification'
);
select is(
  (
    select status from public.dispatch_notification(
      'client:82000000-0000-4000-8000-000000000101',
      'notification:82000000-0000-4000-8000-000000000401',
      extensions.gen_random_uuid()
    )
  ),
  'skipped',
  'in-app acknowledgement replay stays idempotent'
);

select throws_ok(
  $$select * from public.dispatch_notification(
    'client:82000000-0000-4000-8000-000000000101',
    'billing-event:82000000-0000-4000-8000-000000000201',
    extensions.gen_random_uuid()
  )$$,
  'P0001', 'NOTIFICATION_DISPATCH_KEY_INVALID',
  'mixed dispatch-key grammars are refused'
);

select * from finish();
rollback;
