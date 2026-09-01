-- 395_consumer_notification_reads_tenant_wall.test.sql — the reads ledger's
-- insert policy carries the tenant wall, and a consumer can still write.

begin;
create extension if not exists pgtap with schema extensions;

select plan(2);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_policy as policy
    join pg_catalog.pg_class as relation on relation.oid = policy.polrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'consumer_notification_reads'
      and policy.polname = 'consumer_notification_reads_insert_own'
      and coalesce(pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid), '') like '%tenant_write_allowed%'
      and coalesce(pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid), '') like '%auth_profile_id%'
  ),
  1,
  'the reads insert policy conjoins the own-row check with the tenant wall'
);

-- A consumer still writes their own row through the walled policy.
insert into auth.users (id, email)
values ('39500000-0000-4000-8000-000000000111', 'reads.wall@notifications.example');
insert into public.orgs (id, name, slug)
values ('39500000-0000-4000-8000-000000000001', 'Notification Wall Org', 'notification-wall-org');
insert into public.profiles (id, role, org_id, org_role, full_name, email)
values ('39500000-0000-4000-8000-000000000111', 'consumer', '39500000-0000-4000-8000-000000000001', null, 'Wall Reader', 'reads.wall@notifications.example')
on conflict (id) do update set role = excluded.role, org_id = excluded.org_id;

set local role authenticated;
set local request.jwt.claims = '{"sub":"39500000-0000-4000-8000-000000000111","role":"authenticated"}';

select lives_ok(
  $$insert into public.consumer_notification_reads (profile_id, event_key)
    values ('39500000-0000-4000-8000-000000000111', 'stage_change:39500000-0000-4000-8000-0000000000aa')$$,
  'a consumer inserts their own read row through the walled policy'
);

reset role;
select * from finish();
rollback;
