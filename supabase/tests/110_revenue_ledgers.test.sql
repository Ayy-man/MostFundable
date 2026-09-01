create extension if not exists pgtap with schema extensions;

begin;

set local search_path = public, extensions;

select plan(41);

insert into public.orgs (id, name, slug)
values
  ('14110000-0000-0000-0000-000000000001', 'Revenue Referrer', 'revenue-referrer-1411'),
  ('14110000-0000-0000-0000-000000000002', 'Revenue Referred', 'revenue-referred-1411'),
  ('14110000-0000-0000-0000-000000000003', 'Revenue Other', 'revenue-other-1411');

insert into auth.users (id, email, raw_app_meta_data)
values
  (
    '14110000-0000-0000-0000-000000000101',
    'operator.revenue@test.example',
    '{"app_role":"operator_member"}'::jsonb
  ),
  (
    '14110000-0000-0000-0000-000000000102',
    'admin.revenue@test.example',
    '{"app_role":"platform_admin"}'::jsonb
  );

insert into public.profiles (id, role, org_id, org_role, full_name, email)
values
  (
    '14110000-0000-0000-0000-000000000101',
    'operator_member',
    '14110000-0000-0000-0000-000000000002',
    'owner',
    'Revenue Operator',
    'operator.revenue@test.example'
  ),
  (
    '14110000-0000-0000-0000-000000000102',
    'platform_admin',
    null,
    null,
    'Revenue Admin',
    'admin.revenue@test.example'
  )
on conflict (id) do update
set
  role = excluded.role,
  org_id = excluded.org_id,
  org_role = excluded.org_role,
  full_name = excluded.full_name,
  email = excluded.email;

select has_table('public', 'saas_referrals', 'saas_referrals exists');
select has_table('public', 'operator_earnings_ledger', 'operator earnings ledger exists');
select has_table('public', 'referral_ledger', 'referral ledger exists');
select has_function('public', 'revenue_read_accrual_inputs', array['uuid', 'date'], 'input RPC exists');
select has_function('public', 'revenue_list_accrual_orgs', array[]::text[], 'organization-list RPC exists');
select has_function(
  'public',
  'revenue_post_billing_accrual',
  array['uuid', 'date', 'bigint', 'numeric', 'bigint', 'integer', 'boolean', 'text', 'jsonb'],
  'posting RPC exists'
);
select has_function('public', 'revenue_read_kpis', array['date'], 'KPI RPC exists');

select is(
  (select bool_and(relrowsecurity) from pg_class where oid in (
    'public.saas_referrals'::regclass,
    'public.operator_earnings_ledger'::regclass,
    'public.referral_ledger'::regclass
  )),
  true,
  'RLS is enabled on every revenue table'
);
select is(
  (select bool_and(relforcerowsecurity) from pg_class where oid in (
    'public.saas_referrals'::regclass,
    'public.operator_earnings_ledger'::regclass,
    'public.referral_ledger'::regclass
  )),
  true,
  'RLS is forced on every revenue table'
);

insert into public.saas_referrals (
  id,
  referrer_org_id,
  referred_org_id,
  started_at
)
values (
  '14110000-0000-0000-0000-000000000201',
  '14110000-0000-0000-0000-000000000001',
  '14110000-0000-0000-0000-000000000002',
  '2026-01-15'
);

select is((select pct from public.saas_referrals where id = '14110000-0000-0000-0000-000000000201'), 20.00::numeric, 'percentage defaults to 20');
select is((select months from public.saas_referrals where id = '14110000-0000-0000-0000-000000000201'), 12::smallint, 'term defaults to 12 months');
select is((select base from public.saas_referrals where id = '14110000-0000-0000-0000-000000000201'), 'platform_subscription', 'basis defaults to platform subscription');

