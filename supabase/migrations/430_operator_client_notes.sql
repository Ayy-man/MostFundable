-- Private operator notes attached directly to a client. Notes are deliberately
-- separate from support messages: a consumer cannot read the table, and every
-- mutation runs through a service-only RPC that fixes tenant, actor, and audit
-- attribution in one database transaction.

begin;

create table public.client_notes (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete restrict,
  client_id uuid not null,
  request_id uuid not null,
  body text not null,
  created_by uuid not null,
  updated_by uuid not null,
  deleted_at timestamptz,
  deleted_by uuid,
  deletion_reason text,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint client_notes_client_org_fk
    foreign key (client_id, org_id)
    references public.clients(id, org_id)
    on delete cascade,
  constraint client_notes_created_by_org_fk
    foreign key (created_by, org_id)
    references public.profiles(id, org_id)
    on delete restrict,
  constraint client_notes_updated_by_org_fk
    foreign key (updated_by, org_id)
    references public.profiles(id, org_id)
    on delete restrict,
  constraint client_notes_deleted_by_org_fk
    foreign key (deleted_by, org_id)
    references public.profiles(id, org_id)
    on delete restrict,
  constraint client_notes_org_request_key unique (org_id, request_id),
  constraint client_notes_body_and_deletion_shape check (
    (
      deleted_at is null
      and deleted_by is null
      and deletion_reason is null
      and body = pg_catalog.btrim(body)
      and char_length(body) between 1 and 4000
    )
    or (
      deleted_at is not null
      and body = ''
      and (
        (deletion_reason = 'operator_delete' and deleted_by is not null)
        or (deletion_reason = 'privacy_erasure' and deleted_by is null)
      )
    )
  ),
  constraint client_notes_timestamp_order check (
    created_at <= updated_at
    and (deleted_at is null or created_at <= deleted_at)
  )
);

create index client_notes_client_created_idx
  on public.client_notes(client_id, created_at desc)
  where deleted_at is null;
create index client_notes_org_created_idx
  on public.client_notes(org_id, created_at desc)
  where deleted_at is null;

create function private.validate_client_note()
returns trigger
language plpgsql
set search_path = ''
as $fn$
declare
  v_privacy_erasure boolean := coalesce(
    pg_catalog.current_setting('app.privacy_erasure', true) = 'on',
    false
  );
  v_client public.clients;
begin
  if tg_op = 'UPDATE' and (
    new.id is distinct from old.id
    or new.org_id is distinct from old.org_id
    or new.client_id is distinct from old.client_id
    or new.request_id is distinct from old.request_id
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
  ) then
    raise exception using errcode = '42501', message = 'CLIENT_NOTE_IDENTITY_IMMUTABLE';
  end if;

  if tg_op = 'UPDATE' and old.deleted_at is not null then
    raise exception using errcode = '42501', message = 'CLIENT_NOTE_TOMBSTONE_IMMUTABLE';
  end if;

  -- Every ordinary write serializes on the client row. A privacy completion
  -- takes the same lock before archiving the client and completing its request,
  -- so a concurrent create is either erased inside that completion transaction
  -- or waits, observes the terminal state, and is refused. The trigger keeps
  -- this invariant true even for a table-owner write outside the RPCs.
  if not v_privacy_erasure then
    select client.* into v_client
    from public.clients as client
    where client.id = new.client_id and client.org_id = new.org_id
    for update;

    if v_client.id is null then
      raise exception using errcode = 'P0002', message = 'CLIENT_NOTES_NOT_FOUND';
    end if;
    if v_client.status <> 'active'::public.client_status
      or exists (
        select 1
        from public.privacy_requests as request
        where request.client_id = new.client_id
          and request.org_id = new.org_id
          and request.kind = 'deletion'::public.privacy_request_kind
          and request.status = 'completed'::public.privacy_request_status
      ) then
      raise exception using errcode = '55000', message = 'CLIENT_NOTES_WRITE_BLOCKED';
    end if;
    if tg_op = 'INSERT' and (
      select pg_catalog.count(*)
      from public.client_notes as existing
      where existing.client_id = new.client_id
        and existing.org_id = new.org_id
        and existing.deleted_at is null
    ) >= 100 then
      raise exception using errcode = '54000', message = 'CLIENT_NOTE_LIMIT_REACHED';
    end if;
  end if;

  if tg_op = 'INSERT' and not exists (
    select 1
    from public.profiles as creator
    where creator.id = new.created_by
      and creator.org_id = new.org_id
      and creator.role = 'operator_member'::public.app_role
      and creator.disabled_at is null
  ) then
    raise exception using errcode = '42501', message = 'CLIENT_NOTE_CREATOR_INVALID';
  end if;

  if not v_privacy_erasure and not exists (
    select 1
    from public.profiles as updater
    where updater.id = new.updated_by
      and updater.org_id = new.org_id
      and updater.role = 'operator_member'::public.app_role
      and updater.disabled_at is null
  ) then
    raise exception using errcode = '42501', message = 'CLIENT_NOTE_UPDATER_INVALID';
  end if;

  if not v_privacy_erasure and new.deleted_by is not null and not exists (
    select 1
    from public.profiles as deleter
    where deleter.id = new.deleted_by
      and deleter.org_id = new.org_id
      and deleter.role = 'operator_member'::public.app_role
      and deleter.disabled_at is null
  ) then
    raise exception using errcode = '42501', message = 'CLIENT_NOTE_DELETER_INVALID';
  end if;

  if new.deleted_at is null then
    new.body := pg_catalog.btrim(new.body);
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := pg_catalog.clock_timestamp();
  end if;
  return new;
