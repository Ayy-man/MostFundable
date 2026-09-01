-- 170_tenancy_lifecycle.sql — database authority for tenant identity and lifecycle.

begin;

alter table public.orgs
  add column if not exists trial_ends_at timestamptz,
  add column if not exists brand_published_at timestamptz;

alter table public.orgs
  add constraint orgs_slug_format
  check (
    length(slug) between 3 and 40
    and slug ~ '^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?$'
  );

create or replace function private.tenancy_slug_reserved(p_slug text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_slug = any(array['www', 'admin', 'app', 'api', 'mail', 'platform', 'help', 'status', 'docs'])
    or exists (
      select 1
      from public.orgs as organization
      where organization.brand @> '{"platform_intake": true}'::jsonb
        and organization.slug = p_slug
    )
$$;

revoke all on function private.tenancy_slug_reserved(text) from public;

create or replace function private.tenancy_guard_org_slug()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if tg_op = 'UPDATE'
    and new.slug is not distinct from old.slug
  then
    return new;
  end if;

  if private.tenancy_slug_reserved(new.slug) then
    raise exception using errcode = '23514', message = 'TENANT_SLUG_RESERVED';
  end if;

  if tg_op = 'UPDATE'
    and old.brand_published_at is not null
    and coalesce(pg_catalog.current_setting('app.tenancy_slug_rename', true), 'off') <> 'on'
  then
    raise exception using errcode = '42501', message = 'TENANT_SLUG_PUBLISHED';
  end if;

  return new;
end;
$fn$;

revoke all on function private.tenancy_guard_org_slug() from public;

drop trigger if exists orgs_tenancy_slug_guard on public.orgs;
create trigger orgs_tenancy_slug_guard
  before insert or update of slug on public.orgs
  for each row execute function private.tenancy_guard_org_slug();

create or replace function private.tenancy_actor_is_platform_admin(p_actor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles as actor
    where actor.id = p_actor_id
      and actor.role = 'platform_admin'
  )
$$;

create or replace function private.tenancy_actor_can_manage_org(
  p_actor_id uuid,
  p_org_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles as actor
    where actor.id = p_actor_id
      and (
        actor.role = 'platform_admin'
        or (
          actor.role = 'operator_member'
          and actor.org_id = p_org_id
          and actor.org_role in ('owner', 'admin')
        )
      )
  )
$$;

revoke all on function private.tenancy_actor_is_platform_admin(uuid) from public;
revoke all on function private.tenancy_actor_can_manage_org(uuid, uuid) from public;

create or replace function private.tenancy_create_org(
  p_name text,
  p_slug text,
  p_trial_ends_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_org_id uuid;
begin
  if nullif(pg_catalog.btrim(p_name), '') is null
    or p_trial_ends_at is null
    or p_trial_ends_at <= pg_catalog.now()
  then
    raise exception using errcode = '22023', message = 'TENANT_PROVISION_INPUT_INVALID';
  end if;

  insert into public.orgs (
    name,
    slug,
    plan,
    membership,
    trial_ends_at
  ) values (
    pg_catalog.btrim(p_name),
    p_slug,
    'trial',
    'trial',
    p_trial_ends_at
  )
  returning id into v_org_id;

  return v_org_id;
end;
$fn$;

revoke all on function private.tenancy_create_org(text, text, timestamptz) from public;

create or replace function public.tenancy_rename_org_slug(
  p_org_id uuid,
  p_slug text,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_from text;
begin
  if not private.tenancy_actor_is_platform_admin(p_actor_id) then
    raise exception using errcode = '42501', message = 'TENANT_PLATFORM_ADMIN_REQUIRED';
  end if;

  select organization.slug
  into v_from
  from public.orgs as organization
  where organization.id = p_org_id
  for update;

  if v_from is null then
    raise exception using errcode = 'P0002', message = 'TENANT_NOT_FOUND';
  end if;

  if v_from = p_slug then
    return pg_catalog.jsonb_build_object('applied', false, 'reason_code', 'unchanged');
  end if;

  perform pg_catalog.set_config('app.tenancy_slug_rename', 'on', true);
  update public.orgs set slug = p_slug where id = p_org_id;
  perform pg_catalog.set_config('app.tenancy_slug_rename', 'off', true);

  insert into public.audit_log (
    org_id, client_id, actor_profile_id, action, subject_type, subject_id, occurred_at, meta
  ) values (
    p_org_id, null, p_actor_id, 'org.slug_renamed', 'org', p_org_id, pg_catalog.now(),
    pg_catalog.jsonb_build_object('from', v_from, 'to', p_slug)
  );

  return pg_catalog.jsonb_build_object(
    'applied', true,
    'reason_code', 'applied',
    'from', v_from,
    'to', p_slug
  );
end;
$fn$;

create or replace function public.tenancy_apply_org_action(
  p_org_id uuid,
  p_action text,
  p_trial_ends_at timestamptz,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_from public.org_membership;
  v_to public.org_membership;
  v_existing_trial_end timestamptz;
  v_has_current_subscription boolean;
begin
  if not private.tenancy_actor_is_platform_admin(p_actor_id) then
    raise exception using errcode = '42501', message = 'TENANT_PLATFORM_ADMIN_REQUIRED';
  end if;

  select organization.membership, organization.trial_ends_at
  into v_from, v_existing_trial_end
  from public.orgs as organization
  where organization.id = p_org_id
  for update;

  if v_from is null then
    raise exception using errcode = 'P0002', message = 'TENANT_NOT_FOUND';
  end if;

  if p_action = 'extend-trial' then
    if p_trial_ends_at is null or p_trial_ends_at <= pg_catalog.now() then
      raise exception using errcode = '22023', message = 'TENANT_TRIAL_END_INVALID';
    end if;
    update public.orgs set trial_ends_at = p_trial_ends_at where id = p_org_id;
    insert into public.audit_log (
      org_id, client_id, actor_profile_id, action, subject_type, subject_id, occurred_at, meta
    ) values (
      p_org_id, null, p_actor_id, 'org.trial_extended', 'org', p_org_id, pg_catalog.now(),
      pg_catalog.jsonb_build_object(
        'from', coalesce(v_existing_trial_end::text, ''),
        'to', p_trial_ends_at::text
      )
    );
    return pg_catalog.jsonb_build_object(
      'applied', true,
      'reason_code', 'applied',
      'membership', v_from::text,
      'trial_ends_at', p_trial_ends_at
    );
  elsif p_action = 'deactivate' then
    v_to := 'deactivated';
  elsif p_action = 'reactivate' then
    select exists (
      select 1
      from public.operator_subscriptions as subscription
      where subscription.org_id = p_org_id
        and subscription.status in ('active', 'trialing')
    ) into v_has_current_subscription;

    if v_has_current_subscription then
      v_to := 'current';
    elsif v_existing_trial_end > pg_catalog.now() then
      v_to := 'trial';
    else
      raise exception using
        errcode = '55000',
        message = 'TENANT_REACTIVATION_REQUIRES_TRIAL_EXTENSION';
    end if;
  elsif p_action = 'raise-cap' then
    raise exception using errcode = '0A000', message = 'TENANT_ACTION_UNAVAILABLE';
  else
    raise exception using errcode = '22023', message = 'TENANT_ACTION_INVALID';
  end if;

  if v_to = v_from then
    return pg_catalog.jsonb_build_object(
      'applied', false,
      'reason_code', 'unchanged',
      'membership', v_from::text
    );
  end if;

  perform pg_catalog.set_config('app.billing_write', 'on', true);
  update public.orgs set membership = v_to where id = p_org_id;
  perform pg_catalog.set_config('app.billing_write', 'off', true);

  insert into public.audit_log (
    org_id, client_id, actor_profile_id, action, subject_type, subject_id, occurred_at, meta
  ) values (
    p_org_id, null, p_actor_id, 'org.lifecycle_changed', 'org', p_org_id, pg_catalog.now(),
    pg_catalog.jsonb_build_object(
      'from_state', v_from::text,
      'to_state', v_to::text,
      'reason_code', p_action,
      'source', 'tenancy'
    )
  );

  return pg_catalog.jsonb_build_object(
    'applied', true,
    'reason_code', 'applied',
    'from_membership', v_from::text,
    'to_membership', v_to::text
  );
end;
$fn$;

create or replace function public.tenancy_update_brand(
  p_org_id uuid,
  p_brand jsonb,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_brand jsonb;
begin
  if not private.tenancy_actor_can_manage_org(p_actor_id, p_org_id) then
    raise exception using errcode = '42501', message = 'TENANT_ORG_ADMIN_REQUIRED';
  end if;
  if p_brand is null or pg_catalog.jsonb_typeof(p_brand) <> 'object' then
    raise exception using errcode = '22023', message = 'TENANT_BRAND_INVALID';
  end if;

  select organization.brand
  into v_brand
  from public.orgs as organization
  where organization.id = p_org_id
  for update;

  if v_brand is null then
    raise exception using errcode = 'P0002', message = 'TENANT_NOT_FOUND';
  end if;

  v_brand := v_brand || p_brand;
  update public.orgs set brand = v_brand where id = p_org_id;
  return v_brand;
end;
$fn$;

create or replace function public.tenancy_publish_brand(
  p_org_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_published_at timestamptz;
  v_slug text;
begin
  if not private.tenancy_actor_can_manage_org(p_actor_id, p_org_id) then
    raise exception using errcode = '42501', message = 'TENANT_ORG_ADMIN_REQUIRED';
  end if;

  select organization.slug, organization.brand_published_at
  into v_slug, v_published_at
  from public.orgs as organization
  where organization.id = p_org_id
  for update;

  if v_slug is null then
    raise exception using errcode = 'P0002', message = 'TENANT_NOT_FOUND';
  end if;
  if private.tenancy_slug_reserved(v_slug) then
    raise exception using errcode = '23514', message = 'TENANT_SLUG_RESERVED';
  end if;

  if v_published_at is null then
    v_published_at := pg_catalog.now();
    update public.orgs set brand_published_at = v_published_at where id = p_org_id;
    insert into public.audit_log (
      org_id, client_id, actor_profile_id, action, subject_type, subject_id, occurred_at, meta
    ) values (
      p_org_id, null, p_actor_id, 'org.brand_published', 'org', p_org_id,
      v_published_at, pg_catalog.jsonb_build_object('source', 'tenancy')
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'applied', true,
    'published_at', v_published_at
  );
end;
$fn$;

create or replace function public.tenancy_expire_trials(p_window date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_count integer := 0;
  v_event_id text;
  v_org record;
begin
  if p_window is null then
    raise exception using errcode = '22023', message = 'TENANT_WINDOW_INVALID';
  end if;

  for v_org in
    select organization.id, organization.membership, subscription.status
    from public.orgs as organization
    left join public.operator_subscriptions as subscription
      on subscription.org_id = organization.id
    where organization.membership = 'trial'
      and organization.trial_ends_at is not null
      and organization.trial_ends_at <= pg_catalog.now()
      and not exists (
        select 1
        from public.operator_subscriptions as current_subscription
        where current_subscription.org_id = organization.id
          and current_subscription.status in ('active', 'trialing')
      )
    for update of organization skip locked
  loop
    v_event_id := 'tenancy.trial_expiry:' || p_window::text;

    insert into public.operator_billing_events (
      org_id, event_id, event_type, from_membership, to_membership,
      from_status, to_status, reason_code, applied, occurred_at
    ) values (
      v_org.id, v_event_id, 'tenancy.trial_expiry', 'trial', 'deactivated',
      v_org.status, v_org.status, 'trial_ended', true, pg_catalog.now()
    )
    on conflict (org_id, event_id) do nothing;

    if not found then
      continue;
    end if;

    perform pg_catalog.set_config('app.billing_write', 'on', true);
    update public.orgs set membership = 'deactivated' where id = v_org.id;
    perform pg_catalog.set_config('app.billing_write', 'off', true);

    insert into public.audit_log (
      org_id, client_id, actor_profile_id, action, subject_type, subject_id, occurred_at, meta
    ) values (
      v_org.id, null, null, 'billing.membership_change', 'org', v_org.id,
      pg_catalog.now(),
      pg_catalog.jsonb_build_object(
        'from_state', 'trial',
        'to_state', 'deactivated',
        'reason_code', 'trial_ended',
        'source', 'tenancy'
      )
    );
    v_count := v_count + 1;
  end loop;

  return pg_catalog.jsonb_build_object('status', 'ok', 'rows', v_count);
end;
$fn$;

revoke all on function public.tenancy_rename_org_slug(uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.tenancy_apply_org_action(uuid, text, timestamptz, uuid)
  from public, anon, authenticated;
revoke all on function public.tenancy_update_brand(uuid, jsonb, uuid)
  from public, anon, authenticated;
revoke all on function public.tenancy_publish_brand(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.tenancy_expire_trials(date)
  from public, anon, authenticated;

grant execute on function public.tenancy_rename_org_slug(uuid, text, uuid) to service_role;
grant execute on function public.tenancy_apply_org_action(uuid, text, timestamptz, uuid) to service_role;
grant execute on function public.tenancy_update_brand(uuid, jsonb, uuid) to service_role;
grant execute on function public.tenancy_publish_brand(uuid, uuid) to service_role;
grant execute on function public.tenancy_expire_trials(date) to service_role;

comment on function public.tenancy_expire_trials(date) is
  'Daily replay-safe trial expiry. It records the Phase 10 billing event and one system audit row before returning counts only.';

commit;
