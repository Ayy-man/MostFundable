-- R3C-02 — a stable provider payment may advance append-only after required action.

create extension if not exists pgtap with schema extensions;
begin;
set local search_path = public, extensions;
select plan(8);

insert into auth.users (id, email)
values ('33700000-0000-4000-8000-000000000011', 'r3c02-consumer@test.example');
insert into public.orgs (id, name, slug)
values ('33700000-0000-4000-8000-000000000001', 'R3C02 Payment Org', 'r3c02-payment-org');
insert into public.profiles (id, role, org_id, full_name, email)
values (
  '33700000-0000-4000-8000-000000000011', 'consumer',
  '33700000-0000-4000-8000-000000000001', 'R3C02 Consumer',
  'r3c02-consumer@test.example'
)
on conflict (id) do update
set role = excluded.role, org_id = excluded.org_id, full_name = excluded.full_name;
insert into public.clients (id, org_id, consumer_profile_id, display_name)
values (
  '33700000-0000-4000-8000-000000000101',
  '33700000-0000-4000-8000-000000000001',
  '33700000-0000-4000-8000-000000000011', 'R3C02 Client'
);

create temporary table r3c02_request on commit drop as
select id from public.create_paid_refresh_request(
  '33700000-0000-4000-8000-000000000011',
  '33700000-0000-4000-8000-000000000101',
  'r3c02-request', 1900, 'usd', 'mock'
);

select payment_attempt_state from public.begin_paid_refresh_payment_attempt(
  (select id from r3c02_request), 'force_pull:r3c02'
);
select payment_attempt_state from public.record_paid_refresh_provider_returned(
  (select id from r3c02_request), 'force_pull:r3c02',
  'mock:event:action', 'mock:payment:r3c02', 'requires_action', 1900, 'usd'
);
select outcome from public.record_paid_refresh_payment_event(
  (select id from r3c02_request), 'mock:event:action',
  'mock:payment:r3c02', 'requires_action', 1900, 'usd'
);

select is(
  (select payment_attempt_state from public.record_paid_refresh_provider_returned(
    (select id from r3c02_request), 'force_pull:r3c02',
    'mock:event:success', 'mock:payment:r3c02', 'succeeded', 1900, 'usd'
  )), 'provider_returned',
  'the recorded action-required attempt can advance with the same payment identity'
);
select is(
  (select outcome from public.record_paid_refresh_payment_event(
    (select id from r3c02_request), 'mock:event:success',
    'mock:payment:r3c02', 'succeeded', 1900, 'usd'
  )), 'succeeded',
  'the terminal provider result records after the action-required event'
);
select is(
  (select count(*)::integer from public.paid_refresh_payment_events
   where request_id = (select id from r3c02_request)), 2,
  'the provider progression retains two append-only events'
);
select is(
  (select count(distinct provider_payment_ref)::integer
   from public.paid_refresh_payment_events
   where request_id = (select id from r3c02_request)), 1,
  'both events retain one stable provider payment identity'
);
select is(
  (select state from public.paid_refresh_requests where id = (select id from r3c02_request)),
  'paid', 'the advanced payment reaches paid state'
);
select throws_ok(
  $$select * from public.record_paid_refresh_provider_returned(
    (select id from r3c02_request), 'force_pull:r3c02',
    'mock:event:other', 'mock:payment:other', 'failed', 1900, 'usd'
  )$$,
  '22023', 'PAID_REFRESH_PROVIDER_RESULT_MISMATCH',
  'a terminal payment cannot be replaced by another provider identity'
);
select is(
  (select count(*)::integer from public.paid_refresh_payment_events
   where request_id = (select id from r3c02_request) and outcome = 'succeeded'),
  1, 'duplicate replay retains one success event'
);
select is(
  (select outcome from public.record_paid_refresh_payment_event(
    (select id from r3c02_request), 'mock:event:success',
    'mock:payment:r3c02', 'succeeded', 1900, 'usd'
  )), 'succeeded', 'terminal event replay is idempotent'
);

select * from finish();
rollback;
