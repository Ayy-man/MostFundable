-- Immutable assignment transitions captured from the governed client row.

create table public.client_assignment_history (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  from_user uuid references public.profiles(id) on delete restrict,
  to_user uuid references public.profiles(id) on delete restrict,
  changed_by uuid references public.profiles(id) on delete restrict,
  changed_at timestamptz not null default now(),
  constraint client_assignment_history_change check (from_user is distinct from to_user)
);

create index client_assignment_history_client_changed_idx
  on public.client_assignment_history(client_id, changed_at desc);

create function private.capture_client_assignment_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
begin
  if old.assigned_to is not distinct from new.assigned_to then
    return new;
  end if;

  select profile.id into v_actor
  from public.profiles as profile
  where profile.id = private.auth_profile_id()
    and profile.disabled_at is null
    and profile.role in ('operator_member'::public.app_role, 'platform_admin'::public.app_role);

  insert into public.client_assignment_history (
    org_id, client_id, from_user, to_user, changed_by, changed_at
  ) values (
    new.org_id, new.id, old.assigned_to, new.assigned_to, v_actor, now()
  );

  insert into public.audit_log (
    org_id, client_id, actor_profile_id, action, subject_type, subject_id, meta
  ) values (
    new.org_id,
    new.id,
    v_actor,
    'client.assignment_changed',
    'client',
    new.id,
    jsonb_build_object(
      'from_state', coalesce(old.assigned_to::text, 'unassigned'),
      'to_state', coalesce(new.assigned_to::text, 'unassigned')
    )
  );

  return new;
end;
$$;

create trigger clients_capture_assignment_change
after update of assigned_to on public.clients
for each row
when (old.assigned_to is distinct from new.assigned_to)
execute function private.capture_client_assignment_change();

create trigger client_assignment_history_immutable
before update or delete on public.client_assignment_history
for each row execute function private.prevent_row_change();

create trigger client_assignment_history_no_truncate
before truncate on public.client_assignment_history
for each statement execute function public.append_only_guard();
alter table public.client_assignment_history
  enable always trigger client_assignment_history_no_truncate;

alter table public.client_assignment_history enable row level security;
alter table public.client_assignment_history force row level security;

revoke all on table public.client_assignment_history from public, anon, authenticated;
grant select on table public.client_assignment_history to authenticated;
grant all on table public.client_assignment_history to service_role;
revoke truncate on table public.client_assignment_history from public, anon, authenticated, service_role;

create policy client_assignment_history_select_operator
on public.client_assignment_history
for select
to authenticated
using (
  (select private.auth_app_role()) in (
    'operator_member'::public.app_role,
    'platform_admin'::public.app_role
  )
  and (select private.can_access_client(client_id))
);

create policy client_assignment_history_service_all
on public.client_assignment_history
for all
to service_role
using (true)
with check (true);
