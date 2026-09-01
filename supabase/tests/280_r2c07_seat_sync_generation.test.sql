-- R2C-07 — an older seat worker cannot complete a newer observed target.

create extension if not exists pgtap with schema extensions;

begin;

set local search_path = public, extensions;

select plan(15);

select has_column(
  'public', 'operator_seat_sync_outbox', 'generation',
  'the seat outbox carries a provider-operation generation'
);
select col_not_null(
  'public', 'operator_seat_sync_outbox', 'generation',
  'every seat target has a generation'
);
select has_function(
  'public', 'operator_billing_set_seat_quantity',
  array['uuid', 'integer', 'uuid', 'text'],
  'seat completion requires the observed generation'
);
select has_function(
  'public', 'operator_seat_sync_record_failure',
  array['uuid', 'uuid', 'text'],
  'seat failure recording requires the observed generation'
);

insert into public.orgs (id, name, slug, seats_included)
values (
  '28000000-0000-0000-0000-000000000001',
  'R2C07 Seat Generation Org',
  'r2c07-seat-generation-org',
  0
);

insert into public.operator_subscriptions (
  org_id, provider, base_price_ref, seat_price_ref, seat_quantity
) values (
  '28000000-0000-0000-0000-000000000001',
  'mock', 'mock_price_operator_base', 'mock_price_operator_seat', 0
);

insert into public.operator_seat_sync_outbox (
  org_id, desired_quantity, generation, status
) values (
  '28000000-0000-0000-0000-000000000001',
  0,
  '28000000-0000-0000-0000-000000000010',
  'synced'
);

insert into auth.users (id, email, raw_app_meta_data)
values (
  '28000000-0000-0000-0000-000000000101',
  'r2c07-seat-one@test.example',
  pg_catalog.jsonb_build_object(
    'app_role', 'operator_member',
    'full_name', 'R2C07 Seat One',
    'org_id', '28000000-0000-0000-0000-000000000001',
    'org_role', 'prep_specialist'
  )
);

select isnt(
  (select generation from public.operator_seat_sync_outbox where org_id = '28000000-0000-0000-0000-000000000001'),
  '28000000-0000-0000-0000-000000000010'::uuid,
  'observing a target replaces the prior generation'
);
select is(
  (select desired_quantity from public.operator_seat_sync_outbox where org_id = '28000000-0000-0000-0000-000000000001'),
  1,
  'the first observed target is one seat'
);

create temporary table r2c07_first_generation on commit drop as
select generation
from public.operator_seat_sync_outbox
where org_id = '28000000-0000-0000-0000-000000000001';

insert into auth.users (id, email, raw_app_meta_data)
values (
  '28000000-0000-0000-0000-000000000102',
  'r2c07-seat-two@test.example',
  pg_catalog.jsonb_build_object(
    'app_role', 'operator_member',
    'full_name', 'R2C07 Seat Two',
    'org_id', '28000000-0000-0000-0000-000000000001',
    'org_role', 'prep_specialist'
  )
);

select isnt(
  (select generation from public.operator_seat_sync_outbox where org_id = '28000000-0000-0000-0000-000000000001'),
  (select generation from r2c07_first_generation),
  'a superseding target receives another generation'
);
select is(
  (select desired_quantity from public.operator_seat_sync_outbox where org_id = '28000000-0000-0000-0000-000000000001'),
  2,
  'the superseding target carries the current quantity'
);

select is(
  (
    select public.operator_billing_set_seat_quantity(
      '28000000-0000-0000-0000-000000000001',
      1,
      generation,
      'test'
    )
    from r2c07_first_generation
  )->>'reason_code',
  'superseded',
  'an older worker cannot complete the newer target'
);
select is(
  (select seat_quantity from public.operator_subscriptions where org_id = '28000000-0000-0000-0000-000000000001'),
  0,
  'a superseded completion cannot change the local subscription quantity'
);
select is(
  (select desired_quantity::text || '/' || status || '/' || coalesce(processed_at::text, 'null') from public.operator_seat_sync_outbox where org_id = '28000000-0000-0000-0000-000000000001'),
  '2/pending/null',
  'a superseded completion leaves the current target pending'
);
select is(
  (
    select public.operator_seat_sync_record_failure(
      '28000000-0000-0000-0000-000000000001',
      generation,
      'late_failure'
    )
    from r2c07_first_generation
  )->>'reason_code',
  'superseded',
  'an older worker cannot fail the newer target'
);
select is(
  (select attempts from public.operator_seat_sync_outbox where org_id = '28000000-0000-0000-0000-000000000001'),
  0,
  'a superseded failure cannot increment the current target attempts'
);

select is(
  (
    select public.operator_billing_set_seat_quantity(
      outbox.org_id,
      outbox.desired_quantity,
      outbox.generation,
      'test'
    )
    from public.operator_seat_sync_outbox as outbox
    where outbox.org_id = '28000000-0000-0000-0000-000000000001'
  )->>'reason_code',
  'applied',
  'the current generation can complete its target'
);
select is(
  (select subscription.seat_quantity::text || '/' || outbox.status from public.operator_subscriptions as subscription join public.operator_seat_sync_outbox as outbox using (org_id) where subscription.org_id = '28000000-0000-0000-0000-000000000001'),
  '2/synced',
  'the current completion updates both subscription and outbox state'
);

select * from finish();

rollback;