select throws_ok(
  $$insert into public.saas_referrals (referrer_org_id, referred_org_id, started_at)
    values ('14110000-0000-0000-0000-000000000003', '14110000-0000-0000-0000-000000000003', '2026-01-01')$$,
  '23514',
  null,
  'one organization cannot refer itself'
);
select throws_ok(
  $$insert into public.saas_referrals (referrer_org_id, referred_org_id, started_at)
    values ('14110000-0000-0000-0000-000000000003', '14110000-0000-0000-0000-000000000002', '2026-01-01')$$,
  '23505',
  null,
  'a referred organization has one referral'
);
select throws_ok(
  $$insert into public.operator_earnings_ledger (
      operator_org_id, accrual_month, is_complete, incomplete_code
    ) values (
      '14110000-0000-0000-0000-000000000003', '2026-02-02', false, 'monitoring_split_unset'
    )$$,
  '23514',
  null,
  'operator accrual month must be month start'
);
select throws_ok(
  $$insert into public.operator_earnings_ledger (
      operator_org_id, accrual_month, pct_snapshot, amount_cents,
      is_complete, incomplete_code
    ) values (
      '14110000-0000-0000-0000-000000000003', '2026-02-01', null, 1,
      false, 'monitoring_split_unset'
    )$$,
  '23514',
  null,
  'a missing split cannot carry an amount'
);

select lives_ok(
  $$select * from public.revenue_post_billing_accrual(
    '14110000-0000-0000-0000-000000000003',
    '2026-02-01',
    4900,
    null,
    null,
    1,
    false,
    'monitoring_split_unset',
    '[]'::jsonb
  )$$,
  'posting RPC persists an undefined split safely'
);
select is(
  (select pct_snapshot from public.operator_earnings_ledger where operator_org_id = '14110000-0000-0000-0000-000000000003'),
  null::numeric,
  'undefined split persists a null snapshot'
);
select is(
  (select amount_cents from public.operator_earnings_ledger where operator_org_id = '14110000-0000-0000-0000-000000000003'),
  null::bigint,
  'undefined split persists a null amount'
);
select is(
  (select operator_rows from public.revenue_post_billing_accrual(
    '14110000-0000-0000-0000-000000000003', '2026-02-01', 4900,
    null, null, 1, false, 'monitoring_split_unset', '[]'::jsonb
  )),
  0,
  'operator replay inserts no second row'
);

select lives_ok(
  $$select * from public.revenue_post_billing_accrual(
    '14110000-0000-0000-0000-000000000002',
    '2026-01-01',
    10000,
    10,
    1000,
    1,
    true,
    null,
    jsonb_build_array(jsonb_build_object(
      'saas_referral_id', '14110000-0000-0000-0000-000000000201',
      'referrer_org_id', '14110000-0000-0000-0000-000000000001',
      'referred_org_id', '14110000-0000-0000-0000-000000000002',
      'accrual_month', '2026-01-01',
      'cycle_number', 1,
      'base_snapshot', 'platform_subscription',
      'base_amount_cents', 50000,
      'pct_snapshot', 20,
      'amount_cents', 10000,
      'source_row_count', 1,
      'is_complete', true,
      'incomplete_code', null
    ))
  )$$,
  'one RPC inserts the operator and referral snapshots'
);
select is((select count(*) from public.operator_earnings_ledger where operator_org_id = '14110000-0000-0000-0000-000000000002'), 1::bigint, 'operator row exists once');
select is((select count(*) from public.referral_ledger where saas_referral_id = '14110000-0000-0000-0000-000000000201'), 1::bigint, 'referral row exists once');
select is((select amount_cents from public.referral_ledger where saas_referral_id = '14110000-0000-0000-0000-000000000201'), 10000::bigint, 'referral amount matches its snapshotted basis');
select is(
  (select referral_rows from public.revenue_post_billing_accrual(
    '14110000-0000-0000-0000-000000000002', '2026-01-01', 10000,
    10, 1000, 1, true, null, '[]'::jsonb
  )),
  0,
  'operator replay does not alter referral rows'
);

select throws_ok(
  $$insert into public.referral_ledger (
      saas_referral_id, referrer_org_id, referred_org_id, accrual_month,
      cycle_number, base_snapshot, pct_snapshot, is_complete
    ) values (
      '14110000-0000-0000-0000-000000000201',
      '14110000-0000-0000-0000-000000000001',
      '14110000-0000-0000-0000-000000000002',
      '2027-01-01', 13, 'platform_subscription', 20, true
    )$$,
  '23514',
  null,
  'cycle 13 is structurally impossible'
);
select throws_ok(
  $$update public.operator_earnings_ledger set base_amount_cents = 0
    where operator_org_id = '14110000-0000-0000-0000-000000000002'$$,
  -- Phase 21 (181) rewrote the guard to allow settlement-column updates and
  -- raises 55000 REVENUE_LEDGER_APPEND_ONLY instead of P0001.
  '55000',
  null,
  'operator snapshots are append only'
);
select throws_ok(
  $$delete from public.referral_ledger
    where saas_referral_id = '14110000-0000-0000-0000-000000000201'$$,
  '55000',
  null,
  'referral snapshots are append only'
);

