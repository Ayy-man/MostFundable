begin;

create or replace function private.generate_affiliate_referral_slug()
returns text
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_slug text;
begin
  loop
    v_slug := substr(encode(extensions.gen_random_bytes(4), 'hex'), 1, 8);
    exit when not exists (
      select 1 from public.affiliates where referral_slug = v_slug
    );
  end loop;
  return v_slug;
end;
$fn$;

create or replace function private.fill_affiliate_referral_slug()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if new.referral_slug is null or btrim(new.referral_slug) = '' then
    new.referral_slug := private.generate_affiliate_referral_slug();
  end if;
  return new;
end;
$fn$;

drop trigger if exists affiliates_fill_referral_slug on public.affiliates;
create trigger affiliates_fill_referral_slug
before insert on public.affiliates
for each row execute function private.fill_affiliate_referral_slug();

revoke all on function private.generate_affiliate_referral_slug() from public;
revoke all on function private.fill_affiliate_referral_slug() from public;

create policy audit_log_affiliate_client_insert
on public.audit_log
for insert
to authenticated
with check (
  (select private.auth_app_role()) = 'operator_member'
  and actor_profile_id = (select private.auth_profile_id())
  and client_id is not null
  and org_id = (select private.auth_org_id())
  and (select private.can_access_client(client_id))
);

create or replace function public.affiliate_share_client(
  p_affiliate_id uuid,
  p_client_id uuid
) returns table (
  inserted boolean,
  affiliate_id uuid,
  client_id uuid,
  expected_commission_cents bigint,
  payment_status public.affiliate_payment_status
)
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_inserted boolean := false;
  v_org_id uuid;
begin
  insert into public.affiliate_client_shares as share (affiliate_id, client_id)
  values (p_affiliate_id, p_client_id)
  on conflict on constraint affiliate_client_shares_pkey do nothing
  returning true into v_inserted;
  v_inserted := coalesce(v_inserted, false);

  if v_inserted then
    select client.org_id into v_org_id
    from public.clients as client
    where client.id = p_client_id;

    insert into public.audit_log (
      org_id, client_id, actor_profile_id, action, subject_type, subject_id, meta
    ) values (
      v_org_id,
      p_client_id,
      private.auth_profile_id(),
      'affiliate.client_shared',
      'affiliate',
      p_affiliate_id,
      jsonb_build_object('field_names', jsonb_build_array('affiliate_id'))
    );
  end if;

  return query
  select v_inserted, share.affiliate_id, share.client_id,
    share.expected_commission_cents, share.payment_status
  from public.affiliate_client_shares as share
  where share.affiliate_id = p_affiliate_id and share.client_id = p_client_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'affiliate share not found';
  end if;
end;
$fn$;

