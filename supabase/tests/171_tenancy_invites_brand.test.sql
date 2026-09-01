begin;

set local search_path = public, extensions;

select plan(46);

select has_table('public', 'invites', 'invites table exists');
select has_column('public', 'profiles', 'disabled_at', 'profiles carry disablement time');
select enum_has_labels(
  'public', 'tenant_invite_kind', array['team', 'affiliate', 'client'],
  'invite kind is closed'
);
select enum_has_labels(
  'public', 'tenant_invite_status',
  array['pending', 'sent', 'failed', 'accepted', 'expired'],
  'invite status is closed'
);
select ok(
  'member' = any(enum_range(null::public.org_role)::text[]),
  'the least-privileged invited team role is representable'
);
select is(
  (
    select relation.relrowsecurity and relation.relforcerowsecurity
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public' and relation.relname = 'invites'
  ),
  true,
  'invites enable and force RLS'
);
select is(
  has_function_privilege('authenticated', 'public.tenancy_accept_invite(uuid,uuid,uuid,text)', 'execute'),
  false,
  'authenticated callers cannot invoke acceptance directly'
);
select is(
  has_function_privilege('service_role', 'public.tenancy_accept_invite(uuid,uuid,uuid,text)', 'execute'),
  true,
  'service role can invoke verified acceptance'
);
select is(
  (select public from storage.buckets where id = 'brand-assets'),
  true,
  'brand-assets is public-read'
);
select is(
  (select file_size_limit from storage.buckets where id = 'brand-assets'),
  2097152::bigint,
  'brand-assets enforces the two MiB boundary'
);

insert into public.orgs (id, name, slug, seats_included)
values
  ('17100000-0000-4000-8000-000000000001', 'Invite Org A', 'invite-org-a', 0),
  ('17100000-0000-4000-8000-000000000002', 'Invite Org B', 'invite-org-b', 0);

insert into auth.users (id, email, raw_app_meta_data)
values
  ('17100000-0000-4000-8000-000000000011', 'platform@invite.test', '{"app_role":"platform_admin","full_name":"Platform Admin"}'),
  ('17100000-0000-4000-8000-000000000012', 'owner-a@invite.test', '{"app_role":"operator_member","org_id":"17100000-0000-4000-8000-000000000001","org_role":"owner","full_name":"Owner A"}'),
  ('17100000-0000-4000-8000-000000000013', 'owner-b@invite.test', '{"app_role":"operator_member","org_id":"17100000-0000-4000-8000-000000000002","org_role":"owner","full_name":"Owner B"}'),
  ('17100000-0000-4000-8000-000000000014', 'admin-b@invite.test', '{"app_role":"operator_member","org_id":"17100000-0000-4000-8000-000000000002","org_role":"admin","full_name":"Admin B"}'),
  ('17100000-0000-4000-8000-000000000021', 'team-target@invite.test', '{"invite_id":"17100000-0000-4000-8000-000000000101"}'),
  ('17100000-0000-4000-8000-000000000022', 'affiliate-target@invite.test', '{"invite_id":"17100000-0000-4000-8000-000000000102"}');

insert into public.profiles (id, role, org_id, org_role, full_name, email)
values
  ('17100000-0000-4000-8000-000000000011', 'platform_admin', null, null, 'Platform Admin', 'platform@invite.test'),
  ('17100000-0000-4000-8000-000000000012', 'operator_member', '17100000-0000-4000-8000-000000000001', 'owner', 'Owner A', 'owner-a@invite.test'),
  ('17100000-0000-4000-8000-000000000013', 'operator_member', '17100000-0000-4000-8000-000000000002', 'owner', 'Owner B', 'owner-b@invite.test'),
  ('17100000-0000-4000-8000-000000000014', 'operator_member', '17100000-0000-4000-8000-000000000002', 'admin', 'Admin B', 'admin-b@invite.test')
on conflict (id) do update
set role = excluded.role, org_id = excluded.org_id, org_role = excluded.org_role,
    full_name = excluded.full_name, email = excluded.email;

