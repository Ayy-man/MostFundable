begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(11);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000004081', 'tasks-owner@test.example'),
  ('00000000-0000-4000-8000-000000004082', 'tasks-member@test.example'),
  ('00000000-0000-4000-8000-000000004083', 'tasks-outsider@test.example');
insert into public.orgs (id, name, slug) values
  ('00000000-0000-4000-8000-000000004084', 'Tasks org', 'tasks-org'),
  ('00000000-0000-4000-8000-000000004085', 'Other tasks org', 'other-tasks-org');
insert into public.profiles (id, role, org_id, org_role, full_name, email) values
  ('00000000-0000-4000-8000-000000004081', 'operator_member', '00000000-0000-4000-8000-000000004084', 'owner', 'Tasks Owner', 'tasks-owner@test.example'),
  ('00000000-0000-4000-8000-000000004082', 'operator_member', '00000000-0000-4000-8000-000000004084', 'member', 'Tasks Member', 'tasks-member@test.example'),
  ('00000000-0000-4000-8000-000000004083', 'operator_member', '00000000-0000-4000-8000-000000004085', 'owner', 'Tasks Outsider', 'tasks-outsider@test.example')
on conflict (id) do update set role = excluded.role, org_id = excluded.org_id, org_role = excluded.org_role, full_name = excluded.full_name, email = excluded.email;
insert into public.clients (id, org_id, display_name) values
  ('00000000-0000-4000-8000-000000004086', '00000000-0000-4000-8000-000000004084', 'Tasks Client'),
  ('00000000-0000-4000-8000-000000004087', '00000000-0000-4000-8000-000000004085', 'Other Tasks Client');

insert into public.operator_tasks (
  id, org_id, client_id, title, priority, due_on, assignee_profile_id, created_by
) values (
  '00000000-0000-4000-8000-000000004088',
  '00000000-0000-4000-8000-000000004084',
  '00000000-0000-4000-8000-000000004086',
  'Review application packet',
  'high',
  current_date,
  '00000000-0000-4000-8000-000000004082',
  '00000000-0000-4000-8000-000000004081'
);

select is((select count(*) from public.operator_tasks where id = '00000000-0000-4000-8000-000000004088'), 1::bigint, 'a valid tenant task is stored');
select throws_ok(
  $$insert into public.operator_tasks (org_id, client_id, title, created_by) values ('00000000-0000-4000-8000-000000004084', '00000000-0000-4000-8000-000000004087', 'Cross tenant client', '00000000-0000-4000-8000-000000004081')$$,
  '23503', 'TASK_CLIENT_INVALID', 'a cross-tenant client cannot be linked'
);
select throws_ok(
  $$insert into public.operator_tasks (org_id, title, assignee_profile_id, created_by) values ('00000000-0000-4000-8000-000000004084', 'Cross tenant assignee', '00000000-0000-4000-8000-000000004083', '00000000-0000-4000-8000-000000004081')$$,
  '23503', 'TASK_ASSIGNEE_INVALID', 'a cross-tenant assignee cannot be linked'
);
select throws_ok(
  $$update public.operator_tasks set org_id = '00000000-0000-4000-8000-000000004085' where id = '00000000-0000-4000-8000-000000004088'$$,
  '42501', 'TASK_IDENTITY_IMMUTABLE', 'task tenant identity cannot be moved'
);

update public.profiles
set disabled_at = pg_catalog.clock_timestamp()
where id = '00000000-0000-4000-8000-000000004082';
update public.operator_tasks
set status = 'completed', completed_at = pg_catalog.clock_timestamp(), notes = 'Reviewed with client.'
where id = '00000000-0000-4000-8000-000000004088';
select is((select status from public.operator_tasks where id = '00000000-0000-4000-8000-000000004088'), 'completed', 'completion is durable');
select ok((select completed_at is not null from public.operator_tasks where id = '00000000-0000-4000-8000-000000004088'), 'completion records its timestamp');
select is((select notes from public.operator_tasks where id = '00000000-0000-4000-8000-000000004088'), 'Reviewed with client.', 'task edits persist');
select is((select assignee_profile_id from public.operator_tasks where id = '00000000-0000-4000-8000-000000004088'), '00000000-0000-4000-8000-000000004082'::uuid, 'an existing task remains editable after its assignee is disabled');

update public.operator_tasks
set deleted_at = pg_catalog.clock_timestamp(), deleted_by = '00000000-0000-4000-8000-000000004081'
where id = '00000000-0000-4000-8000-000000004088';
select ok((select deleted_at is not null from public.operator_tasks where id = '00000000-0000-4000-8000-000000004088'), 'removal is a durable tombstone');
set local role service_role;
select throws_ok(
  $$delete from public.operator_tasks where id = '00000000-0000-4000-8000-000000004088'$$,
  '42501',
  'permission denied for table operator_tasks',
  'service callers cannot erase task history'
);
reset role;
select ok(
  has_table_privilege('authenticated', 'public.operator_tasks', 'SELECT,INSERT,UPDATE')
    and not has_table_privilege('authenticated', 'public.operator_tasks', 'DELETE'),
  'authenticated operators get scoped CRUD without hard delete authority'
);

select * from finish();
rollback;