create or replace function public.affiliate_unshare_client(
  p_affiliate_id uuid,
  p_client_id uuid
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_deleted boolean := false;
  v_org_id uuid;
begin
  delete from public.affiliate_client_shares as share
  where share.affiliate_id = p_affiliate_id and share.client_id = p_client_id
  returning true into v_deleted;
  v_deleted := coalesce(v_deleted, false);

  if v_deleted then
    select client.org_id into v_org_id
    from public.clients as client
    where client.id = p_client_id;

    insert into public.audit_log (
      org_id, client_id, actor_profile_id, action, subject_type, subject_id, meta
    ) values (
      v_org_id,
      p_client_id,
      private.auth_profile_id(),
      'affiliate.client_unshared',
      'affiliate',
      p_affiliate_id,
      jsonb_build_object('field_names', jsonb_build_array('affiliate_id'))
    );
  end if;

  return v_deleted;
end;
$fn$;

create or replace function public.affiliate_update_share(
  p_affiliate_id uuid,
  p_client_id uuid,
  p_patch jsonb
) returns table (
  affiliate_id uuid,
  client_id uuid,
  expected_commission_cents bigint,
  payment_status public.affiliate_payment_status,
  changed boolean
)
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_allowed_keys constant text[] := array['expectedCommissionCents', 'paymentStatus'];
  v_changed_fields text[] := array[]::text[];
  v_expected bigint;
  v_org_id uuid;
  v_status public.affiliate_payment_status;
begin
  if p_patch is null
    or jsonb_typeof(p_patch) <> 'object'
    or p_patch = '{}'::jsonb
    or exists (
      select 1 from jsonb_object_keys(p_patch) as key
      where key <> all(v_allowed_keys)
    ) then
    raise exception using errcode = '22023', message = 'invalid affiliate share patch';
  end if;

  if p_patch ? 'expectedCommissionCents' then
    if p_patch -> 'expectedCommissionCents' = 'null'::jsonb then
      v_expected := null;
    elsif jsonb_typeof(p_patch -> 'expectedCommissionCents') <> 'number'
      or (p_patch ->> 'expectedCommissionCents') !~ '^[0-9]+$' then
      raise exception using errcode = '22023', message = 'invalid affiliate share patch';
    else
      begin
        v_expected := (p_patch ->> 'expectedCommissionCents')::bigint;
      exception when numeric_value_out_of_range then
        raise exception using errcode = '22023', message = 'invalid affiliate share patch';
      end;
    end if;
  end if;

  if p_patch ? 'paymentStatus' then
    if jsonb_typeof(p_patch -> 'paymentStatus') <> 'string'
      or (p_patch ->> 'paymentStatus') not in ('not_ready', 'pending', 'submitted', 'paid') then
      raise exception using errcode = '22023', message = 'invalid affiliate share patch';
    end if;
    v_status := (p_patch ->> 'paymentStatus')::public.affiliate_payment_status;
  end if;

  select client.org_id into v_org_id
  from public.clients as client
  join public.affiliate_client_shares as share on share.client_id = client.id
  where share.affiliate_id = p_affiliate_id and share.client_id = p_client_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'affiliate share not found';
  end if;

  update public.affiliate_client_shares as share
  set
    expected_commission_cents = case
      when p_patch ? 'expectedCommissionCents' then v_expected
      else share.expected_commission_cents
    end,
    payment_status = case
      when p_patch ? 'paymentStatus' then v_status
      else share.payment_status
    end
  where share.affiliate_id = p_affiliate_id
    and share.client_id = p_client_id
    and (
      (p_patch ? 'expectedCommissionCents'
        and share.expected_commission_cents is distinct from v_expected)
      or (p_patch ? 'paymentStatus' and share.payment_status is distinct from v_status)
    );

  if found then
    if p_patch ? 'expectedCommissionCents' then
      v_changed_fields := array_append(v_changed_fields, 'expected_commission_cents');
    end if;
    if p_patch ? 'paymentStatus' then
      v_changed_fields := array_append(v_changed_fields, 'payment_status');
    end if;

    insert into public.audit_log (
      org_id, client_id, actor_profile_id, action, subject_type, subject_id, meta
    ) values (
      v_org_id,
      p_client_id,
      private.auth_profile_id(),
      'affiliate.share_updated',
      'affiliate',
      p_affiliate_id,
      jsonb_build_object('field_names', to_jsonb(v_changed_fields))
    );
  end if;

  return query
  select share.affiliate_id, share.client_id, share.expected_commission_cents,
    share.payment_status, cardinality(v_changed_fields) > 0
  from public.affiliate_client_shares as share
  where share.affiliate_id = p_affiliate_id and share.client_id = p_client_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'affiliate share not found';
  end if;
end;
$fn$;

revoke all on function public.affiliate_share_client(uuid, uuid) from public, anon;
revoke all on function public.affiliate_unshare_client(uuid, uuid) from public, anon;
revoke all on function public.affiliate_update_share(uuid, uuid, jsonb) from public, anon;
grant execute on function public.affiliate_share_client(uuid, uuid) to authenticated;
grant execute on function public.affiliate_unshare_client(uuid, uuid) to authenticated;
grant execute on function public.affiliate_update_share(uuid, uuid, jsonb) to authenticated;

commit;