select ok(
  (select bool_and(prosecdef) from pg_proc where oid in (
    'public.revenue_read_accrual_inputs(uuid,date)'::regprocedure,
    'public.revenue_list_accrual_orgs()'::regprocedure,
    'public.revenue_post_billing_accrual(uuid,date,bigint,numeric,bigint,integer,boolean,text,jsonb)'::regprocedure,
    'public.revenue_read_kpis(date)'::regprocedure
  )),
  'all revenue RPCs are security definers'
);
select ok(
  (select bool_and(coalesce(proconfig, '{}'::text[]) @> array['search_path=""']) from pg_proc where oid in (
    'public.revenue_read_accrual_inputs(uuid,date)'::regprocedure,
    'public.revenue_list_accrual_orgs()'::regprocedure,
    'public.revenue_post_billing_accrual(uuid,date,bigint,numeric,bigint,integer,boolean,text,jsonb)'::regprocedure,
    'public.revenue_read_kpis(date)'::regprocedure
  )),
  'all revenue RPCs use an empty search path'
);
select ok(
  not has_function_privilege('authenticated', 'public.revenue_read_accrual_inputs(uuid,date)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.revenue_list_accrual_orgs()', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.revenue_post_billing_accrual(uuid,date,bigint,numeric,bigint,integer,boolean,text,jsonb)', 'EXECUTE'),
  'worker RPCs are not executable by authenticated callers'
);
select ok(
  has_function_privilege('authenticated', 'public.revenue_read_kpis(date)', 'EXECUTE'),
  'authenticated callers may invoke the gated KPI RPC'
);
select ok(
  not has_table_privilege('anon', 'public.saas_referrals', 'SELECT')
    and not has_table_privilege('anon', 'public.operator_earnings_ledger', 'SELECT')
    and not has_table_privilege('anon', 'public.referral_ledger', 'SELECT'),
  'anonymous callers hold no revenue-table access'
);
select ok(
  has_table_privilege('authenticated', 'public.saas_referrals', 'SELECT')
    and not has_table_privilege('authenticated', 'public.saas_referrals', 'INSERT')
    and has_table_privilege('authenticated', 'public.operator_earnings_ledger', 'SELECT')
    and not has_table_privilege('authenticated', 'public.operator_earnings_ledger', 'UPDATE'),
  'authenticated callers have select-only grants'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'authenticated', 'sub', '14110000-0000-0000-0000-000000000101')::text,
  true
);
select is((select count(*) from public.operator_earnings_ledger), 0::bigint, 'operator cannot read earnings rows');
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'authenticated', 'sub', '14110000-0000-0000-0000-000000000102')::text,
  true
);
select is((select count(*) from public.operator_earnings_ledger), 2::bigint, 'platform admin can read earnings rows');
select is((select monitoring_share_total_cents from public.revenue_read_kpis('2026-01-01')), 1000::bigint, 'KPI RPC sums persisted monitoring cents');
reset role;

select is(
  (select count(*) from public.revenue_list_accrual_orgs() where operator_org_id = '14110000-0000-0000-0000-000000000002'),
  1::bigint,
  'organization-list RPC includes an operator organization'
);
select is(
  (select count(*) from public.revenue_read_accrual_inputs('14110000-0000-0000-0000-000000000002', '2026-01-01')),
  1::bigint,
  'input RPC returns one organization snapshot'
);
select ok(
  pg_catalog.strpos(
    pg_get_functiondef('public.revenue_read_accrual_inputs(uuid,date)'::regprocedure)
      || pg_get_functiondef('public.revenue_post_billing_accrual(uuid,date,bigint,numeric,bigint,integer,boolean,text,jsonb)'::regprocedure)
    , 'fee_'
  ) = 0,
  'revenue worker RPCs do not reference fee tables'
);
select is((select count(*) from public.fee_ledger), 0::bigint, 'revenue posting leaves fee ledger fixtures unchanged');

select * from finish();

rollback;
