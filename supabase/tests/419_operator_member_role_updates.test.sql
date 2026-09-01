begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(10);

insert into public.orgs (id, name, slug) values
  ('41900000-0000-4000-8000-000000000001', 'Member Role Org', 'member-role-org'),
  ('41900000-0000-4000-8000-000000000002', 'Other Member Role Org', 'other-member-role-org');
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  (
    '41900000-0000-4000-8000-000000000011', 'owner@member-role.test',
    '{"app_role":"operator_member","org_id":"41900000-0000-4000-8000-000000000001","org_role":"owner"}',
    '{"full_name":"Role Owner"}'
  ),
  (
    '41900000-0000-4000-8000-000000000012', 'second-owner@member-role.test',
    '{"app_role":"operator_member","org_id":"41900000-0000-4000-8000-000000000001","org_role":"owner"}',
    '{"full_name":"Second Owner"}'
  ),
  (
    '41900000-0000-4000-8000-000000000013', 'member@member-role.test',
    '{"app_role":"operator_member","org_id":"41900000-0000-4000-8000-000000000001","org_role":"member"}',
    '{"full_name":"Role Member"}'
  ),
  (
    '41900000-0000-4000-8000-000000000014', 'other@member-role.test',
    '{"app_role":"operator_member","org_id":"41900000-0000-4000-8000-000000000002","org_role":"owner"}',
    '{"full_name":"Other Owner"}'
  );

select ok(
  not has_function_privilege('authenticated', 'public.tenancy_update_member_role(uuid,public.org_role,uuid)', 'execute'),
  'the browser role cannot call the actor-parameterized mutation'
);
select ok(
  has_function_privilege('service_role', 'public.tenancy_update_member_role(uuid,public.org_role,uuid)', 'execute'),
  'only the trusted server rail can call the role mutation'
);
select ok(
  pg_catalog.pg_get_functiondef(
    'public.tenancy_update_member_role(uuid,public.org_role,uuid)'::pg_catalog.regprocedure
  ) ~ 'from public[.]orgs as organization[[:space:]]+where organization[.]id = v_target[.]org_id[[:space:]]+for update;'
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'public.tenancy_update_member_role(uuid,public.org_role,uuid)'::pg_catalog.regprocedure
    ),
    'from public.orgs as organization'
  ) < pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'public.tenancy_update_member_role(uuid,public.org_role,uuid)'::pg_catalog.regprocedure
    ),
    'from public.profiles as owner_profile'
  ),
  'the organization-wide row lock is acquired before the active-owner check'
);

create temporary table member_role_change on commit drop as
select public.tenancy_update_member_role(
  '41900000-0000-4000-8000-000000000013', 'funding_specialist',
  '41900000-0000-4000-8000-000000000011'
) as value;
select is((select value ->> 'applied' from member_role_change), 'true', 'an owner changes a same-org active member');
select is(
  (select org_role::text from public.profiles where id = '41900000-0000-4000-8000-000000000013'),
  'funding_specialist',
  'the member role is durable'
);
select is(
  (select count(*) from public.audit_log where action = 'org.member_role_updated' and subject_id = '41900000-0000-4000-8000-000000000013'),
  1::bigint,
  'the role change appends one audit event'
);
select is(
  (select public.tenancy_update_member_role(
    '41900000-0000-4000-8000-000000000013', 'funding_specialist',
    '41900000-0000-4000-8000-000000000011'
  ) ->> 'applied'),
  'false',
  'an equal retry is an idempotent no-op'
);
select throws_ok(
  $$select public.tenancy_update_member_role(
    '41900000-0000-4000-8000-000000000014', 'admin',
    '41900000-0000-4000-8000-000000000011'
  )$$,
  '42501', 'TENANT_MEMBER_NOT_FOUND',
  'another organization member stays hidden'
);

delete from public.profiles where id = '41900000-0000-4000-8000-000000000012';
select throws_ok(
  $$select public.tenancy_update_member_role(
    '41900000-0000-4000-8000-000000000011', 'admin',
    '41900000-0000-4000-8000-000000000011'
  )$$,
  '22023', 'TENANT_LAST_OWNER_ROLE_FORBIDDEN',
  'the last active owner cannot demote themselves'
);

update public.profiles set disabled_at = pg_catalog.now()
where id = '41900000-0000-4000-8000-000000000013';
select throws_ok(
  $$select public.tenancy_update_member_role(
    '41900000-0000-4000-8000-000000000013', 'admin',
    '41900000-0000-4000-8000-000000000011'
  )$$,
  '42501', 'TENANT_MEMBER_NOT_FOUND',
  'an inactive member cannot be silently restored through a role edit'
);

select * from finish();
rollback;
