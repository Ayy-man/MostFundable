-- R2C-05 — outbound paid-refresh payment ambiguity is durable and reviewable.

create extension if not exists pgtap with schema extensions;

begin;

set local search_path = public, extensions;

select plan(17);

select has_column('public', 'paid_refresh_requests', 'payment_attempt_state', 'payment attempt state is durable');
select has_column('public', 'paid_refresh_requests', 'payment_dispatch_started_at', 'dispatch time is durable');
select has_function(
  'public', 'begin_paid_refresh_payment_attempt', array['uuid', 'text'],
  'the pre-provider dispatch transition exists'
);
select ok(
  has_function_privilege('service_role', 'public.begin_paid_refresh_payment_attempt(uuid,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.begin_paid_refresh_payment_attempt(uuid,text)', 'EXECUTE'),
  'only service role can begin an outbound payment attempt'
);

insert into auth.users (id, email)
values ('28200000-0000-4000-8000-000000000011', 'r2c05-consumer@test.example');
insert into public.orgs (id, name, slug)
values ('28200000-0000-4000-8000-000000000001', 'R2C05 Payment Org', 'r2c05-payment-org');
insert into public.profiles (id, role, org_id, full_name, email)
values (
  '28200000-0000-4000-8000-000000000011', 'consumer',
  '28200000-0000-4000-8000-000000000001', 'R2C05 Consumer',
  'r2c05-consumer@test.example'
)
on conflict (id) do update set role = excluded.role, org_id = excluded.org_id;
insert into public.clients (id, org_id, consumer_profile_id, display_name)
values (
  '28200000-0000-4000-8000-000000000101',
  '28200000-0000-4000-8000-000000000001',
  '28200000-0000-4000-8000-000000000011',
  'R2C05 Client'
);

create temporary table r2c05_requests on commit drop as
select id, idempotency_key
from public.create_paid_refresh_request(
  '28200000-0000-4000-8000-000000000011',
  '28200000-0000-4000-8000-000000000101',
  'r2c05-request-one', 1900, 'usd', 'mock'
);

select is(
  (select payment_attempt_state from public.begin_paid_refresh_payment_attempt(
    (select id from r2c05_requests),
    'force_pull:28200000-0000-4000-8000-000000000201'
  )),
  'dispatching',
  'dispatching is persisted before the provider call'
);
select ok(
  (select payment_dispatch_started_at is not null from public.paid_refresh_requests where id = (select id from r2c05_requests)),
  'dispatching carries the retention clock anchor'
);

create temporary table r2c05_dispatch_time on commit drop as
select payment_dispatch_started_at
from public.paid_refresh_requests
where id = (select id from r2c05_requests);

select is(
  (select payment_dispatch_started_at from public.begin_paid_refresh_payment_attempt(
    (select id from r2c05_requests),
    'force_pull:28200000-0000-4000-8000-000000000201'
  )),
  (select payment_dispatch_started_at from r2c05_dispatch_time),
  'attempt replay keeps the original dispatch time'
);
select throws_ok(
  $$select * from public.begin_paid_refresh_payment_attempt(
    (select id from r2c05_requests), 'force_pull:different'
  )$$,
  '22023', 'PAID_REFRESH_PAYMENT_ATTEMPT_MISMATCH',
  'attempt replay cannot replace the durable idempotency key'
);

select is(
  (select payment_attempt_state from public.record_paid_refresh_provider_returned(
    (select id from r2c05_requests),
    'force_pull:28200000-0000-4000-8000-000000000201',
    'mock:event:r2c05', 'mock_payment_r2c05', 'succeeded', 1900, 'usd'
  )),
  'provider_returned',
  'the exact provider result is durable before event recording'
);
select is(
  (select payment_provider_payment_ref || '/' || payment_provider_outcome from public.paid_refresh_requests where id = (select id from r2c05_requests)),
  'mock_payment_r2c05/succeeded',
  'provider-returned state retains the result needed for recovery'
);
select is(
  (select payment_attempt_state from public.record_paid_refresh_provider_returned(
    (select id from r2c05_requests),
    'force_pull:28200000-0000-4000-8000-000000000201',
    'mock:event:r2c05', 'mock_payment_r2c05', 'succeeded', 1900, 'usd'
  )),
  'provider_returned',
  'provider-result replay is idempotent'
);

select is(
  (select outcome from public.record_paid_refresh_payment_event(
    (select id from r2c05_requests),
    'mock:event:r2c05', 'mock_payment_r2c05', 'succeeded', 1900, 'usd'
  )),
  'succeeded',
  'the staged provider result records as payment evidence'
);
select is(
  (select payment_attempt_state from public.paid_refresh_requests where id = (select id from r2c05_requests)),
  'recorded',
  'payment evidence closes the outbound attempt as recorded'
);
select is(
  (select payment_provider_payment_ref from public.read_paid_refresh_request((select id from r2c05_requests))),
  'mock_payment_r2c05',
  'durable reads expose the staged provider identity for recovery'
);

insert into r2c05_requests (id, idempotency_key)
select id, idempotency_key
from public.create_paid_refresh_request(
  '28200000-0000-4000-8000-000000000011',
  '28200000-0000-4000-8000-000000000101',
  -- Migration 431 keeps a paid request outstanding for its driver until the
  -- analysis chain closes. Use the other supported driver so this test can
  -- isolate the unresolved-dispatch path without bypassing that guard.
  'r2c05-request-two', 1900, 'usd', 'stripe'
);

select payment_attempt_state
from public.begin_paid_refresh_payment_attempt(
  (select id from r2c05_requests where idempotency_key = 'r2c05-request-two'),
  'force_pull:28200000-0000-4000-8000-000000000202'
);
select ok(
  public.mark_paid_refresh_payment_needs_review(
    (select id from r2c05_requests where idempotency_key = 'r2c05-request-two'),
    'force_pull:28200000-0000-4000-8000-000000000202'
  ),
  'an expired unresolved dispatch can be failed closed for review'
);
select is(
  (select payment_attempt_state from public.begin_paid_refresh_payment_attempt(
    (select id from r2c05_requests where idempotency_key = 'r2c05-request-two'),
    'force_pull:28200000-0000-4000-8000-000000000202'
  )),
  'needs_review',
  'review state is durable and cannot issue a fresh attempt'
);
select is(
  (select count(*)::integer from public.paid_refresh_payment_events where request_id = (select id from r2c05_requests where idempotency_key = 'r2c05-request-two')),
  0,
  'review state invents no payment evidence'
);

select * from finish();

rollback;
