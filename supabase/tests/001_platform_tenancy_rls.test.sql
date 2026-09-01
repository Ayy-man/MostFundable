begin;

set local search_path = public, extensions;

select plan(55);

select has_table('public', 'orgs', 'orgs table exists');
select has_table('public', 'profiles', 'profiles table exists');
select has_table('public', 'affiliates', 'affiliates table exists');
select has_table('public', 'clients', 'clients table exists');
select has_table('public', 'affiliate_client_shares', 'affiliate shares table exists');
select has_type('public', 'org_role', 'org role enum exists');
select has_type('public', 'client_stage', 'client stage enum exists');
select has_type('public', 'app_role', 'application role enum exists');
select has_type('public', 'org_plan', 'org plan enum exists');
select has_type('public', 'org_membership', 'org membership enum exists');
select has_type('public', 'assignment_mode', 'assignment mode enum exists');
select has_type('public', 'affiliate_payment_status', 'affiliate payment status enum exists');

select is(
  (
    select count(*)::integer
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in ('orgs', 'profiles', 'affiliates', 'clients', 'affiliate_client_shares')
      and relation.relrowsecurity
  ),
  5,
  'all tenancy tables enable row security'
);

select is(
  (
    select count(*)::integer
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in ('orgs', 'profiles', 'affiliates', 'clients', 'affiliate_client_shares')
      and relation.relforcerowsecurity
  ),
  5,
  'all tenancy tables force row security'
);

select is(
  (
    select count(*)::integer
    from pg_constraint
    where conname in (
      'profiles_role_shape_check',
      'affiliates_profile_org_fk',
      'clients_consumer_org_fk',
      'clients_assignee_org_fk',
      'clients_affiliate_org_fk',
      'clients_funded_amount_nonnegative',
      'affiliate_shares_commission_nonnegative'
    )
  ),
  7,
  'tenant and value constraints are present'
);

select is(
  (
    select count(*)::integer
    from pg_indexes
    where schemaname = 'public'
      and indexname in (
        'profiles_org_id_idx',
        'profiles_role_idx',
        'profiles_org_role_idx',
        'affiliates_org_id_idx',
        'affiliates_profile_id_idx',
        'clients_org_id_idx',
        'clients_consumer_profile_id_idx',
        'clients_assigned_to_idx',
        'clients_affiliate_id_idx',
        'clients_stage_idx',
        'affiliate_client_shares_client_id_idx'
      )
  ),
  11,
  'named relationship and policy indexes are present'
);

select is(
  (
    select count(*)::integer
    from pg_proc as function
    join pg_namespace as namespace on namespace.oid = function.pronamespace
    where namespace.nspname = 'private'
      and function.proname in (
        'auth_profile_id',
        'auth_org_id',
        'auth_app_role',
        'auth_org_role',
        'can_access_client'
      )
      and function.prosecdef
      and function.provolatile = 's'
      and function.proconfig @> array['search_path=""']
  ),
  5,
  'authorization helpers are stable fixed-path security definers'
);

select is(has_table_privilege('anon', 'public.orgs', 'select'), false, 'anonymous cannot select orgs');
select is(has_table_privilege('anon', 'public.profiles', 'select'), false, 'anonymous cannot select profiles');
select is(has_table_privilege('anon', 'public.affiliates', 'select'), false, 'anonymous cannot select affiliates');
select is(has_table_privilege('anon', 'public.clients', 'select'), false, 'anonymous cannot select clients');
select is(
  has_table_privilege('anon', 'public.affiliate_client_shares', 'select'),
  false,
  'anonymous cannot select affiliate shares'
);

select has_view('public', 'specialist_default_client_view', 'specialist default view exists');
select has_view('public', 'affiliate_client_view', 'affiliate projection exists');

select is(
  (
    select coalesce(relation.reloptions @> array['security_invoker=true'], false)
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'specialist_default_client_view'
  ),
  true,
  'specialist view uses invoker security'
);

select is(
  (
    select coalesce(relation.reloptions @> array['security_barrier=true'], false)
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'affiliate_client_view'
  ),
  true,
  'affiliate projection uses a security barrier'
);

select results_eq(
  $$
    select column_name::text collate "C"
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'affiliate_client_view'
    order by ordinal_position
  $$,
  $$
    values
      ('started_at'::text collate "C"),
      ('stage'::text collate "C"),
      ('funded_amount_cents'::text collate "C"),
      ('expected_commission_cents'::text collate "C"),
      ('payment_status'::text collate "C")
  $$,
  'affiliate projection has exactly five ordered columns'
);

insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-000000000900', 'platform.admin@test.example'),
  ('00000000-0000-0000-0000-000000000110', 'owner.a@test.example'),
  ('00000000-0000-0000-0000-000000000120', 'prep.a@test.example'),
  ('00000000-0000-0000-0000-000000000130', 'funding.a@test.example'),
  ('00000000-0000-0000-0000-000000000140', 'manager.a@test.example'),
  ('00000000-0000-0000-0000-000000000150', 'worker.a@test.example'),
  ('00000000-0000-0000-0000-000000000160', 'affiliate.a@test.example'),
  ('00000000-0000-0000-0000-000000000170', 'consumer.a1@test.example'),
  ('00000000-0000-0000-0000-000000000180', 'consumer.a2@test.example'),
  ('00000000-0000-0000-0000-000000000210', 'owner.b@test.example'),
  ('00000000-0000-0000-0000-000000000220', 'worker.b@test.example'),
  ('00000000-0000-0000-0000-000000000230', 'consumer.b@test.example'),
  ('00000000-0000-0000-0000-000000000990', 'unknown@test.example');

insert into public.orgs (id, name, slug, team_sees_all_clients)
values
  ('10000000-0000-0000-0000-000000000001', 'Test Org A', 'test-org-a', true),
  ('20000000-0000-0000-0000-000000000002', 'Test Org B', 'test-org-b', true);

insert into public.profiles (id, role, org_id, org_role, manages, full_name, email)
values
  (
    '00000000-0000-0000-0000-000000000900',
    'platform_admin',
    null,
    null,
    '{}',
    'Platform Admin',
    'platform.admin@test.example'
  ),
  (
    '00000000-0000-0000-0000-000000000110',
    'operator_member',
    '10000000-0000-0000-0000-000000000001',
    'owner',
    '{}',
    'Owner A',
    'owner.a@test.example'
  ),
  (
    '00000000-0000-0000-0000-000000000120',
    'operator_member',
    '10000000-0000-0000-0000-000000000001',
    'prep_specialist',
    '{}',
    'Prep A',
    'prep.a@test.example'
  ),
  (
    '00000000-0000-0000-0000-000000000130',
    'operator_member',
    '10000000-0000-0000-0000-000000000001',
    'funding_specialist',
    '{}',
    'Funding A',
    'funding.a@test.example'
  ),
  (
    '00000000-0000-0000-0000-000000000140',
    'operator_member',
    '10000000-0000-0000-0000-000000000001',
    'manager',
    array[
      '00000000-0000-0000-0000-000000000150'::uuid,
      '00000000-0000-0000-0000-000000000220'::uuid
    ],
    'Manager A',
    'manager.a@test.example'
  ),
  (
    '00000000-0000-0000-0000-000000000150',
    'operator_member',
    '10000000-0000-0000-0000-000000000001',
    'commando',
    '{}',
    'Worker A',
    'worker.a@test.example'
  ),
  (
    '00000000-0000-0000-0000-000000000160',
    'affiliate',
    '10000000-0000-0000-0000-000000000001',
    null,
    '{}',
    'Affiliate A',
    'affiliate.a@test.example'
  ),
  (
    '00000000-0000-0000-0000-000000000170',
    'consumer',
    '10000000-0000-0000-0000-000000000001',
    null,
    '{}',
    'Consumer A1',
    'consumer.a1@test.example'
  ),
  (
    '00000000-0000-0000-0000-000000000180',
    'consumer',
    '10000000-0000-0000-0000-000000000001',
    null,
    '{}',
    'Consumer A2',
    'consumer.a2@test.example'
  ),
  (
    '00000000-0000-0000-0000-000000000210',
    'operator_member',
    '20000000-0000-0000-0000-000000000002',
    'owner',
    '{}',
    'Owner B',
    'owner.b@test.example'
  ),
  (
    '00000000-0000-0000-0000-000000000220',
    'operator_member',
    '20000000-0000-0000-0000-000000000002',
    'commando',
    '{}',
    'Worker B',
    'worker.b@test.example'
  ),
  (
    '00000000-0000-0000-0000-000000000230',
    'consumer',
    '20000000-0000-0000-0000-000000000002',
    null,
    '{}',
    'Consumer B',
    'consumer.b@test.example'
  )
on conflict (id) do update
set
  role = excluded.role,
  org_id = excluded.org_id,
  org_role = excluded.org_role,
  manages = excluded.manages,
  full_name = excluded.full_name,
  email = excluded.email;

insert into public.affiliates (id, org_id, profile_id, name, referral_slug)
values (
  'a0000000-0000-0000-0000-0000000000a1',
  '10000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000160',
  'Affiliate A',
  'affiliate-a-test'
);