end;
$fn$;

revoke all on function private.validate_client_note()
  from public, anon, authenticated, service_role;

create trigger client_notes_validate
before insert or update on public.client_notes
for each row execute function private.validate_client_note();

-- Deletion-request completion must not leave a second private prose stream
-- behind. The privacy workflow already owns the consumer-facing completion
-- audit; this trigger makes that completion fail atomically unless every live
-- client note body is erased as part of the same transaction.
create function private.erase_client_notes_after_privacy_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_previous_marker text :=
    pg_catalog.current_setting('app.privacy_erasure', true);
begin
  perform pg_catalog.set_config('app.privacy_erasure', 'on', true);
  update public.client_notes
  set
    body = '',
    deleted_at = pg_catalog.clock_timestamp(),
    deleted_by = null,
    deletion_reason = 'privacy_erasure'
  where org_id = new.org_id
    and client_id = new.client_id
    and deleted_at is null;
  perform pg_catalog.set_config(
    'app.privacy_erasure',
    coalesce(v_previous_marker, ''),
    true
  );
  return new;
exception
  when others then
    perform pg_catalog.set_config(
      'app.privacy_erasure',
      coalesce(v_previous_marker, ''),
      true
    );
    raise;
end;
$fn$;

revoke all on function private.erase_client_notes_after_privacy_request()
  from public, anon, authenticated, service_role;

create trigger privacy_requests_erase_client_notes
after update of status on public.privacy_requests
for each row
when (
  new.kind = 'deletion'::public.privacy_request_kind
  and new.status = 'completed'::public.privacy_request_status
  and old.status is distinct from new.status
)
execute function private.erase_client_notes_after_privacy_request();

create function private.client_notes_actor_valid(
  p_actor_id uuid,
  p_org_id uuid,
  p_for_write boolean
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.profiles as actor
    join public.orgs as organization on organization.id = actor.org_id
    where actor.id = p_actor_id
      and actor.org_id = p_org_id
      and actor.role = 'operator_member'::public.app_role
      and actor.disabled_at is null
      and (not p_for_write or organization.membership <> 'deactivated'::public.org_membership)
  )
$fn$;

revoke all on function private.client_notes_actor_valid(uuid, uuid, boolean)
  from public, anon, authenticated, service_role;

