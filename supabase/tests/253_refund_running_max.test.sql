begin;
create extension if not exists pgtap with schema extensions;

-- 2026-08-17 R1C-07: cumulative refund ordering converges within and across months.
select plan(8);

insert into public.orgs(id, name, slug) values
  ('25300000-0000-4000-8000-000000000001', 'Refund A', 'r1c07-a'),
  ('25300000-0000-4000-8000-000000000002', 'Refund B', 'r1c07-b'),
  ('25300000-0000-4000-8000-000000000003', 'Refund C', 'r1c07-c'),
  ('25300000-0000-4000-8000-000000000004', 'Refund D', 'r1c07-d'),
  ('25300000-0000-4000-8000-000000000005', 'Refund E', 'r1c07-e');

insert into public.operator_subscriptions(
  org_id, provider, customer_ref, subscription_ref, base_price_ref, seat_price_ref, status
) values
  ('25300000-0000-4000-8000-000000000001', 'mock', 'cus_253_a', 'sub_253_a', 'base', 'seat', 'active'),
  ('25300000-0000-4000-8000-000000000002', 'mock', 'cus_253_b', 'sub_253_b', 'base', 'seat', 'active'),
  ('25300000-0000-4000-8000-000000000003', 'mock', 'cus_253_c', 'sub_253_c', 'base', 'seat', 'active'),
  ('25300000-0000-4000-8000-000000000004', 'mock', 'cus_253_d', 'sub_253_d', 'base', 'seat', 'active'),
  ('25300000-0000-4000-8000-000000000005', 'mock', 'cus_253_e', 'sub_253_e', 'base', 'seat', 'active');

insert into public.stripe_webhook_events(event_id, event_type)
select event_id, 'charge.refunded' from unnest(array[
  'evt_253_a_1','evt_253_a_2','evt_253_b_1','evt_253_b_2',
  'evt_253_c_1','evt_253_c_2','evt_253_c_3','evt_253_d_1',
  'evt_253_d_2','evt_253_e_1','evt_253_e_2'
]) as event_id;

select public.billing_record_refund_observation('evt_253_a_1','ch_253_a','cus_253_a','sub_253_a',1000,'usd','2026-08-17T12:00:00Z');
select public.billing_record_refund_observation('evt_253_a_2','ch_253_a','cus_253_a','sub_253_a',2500,'usd','2026-08-17T12:00:00Z');
select is(public.revenue_read_refund_total('25300000-0000-4000-8000-000000000001','2026-08-01'), 2500::bigint, 'equal-second low-then-high totals the running maximum');

select public.billing_record_refund_observation('evt_253_b_1','ch_253_b','cus_253_b','sub_253_b',2500,'usd','2026-08-17T12:00:00Z');
select public.billing_record_refund_observation('evt_253_b_2','ch_253_b','cus_253_b','sub_253_b',1000,'usd','2026-08-17T12:00:00Z');
select is(public.revenue_read_refund_total('25300000-0000-4000-8000-000000000002','2026-08-01'), 2500::bigint, 'equal-second high-then-low totals the same maximum');

select public.billing_record_refund_observation('evt_253_c_1','ch_253_c','cus_253_c','sub_253_c',1000,'usd','2026-08-17T12:00:00Z');
select public.billing_record_refund_observation('evt_253_c_2','ch_253_c','cus_253_c','sub_253_c',1000,'usd','2026-08-17T12:00:00Z');
select public.billing_record_refund_observation('evt_253_c_3','ch_253_c','cus_253_c','sub_253_c',2500,'usd','2026-08-17T12:00:00Z');
select is(public.revenue_read_refund_total('25300000-0000-4000-8000-000000000003','2026-08-01'), 2500::bigint, 'duplicate cumulative observations add no extra delta');
select is((public.billing_record_refund_observation('evt_253_c_3','ch_253_c','cus_253_c','sub_253_c',2500,'usd','2026-08-17T12:00:00Z')->>'reason_code'), 'duplicate', 'event replay remains a stable duplicate');

select public.billing_record_refund_observation('evt_253_d_1','ch_253_d','cus_253_d','sub_253_d',2500,'usd','2026-08-20T12:00:00Z');
select public.billing_record_refund_observation('evt_253_d_2','ch_253_d','cus_253_d','sub_253_d',1000,'usd','2026-08-10T12:00:00Z');
select is(public.revenue_read_refund_total('25300000-0000-4000-8000-000000000004','2026-08-01'), 2500::bigint, 'out-of-order arrival recomputes the same maximum');

select public.billing_record_refund_observation('evt_253_e_1','ch_253_e','cus_253_e','sub_253_e',1000,'usd','2026-07-31T23:59:59Z');
select public.billing_record_refund_observation('evt_253_e_2','ch_253_e','cus_253_e','sub_253_e',2500,'usd','2026-08-01T00:00:00Z');
select is(public.revenue_read_refund_total('25300000-0000-4000-8000-000000000005','2026-07-01'), 1000::bigint, 'prior-month observation owns its original delta');
select is(public.revenue_read_refund_total('25300000-0000-4000-8000-000000000005','2026-08-01'), 1500::bigint, 'new month receives only the increase over the prior baseline');
select ok(
  pg_get_functiondef('public.revenue_read_refund_total(uuid,date)'::regprocedure) like '%rows between unbounded preceding and 1 preceding%',
  'refund totals use a prior-row running maximum'
);

select * from finish();
rollback;