insert into public.operator_subscriptions (
  org_id, provider, base_price_ref, seat_price_ref, status
)
values
  ('17100000-0000-4000-8000-000000000001', 'mock', 'base-a', 'seat-a', 'incomplete'),
  ('17100000-0000-4000-8000-000000000002', 'mock', 'base-b', 'seat-b', 'incomplete');

create temporary table tenancy_provision_result on commit drop as
select public.tenancy_provision_org(
  'Provisioned Org', 'provisioned-org', pg_catalog.now() + interval '14 days',
  'first-owner@invite.test', 'First Owner', 'provision-key-0001',
  '17100000-0000-4000-8000-000000000011'
) as value;

select is(
  (select count(*)::integer from public.orgs where slug = 'provisioned-org'),
  1,
  'provision creates one trial org'
);
select is(
  (
    select count(*)::integer
    from public.invites
    where org_id = ((select value ->> 'org_id' from tenancy_provision_result)::uuid)
      and org_role = 'owner'
      and status = 'pending'
  ),
  1,
  'provision atomically creates the first pending owner invite'
);
select lives_ok(
  $$select public.tenancy_provision_org(
    'Provisioned Org', 'provisioned-org', pg_catalog.now() + interval '14 days',
    'first-owner@invite.test', 'First Owner', 'provision-key-0001',
    '17100000-0000-4000-8000-000000000011'
  )$$,
  'provision retry returns the durable identity'
);
select is(
  (select count(*)::integer from public.orgs where slug = 'provisioned-org'),
  1,
  'provision retry creates no second org'
);
select is(
  (
    select count(*)::integer from public.audit_log
    where action = 'org.provisioned'
      and org_id = ((select value ->> 'org_id' from tenancy_provision_result)::uuid)
  ),
  1,
  'provision writes exactly one audit row'
);

create temporary table tenancy_delivery_result on commit drop as
select public.tenancy_create_invite(
  '17100000-0000-4000-8000-000000000001',
  'delivery-target@invite.test', 'Delivery Target', 'team', 'admin',
  pg_catalog.now() + interval '1 day', 'delivery-invite-key-0001',
  '17100000-0000-4000-8000-000000000012'
) as value;
select lives_ok(
  $$select public.tenancy_mark_invite_delivery(
    (select (value ->> 'invite_id')::uuid from tenancy_delivery_result),
    false, null, 'provider_unavailable'
  )$$,
  'provider failure is persisted against the durable invite'
);
select is(
  (
    select status::text from public.invites
    where id = (select (value ->> 'invite_id')::uuid from tenancy_delivery_result)
  ),
  'failed',
  'failed delivery cannot be mistaken for sent'
);
select lives_ok(
  $$select public.tenancy_mark_invite_delivery(
    (select (value ->> 'invite_id')::uuid from tenancy_delivery_result),
    true, '17100000-0000-4000-8000-000000000024', null
  )$$,
  'a retried provider success records the provider identity'
);

insert into public.invites (
  id, org_id, email, full_name, kind, org_role, token_id,
  provider_user_id, status, expires_at, idempotency_key, created_by
)
values
  (
    '17100000-0000-4000-8000-000000000101',
    '17100000-0000-4000-8000-000000000001',
    'team-target@invite.test', 'Team Target', 'team', 'member',
    '17100000-0000-4000-8000-000000000201',
    '17100000-0000-4000-8000-000000000021', 'sent',
    pg_catalog.now() + interval '1 day', 'team-invite-key-0001',
    '17100000-0000-4000-8000-000000000012'
  ),
  (
    '17100000-0000-4000-8000-000000000102',
    '17100000-0000-4000-8000-000000000001',
    'affiliate-target@invite.test', 'Affiliate Target', 'affiliate', null,
    '17100000-0000-4000-8000-000000000202',
    '17100000-0000-4000-8000-000000000022', 'sent',
    pg_catalog.now() + interval '1 day', 'affiliate-invite-key-0001',
    '17100000-0000-4000-8000-000000000012'
  ),
  (
    '17100000-0000-4000-8000-000000000103',
    '17100000-0000-4000-8000-000000000001',
    'expired-target@invite.test', 'Expired Target', 'team', 'member',
    '17100000-0000-4000-8000-000000000203',
    '17100000-0000-4000-8000-000000000023', 'sent',
    pg_catalog.now() - interval '1 minute', 'expired-invite-key-0001',
    '17100000-0000-4000-8000-000000000012'
  );

