begin;

create table public.saas_referrals (
  id uuid primary key default extensions.gen_random_uuid(),
  referrer_org_id uuid not null references public.orgs(id) on delete restrict,
  referred_org_id uuid not null unique references public.orgs(id) on delete restrict,
  pct numeric(5, 2) not null default 20,
  months smallint not null default 12,
  base text not null default 'platform_subscription',
  started_at date not null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint saas_referrals_distinct_orgs check (referrer_org_id <> referred_org_id),
  constraint saas_referrals_pct_range check (pct between 0 and 100),
  constraint saas_referrals_fixed_term check (months = 12),
  constraint saas_referrals_base_valid check (
    base in ('platform_subscription', 'consumer_subscriptions')
  )
);

create table public.operator_earnings_ledger (
  id uuid primary key default extensions.gen_random_uuid(),
  operator_org_id uuid not null references public.orgs(id) on delete restrict,
  accrual_month date not null,
  base_amount_cents bigint not null default 0,
  pct_snapshot numeric(5, 2),
  amount_cents bigint,
  source_row_count integer not null default 0,
  is_complete boolean not null default false,
  incomplete_code text,
  created_at timestamptz not null default pg_catalog.now(),
  constraint operator_earnings_org_month_unique unique (operator_org_id, accrual_month),
  constraint operator_earnings_month_start check (
    accrual_month = pg_catalog.date_trunc('month', accrual_month)::date
  ),
  constraint operator_earnings_base_nonnegative check (base_amount_cents >= 0),
  constraint operator_earnings_pct_range check (
    pct_snapshot is null or pct_snapshot between 0 and 100
  ),
  constraint operator_earnings_amount_nonnegative check (
    amount_cents is null or amount_cents >= 0
  ),
  constraint operator_earnings_source_count_nonnegative check (source_row_count >= 0),
  constraint operator_earnings_null_split_no_amount check (
    pct_snapshot is not null or amount_cents is null
  ),
  constraint operator_earnings_amount_matches_basis check (
    amount_cents is null
    or amount_cents = pg_catalog.round(base_amount_cents * pct_snapshot / 100.0)::bigint
  ),
  constraint operator_earnings_incomplete_code_valid check (
    incomplete_code is null
    or incomplete_code in (
      'monitoring_split_unset',
      'paid_invoice_evidence_missing',
      'consumer_subscriptions_missing'
    )
  ),
  constraint operator_earnings_completeness_shape check (
    (is_complete and incomplete_code is null)
    or (not is_complete and incomplete_code is not null)
  )
);

create table public.referral_ledger (
  id uuid primary key default extensions.gen_random_uuid(),
  saas_referral_id uuid not null references public.saas_referrals(id) on delete restrict,
  referrer_org_id uuid not null references public.orgs(id) on delete restrict,
  referred_org_id uuid not null references public.orgs(id) on delete restrict,
  accrual_month date not null,
  cycle_number smallint not null,
  base_snapshot text not null,
  base_amount_cents bigint not null default 0,
  pct_snapshot numeric(5, 2) not null,
  amount_cents bigint not null default 0,
  source_row_count integer not null default 0,
  is_complete boolean not null default false,
  incomplete_code text,
  created_at timestamptz not null default pg_catalog.now(),
  constraint referral_ledger_referral_month_unique unique (saas_referral_id, accrual_month),
  constraint referral_ledger_referral_cycle_unique unique (saas_referral_id, cycle_number),
  constraint referral_ledger_month_start check (
    accrual_month = pg_catalog.date_trunc('month', accrual_month)::date
  ),
  constraint referral_ledger_cycle_range check (cycle_number between 1 and 12),
  constraint referral_ledger_base_valid check (
    base_snapshot in ('platform_subscription', 'consumer_subscriptions')
  ),
  constraint referral_ledger_base_nonnegative check (base_amount_cents >= 0),
  constraint referral_ledger_pct_range check (pct_snapshot between 0 and 100),
  constraint referral_ledger_amount_nonnegative check (amount_cents >= 0),
  constraint referral_ledger_amount_matches_basis check (
    amount_cents = pg_catalog.round(base_amount_cents * pct_snapshot / 100.0)::bigint
  ),
  constraint referral_ledger_source_count_nonnegative check (source_row_count >= 0),
  constraint referral_ledger_incomplete_code_valid check (
    incomplete_code is null
    or incomplete_code in (
      'paid_invoice_evidence_missing',
      'platform_subscription_missing',
      'consumer_subscriptions_missing'
    )
  ),
  constraint referral_ledger_completeness_shape check (
    (is_complete and incomplete_code is null)
    or (not is_complete and incomplete_code is not null)
  )
);

create index saas_referrals_referrer_org_idx
  on public.saas_referrals(referrer_org_id);
create index operator_earnings_ledger_month_idx
  on public.operator_earnings_ledger(accrual_month);
