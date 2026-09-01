-- R3A-10: fee authority fields must agree with the stored session actor.

create or replace function private.guard_fee_agreement_attribution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_kind text;
begin
  if pg_catalog.current_setting('app.governed_fee_seed', true) = 'on'
    and pg_catalog.pg_trigger_depth() > 1
    and new.source = 'workspace_default'
  then
    return new;
  end if;

  -- Preserve the seeder's documented replay shape: an identical
  -- workspace-default insert that will hit ON CONFLICT DO NOTHING is harmless.
  if tg_op = 'INSERT'
    and new.source = 'workspace_default'
    and exists (
      select 1
      from public.fee_agreements as agreement
      where agreement.client_id = new.client_id
        and agreement.source = 'workspace_default'
    )
  then
    return new;
  end if;

  if (select auth.role()) = 'authenticated' then
    v_actor_kind := private.session_actor_kind((select auth.uid()));
    if (v_actor_kind = 'operator' and new.source <> 'operator_override')
      or (v_actor_kind = 'platform_admin' and new.source <> 'platform_admin')
      or v_actor_kind not in ('operator', 'platform_admin')
    then
      raise exception using errcode = '42501', message = 'FEE_AGREEMENT_ACTOR_MISMATCH';
    end if;
  end if;
  return new;
end;
$$;

create or replace function private.guard_org_fee_default_attribution()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.role()) = 'authenticated'
    and new.updated_by is distinct from (select auth.uid())
  then
    raise exception using errcode = '42501', message = 'FEE_DEFAULT_ACTOR_MISMATCH';
  end if;
  return new;
end;
$$;

create or replace function private.guard_fee_payment_attribution()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.role()) = 'authenticated'
    and (tg_op = 'INSERT' or new.recorded_by is distinct from old.recorded_by)
    and new.recorded_by is distinct from (select auth.uid())
  then
    raise exception using errcode = '42501', message = 'FEE_PAYMENT_ACTOR_MISMATCH';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_fee_agreement_attribution()
  from public, anon, authenticated, service_role;
revoke all on function private.guard_org_fee_default_attribution()
  from public, anon, authenticated, service_role;
revoke all on function private.guard_fee_payment_attribution()
  from public, anon, authenticated, service_role;

drop trigger if exists fee_agreements_guard_attribution on public.fee_agreements;
create trigger fee_agreements_guard_attribution
before insert or update on public.fee_agreements
for each row execute function private.guard_fee_agreement_attribution();
alter table public.fee_agreements enable always trigger fee_agreements_guard_attribution;

drop trigger if exists org_fee_defaults_guard_attribution on public.org_fee_defaults;
create trigger org_fee_defaults_guard_attribution
before insert or update on public.org_fee_defaults
for each row execute function private.guard_org_fee_default_attribution();
alter table public.org_fee_defaults enable always trigger org_fee_defaults_guard_attribution;

drop trigger if exists fee_payments_guard_attribution on public.fee_payments;
create trigger fee_payments_guard_attribution
before insert or update on public.fee_payments
for each row execute function private.guard_fee_payment_attribution();
alter table public.fee_payments enable always trigger fee_payments_guard_attribution;

create or replace function private.fee_seed_client_from_default()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_default public.org_fee_defaults;
  v_previous_marker text := current_setting('app.governed_fee_seed', true);
begin
  select * into v_default
  from public.org_fee_defaults as defaults
  where defaults.org_id = new.org_id;

  if not found then
    return new;
  end if;

  begin
    perform pg_catalog.set_config('app.governed_fee_seed', 'on', true);
    insert into public.fee_agreements (
      client_id, org_id, model, pct, upfront_cents, success_cents,
      trigger_cents, custom_total_cents, status, source
    ) values (
      new.id, new.org_id, v_default.model, v_default.pct,
      v_default.upfront_cents, v_default.success_cents, v_default.trigger_cents,
      v_default.custom_total_cents, 'draft', 'workspace_default'
    ) on conflict (client_id) do nothing;

    insert into public.fee_ledger (client_id, org_id)
    values (new.id, new.org_id)
    on conflict (client_id) do nothing;
    perform pg_catalog.set_config('app.governed_fee_seed', coalesce(v_previous_marker, ''), true);
  exception
    when sqlstate 'PT403' or sqlstate '42501' then
      perform pg_catalog.set_config('app.governed_fee_seed', coalesce(v_previous_marker, ''), true);
      return new;
  end;

  return new;
end;
$$;

revoke all on function private.fee_seed_client_from_default()
  from public, anon, service_role;
grant execute on function private.fee_seed_client_from_default() to authenticated;
