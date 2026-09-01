-- Auth invite creation runs the merged bootstrap trigger before the provider
-- link is accepted. That trigger creates one deliberately unbound consumer
-- profile, so acceptance may correct that exact state and no other identity.

begin;

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
  elsif v_existing.role = 'consumer'
    and v_existing.org_id is null
    and v_existing.org_role is null
    and v_existing.disabled_at is null
  then
    update public.profiles
    set role = case when v_invite.kind = 'team' then 'operator_member'::public.app_role else 'affiliate'::public.app_role end,
        org_id = v_invite.org_id,
        org_role = case when v_invite.kind = 'team' then v_invite.org_role else null end,
        full_name = v_invite.full_name,
        email = v_invite.email
    where id = p_provider_user_id;
  elsif v_existing.org_id is distinct from v_invite.org_id
    or v_existing.role::text is distinct from (
      case when v_invite.kind = 'team' then 'operator_member' else 'affiliate' end
    )
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

revoke all on function public.tenancy_accept_invite(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.tenancy_accept_invite(uuid, uuid, uuid, text)
  to service_role;

commit;
