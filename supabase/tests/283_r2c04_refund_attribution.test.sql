begin;
set local search_path = public, extensions;

-- 2026-08-17 R2C-04: late refund identity is reconciled append-only.
select plan(20);

select has_table('public', 'billing_refund_attributions', 'refund attribution table exists');
select has_trigger('public', 'billing_refund_attributions', 'billing_refund_attributions_prevent_change', 'attributions reject row mutation');
select has_trigger('public', 'billing_refund_attributions', 'billing_refund_attributions_no_truncate', 'attributions reject truncation');
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.billing_refund_attributions'::regclass),
  'attribution RLS is enabled and forced'
);
select ok(
  has_function_privilege('service_role', 'public.billing_attribute_unmatched_refunds(text)', 'execute'),
  'service role can run reconciliation'
);

insert into public.orgs(id, name, slug) values
  ('28300000-0000-4000-8000-000000000001', 'Refund Before Subscription', 'r2c04-before'),
  ('28300000-0000-4000-8000-000000000002', 'Refund After Subscription', 'r2c04-after'),
  ('28300000-0000-4000-8000-000000000003', 'Refund Ambiguous A', 'r2c04-ambiguous-a'),
  ('28300000-0000-4000-8000-000000000004', 'Refund Ambiguous B', 'r2c04-ambiguous-b');

insert into public.stripe_webhook_events(event_id, event_type) values
  ('evt_283_before', 'charge.refunded'),
  ('evt_283_after', 'charge.refunded'),
  ('evt_283_ambiguous', 'charge.refunded');

select is(
  (public.billing_record_refund_observation(
    'evt_283_before', 'ch_283_before', 'cus_283_before', 'sub_283_before',
    2100, 'usd', '2026-08-17T10:00:00Z'
  )->>'attributed'),
  'false',
  'refund arriving before subscription remains immutable and initially unattributed'
);
select is(
  (select count(*)::integer from public.billing_refund_attributions
    where observation_id = (select id from public.billing_refund_observations where event_id = 'evt_283_before')),
  0,
  'an unmatched refund has no speculative attribution'
);

select public.operator_billing_upsert_subscription(
  '28300000-0000-4000-8000-000000000001', 'mock',
  'cus_283_before', 'sub_283_before', null, null, 'base_283', 'seat_283',
  'active', '2026-09-17T00:00:00Z'
);

select is(
  (select org_id from public.billing_refund_attributions
    where observation_id = (select id from public.billing_refund_observations where event_id = 'evt_283_before')),
  '28300000-0000-4000-8000-000000000001'::uuid,
  'subscription upsert reconciles the earlier refund to its sole org'
);
select is(
  (select source from public.billing_refund_attributions
    where observation_id = (select id from public.billing_refund_observations where event_id = 'evt_283_before')),
  'subscription_upsert',
  'late attribution records its reconciliation source'
);
select is(
  public.revenue_read_refund_total('28300000-0000-4000-8000-000000000001', '2026-08-01'),
  2100::bigint,
  'accrual reads the reconciled attribution without rewriting the observation'
);

select public.operator_billing_upsert_subscription(
  '28300000-0000-4000-8000-000000000002', 'mock',
  'cus_283_after', 'sub_283_after', null, null, 'base_283', 'seat_283',
  'active', '2026-09-17T00:00:00Z'
);
select is(
  (public.billing_record_refund_observation(
    'evt_283_after', 'ch_283_after', 'cus_283_after', 'sub_283_after',
    900, 'usd', '2026-08-17T11:00:00Z'
  )->>'attributed'),
  'true',
  'refund arriving after subscription resolves immediately'
);
select is(
  (select source from public.billing_refund_attributions
    where observation_id = (select id from public.billing_refund_observations where event_id = 'evt_283_after')),
  'observation',
  'immediate resolution writes one append-only attribution'
);

select public.operator_billing_upsert_subscription(
  '28300000-0000-4000-8000-000000000003', 'mock',
  'cus_283_ambiguous', 'sub_283_a', null, null, 'base_283', 'seat_283',
  'active', '2026-09-17T00:00:00Z'
);
select public.operator_billing_upsert_subscription(
  '28300000-0000-4000-8000-000000000004', 'mock',
  'cus_283_b', 'sub_283_ambiguous', null, null, 'base_283', 'seat_283',
  'active', '2026-09-17T00:00:00Z'
);
select is(
  (public.billing_record_refund_observation(
    'evt_283_ambiguous', 'ch_283_ambiguous', 'cus_283_ambiguous', 'sub_283_ambiguous',
    500, 'usd', '2026-08-17T12:00:00Z'
  )->>'attributed'),
  'false',
  'conflicting provider references remain unattributed'
);
select is(
  (public.billing_attribute_unmatched_refunds('reconciliation')->>'ambiguous')::integer,
  1,
  'reconciliation reports an ambiguous match instead of guessing'
);
select is(
  (select count(*)::integer from public.billing_refund_attributions
    where observation_id = (select id from public.billing_refund_observations where event_id = 'evt_283_ambiguous')),
  0,
  'ambiguous evidence receives no attribution row'
);

select is(
  (public.billing_attribute_unmatched_refunds('reconciliation')->>'attributed')::integer,
  0,
  'replaying reconciliation adds no duplicate attribution'
);
select is(
  (select count(*)::integer from public.billing_refund_attributions
    where observation_id = (select id from public.billing_refund_observations where event_id = 'evt_283_before')),
  1,
  'reconciliation replay preserves exactly one attribution'
);
select throws_ok(
  $$update public.billing_refund_attributions set source = 'reconciliation' where source = 'subscription_upsert'$$,
  'P0001',
  'billing_refund_attributions rows are append-only',
  'attribution rows cannot be updated'
);
select throws_ok(
  $$delete from public.billing_refund_attributions where source = 'subscription_upsert'$$,
  'P0001',
  'billing_refund_attributions rows are append-only',
  'attribution rows cannot be deleted'
);
select throws_ok(
  $$truncate public.billing_refund_attributions$$,
  '42501',
  'billing_refund_attributions is append-only',
  'attribution history cannot be truncated'
);

select * from finish();
rollback;
