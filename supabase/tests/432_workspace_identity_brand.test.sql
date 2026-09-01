begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(19);

select ok(
  (select convalidated from pg_catalog.pg_constraint where conname = 'orgs_name_bounded_trimmed'),
  'workspace identity has a validated database invariant'
);
select ok(
  (select convalidated from pg_catalog.pg_constraint where conname = 'orgs_brand_portal_name_valid'),
  'the optional portal name has a validated database invariant'
);
select has_trigger(
  'public', 'orgs', 'orgs_audit_settings_change',
  'workspace identity retains the fixed-action settings audit'
);
select has_function(
  'public', 'tenancy_update_brand', array['uuid', 'jsonb', 'uuid'],
  'the existing brand RPC signature is preserved'
);
select ok(
  has_function_privilege('service_role', 'public.tenancy_update_brand(uuid,jsonb,uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.tenancy_update_brand(uuid,jsonb,uuid)', 'execute'),
  'the brand RPC remains a trusted-server mutation'
);

insert into public.orgs (id, name, slug, brand) values
  ('43200000-0000-4000-8000-000000000001', 'Workspace Identity A', 'workspace-identity-a', '{"existingKey":"kept"}'),
  ('43200000-0000-4000-8000-000000000002', 'Workspace Identity B', 'workspace-identity-b', '{}');
insert into auth.users (id, email, raw_app_meta_data) values
  (
    '43200000-0000-4000-8000-000000000011', 'owner-a@workspace-identity.test',
    '{"app_role":"operator_member","org_id":"43200000-0000-4000-8000-000000000001","org_role":"owner","full_name":"Owner A"}'
  ),
  (
    '43200000-0000-4000-8000-000000000012', 'owner-b@workspace-identity.test',
    '{"app_role":"operator_member","org_id":"43200000-0000-4000-8000-000000000002","org_role":"owner","full_name":"Owner B"}'
  );
insert into public.profiles (id, role, org_id, org_role, full_name, email) values
  ('43200000-0000-4000-8000-000000000011', 'operator_member', '43200000-0000-4000-8000-000000000001', 'owner', 'Owner A', 'owner-a@workspace-identity.test'),
  ('43200000-0000-4000-8000-000000000012', 'operator_member', '43200000-0000-4000-8000-000000000002', 'owner', 'Owner B', 'owner-b@workspace-identity.test')
on conflict (id) do update
set role = excluded.role, org_id = excluded.org_id, org_role = excluded.org_role,
    full_name = excluded.full_name, email = excluded.email;

set local request.jwt.claims = '{"role":"authenticated","sub":"43200000-0000-4000-8000-000000000011"}';
set local role authenticated;
update public.orgs set name = 'Northbridge Funding Group'
where id = '43200000-0000-4000-8000-000000000001';
reset role;

select is(
  (select name from public.orgs where id = '43200000-0000-4000-8000-000000000001'),
  'Northbridge Funding Group'::text,
  'the workspace name is stored exactly'
);
select is(
  (select count(*) from public.audit_log where org_id = '43200000-0000-4000-8000-000000000001' and actor_profile_id = '43200000-0000-4000-8000-000000000011' and action = 'org.settings.updated'),
  1::bigint,
  'the workspace name update appends one attributed audit event'
);
select is(
  (select meta -> 'field_names' from public.audit_log where org_id = '43200000-0000-4000-8000-000000000001' and action = 'org.settings.updated'),
  '["name"]'::jsonb,
  'the workspace audit identifies the changed name field'
);
select throws_ok(
  $$update public.orgs set name = '  padded name  ' where id = '43200000-0000-4000-8000-000000000001'$$,
  '23514', null,
  'an untrimmed workspace name cannot bypass the route validator'
);
select throws_ok(
  $$update public.orgs set name = repeat('x', 121) where id = '43200000-0000-4000-8000-000000000001'$$,
  '23514', null,
  'an overlong workspace name is rejected by the database'
);

create temporary table workspace_brand_result on commit drop as
select public.tenancy_update_brand(
  '43200000-0000-4000-8000-000000000001',
  '{"portalName":"  Northbridge Client Portal  ","primaryColor":"#123456"}',
  '43200000-0000-4000-8000-000000000011'
) as value;
select is(
  (select value ->> 'portalName' from workspace_brand_result),
  'Northbridge Client Portal'::text,
  'the brand RPC normalizes and returns the portal name'
);
select ok(
  (select brand @> '{"existingKey":"kept","portalName":"Northbridge Client Portal","primaryColor":"#123456"}'::jsonb from public.orgs where id = '43200000-0000-4000-8000-000000000001'),
  'the portal name merges without deleting existing tenant brand keys'
);
select is(
  (select count(*) from public.audit_log where org_id = '43200000-0000-4000-8000-000000000001' and actor_profile_id = '43200000-0000-4000-8000-000000000011' and action = 'org.brand_updated'),
  1::bigint,
  'the portal name change appends one attributed brand audit event'
);
select is(
  (select meta -> 'field_names' from public.audit_log where org_id = '43200000-0000-4000-8000-000000000001' and action = 'org.brand_updated'),
  '["portalName"]'::jsonb,
  'the brand audit identifies the portal name field'
);
select lives_ok(
  $$select public.tenancy_update_brand(
    '43200000-0000-4000-8000-000000000001',
    '{"portalName":"Northbridge Client Portal"}',
    '43200000-0000-4000-8000-000000000011'
  )$$,
  'an equal portal-name retry remains an idempotent brand merge'
);
select is(
  (select count(*) from public.audit_log where org_id = '43200000-0000-4000-8000-000000000001' and action = 'org.brand_updated'),
  1::bigint,
  'an equal retry creates no duplicate brand audit event'
);
select throws_ok(
  $$select public.tenancy_update_brand(
    '43200000-0000-4000-8000-000000000001', '{"portalName":"   "}',
    '43200000-0000-4000-8000-000000000011'
  )$$,
  '22023', 'TENANT_BRAND_INVALID',
  'an empty portal name is rejected'
);
select throws_ok(
  $$update public.orgs set brand = jsonb_build_object('portalName', repeat('x', 121)) where id = '43200000-0000-4000-8000-000000000001'$$,
  '23514', null,
  'a direct overlong portal name cannot bypass the RPC validator'
);
select throws_ok(
  $$select public.tenancy_update_brand(
    '43200000-0000-4000-8000-000000000002', '{"portalName":"Other Portal"}',
    '43200000-0000-4000-8000-000000000011'
  )$$,
  '42501', 'TENANT_ORG_ADMIN_REQUIRED',
  'an owner cannot change another workspace portal name'
);

select * from finish();
rollback;
