begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into public.orgs (id, name, slug) values (
  '00000000-0000-0000-0000-0000000000b0',
  'Lane B Billing Test Org',
  'lane-b-billing-test'
) on conflict do nothing;

insert into public.clients (id, org_id, display_name) values
  (
    '00000000-0000-0000-0000-0000000000b1',
    '00000000-0000-0000-0000-0000000000b0',
    'Lane B Billing Enrolled Client'
  ),
  (
    '00000000-0000-0000-0000-0000000000c1',
    '00000000-0000-0000-0000-0000000000b0',
    'Lane B Billing Parked Client'
  ),
  (
    '00000000-0000-0000-0000-0000000000c2',
    '00000000-0000-0000-0000-0000000000b0',
    'Lane B Billing Active Client'
  )
on conflict do nothing;

insert into public.consents (
  id, client_id, kind, text_version, signed_at, ip, esig_ref
) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', 'monitoring', 'monitoring-2026-08-16.1', '2026-08-16T00:00:00Z', '127.0.0.1', 'lane-b-billing-be'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000b1', 'analysis', 'analysis-2026-08-16.1', '2026-08-16T00:00:00Z', '127.0.0.1', 'lane-b-billing-be'),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000c1', 'monitoring', 'monitoring-2026-08-16.1', '2026-08-16T00:00:00Z', '127.0.0.1', 'lane-b-billing-bf'),
  ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000c1', 'analysis', 'analysis-2026-08-16.1', '2026-08-16T00:00:00Z', '127.0.0.1', 'lane-b-billing-bf'),
  ('00000000-0000-0000-0000-0000000000d5', '00000000-0000-0000-0000-0000000000c2', 'monitoring', 'monitoring-2026-08-16.1', '2026-08-16T00:00:00Z', '127.0.0.1', 'lane-b-billing-c0'),
  ('00000000-0000-0000-0000-0000000000d6', '00000000-0000-0000-0000-0000000000c2', 'analysis', 'analysis-2026-08-16.1', '2026-08-16T00:00:00Z', '127.0.0.1', 'lane-b-billing-c0')
on conflict do nothing;

insert into public.enrollments (
  id, client_id, status, monitoring_consent_at, analysis_consent_at, esig_doc_id
) values (
  '00000000-0000-0000-0000-0000000000be',
  '00000000-0000-0000-0000-0000000000b1',
  'enrolled',
  '2026-08-16T00:00:00Z',
  '2026-08-16T00:00:00Z',
  'lane-b-billing-be'
) on conflict do nothing;
insert into public.enrollments (
  id, client_id, status, parked_until,
  monitoring_consent_at, analysis_consent_at, esig_doc_id
) values (
  '00000000-0000-0000-0000-0000000000bf',
  '00000000-0000-0000-0000-0000000000c1',
  'parked',
  '2026-08-19T00:00:00Z',
  '2026-08-16T00:00:00Z',
  '2026-08-16T00:00:00Z',
  'lane-b-billing-bf'
) on conflict do nothing;
insert into public.enrollments (
  id, client_id, status, monitoring_consent_at, analysis_consent_at, esig_doc_id
) values (
  '00000000-0000-0000-0000-0000000000c0',
  '00000000-0000-0000-0000-0000000000c2',
  'active',
  '2026-08-16T00:00:00Z',
  '2026-08-16T00:00:00Z',
  'lane-b-billing-c0'
) on conflict do nothing;

select lives_ok(
  $$
    insert into public.consumer_subscriptions (
      client_id, enrollment_id, provider, customer_ref,
      setup_intent_ref, payment_method_ref, price_ref, price_cents,
      status, idempotency_key
    ) values (
      '00000000-0000-0000-0000-0000000000b1',
      '00000000-0000-0000-0000-0000000000be',
      'mock', 'mock_cus_authorized', 'mock_seti_authorized',
      'mock_pm_authorized', 'mock_price_monitoring', 4900,
      'authorized', 'mock_idem_authorized'
    )
  $$,
  'authorization can be recorded before identity verification'
);

