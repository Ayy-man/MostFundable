-- Operator-owned affiliate lifecycle, default commission, and statement reads.
--
-- The portal already supported per-client share writes and the affiliate's own
-- projection. It did not expose an organization roster, a way to disable an
-- affiliate, or a durable commission default. These functions keep the caller
-- inside their own organization and use profile disablement as the existing
-- authentication boundary, so a deactivated affiliate loses access everywhere
-- `private.auth_app_role()` is used rather than merely disappearing from one UI.

alter table public.affiliates
  add column if not exists default_commission_bps integer not null default 0,
  add constraint affiliates_default_commission_bps_range
    check (default_commission_bps between 0 and 10000);

alter table public.affiliate_client_shares
  add column if not exists commission_override boolean;

-- Every amount recorded before commission defaults existed was entered as an
-- explicit commercial term. Preserve those rows as overrides before the
-- recalculation triggers below can derive amounts from a new default.
update public.affiliate_client_shares
set commission_override = true
where commission_override is null;

-- Rows inserted after this migration follow funded/default changes until an
-- operator records an explicit override.
alter table public.affiliate_client_shares
  alter column commission_override set default false,
  alter column commission_override set not null;

-- Migration 273's fixed-action audit trigger predates commission_override.
-- The mode bit is material even when an explicit amount equals the calculated
-- amount, so the audit row must record that transition as well as cent/status
-- changes.
create or replace function private.audit_affiliate_share_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_action text;
  v_affiliate_id uuid := coalesce(new.affiliate_id, old.affiliate_id);
  v_client_id uuid := coalesce(new.client_id, old.client_id);
  v_fields text[] := array['affiliate_id'];
  v_org_id uuid;