-- 2026-08-17 R3A-05: this fixture intentionally carries historical lifecycle
-- values, so mark only its setup insert as governed.
select pg_catalog.set_config('app.governed_client_write', 'on', true);
insert into public.clients (
  id,
  org_id,
  consumer_profile_id,
  display_name,
  stage,
  assigned_to,
  affiliate_id,
  started_at,
  funded_amount_cents
)
values
  (
    'a0000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000170',
    'Client A Onboarding',
    'onboarding',
    '00000000-0000-0000-0000-000000000150',
    null,
    '2026-08-01',
    0
  ),
  (
    'a0000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000180',
    'Client A Optimization',
    'optimization',
    '00000000-0000-0000-0000-000000000150',
    null,
    '2026-08-02',
    0
  ),
  (
    'a0000000-0000-0000-0000-000000000003',
    '10000000-0000-0000-0000-000000000001',
    null,
    'Client A Ready',
    'ready',
    '00000000-0000-0000-0000-000000000150',
    'a0000000-0000-0000-0000-0000000000a1',
    '2026-08-03',
    1000
  ),
  (
    'a0000000-0000-0000-0000-000000000004',
    '10000000-0000-0000-0000-000000000001',
    null,
    'Client A Applying',
    'applying',
    '00000000-0000-0000-0000-000000000150',
    null,
    '2026-08-04',
    0
  ),
  (
    'a0000000-0000-0000-0000-000000000005',
    '10000000-0000-0000-0000-000000000001',
    null,
    'Client A Funded',
    'funded',
    '00000000-0000-0000-0000-000000000150',
    null,
    '2026-08-05',
    5000
  ),
  (
    'a0000000-0000-0000-0000-000000000006',
    '10000000-0000-0000-0000-000000000001',
    null,
    'Client A Graduate',
    'graduate',
    '00000000-0000-0000-0000-000000000150',
    null,
    '2026-08-06',
    7000
  ),
  (
    'b0000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000230',
    'Client B Onboarding',
    'onboarding',
    '00000000-0000-0000-0000-000000000220',
    null,
    '2026-08-07',
    0
  );
select pg_catalog.set_config('app.governed_client_write', '', true);

insert into public.affiliate_client_shares (
  affiliate_id,
  client_id,
  expected_commission_cents,
  payment_status
)
values (
  'a0000000-0000-0000-0000-0000000000a1',
  'a0000000-0000-0000-0000-000000000003',
  500,
  'pending'
);

select throws_ok(
  $$
    insert into public.clients (
      id,
      org_id,
      consumer_profile_id,
      display_name
    ) values (
      'e0000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-000000000170',
      'Invalid Cross Org Client'
    )
  $$,
  'P0001',
  'consumer profile must have the consumer application role',
  'a client cannot link a consumer from another organization'
);

select throws_ok(
  $$
    insert into public.clients (
      id,
      org_id,
      consumer_profile_id,
      display_name
    ) values (
      'e0000000-0000-0000-0000-000000000002',
      '10000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000110',
      'Invalid Consumer Role Client'
    )
  $$,
  'P0001',
  'consumer profile must have the consumer application role',
  'a client consumer link requires a consumer profile'
);

select throws_ok(
  $$
    insert into public.clients (
      id,
      org_id,
      display_name,
      assigned_to
    ) values (
      'e0000000-0000-0000-0000-000000000003',
      '10000000-0000-0000-0000-000000000001',
      'Invalid Assignee Role Client',
      '00000000-0000-0000-0000-000000000170'
    )
  $$,
  'P0001',
  'client assignee must have the operator member application role',
  'a client assignee link requires an operator profile'
);

select throws_ok(
  $$
    insert into public.affiliates (
      id,
      org_id,
      profile_id,
      name,
      referral_slug
    ) values (
      'e0000000-0000-0000-0000-000000000004',
      '10000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000110',
      'Invalid Affiliate Role',
      'invalid-affiliate-role'
    )
  $$,
  'P0001',
  'affiliate profile must have the affiliate application role',
  'an affiliate link requires an affiliate profile'
);

select throws_ok(
  $$
    insert into public.affiliate_client_shares (affiliate_id, client_id)
    values (
      'a0000000-0000-0000-0000-0000000000a1',
      'b0000000-0000-0000-0000-000000000001'
    )
  $$,
  'P0001',
  'affiliate and client must belong to the same organization',
  'an affiliate share cannot cross organizations'
);

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000110"}';

