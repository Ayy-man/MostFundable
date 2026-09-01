begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into public.orgs (
  id, name, slug, brand, brand_published_at, plan, seat_price_cents, base_price_cents
) values (
  '27600000-0000-4000-8000-000000000001','R2A Public Brand','r2a-public-brand',
  '{"primaryColor":"#112233"}',pg_catalog.clock_timestamp(),'agency',3900,69700
);
insert into auth.users (id, email, raw_app_meta_data)
values
  ('27600000-0000-4000-8000-000000000011','platform-r2a12@test.example','{"app_role":"platform_admin"}'),
  ('27600000-0000-4000-8000-000000000012','operator-r2a12@test.example','{"app_role":"operator_member","org_id":"27600000-0000-4000-8000-000000000001","org_role":"owner"}'),
  ('27600000-0000-4000-8000-000000000013','consumer-r2a12@test.example','{"app_role":"consumer","org_id":"27600000-0000-4000-8000-000000000001"}'),
  ('27600000-0000-4000-8000-000000000014','affiliate-r2a12@test.example','{"app_role":"affiliate","org_id":"27600000-0000-4000-8000-000000000001"}');

select results_eq(
  $$select column_name::text collate "C" from information_schema.columns
    where table_schema='public' and table_name='org_brand_view' order by ordinal_position$$,
  $$values
    ('id'::text collate "C"),('name'::text collate "C"),('slug'::text collate "C"),
    ('brand'::text collate "C"),('brand_published_at'::text collate "C")$$,
  'consumer and affiliate projection exposes exactly five ordered brand columns'
);

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"27600000-0000-4000-8000-000000000011"}';
select results_eq(
  $$select plan,seat_price_cents,base_price_cents from public.orgs where id='27600000-0000-4000-8000-000000000001'$$,
  $$values ('agency'::public.org_plan,3900,69700)$$,
  'platform administrator retains the full organization row'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"27600000-0000-4000-8000-000000000012"}';
select results_eq(
  $$select plan,seat_price_cents,base_price_cents from public.orgs where id='27600000-0000-4000-8000-000000000001'$$,
  $$values ('agency'::public.org_plan,3900,69700)$$,
  'operator retains its tenant commercial organization row'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"27600000-0000-4000-8000-000000000013"}';
select is_empty(
  $$select * from public.orgs where id='27600000-0000-4000-8000-000000000001'$$,
  'consumer cannot read the base organization row'
);
select results_eq(
  $$select id,name,slug,brand,brand_published_at is not null from public.org_brand_view$$,
  $$values ('27600000-0000-4000-8000-000000000001'::uuid,'R2A Public Brand'::text,'r2a-public-brand'::text,'{"primaryColor":"#112233"}'::jsonb,true)$$,
  'consumer reads only the brand projection'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"27600000-0000-4000-8000-000000000014"}';
select is_empty(
  $$select * from public.orgs where id='27600000-0000-4000-8000-000000000001'$$,
  'affiliate cannot read the base organization row'
);
select results_eq(
  $$select id,name,slug,brand,brand_published_at is not null from public.org_brand_view$$,
  $$values ('27600000-0000-4000-8000-000000000001'::uuid,'R2A Public Brand'::text,'r2a-public-brand'::text,'{"primaryColor":"#112233"}'::jsonb,true)$$,
  'affiliate reads only the brand projection'
);

-- ---------------------------------------------------------------------------
-- R4A-03. `org_brand_view` is owner-context, so the affiliate arm needs the
-- tenant-membership predicate the route's 402 supplies and RLS cannot. The
-- consumer arm stays open: TEN-04 keeps consumers unwalled. On `c2df7ae` the
-- affiliate assertion below returned the brand row.
-- ---------------------------------------------------------------------------

reset role;
select pg_catalog.set_config('app.billing_write', 'on', true);
update public.orgs set membership = 'deactivated'
where id = '27600000-0000-4000-8000-000000000001';
select pg_catalog.set_config('app.billing_write', '', true);

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"27600000-0000-4000-8000-000000000014"}';
select is_empty(
  $$select * from public.org_brand_view$$,
  'a deactivated organization walls its affiliate out of the brand projection'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"27600000-0000-4000-8000-000000000013"}';
select results_eq(
  $$select id,name,slug from public.org_brand_view$$,
  $$values ('27600000-0000-4000-8000-000000000001'::uuid,'R2A Public Brand'::text,'r2a-public-brand'::text)$$,
  'a consumer of the deactivated organization still reads the brand projection'
);

select * from finish();
rollback;