select throws_ok(
  $$
    update public.consumer_subscriptions
    set status = 'active', subscription_ref = 'mock_sub_enrolled'
    where enrollment_id = '00000000-0000-0000-0000-0000000000be'
  $$,
  '23514', null, 'an enrolled parent cannot settle a subscription'
);

select throws_ok(
  $$
    insert into public.consumer_subscriptions (
      client_id, enrollment_id, provider, customer_ref,
      subscription_ref, price_ref, price_cents, status, idempotency_key
    ) values (
      '00000000-0000-0000-0000-0000000000c1',
      '00000000-0000-0000-0000-0000000000bf',
      'mock', 'mock_cus_parked', 'mock_sub_parked',
      'mock_price_monitoring', 4900, 'active', 'mock_idem_parked'
    )
  $$,
  '23514', null, 'a parked parent cannot receive a settled subscription'
);

select lives_ok(
  $$
    insert into public.consumer_subscriptions (
      client_id, enrollment_id, provider, customer_ref,
      subscription_ref, price_ref, price_cents, status, idempotency_key
    ) values (
      '00000000-0000-0000-0000-0000000000c2',
      '00000000-0000-0000-0000-0000000000c0',
      'mock', 'mock_cus_active', 'mock_sub_active',
      'mock_price_monitoring', 4900, 'active', 'mock_idem_active'
    )
  $$,
  'an active parent can receive a settled subscription'
);

select has_index(
  'public',
  'consumer_subscriptions',
  'uniq_active_sub_per_client',
  'one active subscription per client is backed by a unique index'
);

update public.enrollments
set status = 'active'
where id = '00000000-0000-0000-0000-0000000000be';

select throws_ok(
  $$
    insert into public.consumer_subscriptions (
      client_id, enrollment_id, provider, customer_ref,
      subscription_ref, price_ref, price_cents, status, idempotency_key
    ) values (
      '00000000-0000-0000-0000-0000000000b1',
      '00000000-0000-0000-0000-0000000000c0',
      'mock', 'mock_cus_mismatch', 'mock_sub_mismatch',
      'mock_price_monitoring', 4900, 'active', 'mock_idem_mismatch'
    )
  $$,
  '23514', null, 'a subscription cannot point at another client enrollment'
);

select throws_ok(
  $$
    update public.consumer_subscriptions
    set status = 'active', subscription_ref = null
    where enrollment_id = '00000000-0000-0000-0000-0000000000be'
  $$,
  '23514', null, 'active status requires a subscription reference'
);

select throws_ok(
  $$
    update public.consumer_subscriptions
    set status = 'authorized', subscription_ref = 'mock_sub_half_state'
    where enrollment_id = '00000000-0000-0000-0000-0000000000be'
  $$,
  '23514', null, 'a subscription reference requires a settled status'
);

insert into public.stripe_webhook_events (event_id, event_type) values (
  'mock_event_replay',
  'setup_intent.succeeded'
);

select throws_ok(
  $$
    insert into public.stripe_webhook_events (event_id, event_type) values (
      'mock_event_replay',
      'setup_intent.succeeded'
    )
  $$,
  '23505', null, 'a replayed webhook event collides with the original id'
);

select is_empty(
  $$
    select table_name, column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name in (
        'esignatures',
        'consent_revocations',
        'idv_sessions',
        'consumer_subscriptions',
        'stripe_webhook_events'
      )
      and column_name in ('raw', 'payload', 'body', 'report', 'snapshot', 'tradeline')
  $$,
  'lane B tables expose no provider-content or bureau-content column'
);

select is(
  (
    select count(*)::integer
    from pg_class
    where oid in (
      'public.consumer_subscriptions'::regclass,
      'public.stripe_webhook_events'::regclass
    )
      and relrowsecurity
      and relforcerowsecurity
  ),
  2,
  'both billing tables enable and force row security'
);

select * from finish();
rollback;
