-- R2A-11: authenticated definer entry points resolve disabled-aware identity.

alter function public.billing_read_client_cap(uuid) rename to billing_read_client_cap_r2a11_impl;
alter function public.billing_read_client_cap_r2a11_impl(uuid) set schema private;
revoke all on function private.billing_read_client_cap_r2a11_impl(uuid)
  from public, anon, authenticated, service_role;

create function public.billing_read_client_cap(p_org_id uuid)
returns table(active_count integer, client_cap integer)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_role public.app_role;
begin
  if (select auth.role()) = 'authenticated' then
    v_role := private.auth_app_role();
    if v_role is null
      or (v_role <> 'platform_admin' and private.auth_org_id() is distinct from p_org_id)
    then raise exception using errcode = '42501', message = 'CLIENT_CAP_READ_FORBIDDEN'; end if;
  elsif (select auth.role()) <> 'service_role' then
    raise exception using errcode = '42501', message = 'CLIENT_CAP_READ_FORBIDDEN';
  end if;
  return query select * from private.billing_read_client_cap_r2a11_impl(p_org_id);
end;
$$;

alter function public.record_outcome(uuid, public.outcome_kind, bigint, date, uuid)
  rename to record_outcome_r2a11_impl;
alter function public.record_outcome_r2a11_impl(uuid, public.outcome_kind, bigint, date, uuid)
  set schema private;
revoke all on function private.record_outcome_r2a11_impl(uuid, public.outcome_kind, bigint, date, uuid)
  from public, anon, authenticated, service_role;

create function public.record_outcome(
  p_application_id uuid, p_kind public.outcome_kind, p_amount_cents bigint,
  p_decided_on date, p_actor uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.role()) = 'authenticated' then
    if private.auth_app_role() is null then
      raise exception using errcode = '42501', message = 'actor has no active profile';
    end if;
  elsif (select auth.role()) = 'service_role' then
    if p_actor is null or not exists (
      select 1 from public.profiles as profile
      where profile.id = p_actor and profile.disabled_at is null
    ) then raise exception using errcode = '42501', message = 'actor has no active profile'; end if;
  end if;
  return private.record_outcome_r2a11_impl(
    p_application_id, p_kind, p_amount_cents, p_decided_on, p_actor
  );
end;
$$;

alter function public.review_outcome(uuid, public.outcome_review_state, uuid)
  rename to review_outcome_r2a11_impl;
alter function public.review_outcome_r2a11_impl(uuid, public.outcome_review_state, uuid)
  set schema private;
revoke all on function private.review_outcome_r2a11_impl(uuid, public.outcome_review_state, uuid)
  from public, anon, authenticated, service_role;

create function public.review_outcome(
  p_outcome_id uuid, p_decision public.outcome_review_state, p_actor uuid
) returns table (
  result text, review_state public.outcome_review_state,
  outbox_state text, notified boolean
) language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.role()) = 'authenticated' then
    if p_actor is distinct from (select auth.uid())
      or private.auth_app_role() is distinct from 'platform_admin'::public.app_role
    then raise exception using errcode = '42501', message = 'only an active platform admin decides a correction'; end if;
  elsif (select auth.role()) = 'service_role' then
    if not exists (
      select 1 from public.profiles as profile
      where profile.id = p_actor
        and profile.role = 'platform_admin'
        and profile.disabled_at is null
    ) then raise exception using errcode = '42501', message = 'only an active platform admin decides a correction'; end if;
  end if;
  return query select * from private.review_outcome_r2a11_impl(p_outcome_id, p_decision, p_actor);
end;
$$;

create or replace function public.set_client_status(
  p_client_id uuid, p_status public.client_status, p_actor uuid
) returns setof public.clients language plpgsql security definer set search_path = '' as $$
declare
  v_previous_marker text := current_setting('app.governed_client_write', true);
begin
  if (select auth.role()) = 'authenticated' then
    if p_actor is distinct from (select auth.uid())
      or private.auth_app_role() is distinct from 'operator_member'::public.app_role
    then raise exception using errcode = '42501', message = 'CLIENT_STATUS_FORBIDDEN'; end if;
  elsif (select auth.role()) = 'service_role' then
    if not exists (
      select 1 from public.profiles as profile
      where profile.id = p_actor
        and profile.role = 'operator_member'
        and profile.disabled_at is null
    ) then raise exception using errcode = '42501', message = 'CLIENT_STATUS_FORBIDDEN'; end if;
  end if;

  perform pg_catalog.set_config('app.governed_client_write', 'on', true);
  return query select status_row.*
  from private.set_client_status_r1a03_impl(p_client_id, p_status, p_actor) as status_row;
  perform pg_catalog.set_config('app.governed_client_write', coalesce(v_previous_marker, ''), true);
end;
$$;

create or replace function public.tracker_transition_client_stage(
  p_client_id uuid, p_to_stage public.client_stage,
  p_expected_from public.client_stage, p_actor uuid, p_source text, p_event_key text
) returns table (result text, current_stage public.client_stage, stage_entered_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_previous_marker text := current_setting('app.governed_client_write', true);
begin
  if (select auth.role()) = 'authenticated'
    and (p_actor is distinct from (select auth.uid())
      or private.auth_app_role() is distinct from 'operator_member'::public.app_role)
  then raise exception using errcode = '42501', message = 'manual tracker transition is not authorized'; end if;
  if (select auth.role()) = 'service_role' and p_actor is not null
    and not exists (
      select 1 from public.profiles as profile
      where profile.id = p_actor and profile.disabled_at is null
    )
  then raise exception using errcode = '42501', message = 'tracker actor has no active profile'; end if;

  perform pg_catalog.set_config('app.governed_client_write', 'on', true);
  return query select transition.result, transition.current_stage, transition.stage_entered_at
  from private.tracker_transition_client_stage_r1a03_impl(
    p_client_id, p_to_stage, p_expected_from, p_actor, p_source, p_event_key
  ) as transition;
  perform pg_catalog.set_config('app.governed_client_write', coalesce(v_previous_marker, ''), true);
end;
$$;

revoke all on function public.billing_read_client_cap(uuid) from public, anon;
grant execute on function public.billing_read_client_cap(uuid) to authenticated, service_role;
revoke all on function public.record_outcome(uuid, public.outcome_kind, bigint, date, uuid) from public, anon;
grant execute on function public.record_outcome(uuid, public.outcome_kind, bigint, date, uuid) to authenticated, service_role;
revoke all on function public.review_outcome(uuid, public.outcome_review_state, uuid) from public, anon;
grant execute on function public.review_outcome(uuid, public.outcome_review_state, uuid) to authenticated, service_role;
revoke all on function public.set_client_status(uuid, public.client_status, uuid) from public, anon;
grant execute on function public.set_client_status(uuid, public.client_status, uuid) to authenticated, service_role;
revoke all on function public.tracker_transition_client_stage(uuid, public.client_stage, public.client_stage, uuid, text, text) from public, anon;
grant execute on function public.tracker_transition_client_stage(uuid, public.client_stage, public.client_stage, uuid, text, text) to authenticated, service_role;
