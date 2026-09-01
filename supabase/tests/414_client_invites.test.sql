begin;
set local search_path = public, extensions;
select plan(10);

select enum_has_labels(
  'public', 'tenant_invite_kind', array['team', 'affiliate', 'client'],
  'client invitation is part of the closed durable invite rail'
);

insert into public.orgs (id, name, slug)
values ('41400000-0000-4000-8000-000000000001', 'Client Invite Org', 'client-invite-org');

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
values
  (
    '41400000-0000-4000-8000-000000000011',
    'owner@client-invite.test',
    '{"app_role":"operator_member","org_id":"41400000-0000-4000-8000-000000000001","org_role":"owner"}',
    '{"full_name":"Invite Owner"}'
  ),
  (
    '41400000-0000-4000-8000-000000000012',
    'consumer@client-invite.test',
    '{}',
    '{"full_name":"Invited Consumer"}'
  );

create temporary table client_invite_result on commit drop as
select public.tenancy_create_invite(
  '41400000-0000-4000-8000-000000000001',
  'consumer@client-invite.test',
  'Invited Consumer',
  'client',
  null,
  pg_catalog.now() + interval '7 days',
  '41400000-0000-4000-8000-000000000101',
  '41400000-0000-4000-8000-000000000011'
) as value;

select is(
  (
    select kind::text || ':' || coalesce(org_role::text, 'none')
    from public.invites
    where id = (select (value ->> 'invite_id')::uuid from client_invite_result)
  ),
  'client:none',
  'client invite carries no operator role'
);

select throws_ok(
  $$select public.tenancy_create_invite(
    '41400000-0000-4000-8000-000000000001',
    'bad-role@client-invite.test', 'Bad Role', 'client', 'member',
    pg_catalog.now() + interval '7 days',
    '41400000-0000-4000-8000-000000000102',
    '41400000-0000-4000-8000-000000000011'
  )$$,
  '22023', 'TENANT_INVITE_INPUT_INVALID',
  'client invite cannot smuggle an operator role'
);

select lives_ok(
  format(
    'select public.tenancy_mark_invite_delivery(%L, true, %L, null)',
    (select value ->> 'invite_id' from client_invite_result),
    '41400000-0000-4000-8000-000000000012'
  ),
  'provider delivery binds the invited auth identity'
);

select lives_ok(
  format(
    'select public.tenancy_accept_invite(%L, %L, %L, %L)',
    (select value ->> 'invite_id' from client_invite_result),
    (select value ->> 'token_id' from client_invite_result),
    '41400000-0000-4000-8000-000000000012',
    'CONSUMER@CLIENT-INVITE.TEST'
  ),
  'verified client invite accepts once'
);

select is(
  (
    select role::text || ':' || org_id::text || ':' || coalesce(org_role::text, 'none')
    from public.profiles
    where id = '41400000-0000-4000-8000-000000000012'
  ),
  'consumer:41400000-0000-4000-8000-000000000001:none',
  'acceptance binds the consumer to exactly the inviting organization'
);

select is(
  (
    select count(*)::integer
    from public.clients
    where consumer_profile_id = '41400000-0000-4000-8000-000000000012'
      and org_id = '41400000-0000-4000-8000-000000000001'
      and display_name = 'Invited Consumer'
  ),
  1,
  'acceptance creates one canonical client row'
);

select is(
  (
    select count(*)::integer
    from public.audit_log
    where action = 'org.invite_accepted'
      and client_id = (
        select id from public.clients
        where consumer_profile_id = '41400000-0000-4000-8000-000000000012'
      )
  ),
  1,
  'client acceptance is tied to the created client in the audit trail'
);

select throws_ok(
  format(
    'select public.tenancy_accept_invite(%L, %L, %L, %L)',
    (select value ->> 'invite_id' from client_invite_result),
    (select value ->> 'token_id' from client_invite_result),
    '41400000-0000-4000-8000-000000000012',
    'consumer@client-invite.test'
  ),
  'P0001', 'TENANT_INVITE_INVALID',
  'accepted client invite cannot be replayed'
);

select is(
  (
    select count(*)::integer from public.operator_seat_sync_outbox
    where org_id = '41400000-0000-4000-8000-000000000001'
  ),
  0,
  'consumer acceptance does not create an operator seat obligation'
);

select * from finish();
rollback;
