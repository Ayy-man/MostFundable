begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(4);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000a331', 'task-hardening-owner@test.example');
insert into public.orgs (id, name, slug) values
  ('00000000-0000-4000-8000-00000000a332', 'Task hardening org', 'task-hardening-org');
insert into public.profiles (id, role, org_id, org_role, full_name, email) values
  ('00000000-0000-4000-8000-00000000a331', 'operator_member', '00000000-0000-4000-8000-00000000a332', 'owner', 'Task Hardening Owner', 'task-hardening-owner@test.example')
on conflict (id) do update
set role = excluded.role,
    org_id = excluded.org_id,
    org_role = excluded.org_role,
    full_name = excluded.full_name,
    email = excluded.email;
insert into public.clients (id, org_id, display_name) values
  ('00000000-0000-4000-8000-00000000a333', '00000000-0000-4000-8000-00000000a332', 'Archived task client');
insert into public.operator_tasks (id, org_id, client_id, title, created_by) values
  ('00000000-0000-4000-8000-00000000a334', '00000000-0000-4000-8000-00000000a332', '00000000-0000-4000-8000-00000000a333', 'Historical task', '00000000-0000-4000-8000-00000000a331');

select pg_catalog.set_config('app.governed_client_write', 'on', true);
update public.clients
set status = 'archived',
    archived_at = pg_catalog.clock_timestamp(),
    archived_by = '00000000-0000-4000-8000-00000000a331'
where id = '00000000-0000-4000-8000-00000000a333';
select pg_catalog.set_config('app.governed_client_write', '', true);
select is(
  (select status from public.clients where id = '00000000-0000-4000-8000-00000000a333'),
  'archived'::public.client_status,
  'the task client is archived through the governed lifecycle'
);

update public.operator_tasks
set notes = 'Historical task remains editable after archive.'
where id = '00000000-0000-4000-8000-00000000a334';
select is(
  (select notes from public.operator_tasks where id = '00000000-0000-4000-8000-00000000a334'),
  'Historical task remains editable after archive.',
  'an existing task remains editable after its client is archived'
);

update public.operator_tasks
set deleted_at = pg_catalog.clock_timestamp(),
    deleted_by = '00000000-0000-4000-8000-00000000a331'
where id = '00000000-0000-4000-8000-00000000a334';
select ok(
  (select deleted_at is not null from public.operator_tasks where id = '00000000-0000-4000-8000-00000000a334'),
  'an archived client does not block the task tombstone'
);

select throws_ok(
  $$insert into public.operator_tasks (org_id, client_id, title, created_by) values ('00000000-0000-4000-8000-00000000a332', '00000000-0000-4000-8000-00000000a333', 'New archived client task', '00000000-0000-4000-8000-00000000a331')$$,
  '23503', 'TASK_CLIENT_INVALID', 'a new task cannot be linked to an archived client'
);

select * from finish();
rollback;