create index referral_ledger_month_idx
  on public.referral_ledger(accrual_month);

create trigger operator_earnings_ledger_prevent_change
before update or delete on public.operator_earnings_ledger
for each row execute function private.prevent_row_change();

create trigger referral_ledger_prevent_change
before update or delete on public.referral_ledger
for each row execute function private.prevent_row_change();

create function public.revenue_read_accrual_inputs(
  p_operator_org_id uuid,
  p_accrual_month date
)
returns table (
  operator_org_id uuid,
  org_base_price_cents integer,
  org_seat_price_cents integer,
  operator_subscription jsonb,
  consumer_subscriptions jsonb,
  referral jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if p_operator_org_id is null
    or p_accrual_month is null
    or p_accrual_month <> pg_catalog.date_trunc('month', p_accrual_month)::date
  then
    raise exception using errcode = '22023', message = 'invalid revenue accrual input';
  end if;

  return query
  select
    organization.id,
    organization.base_price_cents,
    organization.seat_price_cents,
    (
      select pg_catalog.jsonb_build_object(
        'provider', subscription.provider,
        'status', subscription.status::text,
        'seat_quantity', subscription.seat_quantity
      )
      from public.operator_subscriptions as subscription
      where subscription.org_id = organization.id
    ),
    coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'provider', subscription.provider,
            'price_cents', subscription.price_cents
          ) order by subscription.id
        )
        from public.consumer_subscriptions as subscription
        join public.clients as client on client.id = subscription.client_id
        where client.org_id = organization.id
          and subscription.status = 'active'
      ),
      '[]'::jsonb
    ),
    (
      select pg_catalog.jsonb_build_object(
        'id', referral_row.id,
        'referrer_org_id', referral_row.referrer_org_id,
        'referred_org_id', referral_row.referred_org_id,
        'pct', referral_row.pct,
        'months', referral_row.months,
        'base', referral_row.base,
        'started_at', referral_row.started_at
      )
      from public.saas_referrals as referral_row
      where referral_row.referred_org_id = organization.id
        and p_accrual_month >= pg_catalog.date_trunc('month', referral_row.started_at)::date
        and p_accrual_month < (
          pg_catalog.date_trunc('month', referral_row.started_at)
          + pg_catalog.make_interval(months => referral_row.months)
        )::date
    )
  from public.orgs as organization
  where organization.id = p_operator_org_id;
end;
$fn$;

create function public.revenue_list_accrual_orgs()
returns table (operator_org_id uuid)
language sql
stable
security definer
set search_path = ''
as $fn$
  select organization.id
  from public.orgs as organization
  where exists (
    select 1
    from public.profiles as profile
    where profile.org_id = organization.id
      and profile.role = 'operator_member'
  )
  or exists (
    select 1
    from public.operator_subscriptions as subscription
    where subscription.org_id = organization.id
  )
  order by organization.id
$fn$;

create function public.revenue_post_billing_accrual(
  p_operator_org_id uuid,
  p_accrual_month date,
  p_operator_base_amount_cents bigint,
  p_operator_pct_snapshot numeric,
  p_operator_amount_cents bigint,
  p_operator_source_row_count integer,
  p_operator_is_complete boolean,
  p_operator_incomplete_code text,
  p_referral_snapshots jsonb default '[]'::jsonb
)
returns table (operator_rows integer, referral_rows integer)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_operator_rows integer := 0;
  v_referral_rows integer := 0;
  v_snapshot jsonb;
  v_referral public.saas_referrals%rowtype;
  v_cycle integer;
  v_base_amount bigint;
  v_pct numeric;
  v_amount bigint;
  v_source_count integer;
  v_is_complete boolean;
  v_incomplete_code text;
  v_inserted integer;
