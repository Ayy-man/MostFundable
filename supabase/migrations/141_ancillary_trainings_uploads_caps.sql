create type public.training_audience as enum ('client', 'operator');
create type public.training_source as enum ('operator', 'platform');
create type public.document_section as enum (
  'articles',
  'ein',
  'tax_returns',
  'bank_statements',
  'other'
);
create type public.document_upload_kind as enum ('company', 'credit_report');
create type public.document_upload_lifecycle as enum (
  'pending',
  'stored',
  'parsed',
  'delete_pending',
  'purged',
  'failed'
);
create type public.pull_cap_reason as enum ('minimum_interval', 'count_window');

create table public.trainings (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid references public.orgs(id) on delete cascade,
  audience public.training_audience not null,
  source public.training_source not null default 'operator',
  title text not null,
  video_url text not null,
  body text not null,
  published boolean not null default false,
  published_at timestamptz,
  published_by uuid references public.profiles(id),
  attested boolean not null default false,
  attested_at timestamptz,
  attestation_text text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trainings_source_scope check (
    (source = 'operator' and org_id is not null)
    or (source = 'platform' and org_id is null)
  ),
  constraint trainings_title_nonblank check (
    char_length(btrim(title)) between 1 and 200
  ),
  constraint trainings_video_url_nonblank check (
    char_length(btrim(video_url)) between 1 and 2048
  ),
  constraint trainings_body_nonblank check (
    char_length(btrim(body)) between 1 and 20000
  ),
  constraint trainings_publication_shape check (
    (
      not published
      and (
        published_at is null
        or (
          published_by is not null
          and attested
          and attested_at is not null
          and attestation_text is not null
          and char_length(btrim(attestation_text)) between 1 and 2000
        )
      )
    )
    or (
      published
      and published_at is not null
      and published_by is not null
      and attested
      and attested_at = published_at
      and attestation_text is not null
      and char_length(btrim(attestation_text)) between 1 and 2000
    )
  )
);

create index trainings_org_audience_published_idx
  on public.trainings(org_id, audience, published, updated_at desc);
create index trainings_platform_published_idx
  on public.trainings(audience, published, updated_at desc)
  where source = 'platform';

alter table public.trainings enable row level security;
alter table public.trainings force row level security;

revoke all on table public.trainings from public, anon, authenticated;
grant select on table public.trainings to authenticated;
grant all on table public.trainings to service_role;

create policy trainings_select_scoped
on public.trainings
for select
to authenticated
using (
  (select private.auth_app_role()) = 'platform_admin'
  or (
    (select private.auth_app_role()) = 'operator_member'
    and (source = 'platform' or org_id = (select private.auth_org_id()))
  )
  or (
    (select private.auth_app_role()) = 'consumer'
    and source = 'operator'
    and org_id = (select private.auth_org_id())
    and audience = 'client'
    and published
  )
);

create function public.publish_training(
  p_id uuid,
  p_actor uuid,
  p_attested boolean,
  p_attestation_text text
)
returns setof public.trainings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles;
  v_at timestamptz;
  v_training public.trainings;
begin
  select profile.* into v_actor
  from public.profiles as profile
  where profile.id = p_actor;

  if v_actor.id is null or v_actor.role not in ('platform_admin', 'operator_member') then
    raise exception using errcode = 'P0001', message = 'TRAINING_ACTOR_FORBIDDEN';
  end if;
  if p_attested is distinct from true
    or p_attestation_text is null
    or char_length(btrim(p_attestation_text)) not between 1 and 2000 then
    raise exception using errcode = 'P0001', message = 'TRAINING_ATTESTATION_REQUIRED';
  end if;

  select training.* into v_training
  from public.trainings as training
  where training.id = p_id
  for update;

  if v_training.id is null then
    raise exception using errcode = 'P0002', message = 'TRAINING_NOT_FOUND';
  end if;
  if v_actor.role = 'operator_member'
    and (v_training.source <> 'operator' or v_training.org_id <> v_actor.org_id) then
    raise exception using errcode = 'P0001', message = 'TRAINING_ACTOR_FORBIDDEN';
  end if;

  v_at := clock_timestamp();
  update public.trainings
  set published = true,
      published_at = v_at,
      published_by = p_actor,
      attested = true,
      attested_at = v_at,
      attestation_text = btrim(p_attestation_text),
      updated_at = v_at
  where id = p_id
  returning * into strict v_training;

  insert into public.audit_log (
    org_id, actor_profile_id, action, subject_type, subject_id, meta
  ) values (
    v_training.org_id,
    p_actor,
    'training.published',
    'training',
    v_training.id,
    jsonb_build_object('from_state', 'draft', 'to_state', 'published')
  );

  return next v_training;
