-- R4C-09 — an unreconcilable operator intent parks instead of releasing the org.
--
-- The claim in one line: after `review`, no path can obtain a fresh operation
-- id for that organization, which is what stops a second subscription being
-- created against a provider state nobody has looked at yet.

create extension if not exists pgtap with schema extensions;

begin;

set local search_path = public, extensions;

select plan(13);

select ok(
  has_function_privilege('service_role', 'public.operator_billing_review_subscription_intent(uuid,uuid,text)', 'EXECUTE'),
  'service role can park an intent'
);
select ok(
  not has_function_privilege('authenticated', 'public.operator_billing_review_subscription_intent(uuid,uuid,text)', 'EXECUTE'),
  'authenticated callers cannot park an intent'
);

insert into public.orgs (id, name, slug)
values
  ('35800000-0000-0000-0000-000000000001', 'R4C09 Review Org', 'r4c09-review-org'),
  ('35800000-0000-0000-0000-000000000002', 'R4C09 Guard Org', 'r4c09-guard-org');

create temporary table r4f5_claim on commit drop as
select public.operator_billing_claim_subscription_intent(
  '35800000-0000-0000-0000-000000000001', 'direct'
) as verdict;

select isnt(
  (select verdict->>'created_at' from r4f5_claim),
  null,
  'the claim reports when the intent was opened, so its age can be judged'
);

select is(
  public.operator_billing_review_subscription_intent(
    '35800000-0000-0000-0000-000000000001',
    (select (verdict->>'operation_id')::uuid from r4f5_claim),
    'made_up_reason'
  )->>'reason_code',
  'invalid_reason',
  'only the two modelled reasons may be recorded'
);

select is(
  public.operator_billing_review_subscription_intent(
    '35800000-0000-0000-0000-000000000001',
    (select (verdict->>'operation_id')::uuid from r4f5_claim),
    'unreconciled_past_retention'
  )->>'reason_code',
  'review',
  'a pending intent parks with its reason'
);

select is(
  (select status || ':' || review_reason
   from public.operator_subscription_creation_intents
   where operation_id = (select (verdict->>'operation_id')::uuid from r4f5_claim)),
  'review:unreconciled_past_retention',
  'the reason is durable beside the status'
);

-- The point of the whole migration: parking does not free the organization.
select is(
  public.operator_billing_claim_subscription_intent(
    '35800000-0000-0000-0000-000000000001', 'direct'
  )->>'reason_code',
  'needs_review',
  'the owning path cannot dispatch again while the intent is parked'
);
select is(
  public.operator_billing_claim_subscription_intent(
    '35800000-0000-0000-0000-000000000001', 'checkout'
  )->>'reason_code',
  'needs_review',
  'the hosted path is refused by review before the path check'
);
select is(
  (public.operator_billing_claim_subscription_intent(
    '35800000-0000-0000-0000-000000000001', 'direct'
  )->>'claimed')::boolean,
  false,
  'no claim is granted against a parked intent'
);
select throws_ok(
  $$insert into public.operator_subscription_creation_intents (org_id, creation_path) values ('35800000-0000-0000-0000-000000000001', 'direct')$$,
  '23505',
  null,
  'a parked intent still occupies the one live slot per organization'
);

select is(
  public.operator_billing_review_subscription_intent(
    '35800000-0000-0000-0000-000000000001',
    (select (verdict->>'operation_id')::uuid from r4f5_claim),
    'ambiguous_provider_match'
  )->>'reason_code',
  'duplicate',
  'parking replays without error and without rewriting the first reason'
);

-- A completed intent is a subscription the provider confirmed. Burying it under
-- review would hide a live subscription from every later read.
create temporary table r4f5_guard on commit drop as
select public.operator_billing_claim_subscription_intent(
  '35800000-0000-0000-0000-000000000002', 'direct'
) as verdict;
select public.operator_billing_complete_subscription_intent(
  '35800000-0000-0000-0000-000000000002',
  (select (verdict->>'operation_id')::uuid from r4f5_guard),
  'direct',
  'sub_r4f5_guard'
);
select is(
  public.operator_billing_review_subscription_intent(
    '35800000-0000-0000-0000-000000000002',
    (select (verdict->>'operation_id')::uuid from r4f5_guard),
    'ambiguous_provider_match'
  )->>'reason_code',
  'state_changed',
  'a completed intent cannot be parked'
);
select is(
  (select status from public.operator_subscription_creation_intents
   where operation_id = (select (verdict->>'operation_id')::uuid from r4f5_guard)),
  'created',
  'the completed intent keeps its provider reference and status'
);

select * from finish();

rollback;
