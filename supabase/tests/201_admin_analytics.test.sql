begin;
set local search_path = public, extensions;
select plan(32);

select has_table('public', 'kpi_rollups', 'KPI rollup table exists');
select has_table('public', 'admin_layouts', 'admin layout table exists');
select has_function('public', 'admin_compute_kpi_metrics', array['text','text','date'], 'KPI calculator exists');
select has_function('public', 'admin_upsert_kpi_rollup', array['text','text','date'], 'KPI upsert exists');
select has_function('public', 'admin_set_layout', array['uuid','jsonb'], 'layout RPC exists');
select is(
  (select bool_and(c.relrowsecurity and c.relforcerowsecurity)
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname in ('kpi_rollups','admin_layouts')),
  true,
  'analytics tables enable and force RLS'
);
select is(has_table_privilege('authenticated', 'public.kpi_rollups', 'insert'), false, 'authenticated cannot insert rollups');
select is(has_table_privilege('authenticated', 'public.admin_layouts', 'update'), false, 'authenticated cannot update layouts directly');
select is(has_function_privilege('service_role', 'public.admin_upsert_kpi_rollup(text,text,date)', 'execute'), true, 'service role can run KPI upsert');
select is(has_function_privilege('authenticated', 'public.admin_set_layout(uuid,jsonb)', 'execute'), false, 'authenticated cannot call layout mutation RPC');
select has_index('public', 'kpi_rollups', 'kpi_rollups_subject_day_idx', '90-day read index exists');

select is(private.admin_layout_valid('["activeUsers"]'::jsonb), true, 'one allowed tile is valid');
select is(private.admin_layout_valid('["activeUsers","activeUsers"]'::jsonb), false, 'duplicate tiles are refused');
select is(private.admin_layout_valid('["unknown"]'::jsonb), false, 'unknown tiles are refused');
select is(private.admin_layout_valid('[]'::jsonb), false, 'empty layout is refused');
select is(
  private.admin_kpi_metrics_valid('{"activeUsers":null,"operators":0,"currentMonitoring":0,"trialConversionPct":null,"averageMonthlyPlanCents":null,"averageMembershipDays":null,"aiUsage":0,"fundedOutcomesCents":0}'::jsonb),
  true,
  'nullable eight-key metric shape is valid'
);
select is(
  private.admin_kpi_metrics_valid('{"activeUsers":0}'::jsonb),
  false,
  'partial metric shape is refused'
);

insert into auth.users (id, email) values
  ('23100000-0000-4000-8000-000000000001', 'admin-a@phase23.test'),
  ('23100000-0000-4000-8000-000000000002', 'admin-b@phase23.test'),
  ('23100000-0000-4000-8000-000000000003', 'member@phase23.test');
insert into public.orgs (id, name, slug, base_price_cents) values
  ('23100000-0000-4000-8000-000000000010', 'Phase 23 Analytics', 'phase-23-analytics', 49700);
insert into public.profiles (id, role, org_id, org_role, full_name, email) values
  ('23100000-0000-4000-8000-000000000001', 'platform_admin', null, null, 'Admin A', 'admin-a@phase23.test'),
  ('23100000-0000-4000-8000-000000000002', 'platform_admin', null, null, 'Admin B', 'admin-b@phase23.test'),
  ('23100000-0000-4000-8000-000000000003', 'operator_member', '23100000-0000-4000-8000-000000000010', 'owner', 'Member', 'member@phase23.test')
on conflict (id) do update set role=excluded.role, org_id=excluded.org_id, org_role=excluded.org_role, full_name=excluded.full_name, email=excluded.email;

select throws_ok(
  $$insert into public.kpi_rollups(scope,subject_id,day,metrics) values ('platform','org:23100000-0000-4000-8000-000000000010','2026-08-17','{"activeUsers":null,"operators":0,"currentMonitoring":0,"trialConversionPct":null,"averageMonthlyPlanCents":null,"averageMembershipDays":null,"aiUsage":0,"fundedOutcomesCents":0}')$$,
  '23514', null, 'scope and subject must match'
);
select lives_ok(
  $$select * from public.admin_upsert_kpi_rollup('platform','platform','2026-08-17')$$,
  'platform KPI row can be computed and stored'
);
select lives_ok(
  $$select * from public.admin_upsert_kpi_rollup('org','org:23100000-0000-4000-8000-000000000010','2026-08-17')$$,
  'organization KPI row can be computed and stored'
);
select lives_ok(
  $$select * from public.admin_upsert_kpi_rollup('member','member:23100000-0000-4000-8000-000000000003','2026-08-17')$$,
  'member KPI row can be computed and stored'
);
select is((select count(*) from public.kpi_rollups where day = '2026-08-17'), 3::bigint, 'all three scopes store one row');
select lives_ok(
  $$select * from public.admin_upsert_kpi_rollup('platform','platform','2026-08-17')$$,
  'same-day KPI retry succeeds'
);
select is((select count(*) from public.kpi_rollups where scope='platform' and subject_id='platform' and day='2026-08-17'), 1::bigint, 'same-day retry updates one row');
select is((select metrics->'activeUsers' from public.kpi_rollups where scope='platform' and day='2026-08-17'), 'null'::jsonb, 'unavailable active-user history remains null');
select is((select metrics->'averageMembershipDays' from public.kpi_rollups where scope='platform' and day='2026-08-17'), 'null'::jsonb, 'unavailable membership history remains null');
select is((select count(*) from public.orgs where id='23100000-0000-4000-8000-000000000010'), 1::bigint, 'KPI computation does not mutate its organization source');

select throws_ok(
  $$select * from public.admin_set_layout('23100000-0000-4000-8000-000000000003','["activeUsers"]')$$,
  'P0001', 'ADMIN_LAYOUT_ACTOR_FORBIDDEN', 'non-admin layout actor is refused'
);
select lives_ok(
  $$select * from public.admin_set_layout('23100000-0000-4000-8000-000000000001','["operators","activeUsers"]')$$,
  'admin can save an ordered layout'
);
select is((select layout from public.admin_layouts where profile_id='23100000-0000-4000-8000-000000000001'), '["operators","activeUsers"]'::jsonb, 'saved layout preserves order');

set local request.jwt.claims = '{"sub":"23100000-0000-4000-8000-000000000001","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.admin_layouts), 1::bigint, 'admin sees only own saved layout');
reset role;
set local request.jwt.claims = '{"sub":"23100000-0000-4000-8000-000000000002","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.admin_layouts), 0::bigint, 'second admin cannot read another layout');
reset role;

select * from finish();
rollback;
