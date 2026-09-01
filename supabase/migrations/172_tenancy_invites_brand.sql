-- 172_tenancy_invites_brand.sql — tenant invitations, access disablement,
-- enabled-seat accounting, and organization-scoped logo objects.

begin;

create type public.tenant_invite_kind as enum ('team', 'affiliate');
create type public.tenant_invite_status as enum (
  'pending', 'sent', 'failed', 'accepted', 'expired'
);

alter table public.profiles
  add column if not exists disabled_at timestamptz;

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
      and actor.disabled_at is null
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
      and actor.disabled_at is null
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

create table public.invites (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  email text not null,
  full_name text not null,
  kind public.tenant_invite_kind not null,
  org_role public.org_role,
  token_id uuid not null unique default extensions.gen_random_uuid(),
  provider_user_id uuid,
  status public.tenant_invite_status not null default 'pending',
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_profile_id uuid references public.profiles(id),
  accepted_affiliate_id uuid references public.affiliates(id),
  idempotency_key text not null unique,
  failure_code text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint invites_email_normalized check (
    email = pg_catalog.lower(pg_catalog.btrim(email))
    and char_length(email) between 3 and 320
  ),
  constraint invites_full_name_bound check (
    char_length(pg_catalog.btrim(full_name)) between 1 and 120
  ),
  constraint invites_idempotency_bound check (
    char_length(idempotency_key) between 8 and 200
  ),
  constraint invites_kind_role_shape check (
    (kind = 'team' and org_role in ('owner', 'admin', 'member'))
    or (kind = 'affiliate' and org_role is null)
  ),
  constraint invites_provider_shape check (
    (status in ('pending', 'failed') and accepted_at is null)
    or (status = 'sent' and provider_user_id is not null and accepted_at is null)
    or (
      status = 'accepted'
      and provider_user_id is not null
      and accepted_at is not null
      and accepted_profile_id is not null
    )
    or (status = 'expired' and accepted_at is null)
  ),
  constraint invites_acceptance_shape check (
    (kind = 'team' and accepted_affiliate_id is null)
    or (
      kind = 'affiliate'
      and (
        (status = 'accepted' and accepted_affiliate_id is not null)
        or (status <> 'accepted' and accepted_affiliate_id is null)
      )
    )
  ),
  constraint invites_failure_code_bound check (
    failure_code is null or char_length(failure_code) between 1 and 64
  )
);

create unique index invites_live_org_email_key
  on public.invites (org_id, email)
  where status in ('pending', 'sent');
create index invites_org_created_idx on public.invites(org_id, created_at desc);
create index invites_provider_user_idx on public.invites(provider_user_id)
  where provider_user_id is not null;

alter table public.invites enable row level security;
alter table public.invites force row level security;
revoke all on table public.invites from public, anon, authenticated;
grant select, insert, update on table public.invites to authenticated;
grant all on table public.invites to service_role;

create policy invites_org_admin_select
on public.invites
for select
to authenticated
using (
  org_id = (select private.auth_org_id())
  and (select private.auth_org_role()) in ('owner', 'admin')
);

create policy invites_org_admin_insert
on public.invites
for insert
to authenticated
with check (
  org_id = (select private.auth_org_id())
  and created_by = (select private.auth_profile_id())
  and (select private.auth_org_role()) in ('owner', 'admin')
);

create policy invites_org_admin_update
on public.invites
for update
to authenticated
using (
  org_id = (select private.auth_org_id())
  and (select private.auth_org_role()) in ('owner', 'admin')
)
with check (
  org_id = (select private.auth_org_id())
  and (select private.auth_org_role()) in ('owner', 'admin')
);