-- service_role has no auth.uid(), so its RPCs must re-express the established
-- private.can_access_client rules against the stored actor instead of treating
-- same-organization membership as permission to read every client.
create function private.client_notes_actor_can_access_client(
  p_actor_id uuid,
  p_org_id uuid,
  p_client_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(
    (
      select
        actor.role = 'operator_member'::public.app_role
        and actor.disabled_at is null
        and actor.org_id = p_org_id
        and client.org_id = p_org_id
        and (
          organization.team_sees_all_clients
          or client.assigned_to = actor.id
          or actor.org_role in (
            'owner'::public.org_role,
            'admin'::public.org_role,
            'commando'::public.org_role
          )
          or (
            actor.org_role = 'manager'::public.org_role
            and exists (
              select 1
              from public.profiles as managed
              where managed.id = client.assigned_to
                and managed.org_id = actor.org_id
                and managed.role = 'operator_member'::public.app_role
                and managed.disabled_at is null
                and managed.id = any(actor.manages)
            )
          )
        )
      from public.profiles as actor
      join public.clients as client on client.id = p_client_id
      join public.orgs as organization on organization.id = client.org_id
      where actor.id = p_actor_id
    ),
    false
  )
$fn$;

revoke all on function private.client_notes_actor_can_access_client(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

alter table public.client_notes enable row level security;
alter table public.client_notes force row level security;

create policy client_notes_operator_select
on public.client_notes
for select
to authenticated
using (
  deleted_at is null
  and (select private.auth_app_role()) = 'operator_member'::public.app_role
  and (select private.can_access_client(client_notes.client_id))
);

revoke all on table public.client_notes
  from public, anon, authenticated, service_role;
grant select on table public.client_notes to authenticated;

create trigger client_notes_no_truncate
before truncate on public.client_notes
for each statement execute function public.append_only_guard();
alter table public.client_notes enable always trigger client_notes_no_truncate;

create function private.client_note_projection(p_note public.client_notes)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select pg_catalog.jsonb_build_object(
    'body', p_note.body,
    'client_id', p_note.client_id,
    'created_at', p_note.created_at,
    'created_by_id', p_note.created_by,
    'created_by_name', creator.full_name,
    'id', p_note.id,
    'updated_at', p_note.updated_at,
    'updated_by_id', p_note.updated_by,
    'updated_by_name', updater.full_name
  )
  from public.profiles as creator
  join public.profiles as updater on updater.id = p_note.updated_by
  where creator.id = p_note.created_by
    and creator.org_id = p_note.org_id
    and updater.org_id = p_note.org_id
$fn$;

revoke all on function private.client_note_projection(public.client_notes)
  from public, anon, authenticated, service_role;

create function private.client_notes_write_blocked_reason(
  p_org_id uuid,
  p_client_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $fn$
  select case
    when exists (
      select 1
      from public.privacy_requests as request
      where request.org_id = p_org_id
        and request.client_id = p_client_id
        and request.kind = 'deletion'::public.privacy_request_kind
        and request.status = 'completed'::public.privacy_request_status
    ) then 'privacy_erased'
    when client.status = 'archived'::public.client_status then 'archived'
    else null
  end
  from public.clients as client
  where client.id = p_client_id and client.org_id = p_org_id
$fn$;

revoke all on function private.client_notes_write_blocked_reason(uuid, uuid)
  from public, anon, authenticated, service_role;

create function private.client_notes_lock_scope(
  p_org_id uuid,
  p_client_id uuid,
  p_actor_id uuid
)
returns public.clients
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_client public.clients;
begin
  if not private.client_notes_actor_valid(p_actor_id, p_org_id, true) then
    raise exception using errcode = '42501', message = 'CLIENT_NOTES_FORBIDDEN';
  end if;

  select client.* into v_client
  from public.clients as client
  where client.id = p_client_id and client.org_id = p_org_id
  for update;

  if v_client.id is null
    or not private.client_notes_actor_can_access_client(
      p_actor_id,
      p_org_id,
      p_client_id
    ) then
    raise exception using errcode = 'P0002', message = 'CLIENT_NOTES_NOT_FOUND';
  end if;
  return v_client;
end;
$fn$;

revoke all on function private.client_notes_lock_scope(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

-- There can be at most 100 live notes per client, enforced in the table
-- trigger while holding the client row lock. The list therefore returns every
-- retained live row rather than silently stranding rows behind a fixed limit.
create function public.client_notes_list(
  p_org_id uuid,
  p_client_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_client public.clients;
  v_notes jsonb;
begin
  if not private.client_notes_actor_valid(p_actor_id, p_org_id, false) then
    raise exception using errcode = '42501', message = 'CLIENT_NOTES_FORBIDDEN';
  end if;
  select client.* into v_client
  from public.clients as client
  where client.id = p_client_id and client.org_id = p_org_id;
  if v_client.id is null
    or not private.client_notes_actor_can_access_client(
      p_actor_id,
      p_org_id,
      p_client_id
    ) then
    raise exception using errcode = 'P0002', message = 'CLIENT_NOTES_NOT_FOUND';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      private.client_note_projection(note)
      order by note.created_at desc, note.id desc
    ),
    '[]'::jsonb
  ) into v_notes
  from public.client_notes as note
  where note.org_id = p_org_id
    and note.client_id = p_client_id
    and note.deleted_at is null;

  return pg_catalog.jsonb_build_object(
    'live_limit', 100,
    'notes', v_notes,
    'write_blocked_reason', private.client_notes_write_blocked_reason(
      p_org_id,
      p_client_id
    )
  );
end;
$fn$;

create function public.client_note_create(
  p_org_id uuid,
  p_client_id uuid,
  p_actor_id uuid,
  p_request_id uuid,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_body text := pg_catalog.btrim(p_body);
  v_client public.clients;
  v_inserted boolean := false;
  v_note public.client_notes;
begin
  if p_request_id is null or p_body is null
    or char_length(v_body) < 1 or char_length(v_body) > 4000 then
    raise exception using errcode = '22023', message = 'CLIENT_NOTE_BODY_INVALID';
  end if;
  v_client := private.client_notes_lock_scope(p_org_id, p_client_id, p_actor_id);

  -- A replay of a verified request returns the original durable projection.
  -- The request id is retained on tombstones, so it can never create twice.
  select note.* into v_note
  from public.client_notes as note
  where note.org_id = p_org_id and note.request_id = p_request_id
  for update;
  if v_note.id is not null then
    if v_note.deleted_at is not null then
      raise exception using errcode = '55000', message = 'CLIENT_NOTE_REQUEST_RETIRED';
    end if;
    if v_note.client_id is distinct from p_client_id
      or v_note.body is distinct from v_body then
      raise exception using errcode = '23505', message = 'CLIENT_NOTE_REQUEST_CONFLICT';
    end if;
    return private.client_note_projection(v_note);
  end if;

  if private.client_notes_write_blocked_reason(p_org_id, p_client_id) is not null then
    raise exception using errcode = '55000', message = 'CLIENT_NOTES_WRITE_BLOCKED';
  end if;

  insert into public.client_notes (
    org_id, client_id, request_id, body, created_by, updated_by
  ) values (
    p_org_id, p_client_id, p_request_id, v_body, p_actor_id, p_actor_id
  )
  on conflict (org_id, request_id) do nothing
  returning * into v_note;
  v_inserted := v_note.id is not null;

  if not v_inserted then
    select note.* into strict v_note
    from public.client_notes as note
    where note.org_id = p_org_id and note.request_id = p_request_id
    for update;
    if v_note.deleted_at is not null then
      raise exception using errcode = '55000', message = 'CLIENT_NOTE_REQUEST_RETIRED';
    end if;
    if v_note.client_id is distinct from p_client_id
      or v_note.body is distinct from v_body then
      raise exception using errcode = '23505', message = 'CLIENT_NOTE_REQUEST_CONFLICT';
    end if;
    return private.client_note_projection(v_note);
  end if;

  insert into public.audit_log (
    org_id, client_id, actor_profile_id, action, subject_type, subject_id, occurred_at, meta
  ) values (
    p_org_id, p_client_id, p_actor_id, 'client.note_created', 'client_note', v_note.id,
    pg_catalog.clock_timestamp(),
    pg_catalog.jsonb_build_object('field_names', pg_catalog.jsonb_build_array('body'))
  );
  return private.client_note_projection(v_note);
end;
$fn$;

create function public.client_note_update(
  p_org_id uuid,
  p_client_id uuid,
  p_note_id uuid,
  p_actor_id uuid,
  p_body text,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_body text := pg_catalog.btrim(p_body);
  v_client public.clients;
  v_note public.client_notes;
begin
  if p_body is null or char_length(v_body) < 1 or char_length(v_body) > 4000
    or p_expected_updated_at is null then
    raise exception using errcode = '22023', message = 'CLIENT_NOTE_UPDATE_INVALID';
  end if;
  v_client := private.client_notes_lock_scope(p_org_id, p_client_id, p_actor_id);

  select note.* into v_note
  from public.client_notes as note
  where note.id = p_note_id
    and note.org_id = p_org_id
    and note.client_id = p_client_id
  for update;

  if v_note.id is null then
    raise exception using errcode = 'P0002', message = 'CLIENT_NOTE_NOT_FOUND';
  end if;
  if private.client_notes_write_blocked_reason(p_org_id, p_client_id) is not null then
    raise exception using errcode = '55000', message = 'CLIENT_NOTES_WRITE_BLOCKED';
  end if;
  if v_note.deleted_at is not null then
    raise exception using errcode = 'P0002', message = 'CLIENT_NOTE_NOT_FOUND';
  end if;
  if v_note.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = '40001', message = 'CLIENT_NOTE_STALE';
  end if;
  -- A body match is only a safe no-op while the caller still holds the exact
  -- current version. A stale same-body request may be another operator's
  -- intervening edit and must never be acknowledged as this caller's write.
  if v_note.body is not distinct from v_body then
    return private.client_note_projection(v_note);
  end if;

  update public.client_notes
  set body = v_body, updated_by = p_actor_id
  where id = v_note.id
  returning * into strict v_note;

  insert into public.audit_log (
    org_id, client_id, actor_profile_id, action, subject_type, subject_id, occurred_at, meta
  ) values (
    p_org_id, p_client_id, p_actor_id, 'client.note_updated', 'client_note', v_note.id,
    pg_catalog.clock_timestamp(),
    pg_catalog.jsonb_build_object('field_names', pg_catalog.jsonb_build_array('body'))
  );
  return private.client_note_projection(v_note);
end;
$fn$;

create function public.client_note_delete(
  p_org_id uuid,
  p_client_id uuid,
  p_note_id uuid,
  p_actor_id uuid,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_client public.clients;
  v_note public.client_notes;
begin
  if p_expected_updated_at is null then
    raise exception using errcode = '22023', message = 'CLIENT_NOTE_DELETE_INVALID';
  end if;
  v_client := private.client_notes_lock_scope(p_org_id, p_client_id, p_actor_id);

  select note.* into v_note
  from public.client_notes as note
  where note.id = p_note_id
    and note.org_id = p_org_id
    and note.client_id = p_client_id
  for update;

  if v_note.id is null then
    raise exception using errcode = 'P0002', message = 'CLIENT_NOTE_NOT_FOUND';
  end if;
  if private.client_notes_write_blocked_reason(p_org_id, p_client_id) is not null then
    raise exception using errcode = '55000', message = 'CLIENT_NOTES_WRITE_BLOCKED';
  end if;
  if v_note.deleted_at is not null then
    -- Update timestamps make a lost-response replay stale. Without an explicit
    -- mutation request identity, any operator tombstone is insufficient proof
    -- that this caller performed the deletion.
    raise exception using errcode = '40001', message = 'CLIENT_NOTE_STALE';
  end if;
  if v_note.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = '40001', message = 'CLIENT_NOTE_STALE';
  end if;

  update public.client_notes
  set
    body = '',
    updated_by = p_actor_id,
    deleted_at = pg_catalog.clock_timestamp(),
    deleted_by = p_actor_id,
    deletion_reason = 'operator_delete'
  where id = v_note.id
  returning * into strict v_note;

  insert into public.audit_log (
    org_id, client_id, actor_profile_id, action, subject_type, subject_id, occurred_at, meta
  ) values (
    p_org_id, p_client_id, p_actor_id, 'client.note_deleted', 'client_note', v_note.id,
    pg_catalog.clock_timestamp(),
    pg_catalog.jsonb_build_object(
      'field_names', pg_catalog.jsonb_build_array('body', 'deleted_at')
    )
  );
  return pg_catalog.jsonb_build_object('deleted', true, 'id', v_note.id);
end;
$fn$;

revoke all on function public.client_notes_list(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.client_note_create(uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.client_note_update(uuid, uuid, uuid, uuid, text, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.client_note_delete(uuid, uuid, uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role;

grant execute on function public.client_notes_list(uuid, uuid, uuid)
  to service_role;
grant execute on function public.client_note_create(uuid, uuid, uuid, uuid, text)
  to service_role;
grant execute on function public.client_note_update(uuid, uuid, uuid, uuid, text, timestamptz)
  to service_role;
grant execute on function public.client_note_delete(uuid, uuid, uuid, uuid, timestamptz)
  to service_role;

comment on table public.client_notes is
  'Operator-private client notes. Consumers are denied by RLS; service-only audited RPCs own mutations.';

commit;
