-- Document requests and the two narrow timeline source projections.

create table public.document_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete restrict,
  name text not null,
  why text not null,
  fulfilled_at timestamptz,
  fulfilled_upload_id uuid references public.document_uploads(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint document_requests_name_shape check (
    char_length(btrim(name)) between 2 and 120 and name = btrim(name)
  ),
  constraint document_requests_why_shape check (
    char_length(btrim(why)) between 2 and 500 and why = btrim(why)
  ),
  constraint document_requests_fulfilment_shape check (
    (fulfilled_at is null and fulfilled_upload_id is null)
    or (fulfilled_at is not null and fulfilled_upload_id is not null)
  )
);

create index document_requests_client_created_idx
  on public.document_requests(client_id, created_at desc);
create index document_requests_open_idx
  on public.document_requests(client_id, created_at)
  where fulfilled_at is null;

create function private.validate_document_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client_org uuid;
  v_requester_org uuid;
  v_requester_role public.app_role;
  v_upload record;
begin
  select client.org_id into v_client_org
  from public.clients as client
  where client.id = new.client_id;

  select profile.org_id, profile.role
    into v_requester_org, v_requester_role
  from public.profiles as profile
  where profile.id = new.requested_by and profile.disabled_at is null;

  if v_client_org is null
    or new.org_id is distinct from v_client_org
    or v_requester_org is distinct from new.org_id
    or v_requester_role is distinct from 'operator_member'::public.app_role
  then
    raise exception using errcode = '42501', message = 'DOCUMENT_REQUEST_SCOPE_INVALID';
  end if;

  if new.fulfilled_upload_id is not null then
    select upload.org_id, upload.client_id, upload.kind, upload.lifecycle
      into v_upload
    from public.document_uploads as upload
    where upload.id = new.fulfilled_upload_id;

    if v_upload.org_id is distinct from new.org_id
      or v_upload.client_id is distinct from new.client_id
      or v_upload.kind is distinct from 'company'::public.document_upload_kind
      or v_upload.lifecycle is distinct from 'stored'::public.document_upload_lifecycle
    then
      raise exception using errcode = '23514', message = 'DOCUMENT_REQUEST_UPLOAD_INVALID';
    end if;
  end if;

  return new;
end;
$$;

create trigger document_requests_validate
before insert or update on public.document_requests
for each row execute function private.validate_document_request();

create function private.audit_document_request_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_log (
    org_id, client_id, actor_profile_id, action, subject_type, subject_id, meta
  ) values (
    new.org_id,
    new.client_id,
    new.requested_by,
    'document_request.created',
    'document_request',
    new.id,
    jsonb_build_object('status', case when new.fulfilled_at is null then 'open' else 'fulfilled' end)
  );
  return new;
end;
$$;

create trigger document_requests_audit_created
after insert on public.document_requests
for each row execute function private.audit_document_request_created();

create function private.fulfil_matching_document_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_upload_name text;
begin
  if new.kind is distinct from 'company'::public.document_upload_kind
    or new.lifecycle is distinct from 'stored'::public.document_upload_lifecycle
    or (tg_op = 'UPDATE' and old.lifecycle = new.lifecycle)
  then
    return new;
  end if;

  v_upload_name := lower(regexp_replace(regexp_replace(new.display_name, '\.[^.]+$', ''), '[^a-z0-9]+', '', 'g'));

  update public.document_requests as request
  set fulfilled_at = new.created_at,
      fulfilled_upload_id = new.id
  where request.id = (
    select candidate.id
    from public.document_requests as candidate
    where candidate.org_id = new.org_id
      and candidate.client_id = new.client_id
      and candidate.fulfilled_at is null
      and position(
        lower(regexp_replace(candidate.name, '[^a-z0-9]+', '', 'g'))
        in v_upload_name
      ) > 0
    order by candidate.created_at, candidate.id
    limit 1
  );

  return new;
end;
$$;

create trigger document_uploads_fulfil_request
after insert or update of lifecycle on public.document_uploads
for each row execute function private.fulfil_matching_document_request();

alter table public.document_requests enable row level security;
alter table public.document_requests force row level security;

revoke all on table public.document_requests from public, anon, authenticated;
grant select on table public.document_requests to authenticated;
grant all on table public.document_requests to service_role;
revoke truncate on table public.document_requests from public, anon, authenticated, service_role;

create policy document_requests_select_accessible_client
on public.document_requests
for select
to authenticated
using ((select private.can_access_client(client_id)));

create policy document_requests_service_all
on public.document_requests
for all
to service_role
using (true)
with check (true);

-- Paid refresh storage contains provider and idempotency fields. This function
-- returns only the four fields the timeline contract can use.
create function public.timeline_paid_refreshes(p_client_id uuid)
returns table (
  id uuid,
  amount_cents integer,
  analysis_run_id uuid,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if private.auth_app_role() is null
    or private.auth_app_role() not in (
      'consumer'::public.app_role,
      'operator_member'::public.app_role,
      'platform_admin'::public.app_role
    )
    or not private.can_access_client(p_client_id)
  then
    raise exception using errcode = '42501', message = 'TIMELINE_CLIENT_FORBIDDEN';
  end if;

  return query
  select request.id, request.amount_cents, request.analysis_run_id, request.created_at
  from public.paid_refresh_requests as request
  where request.client_id = p_client_id
  order by request.created_at, request.id;
end;
$$;

-- Pull-cap rows remain unavailable to consumers. Operators receive only a
-- dated blocked attempt whose reset can be calculated from the active cap.
create function public.timeline_pull_blocks(p_client_id uuid)
returns table (
  id uuid,
  decided_at timestamptz,
  resets_on date
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if private.auth_app_role() is null
    or private.auth_app_role() not in (
      'operator_member'::public.app_role,
      'platform_admin'::public.app_role
    )
    or not private.can_access_client(p_client_id)
  then
    raise exception using errcode = '42501', message = 'TIMELINE_CLIENT_FORBIDDEN';
  end if;

  return query
  select
    attempt.id,
    attempt.decided_at,
    case attempt.reason
      when 'minimum_interval'::public.pull_cap_reason then
        (attempt.decided_at + make_interval(secs => cap.min_interval_seconds))::date
      when 'count_window'::public.pull_cap_reason then
        (attempt.decided_at + make_interval(secs => cap.count_window_seconds))::date
      else null
    end
  from public.pull_cap_attempts as attempt
  join public.pull_caps as cap on cap.client_id = attempt.client_id
  where attempt.client_id = p_client_id
    and not attempt.allowed
    and attempt.reason in (
      'minimum_interval'::public.pull_cap_reason,
      'count_window'::public.pull_cap_reason
    )
  order by attempt.decided_at, attempt.id;
end;
$$;

revoke all on function public.timeline_paid_refreshes(uuid) from public, anon;
revoke all on function public.timeline_pull_blocks(uuid) from public, anon;
grant execute on function public.timeline_paid_refreshes(uuid) to authenticated, service_role;
grant execute on function public.timeline_pull_blocks(uuid) to authenticated, service_role;
