-- A task's historical client link remains valid after the governed archive
-- transition. New links and link changes still require an active client.

create or replace function private.validate_operator_task()
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

  if new.client_id is not null
    and (tg_op = 'INSERT' or new.client_id is distinct from old.client_id)
    and not exists (
      select 1 from public.clients as client
      where client.id = new.client_id
        and client.org_id = new.org_id
        and client.status = 'active'
    ) then
    raise exception using errcode = '23503', message = 'TASK_CLIENT_INVALID';
  end if;

  -- Privacy erasure redacts task prose before completing its request. Unlike a
  -- routine archive, the completed deletion is a permanent boundary: later
  -- edits must not be able to put consumer data back on the historical task.
  if tg_op = 'UPDATE'
    and new.client_id is not null
    and exists (
      select 1
      from public.privacy_requests as request
      where request.client_id = new.client_id
        and request.kind = 'deletion'
        and request.status = 'completed'
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