select throws_ok(
  $$
    insert into public.invites (
      org_id, email, full_name, kind, org_role, expires_at, idempotency_key, created_by
    ) values (
      '17100000-0000-4000-8000-000000000001', 'team-target@invite.test',
      'Duplicate Target', 'team', 'member', pg_catalog.now() + interval '1 day',
      'duplicate-live-key-0001', '17100000-0000-4000-8000-000000000012'
    )
  $$,
  '23505', null, 'a second live invite for one org email fails'
);
select throws_ok(
  $$
    insert into public.invites (
      org_id, email, full_name, kind, org_role, expires_at, idempotency_key, created_by
    ) values (
      '17100000-0000-4000-8000-000000000001', 'bad-affiliate@invite.test',
      'Bad Affiliate', 'affiliate', 'admin', pg_catalog.now() + interval '1 day',
      'bad-affiliate-key-0001', '17100000-0000-4000-8000-000000000012'
    )
  $$,
  '23514', null, 'affiliate invites cannot carry an org role'
);
select throws_ok(
  $$select public.tenancy_accept_invite(
    '17100000-0000-4000-8000-000000000103',
    '17100000-0000-4000-8000-000000000203',
    '17100000-0000-4000-8000-000000000023',
    'expired-target@invite.test'
  )$$,
  'P0001', 'TENANT_INVITE_INVALID', 'an expired invite cannot be accepted'
);
select throws_ok(
  $$select public.tenancy_accept_invite(
    '17100000-0000-4000-8000-000000000101',
    '17100000-0000-4000-8000-000000000201',
    '17100000-0000-4000-8000-000000000099',
    'team-target@invite.test'
  )$$,
  'P0001', 'TENANT_INVITE_INVALID', 'a foreign provider identity cannot accept'
);
select lives_ok(
  $$select public.tenancy_accept_invite(
    '17100000-0000-4000-8000-000000000101',
    '17100000-0000-4000-8000-000000000201',
    '17100000-0000-4000-8000-000000000021',
    'TEAM-TARGET@INVITE.TEST'
  )$$,
  'the verified team identity accepts once'
);
select is(
  (
    select role::text || ':' || org_role::text
    from public.profiles where id = '17100000-0000-4000-8000-000000000021'
  ),
  'operator_member:member',
  'team acceptance binds the selected role'
);
select throws_ok(
  $$select public.tenancy_accept_invite(
    '17100000-0000-4000-8000-000000000101',
    '17100000-0000-4000-8000-000000000201',
    '17100000-0000-4000-8000-000000000021',
    'team-target@invite.test'
  )$$,
  'P0001', 'TENANT_INVITE_INVALID', 'accepted invite replay fails'
);
select lives_ok(
  $$select public.tenancy_accept_invite(
    '17100000-0000-4000-8000-000000000102',
    '17100000-0000-4000-8000-000000000202',
    '17100000-0000-4000-8000-000000000022',
    'affiliate-target@invite.test'
  )$$,
  'the verified affiliate identity accepts once'
);
select matches(
  (
    select referral_slug from public.affiliates
    where profile_id = '17100000-0000-4000-8000-000000000022'
  ),
  '^[a-z0-9]{8}$',
  'affiliate acceptance generates an eight-character lowercase slug'
);
select is(
  (
    select count(*)::integer from public.profiles
    where id = '17100000-0000-4000-8000-000000000022'
      and role = 'affiliate' and org_role is null
  ),
  1,
  'affiliate acceptance creates no operator seat role'
);
select is(
  (
    select desired_quantity from public.operator_seat_sync_outbox
    where org_id = '17100000-0000-4000-8000-000000000001'
  ),
  2,
  'team acceptance enqueues the enabled operator count'
);

update public.profiles
set manages = array['17100000-0000-4000-8000-000000000021'::uuid]
where id = '17100000-0000-4000-8000-000000000012';

