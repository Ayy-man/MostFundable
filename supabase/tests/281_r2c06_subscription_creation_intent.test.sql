-- R2C-06 — direct and hosted creation share one durable organization intent.

create extension if not exists pgtap with schema extensions;

begin;

set local search_path = public, extensions;

select plan(15);

select has_table(
  'public', 'operator_subscription_creation_intents',
  'subscription creation intents are durable'
);
select is(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.operator_subscription_creation_intents'::regclass),
  true,
  'the intent table has forced row security'
);
select ok(
  not has_table_privilege('authenticated', 'public.operator_subscription_creation_intents', 'SELECT'),
  'authenticated callers cannot read server-owned intents'
);
select ok(
  has_function_privilege('service_role', 'public.operator_billing_claim_subscription_intent(uuid,text)', 'EXECUTE'),
  'service role can claim an intent'
);
select ok(
  not has_function_privilege('authenticated', 'public.operator_billing_claim_subscription_intent(uuid,text)', 'EXECUTE'),
  'authenticated callers cannot claim an intent'
);

insert into public.orgs (id, name, slug)
values
  ('28100000-0000-0000-0000-000000000001', 'R2C06 Intent Org', 'r2c06-intent-org'),
  ('28100000-0000-0000-0000-000000000002', 'R2C06 Active Org', 'r2c06-active-org');

create temporary table r2c06_claim on commit drop as
select public.operator_billing_claim_subscription_intent(
  '28100000-0000-0000-0000-000000000001', 'direct'
) as verdict;

select is(
  (select verdict->>'reason_code' from r2c06_claim),
  'created',
  'the first path creates the organization intent'
);
select is(
  public.operator_billing_claim_subscription_intent(
    '28100000-0000-0000-0000-000000000001', 'direct'
  )->>'operation_id',
  (select verdict->>'operation_id' from r2c06_claim),
  'same-path recovery reuses the server-owned operation id'
);
select is(
  public.operator_billing_claim_subscription_intent(
    '28100000-0000-0000-0000-000000000001', 'checkout'
  )->>'reason_code',
  'path_conflict',
  'the other public path receives a typed conflict before provider work'
);
select is(
  public.operator_billing_complete_subscription_intent(
    '28100000-0000-0000-0000-000000000001',
    (select (verdict->>'operation_id')::uuid from r2c06_claim),
    'checkout',
    'cs_wrong_path'
  )->>'reason_code',
  'path_conflict',
  'the other path cannot complete the intent'
);
select is(
  public.operator_billing_complete_subscription_intent(
    '28100000-0000-0000-0000-000000000001',
    (select (verdict->>'operation_id')::uuid from r2c06_claim),
    'direct',
    'sub_r2c06_created'
  )->>'reason_code',
  'created',
  'the owning path records the provider reference'
);
select is(
  public.operator_billing_claim_subscription_intent(
    '28100000-0000-0000-0000-000000000001', 'direct'
  )->>'provider_ref',
  'sub_r2c06_created',
  'crash recovery reads the durable provider reference'
);
select is(
  public.operator_billing_complete_subscription_intent(
    '28100000-0000-0000-0000-000000000001',
    (select (verdict->>'operation_id')::uuid from r2c06_claim),
    'direct',
    'sub_r2c06_created'
  )->>'reason_code',
  'duplicate',
  'completion replay is idempotent'
);
select is(
  public.operator_billing_complete_subscription_intent(
    '28100000-0000-0000-0000-000000000001',
    (select (verdict->>'operation_id')::uuid from r2c06_claim),
    'direct',
    'sub_r2c06_other'
  )->>'reason_code',
  'provider_conflict',
  'completion replay cannot replace the provider reference'
);

select throws_ok(
  $$insert into public.operator_subscription_creation_intents (org_id, creation_path) values ('28100000-0000-0000-0000-000000000001', 'checkout')$$,
  '23505',
  null,
  'the database permits only one live intent per organization'
);

insert into public.operator_subscriptions (
  org_id, provider, customer_ref, subscription_ref,
  base_price_ref, seat_price_ref, status
) values (
  '28100000-0000-0000-0000-000000000002',
  'mock', 'mock_cus_r2c06', 'mock_sub_r2c06',
  'mock_price_operator_base', 'mock_price_operator_seat', 'active'
);

select is(
  public.operator_billing_claim_subscription_intent(
    '28100000-0000-0000-0000-000000000002', 'checkout'
  )->>'reason_code',
  'active_subscription',
  'a bound active subscription prevents another creation intent'
);

select * from finish();

rollback;
