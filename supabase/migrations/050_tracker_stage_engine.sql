create table public.tracker_transition_receipts (
  event_key text primary key,
  client_id uuid not null references public.clients(id) on delete cascade,
  source text not null,
  received_at timestamptz not null default now(),
  constraint tracker_transition_receipts_source_check
    check (source in ('enrollment', 'analysis', 'seed'))
);

alter table public.tracker_transition_receipts enable row level security;
alter table public.tracker_transition_receipts force row level security;

revoke all on table public.tracker_transition_receipts from anon, authenticated;

-- Phase 1 already owns the audit metadata allow-list. Extend only the keys used by
-- the tracker receipt and preserve every existing key and value constraint.
create or replace function private.audit_meta_valid(p_meta jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  item jsonb;
  meta_key text;
  numeric_value numeric;
begin
  if p_meta is null or jsonb_typeof(p_meta) <> 'object' then
    return false;
  end if;

  for meta_key in select key from jsonb_object_keys(p_meta) as key
  loop
    if meta_key not in (
      'count',
      'driver',
      'eventKey',
      'field_names',
      'from',
      'from_state',
      'job',
      'reason_code',
      'source',
      'status',
      'to',
      'to_state',
      'version'
    ) then
      return false;
    end if;

    if meta_key = 'count' then
      if jsonb_typeof(p_meta -> meta_key) <> 'number' then
        return false;
      end if;
      numeric_value := (p_meta ->> meta_key)::numeric;
      if numeric_value < 0 or numeric_value <> trunc(numeric_value) then
        return false;
      end if;
    elsif meta_key = 'field_names' then
      if jsonb_typeof(p_meta -> meta_key) <> 'array'
        or jsonb_array_length(p_meta -> meta_key) > 32 then
        return false;
      end if;
      for item in select value from jsonb_array_elements(p_meta -> meta_key)
      loop
        if jsonb_typeof(item) <> 'string' or length(item #>> '{}') > 64 then
          return false;
        end if;
      end loop;
    elsif jsonb_typeof(p_meta -> meta_key) <> 'string'
      or length(p_meta ->> meta_key) > 128 then
      return false;
    end if;
  end loop;

  return true;
exception
  when others then
    return false;
end;
$$;

create function public.tracker_transition_client_stage(
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

revoke all on function public.tracker_transition_client_stage(
  uuid,
  public.client_stage,
  public.client_stage,
  uuid,
  text,
  text
) from public, anon;
grant execute on function public.tracker_transition_client_stage(
  uuid,
  public.client_stage,
  public.client_stage,
  uuid,
  text,
  text
) to authenticated, service_role;