insert into public.clients (id, org_id, display_name, assigned_to)
values (
  '17100000-0000-4000-8000-000000000301',
  '17100000-0000-4000-8000-000000000001',
  'Assigned Client',
  '17100000-0000-4000-8000-000000000021'
);

select throws_ok(
  $$select public.tenancy_deactivate_member(
    '17100000-0000-4000-8000-000000000012',
    '17100000-0000-4000-8000-000000000012'
  )$$,
  '22023', 'TENANT_MEMBER_SELF_DISABLE_FORBIDDEN', 'an actor cannot disable itself'
);
select throws_ok(
  $$select public.tenancy_deactivate_member(
    '17100000-0000-4000-8000-000000000013',
    '17100000-0000-4000-8000-000000000014'
  )$$,
  '22023', 'TENANT_LAST_OWNER_DISABLE_FORBIDDEN', 'the last enabled owner is protected'
);
select throws_ok(
  $$select public.tenancy_deactivate_member(
    '17100000-0000-4000-8000-000000000021',
    '17100000-0000-4000-8000-000000000014'
  )$$,
  '42501', 'TENANT_MEMBER_NOT_FOUND', 'a foreign-org admin cannot disable the member'
);
select lives_ok(
  $$select public.tenancy_deactivate_member(
    '17100000-0000-4000-8000-000000000021',
    '17100000-0000-4000-8000-000000000012'
  )$$,
  'an org owner can disable its enabled member'
);
select isnt(
  (select disabled_at from public.profiles where id = '17100000-0000-4000-8000-000000000021'),
  null::timestamptz,
  'off-boarding retains the profile and marks it disabled'
);
select is(
  (select cardinality(manages) from public.profiles where id = '17100000-0000-4000-8000-000000000012'),
  0,
  'off-boarding clears the target from manager arrays'
);
select is(
  (select assigned_to from public.clients where id = '17100000-0000-4000-8000-000000000301'),
  null::uuid,
  'off-boarding returns assigned clients to assignment-required'
);
select is(
  (
    select count(*)::integer from public.audit_log
    where action = 'org.member_disabled'
      and subject_id = '17100000-0000-4000-8000-000000000021'
  ),
  1,
  'off-boarding writes one audit row'
);
select is(
  (
    select desired_quantity from public.operator_seat_sync_outbox
    where org_id = '17100000-0000-4000-8000-000000000001'
  ),
  1,
  'off-boarding enqueues the lower enabled seat count'
);

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"17100000-0000-4000-8000-000000000021"}';
select is(private.auth_profile_id(), null::uuid, 'a disabled JWT resolves no profile identity');
select is(private.auth_org_id(), null::uuid, 'a disabled JWT resolves no org identity');
reset role;

select is(
  public.tenancy_email_registered_elsewhere(
    'owner-b@invite.test', '17100000-0000-4000-8000-000000000012'
  ),
  true,
  'email detection finds a profile in another org'
);
select is(
  public.tenancy_email_registered_elsewhere(
    'owner-a@invite.test', '17100000-0000-4000-8000-000000000012'
  ),
  false,
  'email detection excludes the current actor'
);

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"17100000-0000-4000-8000-000000000012"}';
select lives_ok(
  $$insert into storage.objects (bucket_id, name, owner_id)
    values (
      'brand-assets',
      '17100000-0000-4000-8000-000000000001/17100000-0000-4000-8000-000000000401.png',
      '17100000-0000-4000-8000-000000000012'
    )$$,
  'an owner can write the server-shaped path under its org'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner_id)
    values (
      'brand-assets',
      '17100000-0000-4000-8000-000000000002/17100000-0000-4000-8000-000000000402.png',
      '17100000-0000-4000-8000-000000000012'
    )$$,
  '42501', null, 'an owner cannot write a foreign org path'
);
reset role;

select is(
  (
    select count(*)::integer
    from public.clients
    where id = '17100000-0000-4000-8000-000000000301'
  ),
  1,
  'the read-only email check changes no client row'
);
select is(
  (
    select count(*)::integer from public.invites
    where status = 'accepted' and org_id = '17100000-0000-4000-8000-000000000001'
  ),
  2,
  'team and affiliate acceptance each persist exactly once'
);

select * from finish();
rollback;
