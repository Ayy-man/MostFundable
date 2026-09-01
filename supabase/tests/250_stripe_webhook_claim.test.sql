begin;
create extension if not exists pgtap with schema extensions;

-- 2026-08-17 R1C-01: leased claims admit new, failed, and stale deliveries once.
select plan(18);

select has_column('public', 'stripe_webhook_events', 'lease_owner', 'webhook ledger records the lease owner');
select has_column('public', 'stripe_webhook_events', 'lease_until', 'webhook ledger records the lease deadline');
select has_function('public', 'claim_stripe_webhook_event', array['text', 'text', 'uuid', 'integer'], 'claim RPC exists');
select has_function('public', 'finish_stripe_webhook_event', array['text', 'uuid', 'text', 'text'], 'finish RPC exists');

select ok(public.claim_stripe_webhook_event(
  'evt_r1c01_new', 'invoice.paid', '25000000-0000-4000-8000-000000000001', 300
), 'a new delivery is claimed');
select is((select attempts from public.stripe_webhook_events where event_id = 'evt_r1c01_new'), 1, 'the first claim records one attempt');
select ok(not public.claim_stripe_webhook_event(
  'evt_r1c01_new', 'invoice.paid', '25000000-0000-4000-8000-000000000002', 300
), 'a live lease refuses a simultaneous delivery');
select ok(not public.finish_stripe_webhook_event(
  'evt_r1c01_new', '25000000-0000-4000-8000-000000000002', 'failed', 'dispatch_failed'
), 'a non-owner cannot finish the lease');
select ok(public.finish_stripe_webhook_event(
  'evt_r1c01_new', '25000000-0000-4000-8000-000000000001', 'failed', 'dispatch_failed'
), 'the owner records a failed delivery');
select is((select last_error_code from public.stripe_webhook_events where event_id = 'evt_r1c01_new'), 'dispatch_failed', 'failure keeps its short error code');
select ok(public.claim_stripe_webhook_event(
  'evt_r1c01_new', 'invoice.paid', '25000000-0000-4000-8000-000000000002', 300
), 'a failed delivery is reclaimed');
select is((select attempts from public.stripe_webhook_events where event_id = 'evt_r1c01_new'), 2, 'failed replay increments attempts');
select ok(public.finish_stripe_webhook_event(
  'evt_r1c01_new', '25000000-0000-4000-8000-000000000002', 'processed', null
), 'the replay reaches a terminal state');
select ok(not public.claim_stripe_webhook_event(
  'evt_r1c01_new', 'invoice.paid', '25000000-0000-4000-8000-000000000003', 300
), 'processed events remain terminal');

select ok(public.claim_stripe_webhook_event(
  'evt_r1c01_stale', 'invoice.paid', '25000000-0000-4000-8000-000000000001', 300
), 'a second new delivery is claimed');
update public.stripe_webhook_events set lease_until = pg_catalog.now() - interval '1 second' where event_id = 'evt_r1c01_stale';
select ok(public.claim_stripe_webhook_event(
  'evt_r1c01_stale', 'invoice.paid', '25000000-0000-4000-8000-000000000003', 300
), 'an expired received delivery is reclaimed');
select results_eq(
  $$select attempts, lease_owner::text from public.stripe_webhook_events where event_id = 'evt_r1c01_stale'$$,
  $$values (2, '25000000-0000-4000-8000-000000000003'::text)$$,
  'stale reclaim increments once and transfers ownership'
);
select throws_ok(
  $$select public.finish_stripe_webhook_event('evt_r1c01_stale', '25000000-0000-4000-8000-000000000003', 'failed', repeat('x', 65))$$,
  '22023', 'invalid webhook finish', 'long failure codes are refused'
);

select * from finish();
rollback;