begin
  if p_operator_org_id is null
    or p_accrual_month is null
    or p_accrual_month <> pg_catalog.date_trunc('month', p_accrual_month)::date
    or p_operator_base_amount_cents < 0
    or p_operator_source_row_count < 0
    or p_operator_is_complete is null
    or pg_catalog.jsonb_typeof(coalesce(p_referral_snapshots, '[]'::jsonb)) <> 'array'
  then
    raise exception using errcode = '22023', message = 'invalid revenue accrual snapshot';
  end if;

  if p_operator_pct_snapshot is null then
    if p_operator_amount_cents is not null
      or p_operator_is_complete
      or p_operator_incomplete_code <> 'monitoring_split_unset'
    then
      raise exception using errcode = '22023', message = 'invalid revenue accrual snapshot';
    end if;
  elsif p_operator_pct_snapshot < 0
    or p_operator_pct_snapshot > 100
    or p_operator_amount_cents is distinct from
      pg_catalog.round(p_operator_base_amount_cents * p_operator_pct_snapshot / 100.0)::bigint
    or (p_operator_is_complete and p_operator_incomplete_code is not null)
    or (not p_operator_is_complete and p_operator_incomplete_code is null)
  then
    raise exception using errcode = '22023', message = 'invalid revenue accrual snapshot';
  end if;

  insert into public.operator_earnings_ledger (
    operator_org_id,
    accrual_month,
    base_amount_cents,
    pct_snapshot,
    amount_cents,
    source_row_count,
    is_complete,
    incomplete_code
  ) values (
    p_operator_org_id,
    p_accrual_month,
    p_operator_base_amount_cents,
    p_operator_pct_snapshot,
    p_operator_amount_cents,
    p_operator_source_row_count,
    p_operator_is_complete,
    p_operator_incomplete_code
  )
  on conflict (operator_org_id, accrual_month) do nothing;
  get diagnostics v_operator_rows = row_count;

  for v_snapshot in
    select value from pg_catalog.jsonb_array_elements(coalesce(p_referral_snapshots, '[]'::jsonb))
  loop
    if (v_snapshot - array[
      'saas_referral_id', 'referrer_org_id', 'referred_org_id', 'accrual_month',
      'cycle_number', 'base_snapshot', 'base_amount_cents', 'pct_snapshot',
      'amount_cents', 'source_row_count', 'is_complete', 'incomplete_code'
    ]) <> '{}'::jsonb then
      raise exception using errcode = '22023', message = 'invalid referral snapshot';
    end if;

    begin
      select * into strict v_referral
      from public.saas_referrals
      where id = (v_snapshot->>'saas_referral_id')::uuid;

      v_cycle := (v_snapshot->>'cycle_number')::integer;
      v_base_amount := (v_snapshot->>'base_amount_cents')::bigint;
      v_pct := (v_snapshot->>'pct_snapshot')::numeric;
      v_amount := (v_snapshot->>'amount_cents')::bigint;
      v_source_count := (v_snapshot->>'source_row_count')::integer;
      v_is_complete := (v_snapshot->>'is_complete')::boolean;
      v_incomplete_code := nullif(v_snapshot->>'incomplete_code', '');
    exception when others then
      raise exception using errcode = '22023', message = 'invalid referral snapshot';
    end;

    if (v_snapshot->>'referrer_org_id')::uuid <> v_referral.referrer_org_id
      or (v_snapshot->>'referred_org_id')::uuid <> v_referral.referred_org_id
      or (v_snapshot->>'accrual_month')::date <> p_accrual_month
      or v_referral.referred_org_id <> p_operator_org_id
      or v_snapshot->>'base_snapshot' <> v_referral.base
      or v_pct <> v_referral.pct
      or v_cycle <> (
        1
        + (pg_catalog.date_part('year', p_accrual_month)::integer
          - pg_catalog.date_part('year', v_referral.started_at)::integer) * 12
        + pg_catalog.date_part('month', p_accrual_month)::integer
        - pg_catalog.date_part('month', v_referral.started_at)::integer
      )
      or v_cycle < 1
      or v_cycle > v_referral.months
      or v_base_amount < 0
      or v_source_count < 0
      or v_amount <> pg_catalog.round(v_base_amount * v_pct / 100.0)::bigint
      or (v_is_complete and v_incomplete_code is not null)
      or (not v_is_complete and v_incomplete_code is null)
    then
      raise exception using errcode = '22023', message = 'invalid referral snapshot';
    end if;

    insert into public.referral_ledger (
      saas_referral_id,
      referrer_org_id,
      referred_org_id,
      accrual_month,
      cycle_number,
      base_snapshot,
      base_amount_cents,
      pct_snapshot,
      amount_cents,
      source_row_count,
      is_complete,
      incomplete_code
    ) values (
      v_referral.id,
      v_referral.referrer_org_id,
      v_referral.referred_org_id,
      p_accrual_month,
      v_cycle,
      v_referral.base,
      v_base_amount,
      v_pct,
      v_amount,
      v_source_count,
      v_is_complete,
      v_incomplete_code
    )
    on conflict (saas_referral_id, accrual_month) do nothing;
    get diagnostics v_inserted = row_count;
    v_referral_rows := v_referral_rows + v_inserted;
  end loop;

  return query select v_operator_rows, v_referral_rows;
end;
$fn$;

