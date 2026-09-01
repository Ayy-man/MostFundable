-- Durable operator tasks. Rows are soft-deleted so assignment and completion
-- history remains attributable, while every tenant link is checked in the
-- database instead of trusting the browser or a service-role caller.

create table public.operator_tasks (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete restrict,
  client_id uuid references public.clients(id) on delete set null,
  title text not null,
  notes text not null default '',
  priority text not null default 'medium',
  status text not null default 'pending',
  due_on date,
  assignee_profile_id uuid references public.profiles(id) on delete set null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  completed_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint operator_tasks_title_shape check (
    char_length(btrim(title)) between 1 and 160 and title = btrim(title)
  ),
  constraint operator_tasks_notes_shape check (char_length(notes) <= 4000),
  constraint operator_tasks_priority_shape check (priority in ('low', 'medium', 'high')),
  constraint operator_tasks_status_shape check (status in ('pending', 'completed')),
  constraint operator_tasks_completed_shape check (
    (status = 'pending' and completed_at is null)
    or (status = 'completed' and completed_at is not null)
  ),
  constraint operator_tasks_deleted_shape check (
    (deleted_at is null and deleted_by is null)
    or (deleted_at is not null and deleted_by is not null)
  )
);

create index operator_tasks_org_queue_idx
  on public.operator_tasks(org_id, status, due_on, created_at desc)
  where deleted_at is null;
create index operator_tasks_assignee_queue_idx
  on public.operator_tasks(assignee_profile_id, status, due_on)
  where deleted_at is null;
create index operator_tasks_client_idx
  on public.operator_tasks(client_id, created_at desc)
  where deleted_at is null;

create function private.validate_operator_task()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if tg_op = 'UPDATE' and (
    new.org_id is distinct from old.org_id
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
  ) then
    raise exception using errcode = '42501', message = 'TASK_IDENTITY_IMMUTABLE';
  end if;

  if tg_op = 'INSERT' and not exists (
    select 1 from public.profiles as creator
    where creator.id = new.created_by
      and creator.role = 'operator_member'
      and creator.org_id = new.org_id
      and creator.disabled_at is null
  ) then
    raise exception using errcode = '42501', message = 'TASK_CREATOR_INVALID';
  end if;

  -- Recheck the client on every mutation. Otherwise a task attached while the
  -- client was active stays editable after archival or privacy erasure.
  if new.client_id is not null
    and not exists (
    select 1 from public.clients as client
    where client.id = new.client_id
      and client.org_id = new.org_id
      and client.status = 'active'
  ) then
    raise exception using errcode = '23503', message = 'TASK_CLIENT_INVALID';
  end if;

  if new.assignee_profile_id is not null
    and (tg_op = 'INSERT' or new.assignee_profile_id is distinct from old.assignee_profile_id)
    and not exists (
    select 1 from public.profiles as assignee
    where assignee.id = new.assignee_profile_id
      and assignee.role = 'operator_member'
      and assignee.org_id = new.org_id
      and assignee.disabled_at is null
  ) then
    raise exception using errcode = '23503', message = 'TASK_ASSIGNEE_INVALID';
  end if;

  if new.deleted_by is not null
    and (tg_op = 'INSERT' or new.deleted_by is distinct from old.deleted_by)
    and not exists (
    select 1 from public.profiles as deleter
    where deleter.id = new.deleted_by
      and deleter.role = 'operator_member'
      and deleter.org_id = new.org_id
      and deleter.disabled_at is null
  ) then
    raise exception using errcode = '42501', message = 'TASK_DELETER_INVALID';
  end if;

  new.title := btrim(new.title);
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$fn$;

revoke all on function private.validate_operator_task()
  from public, anon, authenticated, service_role;

create trigger operator_tasks_validate
before insert or update on public.operator_tasks
for each row execute function private.validate_operator_task();

alter table public.operator_tasks enable row level security;
alter table public.operator_tasks force row level security;

create policy operator_tasks_select_org on public.operator_tasks
for select to authenticated
using (
  (select private.auth_app_role()) = 'operator_member'
  and exists (
    select 1 from public.profiles as actor
    where actor.id = (select auth.uid())
      and actor.org_id = operator_tasks.org_id
      and actor.disabled_at is null
  )
);

create policy operator_tasks_insert_org on public.operator_tasks
for insert to authenticated
with check (
  (select private.auth_app_role()) = 'operator_member'
  and (select private.tenant_write_allowed(operator_tasks.org_id))
  and created_by = (select auth.uid())
  and exists (
    select 1 from public.profiles as actor
    where actor.id = (select auth.uid())
      and actor.org_id = operator_tasks.org_id
      and actor.disabled_at is null
  )
);

create policy operator_tasks_update_org on public.operator_tasks
for update to authenticated
using (
  (select private.auth_app_role()) = 'operator_member'
  and (select private.tenant_write_allowed(operator_tasks.org_id))
  and exists (
    select 1 from public.profiles as actor
    where actor.id = (select auth.uid())
      and actor.org_id = operator_tasks.org_id
      and actor.disabled_at is null
  )
)
with check (
  (select private.auth_app_role()) = 'operator_member'
  and (select private.tenant_write_allowed(operator_tasks.org_id))
  and exists (
    select 1 from public.profiles as actor
    where actor.id = (select auth.uid())
      and actor.org_id = operator_tasks.org_id
      and actor.disabled_at is null
  )
);

revoke all on table public.operator_tasks from public, anon, authenticated;
grant select, insert, update on table public.operator_tasks to authenticated;
grant all on table public.operator_tasks to service_role;
revoke delete, truncate on table public.operator_tasks
  from public, anon, authenticated, service_role;

create trigger operator_tasks_no_truncate
before truncate on public.operator_tasks
for each statement execute function public.append_only_guard();
alter table public.operator_tasks enable always trigger operator_tasks_no_truncate;
