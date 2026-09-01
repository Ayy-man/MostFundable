-- R1A-03: protected client lifecycle and funding fields may change only through
-- governed RPCs. Metadata, assignment, and affiliate fields retain the existing
-- table policy and direct-write behavior.

create or replace function private.guard_governed_client_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_owner name;
begin
  select pg_catalog.pg_get_userbyid(relation.relowner)
  into v_owner
  from pg_catalog.pg_class as relation
  where relation.oid = tg_relid;

  if current_setting('app.governed_client_write', true) is distinct from 'on'
    or current_user <> v_owner
  then
    raise exception using
      errcode = '42501',
      message = 'CLIENT_GOVERNED_WRITE_REQUIRED';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_governed_client_write()
  from public, anon, authenticated, service_role;

drop trigger if exists clients_guard_governed_write on public.clients;
create trigger clients_guard_governed_write
before update of
  stage,
  stage_entered_at,
  funded_amount_cents,
  status,
  archived_at,
  archived_by
on public.clients
for each row execute function private.guard_governed_client_write();
alter table public.clients enable always trigger clients_guard_governed_write;

alter function public.tracker_transition_client_stage(
  uuid, public.client_stage, public.client_stage, uuid, text, text
) rename to tracker_transition_client_stage_r1a03_impl;
alter function public.tracker_transition_client_stage_r1a03_impl(
  uuid, public.client_stage, public.client_stage, uuid, text, text
) set schema private;
revoke all on function private.tracker_transition_client_stage_r1a03_impl(
  uuid, public.client_stage, public.client_stage, uuid, text, text
) from public, anon, authenticated, service_role;

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
  v_previous_marker text := current_setting('app.governed_client_write', true);
begin
  perform pg_catalog.set_config('app.governed_client_write', 'on', true);
  return query
    select transition.result, transition.current_stage, transition.stage_entered_at
    from private.tracker_transition_client_stage_r1a03_impl(
      p_client_id,
      p_to_stage,
      p_expected_from,
      p_actor,
      p_source,
      p_event_key
    ) as transition;
  perform pg_catalog.set_config(
    'app.governed_client_write',
    coalesce(v_previous_marker, ''),
    true
  );
end;
$$;

revoke all on function public.tracker_transition_client_stage(
  uuid, public.client_stage, public.client_stage, uuid, text, text
) from public, anon;
grant execute on function public.tracker_transition_client_stage(
  uuid, public.client_stage, public.client_stage, uuid, text, text
) to authenticated, service_role;

alter function public.set_client_status(
  uuid, public.client_status, uuid
) rename to set_client_status_r1a03_impl;
alter function public.set_client_status_r1a03_impl(
  uuid, public.client_status, uuid
) set schema private;
revoke all on function private.set_client_status_r1a03_impl(
  uuid, public.client_status, uuid
) from public, anon, authenticated, service_role;

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
  v_previous_marker text := current_setting('app.governed_client_write', true);
begin
  perform pg_catalog.set_config('app.governed_client_write', 'on', true);
  return query
    select status_row.*
    from private.set_client_status_r1a03_impl(
      p_client_id,
      p_status,
      p_actor
    ) as status_row;
  perform pg_catalog.set_config(
    'app.governed_client_write',
    coalesce(v_previous_marker, ''),
    true
  );
end;
$$;

revoke all on function public.set_client_status(
  uuid, public.client_status, uuid
) from public, anon;
grant execute on function public.set_client_status(
  uuid, public.client_status, uuid
) to authenticated, service_role;