end;
$$;

create function public.unpublish_training(p_id uuid, p_actor uuid)
returns setof public.trainings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles;
  v_training public.trainings;
begin
  select profile.* into v_actor
  from public.profiles as profile
  where profile.id = p_actor;

  if v_actor.id is null or v_actor.role not in ('platform_admin', 'operator_member') then
    raise exception using errcode = 'P0001', message = 'TRAINING_ACTOR_FORBIDDEN';
  end if;

  select training.* into v_training
  from public.trainings as training
  where training.id = p_id
  for update;

  if v_training.id is null then
    raise exception using errcode = 'P0002', message = 'TRAINING_NOT_FOUND';
  end if;
  if v_actor.role = 'operator_member'
    and (v_training.source <> 'operator' or v_training.org_id <> v_actor.org_id) then
    raise exception using errcode = 'P0001', message = 'TRAINING_ACTOR_FORBIDDEN';
  end if;

  update public.trainings
  set published = false,
      updated_at = clock_timestamp()
  where id = p_id
  returning * into strict v_training;

  insert into public.audit_log (
    org_id, actor_profile_id, action, subject_type, subject_id, meta
  ) values (
    v_training.org_id,
    p_actor,
    'training.unpublished',
    'training',
    v_training.id,
    jsonb_build_object('from_state', 'published', 'to_state', 'draft')
  );

  return next v_training;
end;
$$;

revoke all on function public.publish_training(uuid, uuid, boolean, text)
  from public, anon, authenticated;
revoke all on function public.unpublish_training(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.publish_training(uuid, uuid, boolean, text)
  to service_role;
grant execute on function public.unpublish_training(uuid, uuid)
  to service_role;

create table public.document_uploads (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  client_id uuid not null,
  kind public.document_upload_kind not null,
  section public.document_section,
  bucket text not null,
  object_path text not null unique,
  display_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  lifecycle public.document_upload_lifecycle not null default 'pending',
  derived_features jsonb,
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  purged_at timestamptz,
  failure_code text,
  constraint document_uploads_client_org_fk
    foreign key (client_id, org_id)
    references public.clients(id, org_id) on delete cascade,
  constraint document_uploads_name_nonblank check (
    char_length(btrim(display_name)) between 1 and 255
  ),
  constraint document_uploads_mime_nonblank check (
    char_length(btrim(mime_type)) between 1 and 127
  ),
  constraint document_uploads_size_bound check (
    size_bytes between 1 and 6291456
  ),
  constraint document_uploads_path_scope check (
    object_path like org_id::text || '/' || client_id::text || '/' || id::text || '/%'
  ),
  constraint document_uploads_bucket_kind check (
    (kind = 'company' and bucket = 'client-documents')
    or (kind = 'credit_report' and bucket = 'credit-reports')
  ),
  constraint document_uploads_kind_shape check (
    (
      kind = 'company'
      and section is not null
      and derived_features is null
      and lifecycle in ('pending', 'stored', 'failed')
    )
    or (
      kind = 'credit_report'
      and section is null
      and (
        (lifecycle in ('pending', 'stored', 'failed') and derived_features is null)
        or (
          lifecycle in ('parsed', 'delete_pending', 'purged')
          and private.derived_features_valid(derived_features)
        )
      )
    )
  ),
  constraint document_uploads_purge_shape check (
    (lifecycle = 'purged' and purged_at is not null)
    or (lifecycle <> 'purged' and purged_at is null)
  ),
  constraint document_uploads_failure_code_bound check (
    failure_code is null or char_length(failure_code) between 1 and 64
  )
);

create index document_uploads_client_section_created_idx
  on public.document_uploads(client_id, section, created_at desc);
create index document_uploads_purge_retry_idx
  on public.document_uploads(lifecycle, updated_at)
  where kind = 'credit_report' and lifecycle = 'delete_pending';

create function private.document_upload_identity_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
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
$$;

create trigger document_uploads_identity_immutable
before update on public.document_uploads
for each row execute function private.document_upload_identity_immutable();

alter table public.document_uploads enable row level security;
alter table public.document_uploads force row level security;

revoke all on table public.document_uploads from public, anon, authenticated;
grant select on table public.document_uploads to authenticated;
grant all on table public.document_uploads to service_role;
grant execute on function private.derived_features_valid(jsonb) to service_role;

create policy document_uploads_select_client
on public.document_uploads
for select
to authenticated
using ((select private.can_access_client(client_id)));

insert into storage.buckets (id, name, public, file_size_limit)
values
  ('client-documents', 'client-documents', false, 6291456),
  ('credit-reports', 'credit-reports', false, 6291456)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit;

create function private.ancillary_storage_path_allowed(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_parts text[];
  v_org uuid;
  v_client uuid;
begin
  v_parts := storage.foldername(p_name);
  if array_length(v_parts, 1) <> 3
    or v_parts[1] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or v_parts[2] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or v_parts[3] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;

  v_org := v_parts[1]::uuid;
  v_client := v_parts[2]::uuid;
  return exists (
    select 1
    from public.clients as client
    where client.id = v_client
      and client.org_id = v_org
      and private.can_access_client(client.id)
  );
end;
$$;

revoke all on function private.ancillary_storage_path_allowed(text) from public;
grant execute on function private.ancillary_storage_path_allowed(text) to authenticated;

create policy ancillary_storage_select
on storage.objects
for select
to authenticated
using (
  bucket_id in ('client-documents', 'credit-reports')
  and (select private.ancillary_storage_path_allowed(name))
);

create policy ancillary_storage_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id in ('client-documents', 'credit-reports')
  and (select private.ancillary_storage_path_allowed(name))
);

create policy ancillary_storage_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id in ('client-documents', 'credit-reports')
  and (select private.ancillary_storage_path_allowed(name))
);

