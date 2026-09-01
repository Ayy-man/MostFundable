-- 394_consumer_notification_reads.test.sql — consumer notification read state.
--
-- The assertions exercise the two policy directions with two real consumer
-- JWTs. The service-role control proves that RLS scopes browser sessions rather
-- than making the table unusable to the platform, while the anonymous cases
-- prove the absence of a grant instead of relying on a policy predicate alone.

begin;

set local search_path = public, extensions;

select plan(19);

insert into auth.users (id, email)
values
  ('39400000-0000-4000-8000-000000000111', 'reads.one@notifications.example'),
  ('39400000-0000-4000-8000-000000000112', 'reads.two@notifications.example');

insert into public.orgs (id, name, slug)
values ('39400000-0000-4000-8000-000000000001', 'Notification Reads Org', 'notification-reads-org');

insert into public.profiles (id, role, org_id, org_role, full_name, email)
values
  (
    '39400000-0000-4000-8000-000000000111',
    'consumer',
    '39400000-0000-4000-8000-000000000001',
    null,
    'Notification Reader One',
    'reads.one@notifications.example'
  ),
  (
    '39400000-0000-4000-8000-000000000112',
    'consumer',
    '39400000-0000-4000-8000-000000000001',
    null,
    'Notification Reader Two',
    'reads.two@notifications.example'
  )
on conflict (id) do update
set
  role = excluded.role,
  org_id = excluded.org_id,
  org_role = excluded.org_role,
  full_name = excluded.full_name,
  email = excluded.email;

insert into public.consumer_notification_reads (profile_id, event_key, read_at)
values (
  '39400000-0000-4000-8000-000000000112',
  'document:39400000-0000-4000-8000-000000000202',
  '2026-08-24T10:00:00Z'
);

select has_table(
  'public',
  'consumer_notification_reads',
  'the consumer notification read ledger exists'
);

select col_is_pk(
  'public',
  'consumer_notification_reads',
  array['profile_id', 'event_key'],
  'one profile has at most one receipt for one stable event key'
);

select is(
  (
    select count(*)::integer
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'consumer_notification_reads'
      and relation.relrowsecurity
      and relation.relforcerowsecurity
  ),
  1,
  'the ledger enables and forces row level security'
);

select is(
  (
    select array_agg(privilege_type::text order by privilege_type::text)
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'consumer_notification_reads'
      and grantee = 'authenticated'
  ),
  array['INSERT', 'SELECT'],
  'authenticated receives exactly insert and select'
);

select is(
  (
    select count(*)::integer
    from pg_policies
    where schemaname = 'public'
      and tablename = 'consumer_notification_reads'
      and cmd in ('UPDATE', 'DELETE', 'ALL')
  ),
  0,
  'no update or delete policy exists'
);

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"39400000-0000-4000-8000-000000000111"}';

select lives_ok(
  $$
    insert into public.consumer_notification_reads (profile_id, event_key, read_at)
    values (
      '39400000-0000-4000-8000-000000000111',
      'stage_change:39400000-0000-4000-8000-000000000201',
      '2026-08-24T09:00:00Z'
    )
  $$,
  'consumer A inserts a receipt for their own profile'
);

select is(
  (
    select count(*)::integer
    from public.consumer_notification_reads
    where profile_id = '39400000-0000-4000-8000-000000000111'
  ),
  1,
  'consumer A reads their own receipt'
);

select is(
  (
    select count(*)::integer
    from public.consumer_notification_reads
    where profile_id = '39400000-0000-4000-8000-000000000112'
  ),
  0,
  'consumer A cannot read consumer B receipts'
);

select throws_ok(
  $$
    insert into public.consumer_notification_reads (profile_id, event_key)
    values (
      '39400000-0000-4000-8000-000000000112',
      'analysis_complete:39400000-0000-4000-8000-000000000203'
    )
  $$,
  '42501',
  'new row violates row-level security policy for table "consumer_notification_reads"',
  'consumer A cannot insert a receipt for consumer B'
);

select throws_ok(
  $$
    update public.consumer_notification_reads
    set read_at = now()
    where profile_id = '39400000-0000-4000-8000-000000000111'
  $$,
  '42501',
  'permission denied for table consumer_notification_reads',
  'consumer A cannot rewrite a receipt'
);

select throws_ok(
  $$
    delete from public.consumer_notification_reads
    where profile_id = '39400000-0000-4000-8000-000000000111'
  $$,
  '42501',
  'permission denied for table consumer_notification_reads',
  'consumer A cannot erase a receipt'
);

select throws_ok(
  $$
    insert into public.consumer_notification_reads (profile_id, event_key)
    values (
      '39400000-0000-4000-8000-000000000111',
      'Stage_change:39400000-0000-4000-8000-000000000204'
    )
  $$,
  '23514',
  null,
  'the event key vocabulary is lowercase and bounded by the shape check'
);

select throws_ok(
  $$
    insert into public.consumer_notification_reads (profile_id, event_key)
    values (
      '39400000-0000-4000-8000-000000000111',
      'stage_change:39400000-0000-4000-8000-000000000204:qualifier_that_makes_this_event_key_far_longer_than_the_one_hundred_and_twenty_character_storage_boundary'
    )
  $$,
  '23514',
  null,
  'an event key longer than the storage boundary is refused'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"39400000-0000-4000-8000-000000000112"}';

select is(
  (
    select array_agg(profile_id order by profile_id)
    from public.consumer_notification_reads
  ),
  array['39400000-0000-4000-8000-000000000112'::uuid],
  'consumer B sees their own receipt and not consumer A receipt'
);

reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

select throws_ok(
  $$select count(*) from public.consumer_notification_reads$$,
  '42501',
  'permission denied for table consumer_notification_reads',
  'anonymous sessions cannot read the ledger'
);

select throws_ok(
  $$
    insert into public.consumer_notification_reads (profile_id, event_key)
    values (
      '39400000-0000-4000-8000-000000000111',
      'document:39400000-0000-4000-8000-000000000205'
    )
  $$,
  '42501',
  'permission denied for table consumer_notification_reads',
  'anonymous sessions cannot insert into the ledger'
);

reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

select is(
  (select count(*)::integer from public.consumer_notification_reads),
  2,
  'service role reads receipts across profiles without an RLS filter'
);

select lives_ok(
  $$
    insert into public.consumer_notification_reads (profile_id, event_key)
    values (
      '39400000-0000-4000-8000-000000000111',
      'team_message:39400000-0000-4000-8000-000000000206'
    )
  $$,
  'service role retains platform maintenance writes'
);

select is(
  (select count(*)::integer from public.consumer_notification_reads),
  3,
  'the service-role write is visible across both profiles'
);

reset role;
select set_config('request.jwt.claims', null, true);

select * from finish();
rollback;