begin
  if tg_op = 'UPDATE' then
    v_fields := array[]::text[];
    if old.expected_commission_cents is distinct from new.expected_commission_cents then
      v_fields := pg_catalog.array_append(v_fields, 'expected_commission_cents');
    end if;
    if old.payment_status is distinct from new.payment_status then
      v_fields := pg_catalog.array_append(v_fields, 'payment_status');
    end if;
    if old.commission_override is distinct from new.commission_override then
      v_fields := pg_catalog.array_append(v_fields, 'commission_override');
    end if;
    if pg_catalog.cardinality(v_fields) = 0 then return new; end if;
    v_action := 'affiliate.share_updated';
  elsif tg_op = 'INSERT' then
    v_action := 'affiliate.client_shared';
  else
    v_action := 'affiliate.client_unshared';
  end if;

  select client.org_id into v_org_id
  from public.clients as client
  where client.id = v_client_id;

  insert into public.audit_log (
    org_id, client_id, actor_profile_id, action, subject_type, subject_id, occurred_at, meta
  ) values (
    v_org_id, v_client_id, (select auth.uid()), v_action, 'affiliate', v_affiliate_id,
    pg_catalog.clock_timestamp(),
    pg_catalog.jsonb_build_object('field_names', pg_catalog.to_jsonb(v_fields))
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$fn$;

revoke all on function private.audit_affiliate_share_mutation()
  from public, anon, authenticated, service_role;

create or replace function private.affiliate_expected_commission(
  p_funded_amount_cents bigint,
  p_commission_bps integer
)
returns bigint
language sql
immutable
strict
set search_path = ''
as $fn$
  select pg_catalog.round(
    p_funded_amount_cents::numeric * p_commission_bps::numeric / 10000
  )::bigint
$fn$;

revoke all on function private.affiliate_expected_commission(bigint, integer)
  from public, anon, authenticated, service_role;

create or replace function private.recalculate_affiliate_share_commission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if tg_table_name = 'clients' then
    update public.affiliate_client_shares as share
    set expected_commission_cents = private.affiliate_expected_commission(
      new.funded_amount_cents,
      affiliate.default_commission_bps
    )
    from public.affiliates as affiliate
    where share.client_id = new.id
      and share.affiliate_id = affiliate.id
      and share.commission_override = false;
    return new;
  end if;

  update public.affiliate_client_shares as share
  set expected_commission_cents = private.affiliate_expected_commission(
    client.funded_amount_cents,
    new.default_commission_bps
  )
  from public.clients as client
  where share.affiliate_id = new.id
    and share.client_id = client.id
    and share.commission_override = false;
  return new;
end;
$fn$;

revoke all on function private.recalculate_affiliate_share_commission()
  from public, anon, authenticated, service_role;

drop trigger if exists clients_recalculate_affiliate_commission on public.clients;
create trigger clients_recalculate_affiliate_commission
after update of funded_amount_cents on public.clients
for each row
when (old.funded_amount_cents is distinct from new.funded_amount_cents)
execute function private.recalculate_affiliate_share_commission();

drop trigger if exists affiliates_recalculate_default_commission on public.affiliates;
create trigger affiliates_recalculate_default_commission
after update of default_commission_bps on public.affiliates
for each row
when (old.default_commission_bps is distinct from new.default_commission_bps)
execute function private.recalculate_affiliate_share_commission();

create or replace function private.audit_affiliate_lifecycle_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_fields text[] := array[]::text[];
begin
  if old.default_commission_bps is distinct from new.default_commission_bps then
    v_fields := pg_catalog.array_append(v_fields, 'default_commission_bps');
  end if;
  if cardinality(v_fields) = 0 then return new; end if;

  insert into public.audit_log (
    org_id, client_id, actor_profile_id, action, subject_type, subject_id, occurred_at, meta
  ) values (
    new.org_id, null, (select auth.uid()), 'affiliate.settings_updated', 'affiliate', new.id,
    pg_catalog.clock_timestamp(), pg_catalog.jsonb_build_object('field_names', pg_catalog.to_jsonb(v_fields))
  );
  return new;
end;
$fn$;

revoke all on function private.audit_affiliate_lifecycle_mutation()
  from public, anon, authenticated, service_role;

drop trigger if exists affiliates_audit_lifecycle_mutation on public.affiliates;
create trigger affiliates_audit_lifecycle_mutation
after update of default_commission_bps on public.affiliates
for each row execute function private.audit_affiliate_lifecycle_mutation();

create or replace function public.operator_affiliate_roster()
returns table (
  affiliate_id uuid,
  profile_id uuid,
  name text,
  email text,
  referral_slug text,
  active boolean,
  default_commission_bps integer,
  shared_clients bigint,
  expected_commission_cents bigint,
  paid_commission_cents bigint
)
language plpgsql
security invoker
set search_path = ''
as $fn$
begin
  if (select private.auth_app_role()) <> 'operator_member'::public.app_role then
    raise exception using errcode = '42501', message = 'AFFILIATE_ROSTER_FORBIDDEN';
  end if;

  return query
  select
    affiliate.id,
    affiliate.profile_id,
    affiliate.name,
    profile.email,
    affiliate.referral_slug,
    profile.disabled_at is null,
    affiliate.default_commission_bps,
    pg_catalog.count(share.client_id),
    coalesce(pg_catalog.sum(share.expected_commission_cents), 0)::bigint,
    coalesce(pg_catalog.sum(share.expected_commission_cents)
      filter (where share.payment_status = 'paid'::public.affiliate_payment_status), 0)::bigint
  from public.affiliates as affiliate
  join public.profiles as profile on profile.id = affiliate.profile_id
  left join public.affiliate_client_shares as share on share.affiliate_id = affiliate.id
  where affiliate.org_id = (select private.auth_org_id())
  group by affiliate.id, profile.id, profile.email, profile.disabled_at
  order by affiliate.name, affiliate.id;
end;
$fn$;

create or replace function public.operator_affiliate_statement(p_affiliate_id uuid)
returns table (
  affiliate_id uuid,
  client_id uuid,
  client_name text,
  started_at date,
  stage public.client_stage,
  funded_amount_cents bigint,
  expected_commission_cents bigint,
  payment_status public.affiliate_payment_status,
  commission_override boolean
)
language plpgsql
security invoker
set search_path = ''
as $fn$
begin
  if (select private.auth_app_role()) <> 'operator_member'::public.app_role
    or not exists (
      select 1
      from public.affiliates as affiliate
      where affiliate.id = p_affiliate_id
        and affiliate.org_id = (select private.auth_org_id())
    )
  then
    raise exception using errcode = 'P0002', message = 'AFFILIATE_NOT_FOUND';
  end if;

  return query
  select
    share.affiliate_id,
    client.id,
    client.display_name,
    client.started_at,
    client.stage,
    client.funded_amount_cents,
    share.expected_commission_cents,
    share.payment_status,
    share.commission_override
  from public.affiliate_client_shares as share
  join public.clients as client on client.id = share.client_id
  where share.affiliate_id = p_affiliate_id
    and client.org_id = (select private.auth_org_id())
  order by client.started_at desc, client.id;
end;
$fn$;

create or replace function public.operator_affiliate_update(
  p_affiliate_id uuid,
  p_patch jsonb
)
returns table (
  affiliate_id uuid,
  active boolean,
  default_commission_bps integer,
  changed boolean
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_affiliate public.affiliates;
  v_profile public.profiles;
  v_active boolean;
  v_bps integer;
  v_changed boolean := false;
  v_allowed constant text[] := array['active', 'defaultCommissionBps'];
begin
  if (select auth.role()) <> 'authenticated'
    or (select private.auth_app_role()) <> 'operator_member'::public.app_role
    or (select private.auth_org_role()) not in ('owner'::public.org_role, 'admin'::public.org_role)
  then
    raise exception using errcode = '42501', message = 'AFFILIATE_UPDATE_FORBIDDEN';
  end if;

  if p_patch is null or pg_catalog.jsonb_typeof(p_patch) <> 'object'
    or p_patch = '{}'::jsonb
    or exists (
      select 1 from pg_catalog.jsonb_object_keys(p_patch) as key
      where key <> all(v_allowed)
    )
  then
    raise exception using errcode = '22023', message = 'AFFILIATE_PATCH_INVALID';
  end if;

  select affiliate.* into v_affiliate
  from public.affiliates as affiliate
  where affiliate.id = p_affiliate_id
    and affiliate.org_id = (select private.auth_org_id())
  for update;

  if v_affiliate.id is null or v_affiliate.profile_id is null then
    raise exception using errcode = 'P0002', message = 'AFFILIATE_NOT_FOUND';
  end if;

  select profile.* into v_profile
  from public.profiles as profile
  where profile.id = v_affiliate.profile_id
    and profile.org_id = v_affiliate.org_id
    and profile.role = 'affiliate'::public.app_role
  for update;

  if v_profile.id is null then
    raise exception using errcode = 'P0002', message = 'AFFILIATE_NOT_FOUND';
  end if;

  if p_patch ? 'active' then
    if pg_catalog.jsonb_typeof(p_patch -> 'active') <> 'boolean' then
      raise exception using errcode = '22023', message = 'AFFILIATE_PATCH_INVALID';
    end if;
    v_active := (p_patch ->> 'active')::boolean;
    if v_active is distinct from (v_profile.disabled_at is null) then
      update public.profiles
      set disabled_at = case when v_active then null else pg_catalog.now() end
      where id = v_profile.id;
      v_changed := true;

      insert into public.audit_log (
        org_id, client_id, actor_profile_id, action, subject_type, subject_id, occurred_at, meta
      ) values (
        v_affiliate.org_id, null, v_actor,
        case when v_active then 'affiliate.reactivated' else 'affiliate.deactivated' end,
        'affiliate', v_affiliate.id, pg_catalog.clock_timestamp(),
        pg_catalog.jsonb_build_object(
          'from', case when v_active then 'disabled' else 'enabled' end,
          'to', case when v_active then 'enabled' else 'disabled' end
        )
      );
    end if;
  end if;

  if p_patch ? 'defaultCommissionBps' then
    if pg_catalog.jsonb_typeof(p_patch -> 'defaultCommissionBps') <> 'number'
      or (p_patch ->> 'defaultCommissionBps') !~ '^[0-9]+$'
    then
      raise exception using errcode = '22023', message = 'AFFILIATE_PATCH_INVALID';
    end if;
    begin
      v_bps := (p_patch ->> 'defaultCommissionBps')::integer;
    exception when numeric_value_out_of_range then
      raise exception using errcode = '22023', message = 'AFFILIATE_PATCH_INVALID';
    end;
    if v_bps < 0 or v_bps > 10000 then
      raise exception using errcode = '22023', message = 'AFFILIATE_PATCH_INVALID';
    end if;
    if v_bps is distinct from v_affiliate.default_commission_bps then
      update public.affiliates
      set default_commission_bps = v_bps
      where id = v_affiliate.id;
      v_affiliate.default_commission_bps := v_bps;
      v_changed := true;
    end if;
  end if;

  return query
  select v_affiliate.id,
    case
      when p_patch ? 'active' then (p_patch ->> 'active')::boolean
      else v_profile.disabled_at is null
    end,
    v_affiliate.default_commission_bps,
    v_changed;
end;
$fn$;

-- A newly shared client inherits the affiliate's configured percentage. A
-- later explicit amount remains an override; resetting that amount to null
-- returns the row to the calculated default.
create or replace function public.affiliate_share_client(p_affiliate_id uuid, p_client_id uuid)
returns table (inserted boolean, affiliate_id uuid, client_id uuid, expected_commission_cents bigint, payment_status public.affiliate_payment_status)
language plpgsql security invoker set search_path = '' as $fn$
declare v_inserted boolean := false;
begin
  insert into public.affiliate_client_shares as share (
    affiliate_id, client_id, expected_commission_cents, commission_override
  )
  select affiliate.id, client.id,
    pg_catalog.round(
      client.funded_amount_cents::numeric * affiliate.default_commission_bps::numeric / 10000
    )::bigint,
    false
  from public.affiliates as affiliate
  join public.clients as client on client.id = p_client_id
  join public.profiles as profile on profile.id = affiliate.profile_id
  where affiliate.id = p_affiliate_id
    and profile.disabled_at is null
  on conflict on constraint affiliate_client_shares_pkey do nothing
  returning true into v_inserted;
  v_inserted := coalesce(v_inserted, false);
  return query select v_inserted, share.affiliate_id, share.client_id,
    share.expected_commission_cents, share.payment_status
  from public.affiliate_client_shares as share
  where share.affiliate_id = p_affiliate_id and share.client_id = p_client_id;
  if not found then raise exception using errcode = 'P0002', message = 'affiliate share not found'; end if;
end;
$fn$;

create or replace function public.affiliate_update_share(p_affiliate_id uuid, p_client_id uuid, p_patch jsonb)
returns table (affiliate_id uuid, client_id uuid, expected_commission_cents bigint, payment_status public.affiliate_payment_status, changed boolean)
language plpgsql security invoker set search_path = '' as $fn$
declare
  v_allowed_keys constant text[] := array['expectedCommissionCents', 'paymentStatus'];
  v_changed boolean := false;
  v_expected bigint;
  v_override boolean;
  v_status public.affiliate_payment_status;
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb
    or exists (select 1 from jsonb_object_keys(p_patch) as key where key <> all(v_allowed_keys))
  then raise exception using errcode = '22023', message = 'invalid affiliate share patch'; end if;

  if p_patch ? 'expectedCommissionCents' then
    if p_patch -> 'expectedCommissionCents' = 'null'::jsonb then
      select pg_catalog.round(
        client.funded_amount_cents::numeric * affiliate.default_commission_bps::numeric / 10000
      )::bigint
      into v_expected
      from public.clients as client
      join public.affiliates as affiliate on affiliate.id = p_affiliate_id
      where client.id = p_client_id;
      v_override := false;
    elsif jsonb_typeof(p_patch -> 'expectedCommissionCents') <> 'number'
      or (p_patch ->> 'expectedCommissionCents') !~ '^[0-9]+$'
    then raise exception using errcode = '22023', message = 'invalid affiliate share patch';
    else
      begin v_expected := (p_patch ->> 'expectedCommissionCents')::bigint;
      exception when numeric_value_out_of_range then
        raise exception using errcode = '22023', message = 'invalid affiliate share patch';
      end;
      v_override := true;
    end if;
  end if;

  if p_patch ? 'paymentStatus' then
    if jsonb_typeof(p_patch -> 'paymentStatus') <> 'string'
      or (p_patch ->> 'paymentStatus') not in ('not_ready', 'pending', 'submitted', 'paid')
    then raise exception using errcode = '22023', message = 'invalid affiliate share patch'; end if;
    v_status := (p_patch ->> 'paymentStatus')::public.affiliate_payment_status;
  end if;

  if not exists (
    select 1 from public.affiliate_client_shares as share
    where share.affiliate_id = p_affiliate_id and share.client_id = p_client_id
  ) then raise exception using errcode = 'P0002', message = 'affiliate share not found'; end if;

  update public.affiliate_client_shares as share
  set expected_commission_cents = case when p_patch ? 'expectedCommissionCents' then v_expected else share.expected_commission_cents end,
      commission_override = case when p_patch ? 'expectedCommissionCents' then v_override else share.commission_override end,
      payment_status = case when p_patch ? 'paymentStatus' then v_status else share.payment_status end
  where share.affiliate_id = p_affiliate_id and share.client_id = p_client_id
    and ((p_patch ? 'expectedCommissionCents'
          and (share.expected_commission_cents is distinct from v_expected or share.commission_override is distinct from v_override))
      or (p_patch ? 'paymentStatus' and share.payment_status is distinct from v_status));
  v_changed := found;

  return query select share.affiliate_id, share.client_id, share.expected_commission_cents,
    share.payment_status, v_changed
  from public.affiliate_client_shares as share
  where share.affiliate_id = p_affiliate_id and share.client_id = p_client_id;
end;
$fn$;

revoke all on function public.operator_affiliate_roster() from public, anon;
revoke all on function public.operator_affiliate_statement(uuid) from public, anon;
revoke all on function public.operator_affiliate_update(uuid, jsonb) from public, anon;
grant execute on function public.operator_affiliate_roster() to authenticated;
grant execute on function public.operator_affiliate_statement(uuid) to authenticated;
grant execute on function public.operator_affiliate_update(uuid, jsonb) to authenticated;

comment on function public.operator_affiliate_update(uuid, jsonb) is
  'Owner/admin affiliate lifecycle and commission-default mutation. Deactivation uses profiles.disabled_at so the existing auth boundary closes the whole affiliate portal.';