create or replace function public.enqueue_analysis_job(
  p_client_id uuid,
  p_source_kind public.analysis_job_source_kind,
  p_source_id uuid,
  p_trigger public.analysis_trigger
)
returns setof public.analysis_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.analysis_jobs;
  v_inserted boolean := false;
begin
  if p_source_kind = 'enrollment' then
    if p_trigger <> 'scheduled' or not exists (
      select 1
      from public.enrollments as enrollment
      where enrollment.id = p_source_id
        and enrollment.client_id = p_client_id
    ) then
      raise exception using errcode = 'P0001', message = 'ANALYSIS_SOURCE_INVALID';
    end if;
  elsif p_source_kind = 'monitoring_event' then
    if p_trigger <> 'alert' or not exists (
      select 1
      from public.monitoring_events as event
      where event.id = p_source_id
        and event.client_id = p_client_id
    ) then
      raise exception using errcode = 'P0001', message = 'ANALYSIS_SOURCE_INVALID';
    end if;
  elsif p_source_kind = 'document_upload' then
    if p_trigger <> 'upload' or not exists (
      select 1
      from public.document_uploads as upload
      where upload.id = p_source_id
        and upload.client_id = p_client_id
        and upload.kind = 'credit_report'
        and upload.lifecycle = 'purged'
        and private.derived_features_valid(upload.derived_features)
    ) then
      raise exception using errcode = 'P0001', message = 'ANALYSIS_SOURCE_INVALID';
    end if;
  else
    raise exception using errcode = 'P0001', message = 'ANALYSIS_SOURCE_INVALID';
  end if;

  insert into public.analysis_jobs (
    client_id,
    source_kind,
    source_id,
    trigger
  ) values (
    p_client_id,
    p_source_kind,
    p_source_id,
    p_trigger
  )
  on conflict on constraint analysis_jobs_source_unique do nothing
  returning * into v_job;

  if v_job.id is not null then
    v_inserted := true;
  else
    select job_row.*
    into strict v_job
    from public.analysis_jobs as job_row
    where job_row.job = 'analysis.run'
      and job_row.subject = 'client:'::text || p_client_id::text
      and job_row.source_kind = p_source_kind
      and job_row.source_id = p_source_id;
  end if;

  if v_inserted then
    perform private.audit_analysis_job_transition(v_job, 'absent', 'queued');
  end if;

  return next v_job;
end;
$$;

revoke all on function public.enqueue_analysis_job(
  uuid,
  public.analysis_job_source_kind,
  uuid,
  public.analysis_trigger
) from public, anon, authenticated;
grant execute on function public.enqueue_analysis_job(
  uuid,
  public.analysis_job_source_kind,
  uuid,
  public.analysis_trigger
) to service_role;