select results_eq(
  $$ select id from public.orgs order by id $$,
  $$ values ('10000000-0000-0000-0000-000000000001'::uuid) $$,
  'Org A owner sees exactly Org A'
);
select is((select count(*)::integer from public.clients), 6, 'Org A owner sees six Org A clients');
select is(
  (
    select count(*)::integer
    from public.clients
    where org_id = '20000000-0000-0000-0000-000000000002'
  ),
  0,
  'Org A owner sees no Org B clients'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000170"}';

select results_eq(
  $$ select id from public.clients order by id $$,
  $$ values ('a0000000-0000-0000-0000-000000000001'::uuid) $$,
  'Org A consumer sees exactly the linked client'
);
select is(
  (
    select count(*)::integer
    from public.clients
    where org_id = '20000000-0000-0000-0000-000000000002'
  ),
  0,
  'Org A consumer sees no Org B client'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000160"}';

select results_eq(
  $$
    select
      started_at,
      stage,
      funded_amount_cents,
      expected_commission_cents,
      payment_status
    from public.affiliate_client_view
  $$,
  $$
    values (
      '2026-08-03'::date,
      'ready'::public.client_stage,
      1000::bigint,
      500::bigint,
      'pending'::public.affiliate_payment_status
    )
  $$,
  'affiliate receives only its explicitly shared projection row'
);
select is((select count(*)::integer from public.clients), 0, 'affiliate sees no direct client rows');
select is(
  (select count(*)::integer from public.affiliate_client_shares),
  0,
  'affiliate sees no direct share rows'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000120"}';

select results_eq(
  $$ select stage from public.specialist_default_client_view order by stage $$,
  $$ values ('onboarding'::public.client_stage), ('optimization'::public.client_stage) $$,
  'prep specialist default view contains only early stages'
);
select is(
  (
    select count(*)::integer
    from public.clients
    where id = 'a0000000-0000-0000-0000-000000000003'
  ),
  1,
  'prep specialist can directly open another authorized client'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000130"}';

select results_eq(
  $$ select stage from public.specialist_default_client_view order by stage $$,
  $$
    values
      ('ready'::public.client_stage),
      ('applying'::public.client_stage),
      ('funded'::public.client_stage)
  $$,
  'funding specialist default view contains its three stages'
);
select is(
  (
    select count(*)::integer
    from public.clients
    where id = 'a0000000-0000-0000-0000-000000000002'
  ),
  1,
  'funding specialist can directly open another authorized client'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000140"}';

select is(
  (
    select count(*)::integer
    from public.clients
    where id = 'b0000000-0000-0000-0000-000000000001'
  ),
  0,
  'foreign manager-array entry does not reveal a foreign client'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000210"}';

select is(
  (
    select count(*)::integer
    from public.orgs
    where id = '10000000-0000-0000-0000-000000000001'
  ),
  0,
  'Org B owner sees no Org A organization row'
);
select results_eq(
  $$ select id from public.clients order by id $$,
  $$ values ('b0000000-0000-0000-0000-000000000001'::uuid) $$,
  'Org B owner sees exactly the Org B client'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000990"}';

select is((select count(*)::integer from public.clients), 0, 'unknown profile sees no clients');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000900"}';

select is(
  (
    select count(*)::integer
    from public.orgs
    where id in (
      '10000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000002'
    )
  ),
  2,
  'platform administrator sees both fixture organizations'
);
select is(
  (
    select count(*)::integer
    from public.clients
    where org_id in (
      '10000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000002'
    )
  ),
  7,
  'platform administrator sees every fixture client'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000230"}';

select results_eq(
  $$ select id from public.clients order by id $$,
  $$ values ('b0000000-0000-0000-0000-000000000001'::uuid) $$,
  'Org B consumer sees exactly the linked client'
);
select is(
  (
    select count(*)::integer
    from public.clients
    where org_id = '10000000-0000-0000-0000-000000000001'
  ),
  0,
  'Org B consumer sees no Org A client'
);

reset role;
update public.profiles
set org_id = '20000000-0000-0000-0000-000000000002'
where id = '00000000-0000-0000-0000-000000000110';

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000110"}';

select is(
  (
    select count(*)::integer
    from public.orgs
    where id = '10000000-0000-0000-0000-000000000001'
  ),
  0,
  'profile-row organization changes revoke prior tenant access immediately'
);
select results_eq(
  $$ select id from public.orgs order by id $$,
  $$ values ('20000000-0000-0000-0000-000000000002'::uuid) $$,
  'profile-row organization changes grant current tenant access immediately'
);

reset role;
update public.profiles
set org_id = '10000000-0000-0000-0000-000000000001'
where id = '00000000-0000-0000-0000-000000000110';

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000110"}';

select results_eq(
  $$ select id from public.orgs order by id $$,
  $$ values ('10000000-0000-0000-0000-000000000001'::uuid) $$,
  'restored profile authority follows the current row'
);

reset role;

select * from finish();

rollback;
