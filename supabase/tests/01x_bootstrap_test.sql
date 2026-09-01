create extension if not exists pgtap with schema extensions;

begin;

set local search_path = public, extensions;

select plan(7);

insert into public.orgs (id, name, slug)
values (
  '21000000-0000-0000-0000-000000000001',
  'Bootstrap Contract Org',
  'bootstrap-contract-org'
);

create function pg_temp.create_user_and_assert_profile(
  p_id uuid,
  p_email text,
  p_user_metadata jsonb,
  p_app_metadata jsonb,
  p_role public.app_role,
  p_org_id uuid,
  p_org_role public.org_role
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
  values (p_id, p_email, p_user_metadata, p_app_metadata);

  if not exists (
    select 1
    from public.profiles as profile
    where profile.id = p_id
      and profile.role = p_role
      and profile.org_id is not distinct from p_org_id
      and profile.org_role is not distinct from p_org_role
  ) then
    raise exception 'the expected bootstrap profile outcome was not observed';
  end if;
end;
$$;

select lives_ok(
  $$
    select pg_temp.create_user_and_assert_profile(
      '21000000-0000-0000-0000-000000000101',
      'spoofed-admin.bootstrap@test.example',
      jsonb_build_object(
        'app_role', 'platform_admin',
        'full_name', 'Spoofed Admin',
        'org_id', '21000000-0000-0000-0000-000000000001',
        'org_role', 'owner'
      ),
      '{}'::jsonb,
      'consumer',
      null,
      null
    )
  $$,
  'caller metadata cannot create a platform administrator or organization binding'
);

select lives_ok(
  $$
    select pg_temp.create_user_and_assert_profile(
      '21000000-0000-0000-0000-000000000105',
      'spoofed-operator.bootstrap@test.example',
      jsonb_build_object(
        'app_role', 'operator_member',
        'org_id', '21000000-0000-0000-0000-000000000001',
        'org_role', 'owner'
      ),
      '{}'::jsonb,
      'consumer',
      null,
      null
    )
  $$,
  'caller metadata cannot create an operator profile'
);

select lives_ok(
  $$
    select pg_temp.create_user_and_assert_profile(
      '21000000-0000-0000-0000-000000000106',
      'spoofed-binding.bootstrap@test.example',
      jsonb_build_object(
        'app_role', 'consumer',
        'org_id', '21000000-0000-0000-0000-000000000001',
        'org_role', 'owner'
      ),
      '{}'::jsonb,
      'consumer',
      null,
      null
    )
  $$,
  'caller metadata cannot bind a consumer to an organization or member role'
);

select lives_ok(
  $$
    select pg_temp.create_user_and_assert_profile(
      '21000000-0000-0000-0000-000000000107',
      'server-controlled.bootstrap@test.example',
      jsonb_build_object('full_name', 'Server Controlled User'),
      jsonb_build_object(
        'app_role', 'operator_member',
        'org_id', '21000000-0000-0000-0000-000000000001',
        'org_role', 'owner'
      ),
      'operator_member',
      '21000000-0000-0000-0000-000000000001',
      'owner'
    )
  $$,
  'server-controlled app metadata can create an organization-bound operator profile'
);

select lives_ok(
  $$
    select pg_temp.create_user_and_assert_profile(
      '21000000-0000-0000-0000-000000000102',
      'empty.bootstrap@test.example',
      '{}'::jsonb,
      '{}'::jsonb,
      'consumer',
      null,
      null
    )
  $$,
  'empty metadata cannot block signup and creates the consumer fallback profile'
);

select lives_ok(
  $$
    select pg_temp.create_user_and_assert_profile(
      '21000000-0000-0000-0000-000000000103',
      'malformed.bootstrap@test.example',
      jsonb_build_object(
        'app_role', 'not_an_application_role',
        'full_name', 'Malformed Bootstrap User',
        'org_id', 'not-a-uuid'
      ),
      '{}'::jsonb,
      'consumer',
      null,
      null
    )
  $$,
  'malformed role and organization metadata cannot block signup or profile creation'
);

create temporary table bootstrap_replay (
  id uuid not null,
  email text,
  raw_user_meta_data jsonb,
  raw_app_meta_data jsonb
) on commit drop;

create trigger bootstrap_replay_profile
after insert on bootstrap_replay
for each row execute function public.handle_new_user();

select lives_ok(
  $$
    insert into bootstrap_replay (id, email, raw_user_meta_data, raw_app_meta_data)
    values (
      '21000000-0000-0000-0000-000000000101',
      'complete.bootstrap@test.example',
      jsonb_build_object(
        'app_role', 'operator_member',
        'full_name', 'Complete Bootstrap User',
        'org_id', '21000000-0000-0000-0000-000000000001',
        'org_role', 'owner'
      ),
      '{}'::jsonb
    )
  $$,
  'replaying bootstrap for an existing user profile is idempotent'
);

select * from finish();

rollback;