create table public.pull_caps (
  client_id uuid primary key,
  org_id uuid not null,
  min_interval_seconds integer,
  max_count integer,
  count_window_seconds integer,
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now(),
  constraint pull_caps_client_org_fk
    foreign key (client_id, org_id)
    references public.clients(id, org_id) on delete cascade,
  constraint pull_caps_min_interval_positive check (
    min_interval_seconds is null or min_interval_seconds > 0
  ),
  constraint pull_caps_count_positive check (
    max_count is null or max_count > 0
  ),
  constraint pull_caps_window_positive check (
    count_window_seconds is null or count_window_seconds > 0
  ),
  constraint pull_caps_count_window_pair check (
    (max_count is null and count_window_seconds is null)
    or (max_count is not null and count_window_seconds is not null)
  )
);

create table public.pull_cap_attempts (
  id uuid primary key default extensions.gen_random_uuid(),
  client_id uuid not null,
  org_id uuid not null,
  cause public.analysis_trigger not null,
  source_id uuid not null,
  allowed boolean not null,
  reason public.pull_cap_reason,
  decided_at timestamptz not null default clock_timestamp(),
  constraint pull_cap_attempts_client_org_fk
    foreign key (client_id, org_id)
    references public.clients(id, org_id) on delete cascade,
  constraint pull_cap_attempts_reason_shape check (
    (allowed and reason is null) or (not allowed and reason is not null)
  ),
  constraint pull_cap_attempts_source_unique unique (client_id, cause, source_id)
);

create index pull_cap_attempts_recent_allowed_idx
  on public.pull_cap_attempts(client_id, decided_at desc)
  where allowed;

alter table public.pull_caps enable row level security;
alter table public.pull_caps force row level security;
alter table public.pull_cap_attempts enable row level security;
alter table public.pull_cap_attempts force row level security;

revoke all on table public.pull_caps from public, anon, authenticated;
revoke all on table public.pull_cap_attempts from public, anon, authenticated;
grant select on table public.pull_caps to authenticated;
grant select on table public.pull_cap_attempts to authenticated;
grant all on table public.pull_caps to service_role;
grant all on table public.pull_cap_attempts to service_role;

create policy pull_caps_admin_select
on public.pull_caps
for select
to authenticated
using ((select private.auth_app_role()) = 'platform_admin');

create policy pull_cap_attempts_admin_select
on public.pull_cap_attempts
for select
to authenticated
using ((select private.auth_app_role()) = 'platform_admin');

create function public.set_pull_cap(
  p_client_id uuid,
  p_min_interval_seconds integer,
  p_max_count integer,
  p_count_window_seconds integer,
  p_actor uuid
)
returns setof public.pull_caps
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cap public.pull_caps;
  v_org uuid;
begin
  if not exists (
    select 1 from public.profiles as actor
    where actor.id = p_actor and actor.role = 'platform_admin'
  ) then
    raise exception using errcode = 'P0001', message = 'PULL_CAP_ACTOR_FORBIDDEN';
  end if;

  select client.org_id into v_org
  from public.clients as client
  where client.id = p_client_id;
  if v_org is null then
    raise exception using errcode = 'P0002', message = 'PULL_CAP_CLIENT_NOT_FOUND';
  end if;

  insert into public.pull_caps (
    client_id, org_id, min_interval_seconds, max_count,
    count_window_seconds, updated_by, updated_at
  ) values (
    p_client_id, v_org, p_min_interval_seconds, p_max_count,
    p_count_window_seconds, p_actor, clock_timestamp()
  )
  on conflict (client_id) do update
  set min_interval_seconds = excluded.min_interval_seconds,
      max_count = excluded.max_count,
      count_window_seconds = excluded.count_window_seconds,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at
  returning * into strict v_cap;

  insert into public.audit_log (
    org_id, client_id, actor_profile_id, action, subject_type, subject_id, meta
  ) values (
    v_org, p_client_id, p_actor, 'pull_cap.set', 'client', p_client_id,
    jsonb_build_object('from_state', 'previous', 'to_state', 'configured')
  );

  return next v_cap;
end;
$$;

