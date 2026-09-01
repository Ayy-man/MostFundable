create type public.client_status as enum ('active', 'archived');

alter table public.clients
  add column status public.client_status,
  add column archived_at timestamptz,
  add column archived_by uuid references public.profiles(id),
  add column last_activity_at timestamptz;

update public.clients as client
set last_activity_at = greatest(
  client.stage_entered_at,
  coalesce((select max(history.changed_at) from public.stage_history as history where history.client_id = client.id), '-infinity'::timestamptz),
  coalesce((select max(message.sent_at) from public.support_messages as message join public.support_threads as thread on thread.id = message.thread_id where thread.client_id = client.id), '-infinity'::timestamptz),
  coalesce((select max(greatest(outcome.created_at, coalesce(outcome.removed_at, '-infinity'::timestamptz))) from public.outcomes as outcome where outcome.client_id = client.id), '-infinity'::timestamptz),
  coalesce((select max(greatest(upload.created_at, upload.updated_at)) from public.document_uploads as upload where upload.client_id = client.id), '-infinity'::timestamptz),
  coalesce((select max(greatest(coalesce(state.reported_at, '-infinity'::timestamptz), coalesce(state.verifying_at, '-infinity'::timestamptz), coalesce(state.verified_at, '-infinity'::timestamptz))) from public.checklist_item_state as state where state.client_id = client.id), '-infinity'::timestamptz)
), status = 'active';

alter table public.clients
  alter column status set default 'active',
  alter column status set not null,
  alter column last_activity_at set default statement_timestamp(),
  alter column last_activity_at set not null,
  add constraint clients_archive_shape check (
    (status = 'active' and archived_at is null and archived_by is null)
    or (status = 'archived' and archived_at is not null and archived_by is not null)
  );

create index clients_org_status_stage_idx
  on public.clients(org_id, status, stage, created_at, id);

create function private.advance_client_activity(p_client_id uuid, p_event_at timestamptz)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.clients
  set last_activity_at = greatest(last_activity_at, p_event_at)
  where id = p_client_id and p_event_at is not null
$$;

create function private.stage_history_client_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.advance_client_activity(new.client_id, new.changed_at);
  return new;
end;
$$;

create trigger stage_history_client_activity
after insert on public.stage_history
for each row execute function private.stage_history_client_activity();

create function private.support_message_client_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_client_id uuid;
begin
  select thread.client_id into v_client_id
  from public.support_threads as thread where thread.id = new.thread_id;
  if v_client_id is not null then
    perform private.advance_client_activity(v_client_id, new.sent_at);
  end if;
  return new;
end;
$$;

create trigger support_messages_client_activity
after insert on public.support_messages
for each row execute function private.support_message_client_activity();

create function private.outcome_client_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.advance_client_activity(new.client_id, greatest(new.created_at, coalesce(new.removed_at, '-infinity'::timestamptz)));
  return new;
end;
$$;

create trigger outcomes_client_activity
after insert or update of removed_at on public.outcomes
for each row execute function private.outcome_client_activity();

create function private.document_upload_client_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.advance_client_activity(new.client_id, greatest(new.created_at, new.updated_at));
  return new;
end;
$$;

create trigger document_uploads_client_activity
after insert or update of updated_at on public.document_uploads
for each row execute function private.document_upload_client_activity();

create function private.checklist_state_client_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_event_at timestamptz;
begin
  v_event_at := greatest(new.reported_at, new.verifying_at, new.verified_at);
  if tg_op = 'INSERT' and v_event_at is null then
    v_event_at := statement_timestamp();
  end if;
  perform private.advance_client_activity(new.client_id, v_event_at);
  return new;
end;
$$;

create trigger checklist_item_state_client_activity
after insert or update of state, reported_at, verifying_at, verified_at on public.checklist_item_state
for each row execute function private.checklist_state_client_activity();

