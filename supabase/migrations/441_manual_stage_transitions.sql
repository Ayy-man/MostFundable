-- C6: manual stage moves are forward-only, one stage at a time. An operator
-- cannot skip a stage or move a client back; a correction goes through the
-- owner rather than the tracker. The public routine is a tenant-wall wrapper;
-- keep system transitions (enrollment, analysis, seed) on the same private
-- implementation and constrain only the manual branch below.

create or replace function private.tracker_transition_client_stage_r1a03_impl(
  p_client_id uuid,
  p_to_stage public.client_stage,
  p_expected_from public.client_stage,
  p_actor uuid,
  p_source text,
  p_event_key text
)
returns table (
  result text,
  current_stage public.client_stage,
  stage_entered_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_role public.app_role;
  v_at timestamptz;
  v_client_owner name;
  v_from public.client_stage;
  v_org_id uuid;
  v_stage_entered_at timestamptz;
begin
  select
    client.stage,
    client.stage_entered_at,
    client.org_id
  into
    v_from,
    v_stage_entered_at,
    v_org_id
  from public.clients as client
  where client.id = p_client_id
  for update;

  if not found then
    return query
    select
      'not_found'::text,
      null::public.client_stage,
      null::timestamptz;
    return;
  end if;

  if p_source = 'manual' then
    if (select auth.role()) <> 'authenticated'
      or p_actor is null
      or p_actor <> (select auth.uid()) then
      raise exception using
        errcode = '42501',
        message = 'manual tracker transition is not authorized';
    end if;

    select profile.role
    into v_actor_role
    from public.profiles as profile
    where profile.id = (select auth.uid());

    if v_actor_role is distinct from 'operator_member'::public.app_role
      or not (select private.can_access_client(p_client_id)) then
      raise exception using
        errcode = '42501',
        message = 'manual tracker transition is not authorized';
    end if;

    if p_event_key is not null then
      raise exception using
        errcode = '22023',
        message = 'manual tracker transitions do not accept event keys';
    end if;
  elsif p_source in ('enrollment', 'analysis') then
    if (select auth.role()) <> 'service_role' then
      raise exception using
        errcode = '42501',
        message = 'automatic tracker transition requires service role';
    end if;

    if p_actor is not null
      or p_event_key is null
      or p_expected_from <> 'onboarding'::public.client_stage
      or p_to_stage <> 'optimization'::public.client_stage then
      raise exception using
        errcode = '22023',
        message = 'automatic tracker transition must be onboarding to optimization';
    end if;
  elsif p_source = 'seed' then
    select pg_get_userbyid(relation.relowner)
    into v_client_owner
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'clients';

    if nullif(current_setting('request.jwt.claims', true), '') is not null
      or session_user <> v_client_owner
      or p_actor is not null
      or p_event_key is null then
      raise exception using
        errcode = '42501',
        message = 'seed tracker transition requires the database owner without a JWT';
    end if;
  else
    raise exception using
      errcode = '22023',
      message = 'invalid tracker transition source';
  end if;

  if p_event_key is not null then
    insert into public.tracker_transition_receipts (
      event_key,
      client_id,
      source,
      received_at
    )
    values (
      p_event_key,
      p_client_id,
      p_source,
      transaction_timestamp()
    )
    on conflict (event_key) do nothing;

    if not found then
      return query select 'duplicate'::text, v_from, v_stage_entered_at;
      return;
    end if;
  end if;

  if v_from = p_to_stage then
    return query select 'unchanged'::text, v_from, v_stage_entered_at;
    return;
  end if;

  if v_from <> p_expected_from then
    return query select 'stale'::text, v_from, v_stage_entered_at;
    return;
  end if;

  if p_source = 'manual'
    and (
      pg_catalog.array_position(
        array[
          'onboarding'::public.client_stage,
          'optimization'::public.client_stage,
          'ready'::public.client_stage,
          'applying'::public.client_stage,
          'funded'::public.client_stage,
          'graduate'::public.client_stage
        ],
        p_to_stage
      ) - pg_catalog.array_position(
        array[
          'onboarding'::public.client_stage,
          'optimization'::public.client_stage,
          'ready'::public.client_stage,
          'applying'::public.client_stage,
          'funded'::public.client_stage,
          'graduate'::public.client_stage
        ],
        v_from
      )
    ) <> 1
  then
    raise exception using
      errcode = 'P0001',
      message = 'stage_transition_not_allowed',
      detail = pg_catalog.format('from=%s,to=%s', v_from, p_to_stage);
  end if;

  v_at := transaction_timestamp();

  update public.clients as client
  set
    stage = p_to_stage,
    stage_entered_at = v_at
  where client.id = p_client_id;

  insert into public.stage_history (
    client_id,
    from_stage,
    to_stage,
    changed_at,
    changed_by
  )
  values (
    p_client_id,
    v_from,
    p_to_stage,
    v_at,
    p_actor
  );

  insert into public.audit_log (
    org_id,
    client_id,
    actor_profile_id,
    action,
    subject_type,
    subject_id,
    occurred_at,
    meta
  )
  values (
    v_org_id,
    p_client_id,
    p_actor,
    'client.stage.transitioned',
    'client',
    p_client_id,
    v_at,
    jsonb_build_object(
      'eventKey', coalesce(p_event_key, ''),
      'from', v_from::text,
      'source', p_source,
      'to', p_to_stage::text
    )
  );

  return query select 'transitioned'::text, p_to_stage, v_at;
end;
$$;
