begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(25);

select has_table(
  'public',
  'consumer_notification_preferences',
  'consumer notification preferences are durable'
);
select col_is_pk(
  'public',
  'consumer_notification_preferences',
  array['profile_id', 'event_type'],
  'each consumer has one choice per event category'
);
select has_column('public', 'consumer_notification_preferences', 'event_type', 'event category is stored');
select has_column('public', 'consumer_notification_preferences', 'in_app_enabled', 'in-app delivery choice is stored');
select has_column('public', 'consumer_notification_preferences', 'email_enabled', 'email delivery choice is stored');
select is(
  (
    select count(*)::integer
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'consumer_notification_preferences'
      and relation.relrowsecurity
      and relation.relforcerowsecurity
  ),
  1,
  'preferences enable and force row level security'
);
select is(
  (
    select array_agg(privilege_type::text order by privilege_type::text)
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'consumer_notification_preferences'
      and grantee = 'authenticated'
  ),
  array['INSERT', 'SELECT', 'UPDATE'],
  'authenticated receives only the preference operations the consumer UI needs'
);
select has_check(
  'public',
  'consumer_notification_preferences',
  'the event category vocabulary is constrained'
);
select has_trigger(
  'public',
  'profiles',
  'profiles_seed_consumer_notification_preferences',
  'future consumers receive the conservative defaults'
);
select has_trigger(
  'public',
  'consumer_notification_preferences',
  'consumer_notification_preferences_validate',
  'preference identity and update timestamps are database-owned'
);

insert into public.orgs (id, name, slug)
values
  ('41300000-0000-4000-8000-000000000001', 'Preference One Org', 'preference-one-org'),
  ('41300000-0000-4000-8000-000000000002', 'Preference Two Org', 'preference-two-org');

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
values
  (
    '41300000-0000-4000-8000-000000000111',
    'preferences.one@example.test',
    '{"app_role":"consumer","org_id":"41300000-0000-4000-8000-000000000001"}',
    '{"full_name":"Preference One"}'
  ),
  (
    '41300000-0000-4000-8000-000000000112',
    'preferences.two@example.test',
    '{"app_role":"consumer","org_id":"41300000-0000-4000-8000-000000000002"}',
    '{"full_name":"Preference Two"}'
  ),
  (
    '41300000-0000-4000-8000-000000000113',
    'preferences.affiliate@example.test',
    '{"app_role":"affiliate","org_id":"41300000-0000-4000-8000-000000000001"}',
    '{"full_name":"Preference Affiliate"}'
  );

select is(
  (
    select count(*)::integer
    from public.consumer_notification_preferences
    where profile_id in (
      '41300000-0000-4000-8000-000000000111',
      '41300000-0000-4000-8000-000000000112'
    )
  ),
  16,
  'each new consumer receives all eight event categories'
);
select is(
  (
    select count(*)::integer
    from public.consumer_notification_preferences
    where profile_id in (
      '41300000-0000-4000-8000-000000000111',
      '41300000-0000-4000-8000-000000000112'
    )
      and in_app_enabled
      and not email_enabled
  ),
  16,
  'every seeded category defaults to in-app on and email off'
);
select is(
  (
    select count(*)::integer
    from public.consumer_notification_preferences
    where profile_id = '41300000-0000-4000-8000-000000000113'
  ),
  0,
  'non-consumers receive no consumer notification preferences'
);

-- Leave one category absent for consumer B so consumer A's cross-profile insert
-- reaches the RLS check instead of the primary-key check.
delete from public.consumer_notification_preferences
where profile_id = '41300000-0000-4000-8000-000000000112'
  and event_type = 'application_update';

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"41300000-0000-4000-8000-000000000111"}';

select is(
  (select count(*)::integer from public.consumer_notification_preferences),
  8,
  'consumer A reads only their own eight categories across the tenant wall'
);
select lives_ok(
  $$
    update public.consumer_notification_preferences
    set in_app_enabled = false
    where profile_id = '41300000-0000-4000-8000-000000000111'
      and event_type = 'stage_change'
  $$,
  'consumer A disables in-app delivery for their own category'
);
select is(
  (
    select (not in_app_enabled and not email_enabled)::text
    from public.consumer_notification_preferences
    where event_type = 'stage_change'
  ),
  'true',
  'consumer A reads the in-app choice back while unsupported email stays off'
);
with changed as (
  update public.consumer_notification_preferences
  set email_enabled = true
  where profile_id = '41300000-0000-4000-8000-000000000112'
  returning 1
)
select is(
  (select count(*)::integer from changed),
  0,
  'consumer A cannot update consumer B preferences'
);
select throws_ok(
  $$
    insert into public.consumer_notification_preferences (profile_id, event_type)
    values ('41300000-0000-4000-8000-000000000112', 'application_update')
  $$,
  '42501',
  'new row violates row-level security policy for table "consumer_notification_preferences"',
  'consumer A cannot insert a preference for consumer B'
);
select throws_ok(
  $$
    insert into public.consumer_notification_preferences (profile_id, event_type)
    values ('41300000-0000-4000-8000-000000000111', 'unknown_event')
  $$,
  '23514',
  null,
  'unknown event categories are rejected'
);
select throws_ok(
  $$
    delete from public.consumer_notification_preferences
    where profile_id = '41300000-0000-4000-8000-000000000111'
  $$,
  '42501',
  'permission denied for table consumer_notification_preferences',
  'consumers cannot erase their preference history'
);

reset role;

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_policy as policy
    join pg_catalog.pg_class as relation on relation.oid = policy.polrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'consumer_notification_preferences'
      and policy.polname in (
        'consumer_notification_preferences_insert_own',
        'consumer_notification_preferences_update_own'
      )
      and coalesce(pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid), '') like '%tenant_write_allowed%'
  ),
  2,
  'both authenticated mutation policies carry the tenant write wall'
);

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok(
  $$select count(*) from public.consumer_notification_preferences$$,
  '42501',
  'permission denied for table consumer_notification_preferences',
  'anonymous sessions cannot read consumer preferences'
);

reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$
    insert into public.consumer_notification_preferences (profile_id, event_type)
    values ('41300000-0000-4000-8000-000000000112', 'application_update')
  $$,
  'service maintenance can restore a missing default row'
);
select is(
  (
    select count(*)::integer
    from public.consumer_notification_preferences
    where profile_id in (
      '41300000-0000-4000-8000-000000000111',
      '41300000-0000-4000-8000-000000000112'
    )
  ),
  16,
  'service maintenance reads all persisted preferences for both fixture consumers'
);

reset role;
select is(
  (
    select count(*)::integer
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'consumer_notification_preferences'
      and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
      and privilege_type in ('DELETE', 'TRUNCATE')
  ),
  0,
  'no application-reachable role can delete or truncate preferences'
);

select * from finish();
rollback;
