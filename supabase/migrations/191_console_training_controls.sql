alter table public.trainings
  add column takedown_reason text,
  add column taken_down_by uuid references public.profiles(id),
  add column taken_down_at timestamptz,
  add constraint trainings_takedown_reason_bound check (
    takedown_reason is null
    or char_length(takedown_reason) between 1 and 1000
      and takedown_reason = btrim(takedown_reason)
  ),
  add constraint trainings_takedown_shape check (
    (takedown_reason is null and taken_down_by is null and taken_down_at is null)
    or (takedown_reason is not null and taken_down_by is not null and taken_down_at is not null)
  );

create function public.update_training(
  p_id uuid,
  p_actor uuid,
  p_audience public.training_audience,
  p_title text,
  p_video_url text,
  p_body text
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
  select profile.* into v_actor from public.profiles as profile where profile.id = p_actor;
  if v_actor.id is null or v_actor.role not in ('platform_admin', 'operator_member') then
    raise exception using errcode = 'P0001', message = 'TRAINING_ACTOR_FORBIDDEN';
  end if;

  select training.* into v_training from public.trainings as training
  where training.id = p_id for update;
  if v_training.id is null then
    raise exception using errcode = 'P0002', message = 'TRAINING_NOT_FOUND';
  end if;
  if v_actor.role = 'operator_member'
    and (v_training.source <> 'operator' or v_training.org_id <> v_actor.org_id) then
    raise exception using errcode = 'P0001', message = 'TRAINING_ACTOR_FORBIDDEN';
  end if;
  if p_title is null or char_length(btrim(p_title)) not between 1 and 200
    or p_video_url is null or char_length(btrim(p_video_url)) not between 1 and 2048
    or p_body is null or char_length(btrim(p_body)) not between 1 and 20000 then
    raise exception using errcode = '22023', message = 'TRAINING_INPUT_INVALID';
  end if;

  v_at := clock_timestamp();
  v_was_published := v_training.published;
  update public.trainings
  set audience = p_audience,
      title = btrim(p_title),
      video_url = btrim(p_video_url),
      body = btrim(p_body),
      published = case when v_was_published then false else published end,
      published_at = case when v_was_published then null else published_at end,
      published_by = case when v_was_published then null else published_by end,
      attested = case when v_was_published then false else attested end,
      attested_at = case when v_was_published then null else attested_at end,
      attestation_text = case when v_was_published then null else attestation_text end,
      updated_at = v_at
  where id = p_id
  returning * into strict v_training;

  insert into public.audit_log(org_id, actor_profile_id, action, subject_type, subject_id, occurred_at, meta)
  values (
    v_training.org_id, p_actor, 'training.updated', 'training', p_id, v_at,
    jsonb_build_object(
      'from_state', case when v_was_published then 'published' else 'draft' end,
      'to_state', 'draft',
      'status', case when v_was_published then 'requires_attestation' else 'content_updated' end
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
  select profile.* into v_actor from public.profiles as profile where profile.id = p_actor;
  if v_actor.id is null or v_actor.role not in ('platform_admin', 'operator_member') then
    raise exception using errcode = 'P0001', message = 'TRAINING_ACTOR_FORBIDDEN';
  end if;
  if p_attested is distinct from true or p_attestation_text is null
    or char_length(btrim(p_attestation_text)) not between 1 and 2000 then
    raise exception using errcode = 'P0001', message = 'TRAINING_ATTESTATION_REQUIRED';
  end if;

  select training.* into v_training from public.trainings as training
  where training.id = p_id for update;
  if v_training.id is null then
    raise exception using errcode = 'P0002', message = 'TRAINING_NOT_FOUND';
  end if;
  if v_actor.role = 'operator_member'
    and (v_training.source <> 'operator' or v_training.org_id <> v_actor.org_id) then
    raise exception using errcode = 'P0001', message = 'TRAINING_ACTOR_FORBIDDEN';
  end if;

  v_at := clock_timestamp();
  update public.trainings
  set published = true, published_at = v_at, published_by = p_actor,
      attested = true, attested_at = v_at, attestation_text = btrim(p_attestation_text),
      takedown_reason = null, taken_down_by = null, taken_down_at = null,
      updated_at = v_at
  where id = p_id returning * into strict v_training;

  insert into public.audit_log(org_id, actor_profile_id, action, subject_type, subject_id, occurred_at, meta)
  values (v_training.org_id, p_actor, 'training.published', 'training', p_id, v_at,
    jsonb_build_object('from_state', 'draft', 'to_state', 'published'));
  return next v_training;
end;
$$;

create function public.unpublish_training(p_id uuid, p_actor uuid, p_reason text)
returns setof public.trainings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles;
  v_training public.trainings;
  v_at timestamptz;
  v_reason text;
begin
  select profile.* into v_actor from public.profiles as profile where profile.id = p_actor;
  if v_actor.id is null or v_actor.role not in ('platform_admin', 'operator_member') then
    raise exception using errcode = 'P0001', message = 'TRAINING_ACTOR_FORBIDDEN';
  end if;
  select training.* into v_training from public.trainings as training
  where training.id = p_id for update;
  if v_training.id is null then
    raise exception using errcode = 'P0002', message = 'TRAINING_NOT_FOUND';
  end if;
  if v_actor.role = 'operator_member'
    and (v_training.source <> 'operator' or v_training.org_id <> v_actor.org_id) then
    raise exception using errcode = 'P0001', message = 'TRAINING_ACTOR_FORBIDDEN';
  end if;

  if v_actor.role = 'platform_admin' then
    v_reason := btrim(coalesce(p_reason, ''));
    if char_length(v_reason) not between 1 and 1000 then
      raise exception using errcode = 'P0001', message = 'TRAINING_TAKEDOWN_REASON_REQUIRED';
    end if;
  else
    v_reason := null;
  end if;

  v_at := clock_timestamp();
  update public.trainings
  set published = false,
      takedown_reason = v_reason,
      taken_down_by = case when v_reason is null then null else p_actor end,
      taken_down_at = case when v_reason is null then null else v_at end,
      updated_at = v_at
  where id = p_id returning * into strict v_training;

  insert into public.audit_log(org_id, actor_profile_id, action, subject_type, subject_id, occurred_at, meta)
  values (
    v_training.org_id, p_actor, 'training.unpublished', 'training', p_id, v_at,
    case when v_reason is null
      then jsonb_build_object('from_state', 'published', 'to_state', 'draft')
      else jsonb_build_object('from_state', 'published', 'to_state', 'draft', 'reason_code', 'platform_takedown')
    end
  );
  return next v_training;
end;
$$;

create or replace function public.unpublish_training(p_id uuid, p_actor uuid)
returns setof public.trainings
language plpgsql
security definer
set search_path = ''
as $$
declare v_role public.app_role;
begin
  select role into v_role from public.profiles where id = p_actor;
  if v_role is distinct from 'operator_member'::public.app_role then
    raise exception using errcode = 'P0001', message = 'TRAINING_TAKEDOWN_REASON_REQUIRED';
  end if;
  return query select * from public.unpublish_training(p_id, p_actor, null);
end;
$$;

revoke all on function public.update_training(uuid, uuid, public.training_audience, text, text, text) from public, anon, authenticated;
revoke all on function public.publish_training(uuid, uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.unpublish_training(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.unpublish_training(uuid, uuid) from public, anon, authenticated;
grant execute on function public.update_training(uuid, uuid, public.training_audience, text, text, text) to service_role;
grant execute on function public.publish_training(uuid, uuid, boolean, text) to service_role;
grant execute on function public.unpublish_training(uuid, uuid, text) to service_role;
grant execute on function public.unpublish_training(uuid, uuid) to service_role;
