-- Operators can invite a consumer and acceptance creates the one canonical
-- client row for that identity. The provider token is still verified outside
-- Postgres; this function binds only the provider user recorded on the durable
-- invitation and only after every token, email, status and expiry check agrees.

begin;

alter table public.invites
  drop constraint invites_kind_role_shape,
  drop constraint invites_acceptance_shape;

alter table public.invites
  add constraint invites_kind_role_shape check (
    (kind = 'team' and org_role in ('owner', 'admin', 'member'))
    or (kind in ('affiliate', 'client') and org_role is null)
  ),
  add constraint invites_acceptance_shape check (
    (kind in ('team', 'client') and accepted_affiliate_id is null)
    or (
      kind = 'affiliate'
      and (
        (status = 'accepted' and accepted_affiliate_id is not null)
        or (status <> 'accepted' and accepted_affiliate_id is null)
      )
    )
  );

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
  if p_kind not in ('team', 'affiliate', 'client')
    or (p_kind = 'team' and p_org_role not in ('owner', 'admin', 'member'))
    or (p_kind in ('affiliate', 'client') and p_org_role is not null)
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
  v_client_id uuid;
  v_existing public.profiles;
  v_invite public.invites;
  v_role public.app_role;
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

  v_role := case v_invite.kind
    when 'team' then 'operator_member'::public.app_role
    when 'affiliate' then 'affiliate'::public.app_role
    else 'consumer'::public.app_role
  end;

  select profile.* into v_existing
  from public.profiles as profile
  where profile.id = p_provider_user_id
  for update;

  if v_existing.id is null then
    insert into public.profiles (
      id, role, org_id, org_role, full_name, email
    ) values (
      p_provider_user_id,
      v_role,
      v_invite.org_id,
      case when v_invite.kind = 'team' then v_invite.org_role else null end,
      v_invite.full_name,
      v_invite.email
    );
  elsif v_existing.role = 'consumer'
    and v_existing.org_id is null
    and v_existing.org_role is null
    and v_existing.disabled_at is null
  then
    update public.profiles
    set role = v_role,
        org_id = v_invite.org_id,
        org_role = case when v_invite.kind = 'team' then v_invite.org_role else null end,
        full_name = v_invite.full_name,
        email = v_invite.email
    where id = p_provider_user_id;
  elsif v_existing.disabled_at is not null
    or v_existing.org_id is distinct from v_invite.org_id
    or v_existing.role is distinct from v_role
  then
    raise exception using errcode = '23505', message = 'TENANT_IDENTITY_ALREADY_BOUND';
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
  elsif v_invite.kind = 'client' then
    select client.id into v_client_id
    from public.clients as client
    where client.consumer_profile_id = p_provider_user_id
    for update;

    if v_client_id is null then
      insert into public.clients (
        org_id, consumer_profile_id, display_name
      ) values (
        v_invite.org_id, p_provider_user_id, v_invite.full_name
      )
      returning id into strict v_client_id;
    elsif not exists (
      select 1 from public.clients as client
      where client.id = v_client_id and client.org_id = v_invite.org_id
    ) then
      raise exception using errcode = '23505', message = 'TENANT_IDENTITY_ALREADY_BOUND';
    end if;
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
    v_invite.org_id, v_client_id, p_provider_user_id, 'org.invite_accepted', 'invite',
    v_invite.id, pg_catalog.now(), pg_catalog.jsonb_build_object('source', v_invite.kind::text)
  );

  return pg_catalog.jsonb_build_object(
    'applied', true,
    'org_id', v_invite.org_id,
    'profile_id', p_provider_user_id,
    'affiliate_id', v_affiliate_id,
    'client_id', v_client_id,
    'kind', v_invite.kind::text
  );
end;
$fn$;

revoke all on function public.tenancy_create_invite(
  uuid, text, text, text, text, timestamptz, text, uuid
) from public, anon, authenticated;
grant execute on function public.tenancy_create_invite(
  uuid, text, text, text, text, timestamptz, text, uuid
) to service_role;

revoke all on function public.tenancy_accept_invite(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.tenancy_accept_invite(uuid, uuid, uuid, text)
  to service_role;

commit;
