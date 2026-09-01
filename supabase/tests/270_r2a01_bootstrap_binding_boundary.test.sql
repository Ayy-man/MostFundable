begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

insert into public.orgs (id, name, slug)
values ('27000000-0000-4000-8000-000000000001', 'R2A Bootstrap Org', 'r2a-bootstrap-org');

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
values
  ('27000000-0000-4000-8000-000000000011', 'consumer-r2a01@test.example', '{"org_id":"27000000-0000-4000-8000-000000000001"}', '{}'),
  ('27000000-0000-4000-8000-000000000012', 'affiliate-r2a01@test.example', '{"app_role":"affiliate","org_id":"27000000-0000-4000-8000-000000000001"}', '{}'),
  ('27000000-0000-4000-8000-000000000013', 'invite-r2a01@test.example', '{}', '{}');

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"27000000-0000-4000-8000-000000000011"}';
select throws_ok(
  $$update public.profiles
    set org_id = '27000000-0000-4000-8000-000000000001'
    where id = '27000000-0000-4000-8000-000000000011'$$,
  '42501', null,
  'consumer caller metadata cannot acquire an organization through self-bootstrap'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"27000000-0000-4000-8000-000000000012"}';
select throws_ok(
  $$update public.profiles
    set role = 'affiliate', org_id = '27000000-0000-4000-8000-000000000001'
    where id = '27000000-0000-4000-8000-000000000012'$$,
  '42501', null,
  'affiliate caller metadata cannot acquire an organization through self-bootstrap'
);

reset role;
insert into public.invites (
  id, org_id, email, full_name, kind, org_role, token_id,
  provider_user_id, status, expires_at, idempotency_key, created_by
)
values (
  '27000000-0000-4000-8000-000000000101',
  '27000000-0000-4000-8000-000000000001',
  'invite-r2a01@test.example', 'R2A Consumer', 'team', 'member',
  '27000000-0000-4000-8000-000000000201',
  '27000000-0000-4000-8000-000000000013', 'sent',
  pg_catalog.now() + interval '1 day', 'r2a01-invite',
  'a1000000-0000-0000-0000-000000000001'
);

select lives_ok(
  $$select public.tenancy_accept_invite(
    '27000000-0000-4000-8000-000000000101',
    '27000000-0000-4000-8000-000000000201',
    '27000000-0000-4000-8000-000000000013',
    'invite-r2a01@test.example'
  )$$,
  'verified invite acceptance still binds the profile'
);
select is(
  (select org_id from public.profiles where id = '27000000-0000-4000-8000-000000000013'),
  '27000000-0000-4000-8000-000000000001'::uuid,
  'invite acceptance writes the intended organization binding'
);

select * from finish();
rollback;
