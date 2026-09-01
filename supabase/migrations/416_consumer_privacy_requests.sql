-- Consumer data-access and deletion requests. Deletion completion is deliberately
-- split across the provider/storage service and one final database transaction:
-- the database refuses to anonymize while a provider obligation or private
-- storage object remains, and it independently verifies the auth-provider result.

begin;

create type public.privacy_request_kind as enum ('access', 'deletion');
create type public.privacy_request_status as enum (
  'submitted',
  'in_review',
  'denied',
  'completed'
);

create table public.privacy_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  profile_id uuid not null,
  org_id uuid not null,
  client_id uuid not null,
  kind public.privacy_request_kind not null,
  status public.privacy_request_status not null default 'submitted',
  submitted_at timestamptz not null default pg_catalog.now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete restrict,
  denied_at timestamptz,
  denied_by uuid references public.profiles(id) on delete restrict,
  denial_reason text,
  completed_at timestamptz,
  completed_by uuid references public.profiles(id) on delete restrict,
  completion_note text,
  updated_at timestamptz not null default pg_catalog.now(),
  constraint privacy_requests_profile_org_fk
    foreign key (profile_id, org_id)
    references public.profiles(id, org_id) on delete restrict,
  constraint privacy_requests_client_org_fk
    foreign key (client_id, org_id)
    references public.clients(id, org_id) on delete restrict,
  constraint privacy_requests_denial_reason_bound check (
    denial_reason is null
    or (
      char_length(denial_reason) between 1 and 500
      and denial_reason = pg_catalog.btrim(denial_reason)
    )
  ),
  constraint privacy_requests_completion_note_bound check (
    completion_note is null
    or (
      char_length(completion_note) between 1 and 1000
      and completion_note = pg_catalog.btrim(completion_note)
    )
  ),
  constraint privacy_requests_state_shape check (
    (
      status = 'submitted'
      and reviewed_at is null and reviewed_by is null
      and denied_at is null and denied_by is null and denial_reason is null
      and completed_at is null and completed_by is null and completion_note is null
    )
    or (
      status = 'in_review'
      and reviewed_at is not null and reviewed_by is not null
      and denied_at is null and denied_by is null and denial_reason is null
      and completed_at is null and completed_by is null and completion_note is null
    )
    or (
      status = 'denied'
      and reviewed_at is not null and reviewed_by is not null
      and denied_at is not null and denied_by is not null and denial_reason is not null
      and completed_at is null and completed_by is null and completion_note is null
    )
    or (
      status = 'completed'
      and reviewed_at is not null and reviewed_by is not null
      and denied_at is null and denied_by is null and denial_reason is null
      and completed_at is not null and completed_by is not null and completion_note is not null
    )
  )
);

create unique index privacy_requests_one_open_kind
  on public.privacy_requests(profile_id, kind)
  where status in ('submitted', 'in_review');
create index privacy_requests_admin_queue
  on public.privacy_requests(status, submitted_at, id);
create index privacy_requests_profile_history
  on public.privacy_requests(profile_id, submitted_at desc, id desc);

alter table public.privacy_requests enable row level security;
alter table public.privacy_requests force row level security;

revoke all on table public.privacy_requests
  from public, anon, authenticated, service_role;
grant select on table public.privacy_requests to authenticated, service_role;

create policy privacy_requests_select_scoped
on public.privacy_requests
for select
to authenticated
using (
  profile_id = (select auth.uid())
  or (select private.auth_app_role()) = 'platform_admin'
);

create trigger privacy_requests_no_delete
before delete on public.privacy_requests
for each row execute function public.append_only_guard();
alter table public.privacy_requests enable always trigger privacy_requests_no_delete;

create trigger privacy_requests_no_truncate
before truncate on public.privacy_requests
for each statement execute function public.append_only_guard();
alter table public.privacy_requests enable always trigger privacy_requests_no_truncate;
revoke truncate on table public.privacy_requests
  from public, anon, authenticated, service_role;

