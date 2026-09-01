begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into public.orgs (id, name, slug)
values
  ('27400000-0000-4000-8000-000000000001','R2A Affiliate View A','r2a-affiliate-view-a'),
  ('27400000-0000-4000-8000-000000000002','R2A Affiliate View B','r2a-affiliate-view-b');
insert into auth.users (id, email, raw_app_meta_data)
values
  ('27400000-0000-4000-8000-000000000011','affiliate-a-r2a10@test.example','{"app_role":"affiliate","org_id":"27400000-0000-4000-8000-000000000001"}'),
  ('27400000-0000-4000-8000-000000000012','affiliate-b-r2a10@test.example','{"app_role":"affiliate","org_id":"27400000-0000-4000-8000-000000000002"}'),
  -- 2026-08-18 R4A-03: the consumer control for the deactivation arms below.
  ('27400000-0000-4000-8000-000000000013','consumer-b-r4a03@test.example','{"app_role":"consumer","org_id":"27400000-0000-4000-8000-000000000002"}');
insert into public.affiliates (id, org_id, profile_id, name, referral_slug)
values
  ('27400000-0000-4000-8000-000000000021','27400000-0000-4000-8000-000000000001','27400000-0000-4000-8000-000000000011','Affiliate A','r2a-view-affiliate-a'),
  ('27400000-0000-4000-8000-000000000022','27400000-0000-4000-8000-000000000002','27400000-0000-4000-8000-000000000012','Affiliate B','r2a-view-affiliate-b');
-- 2026-08-17 R3A-05: the projection fixture verifies stored historical
-- amounts, so mark only this setup insert as governed.
select pg_catalog.set_config('app.governed_client_write', 'on', true);
insert into public.clients (id, org_id, display_name, funded_amount_cents)
values
  ('27400000-0000-4000-8000-000000000101','27400000-0000-4000-8000-000000000001','Affiliate View Client A',101),
  ('27400000-0000-4000-8000-000000000102','27400000-0000-4000-8000-000000000002','Affiliate View Client B',202);
select pg_catalog.set_config('app.governed_client_write', '', true);
insert into public.affiliate_client_shares (affiliate_id, client_id)
values
  ('27400000-0000-4000-8000-000000000021','27400000-0000-4000-8000-000000000101'),
  ('27400000-0000-4000-8000-000000000022','27400000-0000-4000-8000-000000000102');

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"27400000-0000-4000-8000-000000000011"}';
select results_eq(
  $$select funded_amount_cents from public.affiliate_client_view$$,
  $$values (101::bigint)$$,
  'enabled affiliate sees only its own projection'
);

reset role;
update public.profiles set role = 'consumer' where id = '27400000-0000-4000-8000-000000000011';
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"27400000-0000-4000-8000-000000000011"}';
select is_empty(
  $$select * from public.affiliate_client_view$$,
  'wrong-role linked profile sees no affiliate projection'
);

reset role;
update public.profiles set role = 'affiliate', disabled_at = pg_catalog.clock_timestamp()
where id = '27400000-0000-4000-8000-000000000011';
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"27400000-0000-4000-8000-000000000011"}';
select is_empty(
  $$select * from public.affiliate_client_view$$,
  'disabled affiliate sees no affiliate projection'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"27400000-0000-4000-8000-000000000012"}';
select results_eq(
  $$select funded_amount_cents from public.affiliate_client_view$$,
  $$values (202::bigint)$$,
  'second affiliate cannot see the first affiliate projection'
);

-- ---------------------------------------------------------------------------
-- R4A-03. The view is owner-context, so base-table RLS cannot supply the tenant
-- check and the route's 402 is bypassed by a direct Data API read on the same
-- valid JWT. Every arm below runs under affiliate B's unchanged JWT in this one
-- transaction; on `c2df7ae` the two `is_empty` assertions returned the row.
-- ---------------------------------------------------------------------------

reset role;
select pg_catalog.set_config('app.billing_write', 'on', true);
update public.orgs set membership = 'current'
where id = '27400000-0000-4000-8000-000000000002';
select pg_catalog.set_config('app.billing_write', '', true);
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"27400000-0000-4000-8000-000000000012"}';
select results_eq(
  $$select funded_amount_cents from public.affiliate_client_view$$,
  $$values (202::bigint)$$,
  'a current organization keeps its affiliate projection'
);
select results_eq(
  $$select count(*)::integer from public.org_brand_view$$,
  $$values (1)$$,
  'a current organization keeps its affiliate brand projection'
);

reset role;
select pg_catalog.set_config('app.billing_write', 'on', true);
update public.orgs set membership = 'trial'
where id = '27400000-0000-4000-8000-000000000002';
select pg_catalog.set_config('app.billing_write', '', true);
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"27400000-0000-4000-8000-000000000012"}';
select results_eq(
  $$select funded_amount_cents from public.affiliate_client_view$$,
  $$values (202::bigint)$$,
  'a trial organization keeps its affiliate projection'
);

reset role;
select pg_catalog.set_config('app.billing_write', 'on', true);
update public.orgs set membership = 'deactivated'
where id = '27400000-0000-4000-8000-000000000002';
select pg_catalog.set_config('app.billing_write', '', true);
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"27400000-0000-4000-8000-000000000012"}';
select is_empty(
  $$select * from public.affiliate_client_view$$,
  'a deactivated organization walls its affiliate out of the client projection'
);
select is_empty(
  $$select * from public.org_brand_view$$,
  'a deactivated organization walls its affiliate out of the brand projection'
);

-- TEN-04 keeps consumers unwalled: the same deactivation must not take the
-- operator's brand away from the consumer surface.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"27400000-0000-4000-8000-000000000013"}';
select results_eq(
  $$select count(*)::integer from public.org_brand_view$$,
  $$values (1)$$,
  'a consumer of the deactivated organization still reads the brand projection'
);

select * from finish();
rollback;
