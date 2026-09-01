begin;
set local search_path = public, extensions;

-- 2026-08-17 R3C-01: the drain-side target follows committed active members.
select plan(4);

insert into public.orgs(id, name, slug, seats_included) values
  ('33300000-0000-4000-8000-000000000001', 'Seat recount', 'r3c01-seat-recount', 0);
insert into auth.users(id, email) values
  ('33300000-0000-4000-8000-000000000002', 'r3c01-owner@example.test'),
  ('33300000-0000-4000-8000-000000000003', 'r3c01-member@example.test');
delete from public.profiles where id in (
  '33300000-0000-4000-8000-000000000002', '33300000-0000-4000-8000-000000000003'
);
insert into public.profiles(id, org_id, role, org_role, full_name, email) values
  ('33300000-0000-4000-8000-000000000002', '33300000-0000-4000-8000-000000000001', 'operator_member', 'owner', 'Owner one', 'r3c01-owner@example.test'),
  ('33300000-0000-4000-8000-000000000003', '33300000-0000-4000-8000-000000000001', 'operator_member', 'member', 'Member two', 'r3c01-member@example.test');
insert into public.operator_subscriptions(
  org_id, provider, customer_ref, subscription_ref, base_item_ref, seat_item_ref,
  base_price_ref, seat_price_ref, status, seat_quantity
) values (
  '33300000-0000-4000-8000-000000000001', 'mock', 'cus_333', 'sub_333', 'base_333', 'seat_333',
  'price_base_333', 'price_seat_333', 'active', 1
);
insert into public.operator_seat_sync_outbox(org_id, desired_quantity, status)
values ('33300000-0000-4000-8000-000000000001', 1, 'pending')
on conflict (org_id) do update set desired_quantity=1, status='pending';

create temporary table old_target as select generation from public.operator_seat_sync_outbox where org_id='33300000-0000-4000-8000-000000000001';
create temporary table prepared as select * from public.operator_seat_sync_prepare('33300000-0000-4000-8000-000000000001');
select is((select desired_quantity from prepared), 2, 'drain-side recount replaces the stale seat target');
select isnt((select generation from prepared), (select generation from old_target), 'corrected target owns a new generation');
select is((select desired_quantity from public.operator_seat_sync_outbox where org_id='33300000-0000-4000-8000-000000000001'), 2, 'the corrected target is durable');
select is((select desired_quantity from public.operator_seat_sync_prepare('33300000-0000-4000-8000-000000000001')), 2, 'the corrected target replays without drift');

select * from finish();
rollback;