create function public.revenue_read_kpis(p_accrual_month date)
returns table (
  monitoring_share_total_cents bigint,
  saas_referral_total_cents bigint,
  expected_operator_rows bigint,
  present_operator_rows bigint,
  expected_referral_rows bigint,
  present_referral_rows bigint,
  is_complete boolean,
  incomplete_codes text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if (select private.auth_app_role()) is distinct from 'platform_admin'::public.app_role then
    raise exception using errcode = '42501', message = 'platform administrator required';
  end if;

  if p_accrual_month is null
    or p_accrual_month <> pg_catalog.date_trunc('month', p_accrual_month)::date
  then
    raise exception using errcode = '22023', message = 'invalid revenue KPI window';
  end if;

  return query
  with expected_operators as (
    select organization.operator_org_id
    from public.revenue_list_accrual_orgs() as organization
  ),
  expected_referrals as (
    select referral_row.id
    from public.saas_referrals as referral_row
    where p_accrual_month >= pg_catalog.date_trunc('month', referral_row.started_at)::date
      and p_accrual_month < (
        pg_catalog.date_trunc('month', referral_row.started_at)
        + pg_catalog.make_interval(months => referral_row.months)
      )::date
  ),
  operator_rollup as (
    select
      coalesce(sum(ledger.amount_cents), 0)::bigint as total,
      count(*)::bigint as present,
      coalesce(bool_and(ledger.is_complete), true) as complete,
      coalesce(array_agg(distinct ledger.incomplete_code)
        filter (where ledger.incomplete_code is not null), '{}'::text[]) as codes
    from public.operator_earnings_ledger as ledger
    where ledger.accrual_month = p_accrual_month
  ),
  referral_rollup as (
    select
      coalesce(sum(ledger.amount_cents), 0)::bigint as total,
      count(*)::bigint as present,
      coalesce(bool_and(ledger.is_complete), true) as complete,
      coalesce(array_agg(distinct ledger.incomplete_code)
        filter (where ledger.incomplete_code is not null), '{}'::text[]) as codes
    from public.referral_ledger as ledger
    where ledger.accrual_month = p_accrual_month
  )
  select
    operator_rollup.total,
    referral_rollup.total,
    (select count(*) from expected_operators),
    operator_rollup.present,
    (select count(*) from expected_referrals),
    referral_rollup.present,
    operator_rollup.complete
      and referral_rollup.complete
      and operator_rollup.present = (select count(*) from expected_operators)
      and referral_rollup.present = (select count(*) from expected_referrals),
    (
      select coalesce(array_agg(distinct code order by code), '{}'::text[])
      from unnest(
        operator_rollup.codes
        || referral_rollup.codes
        || case
          when operator_rollup.present < (select count(*) from expected_operators)
            then array['operator_rows_missing']::text[]
          else '{}'::text[]
        end
        || case
          when referral_rollup.present < (select count(*) from expected_referrals)
            then array['referral_rows_missing']::text[]
          else '{}'::text[]
        end
      ) as code
    )
  from operator_rollup, referral_rollup;
end;
$fn$;

alter table public.saas_referrals enable row level security;
alter table public.saas_referrals force row level security;
alter table public.operator_earnings_ledger enable row level security;
alter table public.operator_earnings_ledger force row level security;
alter table public.referral_ledger enable row level security;
alter table public.referral_ledger force row level security;

revoke all on table public.saas_referrals from public, anon, authenticated;
revoke all on table public.operator_earnings_ledger from public, anon, authenticated;
revoke all on table public.referral_ledger from public, anon, authenticated;

grant select on table public.saas_referrals to authenticated;
grant select on table public.operator_earnings_ledger to authenticated;
grant select on table public.referral_ledger to authenticated;
grant all on table public.saas_referrals to service_role;
grant all on table public.operator_earnings_ledger to service_role;
grant all on table public.referral_ledger to service_role;

create policy saas_referrals_platform_admin_select
on public.saas_referrals for select to authenticated
using ((select private.auth_app_role()) = 'platform_admin');

create policy operator_earnings_platform_admin_select
on public.operator_earnings_ledger for select to authenticated
using ((select private.auth_app_role()) = 'platform_admin');

create policy referral_ledger_platform_admin_select
on public.referral_ledger for select to authenticated
using ((select private.auth_app_role()) = 'platform_admin');

revoke all on function public.revenue_read_accrual_inputs(uuid, date) from public, anon, authenticated;
revoke all on function public.revenue_list_accrual_orgs() from public, anon, authenticated;
revoke all on function public.revenue_post_billing_accrual(uuid, date, bigint, numeric, bigint, integer, boolean, text, jsonb) from public, anon, authenticated;
revoke all on function public.revenue_read_kpis(date) from public, anon;

grant execute on function public.revenue_read_accrual_inputs(uuid, date) to service_role;
grant execute on function public.revenue_list_accrual_orgs() to service_role;
grant execute on function public.revenue_post_billing_accrual(uuid, date, bigint, numeric, bigint, integer, boolean, text, jsonb) to service_role;
grant execute on function public.revenue_read_kpis(date) to authenticated, service_role;

comment on table public.operator_earnings_ledger is
  'Immutable monthly monitoring-share snapshots. A missing split keeps percentage and amount null.';
comment on table public.referral_ledger is
  'Immutable monthly SaaS referral snapshots capped structurally at twelve cycles.';

commit;