create or replace function private.privacy_erasure_blockers(p_client_id uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(pg_catalog.array_agg(blocker.code order by blocker.code), array[]::text[])
  from (
    select 'active_subscription'::text as code
    where exists (
      select 1 from public.consumer_subscriptions as subscription
      where subscription.client_id = p_client_id
        and subscription.status = 'active'
    )
    union all
    select 'billing_cancellation_required'::text
    where exists (
      select 1 from public.consumer_subscriptions as subscription
      where subscription.client_id = p_client_id
        and subscription.status <> 'cancelled'
        and subscription.status <> 'active'
    )
    union all
    select 'provider_cancellation_pending'::text
    where exists (
      select 1 from public.consumer_subscriptions as subscription
      where subscription.client_id = p_client_id
        and coalesce(
          subscription.subscription_ref,
          subscription.attempt_provider_subscription_ref
        ) is not null
        and (
          subscription.provider_cancel_ref is null
          or subscription.provider_cancel_completed_at is null
        )
    )
    union all
    select 'enrollment_cancellation_required'::text
    where exists (
      select 1 from public.enrollments as enrollment
      where enrollment.client_id = p_client_id
        and enrollment.status <> 'cancelled'
    )
    union all
    select 'monitoring_provider_cleanup_pending'::text
    where exists (
      select 1 from public.enrollments as enrollment
      where enrollment.client_id = p_client_id
        and enrollment.crs_member_ref is not null
    )
  ) as blocker
$fn$;

revoke all on function private.privacy_erasure_blockers(uuid)
  from public, anon, authenticated, service_role;

-- Stored object paths end with the caller's sanitized filename, which can still
-- contain a person's name. Preserve the ordinary identity guard exactly, with
-- one owner-only erasure branch that replaces that final metadata identifier
-- after the object itself has been proved absent.
create or replace function private.document_upload_identity_immutable()
returns trigger
language plpgsql
set search_path = ''
as $fn$
declare
  v_owner name;
begin
  select pg_catalog.pg_get_userbyid(relation.relowner)
  into v_owner
  from pg_catalog.pg_class as relation
  where relation.oid = tg_relid;

  if pg_catalog.current_setting('app.privacy_erasure', true) = 'on'
    and current_user = v_owner
    and new.id is not distinct from old.id
    and new.org_id is not distinct from old.org_id
    and new.client_id is not distinct from old.client_id
    and new.kind is not distinct from old.kind
    and new.section is not distinct from old.section
    and new.bucket is not distinct from old.bucket
    and new.object_path = new.org_id::text || '/' || new.client_id::text || '/' || new.id::text || '/deleted-document'
    and new.display_name = 'Deleted document'
    and new.mime_type is not distinct from old.mime_type
    and new.size_bytes is not distinct from old.size_bytes
    and new.derived_features is null
    and new.uploaded_by is not distinct from old.uploaded_by
    and new.created_at is not distinct from old.created_at
    and new.failure_code = 'privacy_erased'
    and (
      (new.kind = 'company' and new.lifecycle = 'failed' and new.purged_at is null)
      or (new.kind = 'credit_report' and new.lifecycle = 'purged' and new.purged_at is not null)
    ) then
    return new;
  end if;

  if new.id <> old.id
    or new.org_id <> old.org_id
    or new.client_id <> old.client_id
    or new.kind <> old.kind
    or new.bucket <> old.bucket
    or new.object_path <> old.object_path
    or new.uploaded_by <> old.uploaded_by
    or new.created_at <> old.created_at then
    raise exception using errcode = 'P0001', message = 'DOCUMENT_UPLOAD_IDENTITY_IMMUTABLE';
  end if;
  return new;
end;
$fn$;

revoke all on function private.document_upload_identity_immutable()
  from public, anon, authenticated, service_role;

-- Application notes are a second consumer/staff message stream. They remain
-- append-only for every ordinary caller, but the final erasure transaction may
-- replace only their body with the fixed tombstone while preserving authorship,
-- attestation, and event time.
create function private.application_note_privacy_guard()
returns trigger
language plpgsql
set search_path = ''
as $fn$
declare
  v_owner name;
begin
  select pg_catalog.pg_get_userbyid(relation.relowner)
  into v_owner
  from pg_catalog.pg_class as relation
  where relation.oid = tg_relid;

  if tg_op = 'UPDATE'
    and pg_catalog.current_setting('app.privacy_erasure', true) = 'on'
    and current_user = v_owner
    and new.id is not distinct from old.id
    and new.application_id is not distinct from old.application_id
    and new.author_profile_id is not distinct from old.author_profile_id
    and new.author_kind is not distinct from old.author_kind
    and new.attested is not distinct from old.attested
    and new.created_at is not distinct from old.created_at
    and new.body = 'Message removed following privacy request.' then
    return new;
  end if;

  raise exception '% rows are append-only', tg_table_name;
end;
$fn$;

revoke all on function private.application_note_privacy_guard()
  from public, anon, authenticated, service_role;
drop trigger application_notes_prevent_change on public.application_notes;
create trigger application_notes_prevent_change
before update or delete on public.application_notes
for each row execute function private.application_note_privacy_guard();

-- A request is ordinary mutable workflow only while its client is active. The
-- deletion transaction redacts the prose before archiving the client; after
-- that point this guard prevents a later fulfilment edit from reintroducing PII.
create function private.document_request_active_client_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if not exists (
    select 1
    from public.clients as client
    where client.id = new.client_id
      and client.org_id = new.org_id
      and client.status = 'active'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'DOCUMENT_REQUEST_CLIENT_INACTIVE';
  end if;
  return new;
end
$fn$;

revoke all on function private.document_request_active_client_guard()
  from public, anon, authenticated, service_role;

create trigger document_requests_active_client_guard
before insert or update on public.document_requests
for each row execute function private.document_request_active_client_guard();

create function public.privacy_submit_request(
  p_actor uuid,
  p_kind public.privacy_request_kind
)
returns setof public.privacy_requests
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor public.profiles;
  v_client public.clients;
  v_request public.privacy_requests;
  v_at timestamptz := pg_catalog.clock_timestamp();
begin
  select profile.* into v_actor
  from public.profiles as profile
  where profile.id = p_actor
    and profile.role = 'consumer'
    and profile.org_id is not null
    and profile.disabled_at is null;
  if v_actor.id is null then
    raise exception using errcode = '42501', message = 'PRIVACY_CONSUMER_REQUIRED';
  end if;

  select client.* into v_client
  from public.clients as client
  where client.consumer_profile_id = v_actor.id
    and client.org_id = v_actor.org_id;
  if v_client.id is null then
    raise exception using errcode = 'P0002', message = 'PRIVACY_CLIENT_NOT_FOUND';
  end if;

  insert into public.privacy_requests (
    profile_id, org_id, client_id, kind, submitted_at, updated_at
  ) values (
    v_actor.id, v_actor.org_id, v_client.id, p_kind, v_at, v_at
  )
  on conflict (profile_id, kind)
    where status in ('submitted', 'in_review')
    do nothing
  returning * into v_request;

  if v_request.id is not null then
    insert into public.audit_log (
      org_id, client_id, actor_profile_id, action,
      subject_type, subject_id, occurred_at, meta
    ) values (
      v_actor.org_id, v_client.id, v_actor.id, 'privacy.request.submitted',
      'privacy_request', v_request.id, v_at,
      pg_catalog.jsonb_build_object('source', p_kind::text, 'status', 'submitted')
    );
  else
    select request.* into strict v_request
    from public.privacy_requests as request
    where request.profile_id = v_actor.id
      and request.kind = p_kind
      and request.status in ('submitted', 'in_review')
    for update;
  end if;

  return next v_request;
end
$fn$;

create function public.privacy_list_requests(
  p_actor uuid,
  p_limit integer default 100
)
returns table (
  id uuid,
  kind public.privacy_request_kind,
  status public.privacy_request_status,
  consumer_name text,
  consumer_email text,
  organization_name text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  denied_at timestamptz,
  denial_reason text,
  completed_at timestamptz,
  completion_note text,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_actor public.profiles;
begin
  select profile.* into v_actor
  from public.profiles as profile
  where profile.id = p_actor and profile.disabled_at is null;
  if v_actor.id is null or v_actor.role not in ('consumer', 'platform_admin') then
    raise exception using errcode = '42501', message = 'PRIVACY_READ_FORBIDDEN';
  end if;
  if p_limit is null or p_limit not between 1 and 200 then
    raise exception using errcode = '22023', message = 'PRIVACY_LIMIT_INVALID';
  end if;

  return query
  select
    request.id,
    request.kind,
    request.status,
    profile.full_name,
    profile.email,
    organization.name,
    request.submitted_at,
    request.reviewed_at,
    request.denied_at,
    request.denial_reason,
    request.completed_at,
    request.completion_note,
    request.updated_at
  from public.privacy_requests as request
  join public.profiles as profile on profile.id = request.profile_id
  join public.orgs as organization on organization.id = request.org_id
  where v_actor.role = 'platform_admin'
    or request.profile_id = v_actor.id
  order by request.submitted_at desc, request.id desc
  limit p_limit;
end
$fn$;

create function public.privacy_review_request(p_request_id uuid, p_actor uuid)
returns setof public.privacy_requests
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_request public.privacy_requests;
  v_at timestamptz := pg_catalog.clock_timestamp();
begin
  if not exists (
    select 1 from public.profiles as actor
    where actor.id = p_actor
      and actor.role = 'platform_admin'
      and actor.disabled_at is null
  ) then
    raise exception using errcode = '42501', message = 'PRIVACY_ADMIN_REQUIRED';
  end if;

  select request.* into v_request
  from public.privacy_requests as request
  where request.id = p_request_id for update;
  if v_request.id is null then
    raise exception using errcode = 'P0002', message = 'PRIVACY_REQUEST_NOT_FOUND';
  end if;
  if v_request.status = 'in_review' then return next v_request; return; end if;
  if v_request.status <> 'submitted' then
    raise exception using errcode = 'P0001', message = 'PRIVACY_REQUEST_CLOSED';
  end if;

  update public.privacy_requests
  set status = 'in_review', reviewed_at = v_at, reviewed_by = p_actor, updated_at = v_at
  where id = v_request.id returning * into strict v_request;
  insert into public.audit_log (
    org_id, client_id, actor_profile_id, action,
    subject_type, subject_id, occurred_at, meta
  ) values (
    v_request.org_id, v_request.client_id, p_actor, 'privacy.request.reviewed',
    'privacy_request', v_request.id, v_at,
    pg_catalog.jsonb_build_object('source', v_request.kind::text, 'status', 'in_review')
  );
  return next v_request;
end
$fn$;

create function public.privacy_deny_request(
  p_request_id uuid,
  p_actor uuid,
  p_reason text
)
returns setof public.privacy_requests
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_request public.privacy_requests;
  v_reason text := pg_catalog.btrim(p_reason);
  v_at timestamptz := pg_catalog.clock_timestamp();
begin
  if not exists (
    select 1 from public.profiles as actor
    where actor.id = p_actor
      and actor.role = 'platform_admin'
      and actor.disabled_at is null
  ) then
    raise exception using errcode = '42501', message = 'PRIVACY_ADMIN_REQUIRED';
  end if;
  if p_reason is null or char_length(v_reason) not between 1 and 500 then
    raise exception using errcode = '22023', message = 'PRIVACY_DENIAL_REASON_INVALID';
  end if;

  select request.* into v_request
  from public.privacy_requests as request
  where request.id = p_request_id for update;
  if v_request.id is null then
    raise exception using errcode = 'P0002', message = 'PRIVACY_REQUEST_NOT_FOUND';
  end if;
  if v_request.status <> 'in_review' then
    raise exception using errcode = 'P0001', message = 'PRIVACY_REQUEST_NOT_IN_REVIEW';
  end if;

  update public.privacy_requests
  set status = 'denied', denied_at = v_at, denied_by = p_actor,
      denial_reason = v_reason, updated_at = v_at
  where id = v_request.id returning * into strict v_request;
  insert into public.audit_log (
    org_id, client_id, actor_profile_id, action,
    subject_type, subject_id, occurred_at, meta
  ) values (
    v_request.org_id, v_request.client_id, p_actor, 'privacy.request.denied',
    'privacy_request', v_request.id, v_at,
    pg_catalog.jsonb_build_object('source', v_request.kind::text, 'status', 'denied')
  );
  return next v_request;
end
$fn$;

create function public.privacy_complete_access_request(
  p_request_id uuid,
  p_actor uuid,
  p_completion_note text
)
returns setof public.privacy_requests
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_request public.privacy_requests;
  v_note text := pg_catalog.btrim(p_completion_note);
  v_at timestamptz := pg_catalog.clock_timestamp();
begin
  if not exists (
    select 1 from public.profiles as actor
    where actor.id = p_actor
      and actor.role = 'platform_admin'
      and actor.disabled_at is null
  ) then
    raise exception using errcode = '42501', message = 'PRIVACY_ADMIN_REQUIRED';
  end if;
  if p_completion_note is null or char_length(v_note) not between 1 and 1000 then
    raise exception using errcode = '22023', message = 'PRIVACY_COMPLETION_NOTE_INVALID';
  end if;

  select request.* into v_request
  from public.privacy_requests as request
  where request.id = p_request_id for update;
  if v_request.id is null then
    raise exception using errcode = 'P0002', message = 'PRIVACY_REQUEST_NOT_FOUND';
  end if;
  if v_request.kind <> 'access' or v_request.status <> 'in_review' then
    raise exception using errcode = 'P0001', message = 'PRIVACY_ACCESS_COMPLETION_FORBIDDEN';
  end if;

  update public.privacy_requests
  set status = 'completed', completed_at = v_at, completed_by = p_actor,
      completion_note = v_note, updated_at = v_at
  where id = v_request.id returning * into strict v_request;
  insert into public.audit_log (
    org_id, client_id, actor_profile_id, action,
    subject_type, subject_id, occurred_at, meta
  ) values (
    v_request.org_id, v_request.client_id, p_actor, 'privacy.request.access_completed',
    'privacy_request', v_request.id, v_at,
    pg_catalog.jsonb_build_object('source', 'access', 'status', 'completed')
  );
  return next v_request;
end
$fn$;

-- Server-only preflight. Storage coordinates never cross the HTTP response;
-- they are consumed by the completion service and rechecked by the final RPC.
create function public.privacy_request_erasure_targets(
  p_request_id uuid,
  p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_request public.privacy_requests;
  v_targets jsonb;
begin
  if not exists (
    select 1 from public.profiles as actor
    where actor.id = p_actor
      and actor.role = 'platform_admin'
      and actor.disabled_at is null
  ) then
    raise exception using errcode = '42501', message = 'PRIVACY_ADMIN_REQUIRED';
  end if;

  select request.* into v_request
  from public.privacy_requests as request
  where request.id = p_request_id for update;
  if v_request.id is null then
    raise exception using errcode = 'P0002', message = 'PRIVACY_REQUEST_NOT_FOUND';
  end if;
  if v_request.kind <> 'deletion' or v_request.status <> 'in_review' then
    raise exception using errcode = 'P0001', message = 'PRIVACY_DELETION_COMPLETION_FORBIDDEN';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'bucket', object.bucket_id,
        'objectPath', object.name
      ) order by object.bucket_id, object.name
    ),
    '[]'::jsonb
  ) into v_targets
  from storage.objects as object
  where object.bucket_id in ('client-documents', 'credit-reports')
    and object.name like v_request.org_id::text || '/' || v_request.client_id::text || '/%';

  return pg_catalog.jsonb_build_object(
    'profileId', v_request.profile_id,
    'pseudonymEmail', 'deleted+' || replace(v_request.profile_id::text, '-', '') || '@privacy.invalid',
    'blockers', pg_catalog.to_jsonb(private.privacy_erasure_blockers(v_request.client_id)),
    'targets', v_targets
  );
end
$fn$;

create function public.privacy_complete_deletion_request(
  p_request_id uuid,
  p_actor uuid
)
returns setof public.privacy_requests
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_request public.privacy_requests;
  v_profile public.profiles;
  v_client public.clients;
  v_auth auth.users;
  v_blockers text[];
  v_email text;
  v_at timestamptz := pg_catalog.clock_timestamp();
  v_previous_marker text := pg_catalog.current_setting('app.governed_client_write', true);
  v_previous_privacy_marker text := pg_catalog.current_setting('app.privacy_erasure', true);
begin
  if not exists (
    select 1 from public.profiles as actor
    where actor.id = p_actor
      and actor.role = 'platform_admin'
      and actor.disabled_at is null
  ) then
    raise exception using errcode = '42501', message = 'PRIVACY_ADMIN_REQUIRED';
  end if;

  select request.* into v_request
  from public.privacy_requests as request
  where request.id = p_request_id for update;
  if v_request.id is null then
    raise exception using errcode = 'P0002', message = 'PRIVACY_REQUEST_NOT_FOUND';
  end if;
  if v_request.kind <> 'deletion' or v_request.status <> 'in_review' then
    raise exception using errcode = 'P0001', message = 'PRIVACY_DELETION_COMPLETION_FORBIDDEN';
  end if;

  select profile.* into v_profile
  from public.profiles as profile
  where profile.id = v_request.profile_id for update;
  select client.* into v_client
  from public.clients as client
  where client.id = v_request.client_id for update;
  if v_profile.id is null or v_profile.role <> 'consumer'
    or v_profile.org_id is distinct from v_request.org_id
    or v_client.id is null
    or v_client.org_id is distinct from v_request.org_id
    or v_client.consumer_profile_id is distinct from v_profile.id then
    raise exception using errcode = '42501', message = 'PRIVACY_REQUEST_SCOPE_INVALID';
  end if;

  v_blockers := private.privacy_erasure_blockers(v_client.id);
  if pg_catalog.cardinality(v_blockers) <> 0 then
    raise exception using
      errcode = 'P0001',
      message = 'PRIVACY_ERASURE_BLOCKED',
      detail = pg_catalog.array_to_string(v_blockers, ',');
  end if;

  if exists (
    select 1 from storage.objects as object
    where object.bucket_id in ('client-documents', 'credit-reports')
      and object.name like v_request.org_id::text || '/' || v_client.id::text || '/%'
  ) then
    raise exception using errcode = 'P0001', message = 'PRIVACY_STORAGE_NOT_EMPTY';
  end if;

  v_email := 'deleted+' || replace(v_profile.id::text, '-', '') || '@privacy.invalid';
  select auth_user.* into v_auth
  from auth.users as auth_user
  where auth_user.id = v_profile.id for update;
  if v_auth.id is null
    or v_auth.email is distinct from v_email
    or nullif(v_auth.phone, '') is not null
    or v_auth.banned_until is null
    or v_auth.banned_until <= v_at
    or v_auth.raw_user_meta_data -> 'privacy_erased' is distinct from 'true'::jsonb then
    raise exception using errcode = 'P0001', message = 'PRIVACY_AUTH_DISABLE_NOT_VERIFIED';
  end if;

  -- Every object has already been removed and verified. Metadata is redacted,
  -- not deleted, so immutable document-review evidence and foreign keys remain.
  perform pg_catalog.set_config('app.privacy_erasure', 'on', true);
  update public.operator_tasks
  set title = 'Deleted client task',
      notes = 'Task details removed following privacy request.'
  where client_id = v_client.id;

  -- This must precede upload tombstoning: a fulfilled request still validates
  -- its linked stored upload during the update, then becomes immutable when the
  -- client is archived at the end of this transaction.
  update public.document_requests
  set name = 'Deleted document request',
      why = 'Request details removed following privacy request.'
  where client_id = v_client.id;

  update public.document_uploads
  set object_path = org_id::text || '/' || client_id::text || '/' || id::text || '/deleted-document',
      display_name = 'Deleted document',
      derived_features = null,
      lifecycle = case
        when kind = 'credit_report' then 'purged'::public.document_upload_lifecycle
        else 'failed'::public.document_upload_lifecycle
      end,
      purged_at = case when kind = 'credit_report' then v_at else null end,
      failure_code = 'privacy_erased',
      updated_at = v_at
  where client_id = v_client.id;

  update public.support_threads
  set subject = 'Deleted consumer conversation'
  where client_id = v_client.id;
  update public.support_messages as message
  set body = 'Message removed following privacy request.'
  from public.support_threads as thread
  where message.thread_id = thread.id and thread.client_id = v_client.id;
  update public.held_drafts as draft
  set body = 'Draft removed following privacy request.'
  from public.support_threads as thread
  where draft.thread_id = thread.id and thread.client_id = v_client.id;

  update public.application_notes as note
  set body = 'Message removed following privacy request.'
  from public.applications as application
  where note.application_id = application.id
    and application.client_id = v_client.id;
  perform pg_catalog.set_config(
    'app.privacy_erasure',
    coalesce(v_previous_privacy_marker, ''),
    true
  );

  update public.invites
  set email = v_email,
      full_name = 'Deleted consumer',
      updated_at = v_at
  where accepted_profile_id = v_profile.id and kind = 'client';

  -- The provider API may merge user metadata instead of replacing the object.
  -- Its read-back must carry the erasure marker before this transaction starts;
  -- this final database step then removes any remaining consumer metadata.
  update auth.users
  set raw_user_meta_data = '{"privacy_erased":true}'::jsonb
  where id = v_profile.id;

  update public.profiles
  set full_name = 'Deleted consumer ' || left(v_profile.id::text, 8),
      email = v_email,
      phone = null,
      disabled_at = coalesce(disabled_at, v_at)
  where id = v_profile.id;

  perform pg_catalog.set_config('app.governed_client_write', 'on', true);
  update public.clients
  set business_name = null,
      display_name = 'Deleted client ' || left(v_client.id::text, 8),
      status = 'archived',
      archived_at = coalesce(archived_at, v_at),
      archived_by = coalesce(archived_by, p_actor)
  where id = v_client.id;
  perform pg_catalog.set_config(
    'app.governed_client_write',
    coalesce(v_previous_marker, ''),
    true
  );

  update public.privacy_requests
  set status = 'completed', completed_at = v_at, completed_by = p_actor,
      completion_note = 'Private files removed, provider access disabled, and direct account data pseudonymized.',
      updated_at = v_at
  where id = v_request.id returning * into strict v_request;

  insert into public.audit_log (
    org_id, client_id, actor_profile_id, action,
    subject_type, subject_id, occurred_at, meta
  ) values (
    v_request.org_id, v_request.client_id, p_actor, 'privacy.request.deletion_completed',
    'privacy_request', v_request.id, v_at,
    pg_catalog.jsonb_build_object(
      'source', 'deletion',
      'status', 'completed',
      'field_names', pg_catalog.jsonb_build_array('audit', 'billing', 'consent')
    )
  );
  return next v_request;
end
$fn$;

revoke all on function public.privacy_submit_request(uuid, public.privacy_request_kind)
  from public, anon, authenticated, service_role;
revoke all on function public.privacy_list_requests(uuid, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.privacy_review_request(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.privacy_deny_request(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.privacy_complete_access_request(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.privacy_request_erasure_targets(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.privacy_complete_deletion_request(uuid, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.privacy_submit_request(uuid, public.privacy_request_kind)
  to service_role;
grant execute on function public.privacy_list_requests(uuid, integer)
  to service_role;
grant execute on function public.privacy_review_request(uuid, uuid)
  to service_role;
grant execute on function public.privacy_deny_request(uuid, uuid, text)
  to service_role;
grant execute on function public.privacy_complete_access_request(uuid, uuid, text)
  to service_role;
grant execute on function public.privacy_request_erasure_targets(uuid, uuid)
  to service_role;
grant execute on function public.privacy_complete_deletion_request(uuid, uuid)
  to service_role;

commit;