create or replace function public.tenancy_provision_org(
  p_name text,
  p_slug text,
  p_trial_ends_at timestamptz,
  p_email text,
  p_full_name text,
  p_idempotency_key text,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := pg_catalog.lower(pg_catalog.btrim(p_email));
  v_invite public.invites;
  v_org_id uuid;
begin
  if not private.tenancy_actor_is_platform_admin(p_actor_id) then
    raise exception using errcode = '42501', message = 'TENANT_PLATFORM_ADMIN_REQUIRED';
  end if;

  select invite.* into v_invite
  from public.invites as invite
  where invite.idempotency_key = p_idempotency_key
  for update;

  if v_invite.id is not null then
    return pg_catalog.jsonb_build_object(
      'applied', false,
      'org_id', v_invite.org_id,
      'invite_id', v_invite.id,
      'token_id', v_invite.token_id,
      'status', v_invite.status::text
    );
  end if;

  if char_length(pg_catalog.btrim(p_full_name)) not between 1 and 120
    or char_length(v_email) not between 3 and 320
    or p_idempotency_key is null
    or char_length(p_idempotency_key) not between 8 and 200
  then
    raise exception using errcode = '22023', message = 'TENANT_PROVISION_INPUT_INVALID';
  end if;

  v_org_id := private.tenancy_create_org(p_name, p_slug, p_trial_ends_at);

  insert into public.invites (
    org_id, email, full_name, kind, org_role, status, expires_at,
    idempotency_key, created_by
  ) values (
    v_org_id, v_email, pg_catalog.btrim(p_full_name), 'team', 'owner', 'pending',
    pg_catalog.now() + interval '7 days', p_idempotency_key, p_actor_id
  )
  returning * into strict v_invite;

  insert into public.audit_log (
    org_id, client_id, actor_profile_id, action, subject_type, subject_id, occurred_at, meta
  ) values (
    v_org_id, null, p_actor_id, 'org.provisioned', 'org', v_org_id,
    pg_catalog.now(), pg_catalog.jsonb_build_object('source', 'tenancy')
  );

  return pg_catalog.jsonb_build_object(
    'applied', true,
    'org_id', v_org_id,
    'invite_id', v_invite.id,
    'token_id', v_invite.token_id,
    'status', v_invite.status::text
  );
end;
$fn$;

create or replace function public.tenancy_create_invite(
  p_org_id uuid,
  p_email text,
  p_full_name text,
  p_kind text,
  p_org_role text,
  p_expires_at timestamptz,
  p_idempotency_key text,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_invite public.invites;
begin
  if not private.tenancy_actor_can_manage_org(p_actor_id, p_org_id) then
    raise exception using errcode = '42501', message = 'TENANT_ORG_ADMIN_REQUIRED';
  end if;
  if p_kind not in ('team', 'affiliate')
    or (p_kind = 'team' and p_org_role not in ('owner', 'admin', 'member'))
    or (p_kind = 'affiliate' and p_org_role is not null)
    or p_expires_at <= pg_catalog.now()
  then
    raise exception using errcode = '22023', message = 'TENANT_INVITE_INPUT_INVALID';
  end if;

  insert into public.invites (
    org_id, email, full_name, kind, org_role, expires_at,
    idempotency_key, created_by
  ) values (
    p_org_id,
    pg_catalog.lower(pg_catalog.btrim(p_email)),
    pg_catalog.btrim(p_full_name),
    p_kind::public.tenant_invite_kind,
    case when p_org_role is null then null else p_org_role::public.org_role end,
    p_expires_at,
    p_idempotency_key,
    p_actor_id
  )
  on conflict (idempotency_key) do update
    set updated_at = public.invites.updated_at
  returning * into strict v_invite;

  return pg_catalog.jsonb_build_object(
    'applied', true,
    'org_id', v_invite.org_id,
    'invite_id', v_invite.id,
    'token_id', v_invite.token_id,
    'status', v_invite.status::text
  );
end;
$fn$;

create or replace function public.tenancy_mark_invite_delivery(
  p_invite_id uuid,
  p_sent boolean,
  p_provider_user_id uuid,
  p_failure_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_invite public.invites;
begin
  select invite.* into v_invite
  from public.invites as invite
  where invite.id = p_invite_id
  for update;

  if v_invite.id is null then
    raise exception using errcode = 'P0002', message = 'TENANT_INVITE_NOT_FOUND';
  end if;
  if v_invite.status = 'accepted' then
    return pg_catalog.jsonb_build_object('applied', false, 'status', 'accepted');
  end if;
  if p_sent and p_provider_user_id is null then
    raise exception using errcode = '22023', message = 'TENANT_PROVIDER_ID_REQUIRED';
  end if;

  update public.invites
  set status = case when p_sent then 'sent'::public.tenant_invite_status else 'failed'::public.tenant_invite_status end,
      provider_user_id = case when p_sent then p_provider_user_id else provider_user_id end,
      failure_code = case when p_sent then null else coalesce(nullif(p_failure_code, ''), 'provider_error') end,
      updated_at = pg_catalog.now()
  where id = p_invite_id
  returning * into strict v_invite;

  return pg_catalog.jsonb_build_object(
    'applied', true,
    'status', v_invite.status::text
  );
end;
$fn$;

create or replace function public.tenancy_accept_invite(
  p_invite_id uuid,
  p_token_id uuid,
  p_provider_user_id uuid,
  p_email text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_affiliate_id uuid;
  v_existing public.profiles;
  v_invite public.invites;
  v_slug text;
begin
  select invite.* into v_invite
  from public.invites as invite
  where invite.id = p_invite_id
  for update;

  if v_invite.id is null
    or v_invite.status <> 'sent'
    or v_invite.expires_at <= pg_catalog.now()
    or v_invite.token_id <> p_token_id
    or v_invite.provider_user_id <> p_provider_user_id
    or v_invite.email <> pg_catalog.lower(pg_catalog.btrim(p_email))
  then
    raise exception using errcode = 'P0001', message = 'TENANT_INVITE_INVALID';
  end if;

  select profile.* into v_existing
  from public.profiles as profile
  where profile.id = p_provider_user_id
  for update;

  if v_existing.id is not null and (
    v_existing.org_id is distinct from v_invite.org_id
    or v_existing.role::text is distinct from (
      case when v_invite.kind = 'team' then 'operator_member' else 'affiliate' end
    )
  ) then
    raise exception using errcode = '23505', message = 'TENANT_IDENTITY_ALREADY_BOUND';
  end if;

  if v_existing.id is null then
    insert into public.profiles (
      id, role, org_id, org_role, full_name, email
    ) values (
      p_provider_user_id,
      case when v_invite.kind = 'team' then 'operator_member'::public.app_role else 'affiliate'::public.app_role end,
      v_invite.org_id,
      case when v_invite.kind = 'team' then v_invite.org_role else null end,
      v_invite.full_name,
      v_invite.email
    );
  end if;

  if v_invite.kind = 'affiliate' then
    loop
      v_slug := pg_catalog.substr(
        pg_catalog.encode(extensions.gen_random_bytes(6), 'hex'),
        1,
        8
      );
      begin
        insert into public.affiliates (org_id, profile_id, name, referral_slug)
        values (v_invite.org_id, p_provider_user_id, v_invite.full_name, v_slug)
        returning id into v_affiliate_id;
        exit;
      exception when unique_violation then
        if exists (
          select 1 from public.affiliates where profile_id = p_provider_user_id
        ) then
          select id into v_affiliate_id
          from public.affiliates where profile_id = p_provider_user_id;
          exit;
        end if;
      end;
    end loop;
  end if;

  update public.invites
  set status = 'accepted',
      accepted_at = pg_catalog.now(),
      accepted_profile_id = p_provider_user_id,
      accepted_affiliate_id = v_affiliate_id,
      failure_code = null,
      updated_at = pg_catalog.now()
  where id = v_invite.id;

  insert into public.audit_log (
    org_id, client_id, actor_profile_id, action, subject_type, subject_id, occurred_at, meta
  ) values (
    v_invite.org_id, null, p_provider_user_id, 'org.invite_accepted', 'invite',
    v_invite.id, pg_catalog.now(), pg_catalog.jsonb_build_object('source', v_invite.kind::text)
  );

  return pg_catalog.jsonb_build_object(
    'applied', true,
    'org_id', v_invite.org_id,
    'profile_id', p_provider_user_id,
    'affiliate_id', v_affiliate_id,
    'kind', v_invite.kind::text
  );
end;
$fn$;

create or replace function public.tenancy_deactivate_member(
  p_target_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_customer_ref text;
  v_target public.profiles;
begin
  select target.* into v_target
  from public.profiles as target
  where target.id = p_target_id
  for update;

  if v_target.id is null
    or v_target.role <> 'operator_member'
    or not private.tenancy_actor_can_manage_org(p_actor_id, v_target.org_id)
  then
    raise exception using errcode = '42501', message = 'TENANT_MEMBER_NOT_FOUND';
  end if;
  if p_target_id = p_actor_id then
    raise exception using errcode = '22023', message = 'TENANT_MEMBER_SELF_DISABLE_FORBIDDEN';
  end if;
  if v_target.disabled_at is not null then
    return pg_catalog.jsonb_build_object(
      'applied', false,
      'org_id', v_target.org_id,
      'profile_id', v_target.id
    );
  end if;
  if v_target.org_role = 'owner' and not exists (
    select 1
    from public.profiles as owner_profile
    where owner_profile.org_id = v_target.org_id
      and owner_profile.role = 'operator_member'
      and owner_profile.org_role = 'owner'
      and owner_profile.disabled_at is null
      and owner_profile.id <> v_target.id
  ) then
    raise exception using errcode = '22023', message = 'TENANT_LAST_OWNER_DISABLE_FORBIDDEN';
  end if;

  update public.profiles
  set disabled_at = pg_catalog.now()
  where id = v_target.id;

  update public.profiles
  set manages = pg_catalog.array_remove(manages, v_target.id)
  where v_target.id = any(manages);

  update public.clients
  set assigned_to = null
  where assigned_to = v_target.id;

  select subscription.customer_ref into v_customer_ref
  from public.operator_subscriptions as subscription
  where subscription.org_id = v_target.org_id;

  insert into public.audit_log (
    org_id, client_id, actor_profile_id, action, subject_type, subject_id, occurred_at, meta
  ) values (
    v_target.org_id, null, p_actor_id, 'org.member_disabled', 'profile',
    v_target.id, pg_catalog.now(),
    pg_catalog.jsonb_build_object('from', 'enabled', 'to', 'disabled')
  );

  return pg_catalog.jsonb_build_object(
    'applied', true,
    'org_id', v_target.org_id,
    'profile_id', v_target.id,
    'customer_ref', v_customer_ref
  );
end;
$fn$;

create or replace function public.tenancy_email_registered_elsewhere(
  p_email text,
  p_actor_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles as profile
    left join public.profiles as actor on actor.id = p_actor_id
    where pg_catalog.lower(pg_catalog.btrim(profile.email)) = pg_catalog.lower(pg_catalog.btrim(p_email))
      and profile.id <> p_actor_id
      and profile.org_id is distinct from actor.org_id
  )
$$;

create or replace function private.auth_profile_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select profile.id
  from public.profiles as profile
  where profile.id = (select auth.uid())
    and profile.disabled_at is null
$$;

create or replace function private.auth_org_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select profile.org_id
  from public.profiles as profile
  where profile.id = (select auth.uid())
    and profile.disabled_at is null
$$;

create or replace function private.auth_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select profile.role
  from public.profiles as profile
  where profile.id = (select auth.uid())
    and profile.disabled_at is null
$$;

create or replace function private.auth_org_role()
returns public.org_role
language sql
stable
security definer
set search_path = ''
as $$
  select profile.org_role
  from public.profiles as profile
  where profile.id = (select auth.uid())
    and profile.disabled_at is null
$$;

create or replace function private.can_access_client(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select case
        when profile.role = 'platform_admin' then true
        when profile.role = 'consumer' then client.consumer_profile_id = profile.id
        when profile.role = 'operator_member' and client.org_id = profile.org_id then
          organization.team_sees_all_clients
          or client.assigned_to = profile.id
          or profile.org_role in ('owner', 'admin', 'commando')
          or (
            profile.org_role = 'manager'
            and exists (
              select 1
              from public.profiles as managed_profile
              where managed_profile.id = client.assigned_to
                and managed_profile.org_id = profile.org_id
                and managed_profile.role = 'operator_member'
                and managed_profile.disabled_at is null
                and managed_profile.id = any(profile.manages)
            )
          )
        else false
      end
      from public.clients as client
      join public.orgs as organization on organization.id = client.org_id
      join public.profiles as profile on profile.id = (select auth.uid())
      where client.id = p_client_id
        and profile.disabled_at is null
    ),
    false
  )
$$;

create or replace function private.operator_seat_outbox_enqueue()
returns trigger
language plpgsql
set search_path = ''
as $fn$
declare
  v_org_id uuid;
  v_count integer;
  v_included integer;
begin
  for v_org_id in
    select distinct affected.org_id
    from (
      select new.org_id as org_id
      union all
      select old.org_id as org_id
    ) as affected
    where affected.org_id is not null
  loop
    if not exists (
      select 1 from public.operator_subscriptions as subscription
      where subscription.org_id = v_org_id
    ) then
      continue;
    end if;

    select pg_catalog.count(*)::integer into v_count
    from public.profiles as member_profile
    where member_profile.org_id = v_org_id
      and member_profile.role = 'operator_member'
      and member_profile.disabled_at is null;

    select organization.seats_included into v_included
    from public.orgs as organization where organization.id = v_org_id;

    insert into public.operator_seat_sync_outbox (
      org_id, desired_quantity, status, attempts, last_error_code,
      enqueued_at, processed_at
    ) values (
      v_org_id, greatest(0, v_count - coalesce(v_included, 0)),
      'pending', 0, null, pg_catalog.now(), null
    )
    on conflict (org_id) do update
    set desired_quantity = excluded.desired_quantity,
        status = 'pending', attempts = 0, last_error_code = null,
        enqueued_at = excluded.enqueued_at, processed_at = null;
  end loop;
  return null;
end;
$fn$;

drop trigger if exists profiles_operator_seat_sync_update on public.profiles;
create trigger profiles_operator_seat_sync_update
  after update of org_id, role, disabled_at on public.profiles
  for each row execute function private.operator_seat_outbox_enqueue();

insert into storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
)
values (
  'brand-assets', 'brand-assets', true, 2097152,
  array['image/png', 'image/jpeg', 'image/webp']::text[]
)
on conflict (id) do update
set public = true,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create or replace function private.tenancy_brand_path_allowed(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_parts text[];
  v_org_id uuid;
begin
  if p_name !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpe?g|webp)$' then
    return false;
  end if;
  v_parts := storage.foldername(p_name);
  if array_length(v_parts, 1) <> 1 then
    return false;
  end if;
  v_org_id := v_parts[1]::uuid;
  return v_org_id = private.auth_org_id()
    and private.auth_org_role() in ('owner', 'admin');
end;
$fn$;

revoke all on function private.tenancy_brand_path_allowed(text) from public;
grant execute on function private.tenancy_brand_path_allowed(text) to authenticated;

create policy tenancy_brand_assets_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'brand-assets'
  and (select private.tenancy_brand_path_allowed(name))
);

create policy tenancy_brand_assets_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'brand-assets'
  and (select private.tenancy_brand_path_allowed(name))
);

revoke all on function public.tenancy_provision_org(
  text, text, timestamptz, text, text, text, uuid
) from public, anon, authenticated;
revoke all on function public.tenancy_create_invite(
  uuid, text, text, text, text, timestamptz, text, uuid
) from public, anon, authenticated;
revoke all on function public.tenancy_mark_invite_delivery(uuid, boolean, uuid, text)
  from public, anon, authenticated;
revoke all on function public.tenancy_accept_invite(uuid, uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.tenancy_deactivate_member(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.tenancy_email_registered_elsewhere(text, uuid)
  from public, anon, authenticated;

grant execute on function public.tenancy_provision_org(
  text, text, timestamptz, text, text, text, uuid
) to service_role;
grant execute on function public.tenancy_create_invite(
  uuid, text, text, text, text, timestamptz, text, uuid
) to service_role;
grant execute on function public.tenancy_mark_invite_delivery(uuid, boolean, uuid, text)
  to service_role;
grant execute on function public.tenancy_accept_invite(uuid, uuid, uuid, text)
  to service_role;
grant execute on function public.tenancy_deactivate_member(uuid, uuid)
  to service_role;
grant execute on function public.tenancy_email_registered_elsewhere(text, uuid)
  to service_role;

comment on table public.invites is
  'Non-secret invite correlation and durable provider outcome. Provider OTP bearer material is never stored.';

commit;
