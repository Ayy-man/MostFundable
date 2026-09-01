begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(10);

insert into public.orgs (id, name, slug)
values ('00000000-0000-4000-8000-000000004111', 'Profile self service org', 'profile-self-service-org');

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000004112', 'profile-one@test.example'),
  ('00000000-0000-4000-8000-000000004113', 'profile-two@test.example');

update public.profiles
set org_id = '00000000-0000-4000-8000-000000004111',
    role = 'consumer',
    org_role = null,
    full_name = case id
      when '00000000-0000-4000-8000-000000004112' then 'profile-one'
      else 'profile-two'
    end
where id in (
  '00000000-0000-4000-8000-000000004112',
  '00000000-0000-4000-8000-000000004113'
);

select has_function('public', 'consumer_update_profile', array['text', 'text'], 'consumer profile mutation exists');
select has_trigger('auth', 'users', 'auth_users_sync_profile_email', 'confirmed auth email changes synchronize the profile');

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-4000-8000-000000004112"}';
select lives_ok(
  $$select public.consumer_update_profile('  Jordan Newcomer  ', '+1 (555) 123-4567')$$,
  'a consumer can update only the non-provider profile fields'
);
select is(
  (select full_name from public.profiles where id = '00000000-0000-4000-8000-000000004112'),
  'Jordan Newcomer'::text,
  'the legal name is normalized and stored'
);
select is(
  (select phone from public.profiles where id = '00000000-0000-4000-8000-000000004112'),
  '+1 (555) 123-4567'::text,
  'the phone is normalized and stored'
);
reset role;
select is(
  (select full_name from public.profiles where id = '00000000-0000-4000-8000-000000004113'),
  'profile-two'::text,
  'another profile is unchanged'
);
select is(
  (select count(*) from public.audit_log where actor_profile_id = '00000000-0000-4000-8000-000000004112' and action = 'consumer.profile.updated'),
  1::bigint,
  'the fixed-action audit row records the profile mutation'
);
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-4000-8000-000000004112"}';
select lives_ok(
  $$select public.consumer_update_profile('Jordan Newcomer', '')$$,
  'a consumer may leave the optional phone empty'
);
select is(
  (select phone from public.profiles where id = '00000000-0000-4000-8000-000000004112'),
  null,
  'an empty optional phone is normalized to database null'
);
reset role;

update auth.users
set email = 'profile-confirmed@test.example'
where id = '00000000-0000-4000-8000-000000004112';
select is(
  (select email from public.profiles where id = '00000000-0000-4000-8000-000000004112'),
  'profile-confirmed@test.example'::text,
  'only the confirmed auth email is synchronized to the profile'
);

select * from finish();
rollback;
