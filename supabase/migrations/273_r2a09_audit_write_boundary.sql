-- R2A-09: authenticated callers cannot manufacture audit events.
-- Fixed-action triggers append attribution inside each exposed mutation.

create or replace function private.audit_org_settings_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fields text[] := array[]::text[];
begin
  if old.assignment_mode is distinct from new.assignment_mode then v_fields := array_append(v_fields, 'assignment_mode'); end if;
  if old.default_client_goal_cents is distinct from new.default_client_goal_cents then v_fields := array_append(v_fields, 'default_client_goal_cents'); end if;
  if old.team_sees_all_clients is distinct from new.team_sees_all_clients then v_fields := array_append(v_fields, 'team_sees_all_clients'); end if;
  if cardinality(v_fields) = 0 then return new; end if;

  insert into public.audit_log (
    org_id, actor_profile_id, action, subject_type, subject_id, occurred_at, meta
  ) values (
    new.id, (select auth.uid()), 'org.settings.updated', 'org', new.id,
    pg_catalog.clock_timestamp(), jsonb_build_object('field_names', to_jsonb(v_fields))
  );
  return new;
end;
$$;

create or replace function private.audit_client_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fields text[] := array[]::text[];
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log (
      org_id, client_id, actor_profile_id, action, subject_type, subject_id, occurred_at, meta
    ) values (
      new.org_id, new.id, (select auth.uid()), 'client.created', 'client', new.id,
      pg_catalog.clock_timestamp(), jsonb_build_object('source', 'tracker')
    );
    return new;
  end if;

  if old.goal_cents is distinct from new.goal_cents then v_fields := array_append(v_fields, 'goal_cents'); end if;
  if old.matches_unlocked_override is distinct from new.matches_unlocked_override then v_fields := array_append(v_fields, 'matches_unlocked_override'); end if;
  if cardinality(v_fields) = 0 then return new; end if;

  insert into public.audit_log (
    org_id, client_id, actor_profile_id, action, subject_type, subject_id, occurred_at, meta
  ) values (
    new.org_id, new.id, (select auth.uid()), 'client.metadata.updated', 'client', new.id,
    pg_catalog.clock_timestamp(), jsonb_build_object('field_names', to_jsonb(v_fields))
  );
  return new;
end;
$$;

create or replace function private.audit_fee_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
  v_actor uuid := (select auth.uid());
  v_client_id uuid;
  v_fields text[];
  v_org_id uuid;
  v_subject_id uuid;
  v_subject_type text;
begin
  if v_actor is null then return new; end if;

  if tg_table_name = 'fee_agreements' then
    v_action := 'fees.agreement.updated';
    v_client_id := new.client_id;
    v_org_id := new.org_id;
    v_subject_id := new.client_id;
    v_subject_type := 'client';
    v_fields := array['model','pct','upfront_cents','success_cents','trigger_cents','custom_total_cents','status'];
  elsif tg_table_name = 'fee_payments' then
    v_action := 'fees.payment.recorded';
    v_client_id := new.client_id;
    v_org_id := new.org_id;
    v_subject_id := new.client_id;
    v_subject_type := 'client';
    v_fields := array['amount_cents','received_on','method','reference','note'];
  elsif tg_table_name = 'org_fee_defaults' then
    v_action := 'fees.org_defaults.updated';
    v_client_id := null;
    v_org_id := new.org_id;
    v_subject_id := new.org_id;
    v_subject_type := 'org';
    v_fields := array['model','pct','upfront_cents','success_cents','trigger_cents','custom_total_cents'];
  else
    raise exception using errcode = '55000', message = 'AUDIT_FEE_TABLE_UNSUPPORTED';
  end if;

  insert into public.audit_log (
    org_id, client_id, actor_profile_id, action, subject_type, subject_id, occurred_at, meta
  ) values (
    v_org_id, v_client_id, v_actor, v_action, v_subject_type, v_subject_id,
    pg_catalog.clock_timestamp(), jsonb_build_object('field_names', to_jsonb(v_fields))
  );
  return new;
end;
$$;

create or replace function private.audit_affiliate_share_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
  v_affiliate_id uuid := coalesce(new.affiliate_id, old.affiliate_id);
  v_client_id uuid := coalesce(new.client_id, old.client_id);
  v_fields text[] := array['affiliate_id'];
  v_org_id uuid;
