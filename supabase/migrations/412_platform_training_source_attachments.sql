alter table public.trainings
  add column source_object_path text,
  add column source_file_name text,
  add column source_mime_type text,
  add column source_size_bytes bigint,
  add column source_uploaded_at timestamptz,
  add constraint trainings_source_attachment_shape check (
    (
      source_object_path is null
      and source_file_name is null
      and source_mime_type is null
      and source_size_bytes is null
      and source_uploaded_at is null
    )
    or (
      source = 'platform'
      and org_id is null
      and source_object_path is not null
      and source_file_name is not null
      and source_mime_type is not null
      and source_size_bytes is not null
      and source_uploaded_at is not null
      and source_object_path = id::text || '/source'
      and char_length(source_file_name) between 5 and 120
      and source_file_name ~ '^[A-Za-z0-9][A-Za-z0-9._-]*\.(pdf|doc|docx|txt)$'
      and source_mime_type in (
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain'
      )
      and (
        (source_mime_type = 'application/pdf' and lower(right(source_file_name, 4)) = '.pdf')
        or (source_mime_type = 'application/msword' and lower(right(source_file_name, 4)) = '.doc')
        or (
          source_mime_type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          and lower(right(source_file_name, 5)) = '.docx'
        )
        or (source_mime_type = 'text/plain' and lower(right(source_file_name, 4)) = '.txt')
      )
      and source_size_bytes between 1 and 6291456
      and source_uploaded_at is not null
    )
  );

create unique index trainings_source_object_path_unique
  on public.trainings(source_object_path)
  where source_object_path is not null;

comment on column public.trainings.source_object_path is
  'Server-derived object path in the private platform-training-sources bucket; never accepted from or returned to a browser.';
comment on column public.trainings.source_file_name is
  'Normalized display filename for the private platform training source.';

-- The original table grant included future columns, which would expose the
-- server-only storage key through a direct authenticated Supabase query. Keep
-- the existing readable training fields available while requiring the scoped
-- server route for every source attachment field.
revoke select on table public.trainings from authenticated;
grant select (
  id,
  org_id,
  audience,
  source,
  title,
  video_url,
  body,
  published,
  published_at,
  published_by,
  attested,
  attested_at,
  attestation_text,
  created_by,
  created_at,
  updated_at,
  takedown_reason,
  taken_down_by,
  taken_down_at
) on table public.trainings to authenticated;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'platform-training-sources',
  'platform-training-sources',
  false,
  6291456,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ]::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create function public.update_platform_training(
  p_id uuid,
  p_actor uuid,
  p_audience public.training_audience,
  p_title text,
  p_video_url text,
  p_body text,
  p_source_file_name text,
  p_source_mime_type text,
  p_source_size_bytes bigint
)
returns setof public.trainings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles;
  v_training public.trainings;
  v_was_published boolean;
  v_at timestamptz;
begin
  select profile.* into v_actor
  from public.profiles as profile
  where profile.id = p_actor;

  if v_actor.id is null or v_actor.role <> 'platform_admin' then
    raise exception using errcode = 'P0001', message = 'TRAINING_ACTOR_FORBIDDEN';
  end if;

  select training.* into v_training
  from public.trainings as training
  where training.id = p_id
  for update;

  if v_training.id is null then
    raise exception using errcode = 'P0002', message = 'TRAINING_NOT_FOUND';
  end if;
  if v_training.source <> 'platform' or v_training.org_id is not null then
    raise exception using errcode = 'P0001', message = 'TRAINING_ACTOR_FORBIDDEN';
  end if;
  if p_title is null or char_length(btrim(p_title)) not between 1 and 200
    or p_video_url is null or char_length(btrim(p_video_url)) not between 1 and 2048
    or p_body is null or char_length(btrim(p_body)) not between 1 and 20000
    or p_source_file_name is null or char_length(p_source_file_name) not between 5 and 120
    or p_source_file_name !~ '^[A-Za-z0-9][A-Za-z0-9._-]*\.(pdf|doc|docx|txt)$'
    or p_source_mime_type is null
    or p_source_mime_type not in (
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain'
    )
    or p_source_size_bytes is null
    or p_source_size_bytes not between 1 and 6291456 then
    raise exception using errcode = '22023', message = 'TRAINING_SOURCE_INVALID';
  end if;

  v_at := clock_timestamp();
  v_was_published := v_training.published;

  update public.trainings
  set audience = p_audience,
      title = btrim(p_title),
      video_url = btrim(p_video_url),
      body = btrim(p_body),
      source_object_path = p_id::text || '/source',
      source_file_name = p_source_file_name,
      source_mime_type = p_source_mime_type,
      source_size_bytes = p_source_size_bytes,
      source_uploaded_at = v_at,
      published = case when v_was_published then false else published end,
      published_at = case when v_was_published then null else published_at end,
      published_by = case when v_was_published then null else published_by end,
      attested = case when v_was_published then false else attested end,
      attested_at = case when v_was_published then null else attested_at end,
      attestation_text = case when v_was_published then null else attestation_text end,
      updated_at = v_at
  where id = p_id
  returning * into strict v_training;

  insert into public.audit_log (
    org_id,
    actor_profile_id,
    action,
    subject_type,
    subject_id,
    occurred_at,
    meta
  ) values (
    null,
    p_actor,
    'training.updated',
    'training',
    p_id,
    v_at,
    jsonb_build_object(
      'from_state', case when v_was_published then 'published' else 'draft' end,
      'to_state', 'draft',
      'status', 'source_replaced'
    )
  );

  return next v_training;
end;
$$;

create or replace function public.publish_training(
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
  if v_training.source = 'platform'
    and (
      v_training.source_object_path is null
      or v_training.source_file_name is null
      or v_training.source_mime_type is null
      or v_training.source_size_bytes is null
      or v_training.source_uploaded_at is null
    ) then
    raise exception using errcode = 'P0001', message = 'TRAINING_SOURCE_REQUIRED';
  end if;

  v_at := clock_timestamp();
  update public.trainings
  set published = true,
      published_at = v_at,
      published_by = p_actor,
      attested = true,
      attested_at = v_at,
      attestation_text = btrim(p_attestation_text),
      takedown_reason = null,
      taken_down_by = null,
      taken_down_at = null,
      updated_at = v_at
  where id = p_id
  returning * into strict v_training;

  insert into public.audit_log (
    org_id,
    actor_profile_id,
    action,
    subject_type,
    subject_id,
    occurred_at,
    meta
  ) values (
    v_training.org_id,
    p_actor,
    'training.published',
    'training',
    p_id,
    v_at,
    jsonb_build_object('from_state', 'draft', 'to_state', 'published')
  );

  return next v_training;
end;
$$;

revoke all on function public.update_platform_training(
  uuid,
  uuid,
  public.training_audience,
  text,
  text,
  text,
  text,
  text,
  bigint
) from public, anon, authenticated;
grant execute on function public.update_platform_training(
  uuid,
  uuid,
  public.training_audience,
  text,
  text,
  text,
  text,
  text,
  bigint
) to service_role;

revoke all on function public.publish_training(uuid, uuid, boolean, text)
  from public, anon, authenticated;
grant execute on function public.publish_training(uuid, uuid, boolean, text)
  to service_role;