create function public.tracker_client_health(
  p_stage public.client_stage,
  p_stage_entered_at timestamptz,
  p_last_activity_at timestamptz,
  p_now timestamptz default statement_timestamp()
)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p_now >= p_last_activity_at + interval '14 days' then 'red'
    when p_stage in ('optimization', 'applying') and p_now > p_stage_entered_at + interval '60 days' then 'red'
    when p_stage in ('optimization', 'applying') and p_now >= p_stage_entered_at + interval '45 days' then 'amber'
    else 'green'
  end
$$;

create function public.tracker_client_health_batch(
  p_client_ids uuid[],
  p_now timestamptz default statement_timestamp()
)
returns table(client_id uuid, health text, health_rank integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select client.id,
    value.health,
    case value.health when 'red' then 0 when 'amber' then 1 else 2 end
  from public.clients as client
  cross join lateral (
    select public.tracker_client_health(client.stage, client.stage_entered_at, client.last_activity_at, p_now) as health
  ) as value
  where client.id = any(coalesce(p_client_ids, array[]::uuid[]))
$$;

create function public.set_client_status(
  p_client_id uuid,
  p_status public.client_status,
  p_actor uuid
)
returns setof public.clients
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles;
  v_client public.clients;
  v_org public.orgs;
  v_authorized boolean := false;
  v_at timestamptz;
  v_old public.client_status;
begin
  select client.* into v_client from public.clients as client
  where client.id = p_client_id for update;
  if v_client.id is null then
    raise exception using errcode = 'P0002', message = 'CLIENT_NOT_FOUND';
  end if;

  select profile.* into v_actor from public.profiles as profile where profile.id = p_actor;
  select organization.* into v_org from public.orgs as organization where organization.id = v_client.org_id;

  if v_actor.id is not null
    and v_actor.role = 'operator_member'
    and v_actor.org_id = v_client.org_id then
    v_authorized := v_org.team_sees_all_clients
      or v_client.assigned_to = v_actor.id
      or v_actor.org_role in ('owner', 'admin', 'commando')
      or (
        v_actor.org_role = 'manager'
        and exists (
          select 1 from public.profiles as managed
          where managed.id = v_client.assigned_to
            and managed.org_id = v_actor.org_id
            and managed.role = 'operator_member'
            and managed.id = any(v_actor.manages)
        )
      );
  end if;

  if (select auth.role()) = 'authenticated' then
    v_authorized := v_authorized and p_actor = (select auth.uid());
  elsif (select auth.role()) <> 'service_role' then
    v_authorized := false;
  end if;

  if not v_authorized then
    raise exception using errcode = '42501', message = 'CLIENT_STATUS_FORBIDDEN';
  end if;

  if v_client.status = p_status then
    return next v_client;
    return;
  end if;

  v_at := clock_timestamp();
  v_old := v_client.status;
  update public.clients
  set status = p_status,
      archived_at = case when p_status = 'archived' then v_at else null end,
      archived_by = case when p_status = 'archived' then p_actor else null end
  where id = p_client_id
  returning * into strict v_client;

  insert into public.audit_log(
    org_id, client_id, actor_profile_id, action, subject_type, subject_id, occurred_at, meta
  ) values (
    v_client.org_id, v_client.id, p_actor, 'client.status.changed', 'client', v_client.id, v_at,
    jsonb_build_object('from', v_old::text, 'to', p_status::text)
  );

  return next v_client;
end;
$$;

revoke all on function private.advance_client_activity(uuid, timestamptz) from public;
revoke all on function public.tracker_client_health(public.client_stage, timestamptz, timestamptz, timestamptz) from public, anon;
revoke all on function public.tracker_client_health_batch(uuid[], timestamptz) from public, anon;
revoke all on function public.set_client_status(uuid, public.client_status, uuid) from public, anon;
grant execute on function public.tracker_client_health(public.client_stage, timestamptz, timestamptz, timestamptz) to authenticated, service_role;
grant execute on function public.tracker_client_health_batch(uuid[], timestamptz) to authenticated, service_role;
grant execute on function public.set_client_status(uuid, public.client_status, uuid) to authenticated, service_role;

comment on type public.client_status is
  'Phase 22 manual lifecycle state. Phase 21 cap counts must use where clients.status = active.';