begin
  if tg_op = 'UPDATE' then
    v_fields := array[]::text[];
    if old.expected_commission_cents is distinct from new.expected_commission_cents then v_fields := array_append(v_fields, 'expected_commission_cents'); end if;
    if old.payment_status is distinct from new.payment_status then v_fields := array_append(v_fields, 'payment_status'); end if;
    if cardinality(v_fields) = 0 then return new; end if;
    v_action := 'affiliate.share_updated';
  elsif tg_op = 'INSERT' then
    v_action := 'affiliate.client_shared';
  else
    v_action := 'affiliate.client_unshared';
  end if;

  select client.org_id into v_org_id from public.clients as client where client.id = v_client_id;
  insert into public.audit_log (
    org_id, client_id, actor_profile_id, action, subject_type, subject_id, occurred_at, meta
  ) values (
    v_org_id, v_client_id, (select auth.uid()), v_action, 'affiliate', v_affiliate_id,
    pg_catalog.clock_timestamp(), jsonb_build_object('field_names', to_jsonb(v_fields))
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function private.audit_org_settings_change() from public, anon, authenticated, service_role;
revoke all on function private.audit_client_mutation() from public, anon, authenticated, service_role;
revoke all on function private.audit_fee_mutation() from public, anon, authenticated, service_role;
revoke all on function private.audit_affiliate_share_mutation() from public, anon, authenticated, service_role;

-- This pre-existing trigger also appends a fixed action. It must keep working
-- after the table insert privilege is removed, without exposing a callable
-- generic audit writer.
alter function private.org_flags_audit() security definer;
revoke all on function private.org_flags_audit() from public, anon, authenticated, service_role;

drop trigger if exists orgs_audit_settings_change on public.orgs;
create trigger orgs_audit_settings_change
after update of assignment_mode, default_client_goal_cents, team_sees_all_clients on public.orgs
for each row execute function private.audit_org_settings_change();

drop trigger if exists clients_audit_authenticated_insert on public.clients;
create trigger clients_audit_authenticated_insert
after insert on public.clients for each row
when (auth.uid() is not null)
execute function private.audit_client_mutation();

drop trigger if exists clients_audit_metadata_update on public.clients;
create trigger clients_audit_metadata_update
after update of goal_cents, matches_unlocked_override on public.clients
for each row when (auth.uid() is not null)
execute function private.audit_client_mutation();

drop trigger if exists fee_agreements_audit_mutation on public.fee_agreements;
create trigger fee_agreements_audit_mutation
after insert or update on public.fee_agreements for each row
execute function private.audit_fee_mutation();

drop trigger if exists fee_payments_audit_insert on public.fee_payments;
create trigger fee_payments_audit_insert
after insert on public.fee_payments for each row
execute function private.audit_fee_mutation();

drop trigger if exists org_fee_defaults_audit_mutation on public.org_fee_defaults;
create trigger org_fee_defaults_audit_mutation
after insert or update on public.org_fee_defaults for each row
execute function private.audit_fee_mutation();

drop trigger if exists affiliate_client_shares_audit_mutation on public.affiliate_client_shares;
create trigger affiliate_client_shares_audit_mutation
after insert or update or delete on public.affiliate_client_shares for each row
execute function private.audit_affiliate_share_mutation();

-- The three affiliate RPCs keep RLS as their authorization boundary; their
-- explicit audit inserts are replaced by the fixed-action share trigger above.
create or replace function public.affiliate_share_client(p_affiliate_id uuid, p_client_id uuid)
returns table (inserted boolean, affiliate_id uuid, client_id uuid, expected_commission_cents bigint, payment_status public.affiliate_payment_status)
language plpgsql security invoker set search_path = '' as $$
declare v_inserted boolean := false;
begin
  insert into public.affiliate_client_shares as share (affiliate_id, client_id)
  values (p_affiliate_id, p_client_id)
  on conflict on constraint affiliate_client_shares_pkey do nothing
  returning true into v_inserted;
  v_inserted := coalesce(v_inserted, false);
  return query select v_inserted, share.affiliate_id, share.client_id,
    share.expected_commission_cents, share.payment_status
  from public.affiliate_client_shares as share
  where share.affiliate_id = p_affiliate_id and share.client_id = p_client_id;
  if not found then raise exception using errcode = 'P0002', message = 'affiliate share not found'; end if;
end;
$$;

create or replace function public.affiliate_unshare_client(p_affiliate_id uuid, p_client_id uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_deleted boolean := false;
begin
  delete from public.affiliate_client_shares as share
  where share.affiliate_id = p_affiliate_id and share.client_id = p_client_id
  returning true into v_deleted;
  return coalesce(v_deleted, false);
end;
$$;

create or replace function public.affiliate_update_share(p_affiliate_id uuid, p_client_id uuid, p_patch jsonb)
returns table (affiliate_id uuid, client_id uuid, expected_commission_cents bigint, payment_status public.affiliate_payment_status, changed boolean)
language plpgsql security invoker set search_path = '' as $$
declare
  v_allowed_keys constant text[] := array['expectedCommissionCents', 'paymentStatus'];
  v_changed_fields text[] := array[]::text[];
  v_expected bigint;
  v_status public.affiliate_payment_status;
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb
    or exists (select 1 from jsonb_object_keys(p_patch) as key where key <> all(v_allowed_keys))
  then raise exception using errcode = '22023', message = 'invalid affiliate share patch'; end if;

  if p_patch ? 'expectedCommissionCents' then
    if p_patch -> 'expectedCommissionCents' = 'null'::jsonb then v_expected := null;
    elsif jsonb_typeof(p_patch -> 'expectedCommissionCents') <> 'number'
      or (p_patch ->> 'expectedCommissionCents') !~ '^[0-9]+$'
    then raise exception using errcode = '22023', message = 'invalid affiliate share patch';
    else
      begin v_expected := (p_patch ->> 'expectedCommissionCents')::bigint;
      exception when numeric_value_out_of_range then
        raise exception using errcode = '22023', message = 'invalid affiliate share patch';
      end;
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
      payment_status = case when p_patch ? 'paymentStatus' then v_status else share.payment_status end
  where share.affiliate_id = p_affiliate_id and share.client_id = p_client_id
    and ((p_patch ? 'expectedCommissionCents' and share.expected_commission_cents is distinct from v_expected)
      or (p_patch ? 'paymentStatus' and share.payment_status is distinct from v_status));

  if found then
    if p_patch ? 'expectedCommissionCents' then v_changed_fields := array_append(v_changed_fields, 'expected_commission_cents'); end if;
    if p_patch ? 'paymentStatus' then v_changed_fields := array_append(v_changed_fields, 'payment_status'); end if;
  end if;

  return query select share.affiliate_id, share.client_id, share.expected_commission_cents,
    share.payment_status, cardinality(v_changed_fields) > 0
  from public.affiliate_client_shares as share
  where share.affiliate_id = p_affiliate_id and share.client_id = p_client_id;
end;
$$;

revoke insert on table public.audit_log from authenticated;
drop policy if exists audit_log_actor_insert_lane_a on public.audit_log;
drop policy if exists audit_log_affiliate_client_insert on public.audit_log;