create function public.clear_pull_cap(p_client_id uuid, p_actor uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted boolean;
  v_org uuid;
begin
  if not exists (
    select 1 from public.profiles as actor
    where actor.id = p_actor and actor.role = 'platform_admin'
  ) then
    raise exception using errcode = 'P0001', message = 'PULL_CAP_ACTOR_FORBIDDEN';
  end if;

  delete from public.pull_caps
  where client_id = p_client_id
  returning org_id into v_org;
  v_deleted := found;

  if v_deleted then
    insert into public.audit_log (
      org_id, client_id, actor_profile_id, action, subject_type, subject_id, meta
    ) values (
      v_org, p_client_id, p_actor, 'pull_cap.cleared', 'client', p_client_id,
      jsonb_build_object('from_state', 'configured', 'to_state', 'uncapped')
    );
  end if;

  return v_deleted;
end;
$$;

create function public.assert_pull_allowed(
  p_client_id uuid,
  p_cause text,
  p_source_id uuid
)
returns table (allowed boolean, reason text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.pull_cap_attempts;
  v_cap public.pull_caps;
  v_cause public.analysis_trigger;
  v_now timestamptz := clock_timestamp();
  v_org uuid;
  v_reason public.pull_cap_reason;
begin
  if p_cause is null or p_cause not in ('scheduled', 'alert', 'upload', 'force_pull') then
    raise exception using errcode = 'P0001', message = 'PULL_CAP_CAUSE_INVALID';
  end if;
  if p_source_id is null then
    raise exception using errcode = 'P0001', message = 'PULL_CAP_SOURCE_INVALID';
  end if;
  v_cause := p_cause::public.analysis_trigger;

  select client.org_id into v_org
  from public.clients as client
  where client.id = p_client_id;
  if v_org is null then
    raise exception using errcode = 'P0002', message = 'PULL_CAP_CLIENT_NOT_FOUND';
  end if;

  select cap.* into v_cap
  from public.pull_caps as cap
  where cap.client_id = p_client_id
  for update;

  select attempt.* into v_attempt
  from public.pull_cap_attempts as attempt
  where attempt.client_id = p_client_id
    and attempt.cause = v_cause
    and attempt.source_id = p_source_id;
  if v_attempt.id is not null then
    return query select v_attempt.allowed, v_attempt.reason::text;
    return;
  end if;

  if v_cap.client_id is not null and v_cap.min_interval_seconds is not null and exists (
    select 1 from public.pull_cap_attempts as attempt
    where attempt.client_id = p_client_id
      and attempt.allowed
      and attempt.decided_at > v_now - make_interval(secs => v_cap.min_interval_seconds)
  ) then
    v_reason := 'minimum_interval';
  elsif v_cap.client_id is not null and v_cap.max_count is not null and (
    select count(*) from public.pull_cap_attempts as attempt
    where attempt.client_id = p_client_id
      and attempt.allowed
      and attempt.decided_at > v_now - make_interval(secs => v_cap.count_window_seconds)
  ) >= v_cap.max_count then
    v_reason := 'count_window';
  end if;

  insert into public.pull_cap_attempts (
    client_id, org_id, cause, source_id, allowed, reason, decided_at
  ) values (
    p_client_id, v_org, v_cause, p_source_id, v_reason is null, v_reason, v_now
  )
  on conflict (client_id, cause, source_id) do nothing;

  select attempt.* into strict v_attempt
  from public.pull_cap_attempts as attempt
  where attempt.client_id = p_client_id
    and attempt.cause = v_cause
    and attempt.source_id = p_source_id;

  if not v_attempt.allowed then
    insert into public.audit_log (
      org_id, client_id, action, subject_type, subject_id, meta
    ) values (
      v_org,
      p_client_id,
      'pull.blocked',
      'pull_cap_attempt',
      v_attempt.id,
      jsonb_build_object('source', p_cause, 'reason_code', v_attempt.reason::text)
    );
  end if;

  return query select v_attempt.allowed, v_attempt.reason::text;
end;
$$;

revoke all on function public.set_pull_cap(uuid, integer, integer, integer, uuid)
  from public, anon, authenticated;
revoke all on function public.clear_pull_cap(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.assert_pull_allowed(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.set_pull_cap(uuid, integer, integer, integer, uuid)
  to service_role;
grant execute on function public.clear_pull_cap(uuid, uuid)
  to service_role;
grant execute on function public.assert_pull_allowed(uuid, text, uuid)
  to service_role;
