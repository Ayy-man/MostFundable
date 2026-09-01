create extension if not exists pgtap with schema extensions;

begin;

set local search_path = public, extensions;

select plan(8);

insert into public.orgs (id, name, slug, assignment_mode)
values
  (
    '22000000-0000-0000-0000-000000000001',
    'Org Settings Contract A',
    'org-settings-contract-a',
    'manual'
  ),
  (
    '22000000-0000-0000-0000-000000000002',
    'Org Settings Contract B',
    'org-settings-contract-b',
    'manual'
  );

insert into auth.users (id, email, raw_app_meta_data)
values
  (
    '22000000-0000-0000-0000-000000000101',
    'owner.a.org-settings@test.example',
    jsonb_build_object(
      'app_role', 'operator_member',
      'full_name', 'Org A Owner',
      'org_id', '22000000-0000-0000-0000-000000000001',
      'org_role', 'owner'
    )
  ),
  (
    '22000000-0000-0000-0000-000000000102',
    'prep.a.org-settings@test.example',
    jsonb_build_object(
      'app_role', 'operator_member',
      'full_name', 'Org A Prep Specialist',
      'org_id', '22000000-0000-0000-0000-000000000001',
      'org_role', 'prep_specialist'
    )
  ),
  (
    '22000000-0000-0000-0000-000000000201',
    'owner.b.org-settings@test.example',
    jsonb_build_object(
      'app_role', 'operator_member',
      'full_name', 'Org B Owner',
      'org_id', '22000000-0000-0000-0000-000000000002',
      'org_role', 'owner'
    )
  );

insert into public.profiles (id, role, org_id, org_role, full_name, email)
values
  (
    '22000000-0000-0000-0000-000000000101',
    'operator_member',
    '22000000-0000-0000-0000-000000000001',
    'owner',
    'Org A Owner',
    'owner.a.org-settings@test.example'
  ),
  (
    '22000000-0000-0000-0000-000000000102',
    'operator_member',
    '22000000-0000-0000-0000-000000000001',
    'prep_specialist',
    'Org A Prep Specialist',
    'prep.a.org-settings@test.example'
  ),
  (
    '22000000-0000-0000-0000-000000000201',
    'operator_member',
    '22000000-0000-0000-0000-000000000002',
    'owner',
    'Org B Owner',
    'owner.b.org-settings@test.example'
  )
on conflict (id) do update
set
  role = excluded.role,
  org_id = excluded.org_id,
  org_role = excluded.org_role,
  full_name = excluded.full_name,
  email = excluded.email;

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'orgs'
      and cmd = 'SELECT'
      and roles @> array['authenticated']::name[]
  ),
  'an authenticated org SELECT policy exists'
);

set local request.jwt.claims = '{"sub":"22000000-0000-0000-0000-000000000101","role":"authenticated"}';
set local role authenticated;

update public.orgs
set assignment_mode = 'round_robin'
where id = '22000000-0000-0000-0000-000000000001';

reset role;

select is(
  (
    select assignment_mode::text
    from public.orgs
    where id = '22000000-0000-0000-0000-000000000001'
  ),
  'round_robin',
  'an owner can update settings for their own organization'
);

set local request.jwt.claims = '{"sub":"22000000-0000-0000-0000-000000000102","role":"authenticated"}';
set local role authenticated;

update public.orgs
set assignment_mode = 'manual'
where id = '22000000-0000-0000-0000-000000000001';

reset role;

select is(
  (
    select assignment_mode::text
    from public.orgs
    where id = '22000000-0000-0000-0000-000000000001'
  ),
  'round_robin',
  'a prep specialist cannot change settings for their organization'
);

set local request.jwt.claims = '{"sub":"22000000-0000-0000-0000-000000000201","role":"authenticated"}';
set local role authenticated;

update public.orgs
set assignment_mode = 'manual'
where id = '22000000-0000-0000-0000-000000000001';

reset role;

select is(
  (
    select assignment_mode::text
    from public.orgs
    where id = '22000000-0000-0000-0000-000000000001'
  ),
  'round_robin',
  'an owner from another organization cannot change the value'
);

set local request.jwt.claims = '{"sub":"22000000-0000-0000-0000-000000000101","role":"authenticated"}';
set local role authenticated;

select results_eq(
  $$ select id from public.orgs order by id $$,
  $$ values ('22000000-0000-0000-0000-000000000001'::uuid) $$,
  'an owner can read their own organization and cannot read another organization'
);

reset role;

-- ---------------------------------------------------------------------------
-- 2026-08-17 R2A-09 carry: the settings trigger owns attribution in the same
-- transaction, and the authenticated role has no direct audit insert lane.
-- ---------------------------------------------------------------------------

select is(
  has_table_privilege('authenticated', 'public.audit_log', 'insert'),
  false,
  'authenticated has no direct audit insert privilege'
);

select is(
  (
    select count(*)::int
    from public.audit_log
    where org_id = '22000000-0000-0000-0000-000000000001'
      and actor_profile_id = '22000000-0000-0000-0000-000000000101'
      and action = 'org.settings.updated'
  ),
  1,
  'the successful settings update appends exactly one fixed attribution row'
);

set local request.jwt.claims = '{"sub":"22000000-0000-0000-0000-000000000101","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$
    insert into public.audit_log (
      action,
      actor_profile_id,
      client_id,
      meta,
      org_id,
      subject_id,
      subject_type
    )
    values (
      'org.settings.updated',
      '22000000-0000-0000-0000-000000000101',
      null,
      jsonb_build_object('field_names', jsonb_build_array('assignment_mode')),
      '22000000-0000-0000-0000-000000000002',
      '22000000-0000-0000-0000-000000000002',
      'org'
    )
  $$,
  '42501',
  null,
  'an owner cannot attribute a row to another organization'
);

reset role;

select * from finish();

rollback;
