-- R2A-14: deactivated tenants cannot mutate through authenticated database paths.

create or replace function private.tenant_write_allowed(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select auth.role()) is distinct from 'authenticated' then true
    when private.auth_app_role() in ('consumer'::public.app_role, 'platform_admin'::public.app_role) then true
    when private.auth_app_role() in ('operator_member'::public.app_role, 'affiliate'::public.app_role) then
      p_org_id = private.auth_org_id()
      and exists (
        select 1
        from public.orgs as organization
        where organization.id = p_org_id
          and organization.membership <> 'deactivated'::public.org_membership
      )
    else false
  end
$$;

revoke all on function private.tenant_write_allowed(uuid) from public, anon;
grant execute on function private.tenant_write_allowed(uuid) to authenticated, service_role;

do $migration$
declare
  policy_row record;
  using_expression text;
  check_expression text;
  clauses text;
begin
  for policy_row in
    select
      policy.oid,
      policy.polname,
      namespace.nspname as schema_name,
      relation.relname as table_name,
      policy.polcmd,
      pg_catalog.pg_get_expr(policy.polqual, policy.polrelid) as using_expression,
      pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid) as check_expression
    from pg_catalog.pg_policy as policy
    join pg_catalog.pg_class as relation on relation.oid = policy.polrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where policy.polroles @> array[(select oid from pg_catalog.pg_roles where rolname = 'authenticated')]
      and policy.polcmd in ('a', 'w', 'd', '*')
      and namespace.nspname in ('public', 'storage')
    order by namespace.nspname, relation.relname, policy.polname
  loop
    using_expression := policy_row.using_expression;
    check_expression := policy_row.check_expression;

    if using_expression is not null and using_expression not like '%tenant_write_allowed%' then
      using_expression := format(
        '(%s) and (select private.tenant_write_allowed(private.auth_org_id()))',
        using_expression
      );
    end if;
    if check_expression is not null and check_expression not like '%tenant_write_allowed%' then
      check_expression := format(
        '(%s) and (select private.tenant_write_allowed(private.auth_org_id()))',
        check_expression
      );
    end if;

    clauses := '';
    if using_expression is not null then
      clauses := clauses || format(' using (%s)', using_expression);
    end if;
    if check_expression is not null then
      clauses := clauses || format(' with check (%s)', check_expression);
    end if;

    execute format(
      'alter policy %I on %I.%I%s',
      policy_row.polname,
      policy_row.schema_name,
      policy_row.table_name,
      clauses
    );
  end loop;
end
$migration$;

create or replace function public.record_outcome(
  p_application_id uuid,
  p_kind public.outcome_kind,
  p_amount_cents bigint,
  p_decided_on date,
  p_actor uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) = 'authenticated' then
    if private.auth_app_role() is null
      or not private.tenant_write_allowed(private.auth_org_id())
    then raise exception using errcode = '42501', message = 'actor has no active tenant write authority'; end if;
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

create or replace function public.review_outcome(
  p_outcome_id uuid,
  p_decision public.outcome_review_state,
  p_actor uuid
)
returns table(result text, review_state public.outcome_review_state, outbox_state text, notified boolean)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) = 'authenticated' then
    if p_actor is distinct from (select auth.uid())
      or private.auth_app_role() is distinct from 'platform_admin'::public.app_role
      or not private.tenant_write_allowed(private.auth_org_id())
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
  if (select auth.role()) = 'authenticated' then
    if p_actor is distinct from (select auth.uid())
      or private.auth_app_role() is distinct from 'operator_member'::public.app_role
      or not private.tenant_write_allowed(private.auth_org_id())
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
  p_client_id uuid,
  p_to_stage public.client_stage,
  p_expected_from public.client_stage,
  p_actor uuid,
  p_source text,
  p_event_key text
)
returns table(result text, current_stage public.client_stage, stage_entered_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous_marker text := current_setting('app.governed_client_write', true);
begin
  if (select auth.role()) = 'authenticated'
    and (p_actor is distinct from (select auth.uid())
      or private.auth_app_role() is distinct from 'operator_member'::public.app_role
      or not private.tenant_write_allowed(private.auth_org_id()))
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
