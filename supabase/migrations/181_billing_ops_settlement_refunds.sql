-- Phase 21: settlement bookkeeping and replay-safe refund observations.

begin;

create type public.settlement_status as enum ('accrued', 'exported', 'paid', 'reversed');

alter table public.operator_earnings_ledger
  add column settlement_status public.settlement_status not null default 'accrued';
alter table public.referral_ledger
  add column settlement_status public.settlement_status not null default 'accrued';
alter table public.orgs
  add column stripe_account_id text,
  add column payouts_enabled boolean;
alter table public.saas_referrals
  add column stripe_account_id text,
  add column payouts_enabled boolean;

create or replace function private.prevent_revenue_ledger_change()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'REVENUE_LEDGER_APPEND_ONLY';
  end if;
  if coalesce(pg_catalog.current_setting('app.settlement_write', true), 'off') <> 'on'
    or (pg_catalog.to_jsonb(new) - 'settlement_status')
      is distinct from (pg_catalog.to_jsonb(old) - 'settlement_status')
  then
    raise exception using errcode = '55000', message = 'REVENUE_LEDGER_APPEND_ONLY';
  end if;
  return new;
end;
$fn$;

revoke all on function private.prevent_revenue_ledger_change() from public;

drop trigger operator_earnings_ledger_prevent_change on public.operator_earnings_ledger;
create trigger operator_earnings_ledger_prevent_change
before update or delete on public.operator_earnings_ledger
for each row execute function private.prevent_revenue_ledger_change();

drop trigger referral_ledger_prevent_change on public.referral_ledger;
create trigger referral_ledger_prevent_change
before update or delete on public.referral_ledger
for each row execute function private.prevent_revenue_ledger_change();

create or replace function private.revenue_actor_is_platform_admin(p_actor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1 from public.profiles as actor
    where actor.id = p_actor_id
      and actor.role = 'platform_admin'::public.app_role
  )
$fn$;

revoke all on function private.revenue_actor_is_platform_admin(uuid) from public;

create function public.revenue_read_settlement_status(
  p_ledger_kind text,
  p_ledger_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_status public.settlement_status;
begin
  if p_ledger_kind = 'operator' then
    select ledger.settlement_status into v_status
    from public.operator_earnings_ledger as ledger where ledger.id = p_ledger_id;
  elsif p_ledger_kind = 'referral' then
    select ledger.settlement_status into v_status
    from public.referral_ledger as ledger where ledger.id = p_ledger_id;
  else
    raise exception using errcode = '22023', message = 'SETTLEMENT_LEDGER_INVALID';
  end if;

  if not found then return null; end if;
  return pg_catalog.jsonb_build_object(
    'ledger', p_ledger_kind,
    'ledger_id', p_ledger_id,
    'status', v_status::text
  );
end;
$fn$;

create function public.revenue_mark_settlement(
  p_ledger_kind text,
  p_ledger_id uuid,
  p_expected_status public.settlement_status,
  p_status public.settlement_status,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_current public.settlement_status;
  v_org_id uuid;
begin
  if not private.revenue_actor_is_platform_admin(p_actor_id) then
    raise exception using errcode = '42501', message = 'SETTLEMENT_PLATFORM_ADMIN_REQUIRED';
  end if;
  if not (
    (p_expected_status = 'accrued' and p_status = 'exported')
    or (p_expected_status = 'exported' and p_status = 'paid')
  ) then
    raise exception using errcode = '22023', message = 'SETTLEMENT_TRANSITION_INVALID';
  end if;

  if p_ledger_kind = 'operator' then
    select ledger.settlement_status, ledger.operator_org_id
    into v_current, v_org_id
    from public.operator_earnings_ledger as ledger
    where ledger.id = p_ledger_id for update;
  elsif p_ledger_kind = 'referral' then
    select ledger.settlement_status, ledger.referrer_org_id
    into v_current, v_org_id
    from public.referral_ledger as ledger
    where ledger.id = p_ledger_id for update;
  else
    raise exception using errcode = '22023', message = 'SETTLEMENT_LEDGER_INVALID';
  end if;

  if not found then
    return pg_catalog.jsonb_build_object(
      'applied', false, 'reason_code', 'not_found',
      'ledger', p_ledger_kind, 'ledger_id', p_ledger_id
    );
  end if;
  if v_current <> p_expected_status then
    return pg_catalog.jsonb_build_object(
      'applied', false, 'reason_code', 'stale',
      'ledger', p_ledger_kind, 'ledger_id', p_ledger_id,
      'status', v_current::text
    );
  end if;

  perform pg_catalog.set_config('app.settlement_write', 'on', true);
  if p_ledger_kind = 'operator' then
    update public.operator_earnings_ledger set settlement_status = p_status where id = p_ledger_id;
  else
    update public.referral_ledger set settlement_status = p_status where id = p_ledger_id;
  end if;
  perform pg_catalog.set_config('app.settlement_write', 'off', true);

  insert into public.audit_log (
    org_id, client_id, actor_profile_id, action, subject_type, subject_id, occurred_at, meta
  ) values (
    v_org_id, null, p_actor_id, 'billing.settlement_changed', 'settlement', p_ledger_id,
    pg_catalog.now(),
    pg_catalog.jsonb_build_object(
      'from', v_current::text,
      'to', p_status::text,
      'source', p_ledger_kind
    )
  );

  return pg_catalog.jsonb_build_object(
    'applied', true, 'reason_code', 'applied',
    'ledger', p_ledger_kind, 'ledger_id', p_ledger_id,
    'status', p_status::text
  );
end;
$fn$;

create table public.billing_refund_observations (
  id uuid primary key default extensions.gen_random_uuid(),
  event_id text not null unique references public.stripe_webhook_events(event_id) on delete restrict,
  charge_ref text not null,
  customer_ref text,
  subscription_ref text,
  org_id uuid references public.orgs(id) on delete restrict,
  currency text not null,
  cumulative_amount_refunded_cents bigint not null,
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default pg_catalog.now(),
  constraint billing_refund_currency_shape check (currency ~ '^[a-z]{3}$'),
  constraint billing_refund_amount_nonnegative check (cumulative_amount_refunded_cents >= 0)
);

create index billing_refund_charge_history_idx
  on public.billing_refund_observations(charge_ref, occurred_at, event_id);
create index billing_refund_org_occurred_idx
  on public.billing_refund_observations(org_id, occurred_at)
  where org_id is not null;

create trigger billing_refund_observations_prevent_change
before update or delete on public.billing_refund_observations
for each row execute function private.prevent_row_change();

alter table public.billing_refund_observations enable row level security;
alter table public.billing_refund_observations force row level security;
revoke all on table public.billing_refund_observations from public, anon, authenticated, service_role;
grant select on table public.billing_refund_observations to authenticated, service_role;

create policy billing_refund_platform_admin_select
on public.billing_refund_observations for select to authenticated
using ((select private.auth_app_role()) = 'platform_admin');

create function public.billing_record_refund_observation(
  p_event_id text,
  p_charge_ref text,
  p_customer_ref text,
  p_subscription_ref text,
  p_cumulative_amount_refunded_cents bigint,
  p_currency text,
  p_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_org_ids uuid[];
  v_org_id uuid;
  v_inserted boolean;
begin
  if nullif(pg_catalog.btrim(p_event_id), '') is null
    or nullif(pg_catalog.btrim(p_charge_ref), '') is null
    or p_cumulative_amount_refunded_cents is null
    or p_cumulative_amount_refunded_cents < 0
    or p_currency is null
    or p_currency !~ '^[a-z]{3}$'
    or p_occurred_at is null
    or not exists (
      select 1 from public.stripe_webhook_events as event
      where event.event_id = p_event_id and event.event_type = 'charge.refunded'
    )
  then
    raise exception using errcode = '22023', message = 'REFUND_OBSERVATION_INVALID';
  end if;

  select pg_catalog.array_agg(candidate.org_id order by candidate.org_id)
  into v_org_ids
  from (
    select subscription.org_id
    from public.operator_subscriptions as subscription
    where (p_customer_ref is not null and subscription.customer_ref = p_customer_ref)
       or (p_subscription_ref is not null and subscription.subscription_ref = p_subscription_ref)
    union
    select client.org_id
    from public.consumer_subscriptions as subscription
    join public.clients as client on client.id = subscription.client_id
    where (p_customer_ref is not null and subscription.customer_ref = p_customer_ref)
       or (p_subscription_ref is not null and subscription.subscription_ref = p_subscription_ref)
  ) as candidate;

  if coalesce(pg_catalog.array_length(v_org_ids, 1), 0) = 1 then
    v_org_id := v_org_ids[1];
  end if;

  insert into public.billing_refund_observations (
    event_id, charge_ref, customer_ref, subscription_ref, org_id,
    currency, cumulative_amount_refunded_cents, occurred_at
  ) values (
    p_event_id, pg_catalog.btrim(p_charge_ref), nullif(pg_catalog.btrim(p_customer_ref), ''),
    nullif(pg_catalog.btrim(p_subscription_ref), ''), v_org_id,
    p_currency, p_cumulative_amount_refunded_cents, p_occurred_at
  )
  on conflict (event_id) do nothing
  returning true into v_inserted;

  return pg_catalog.jsonb_build_object(
    'recorded', coalesce(v_inserted, false),
    'reason_code', case when v_inserted then 'recorded' else 'duplicate' end,
    'attributed', v_org_id is not null,
    'org_id', v_org_id
  );
end;
$fn$;

create function public.revenue_read_refund_total(p_org_id uuid, p_accrual_month date)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_total bigint;
begin
  if p_org_id is null or p_accrual_month is null
    or p_accrual_month <> pg_catalog.date_trunc('month', p_accrual_month)::date
  then
    raise exception using errcode = '22023', message = 'REFUND_WINDOW_INVALID';
  end if;

  with history as (
    select observation.org_id, observation.currency, observation.occurred_at,
      greatest(
        observation.cumulative_amount_refunded_cents
          - pg_catalog.lag(observation.cumulative_amount_refunded_cents, 1, 0)
            over (partition by observation.charge_ref order by observation.occurred_at, observation.event_id),
        0
      )::bigint as delta_cents
    from public.billing_refund_observations as observation
  )
  select coalesce(pg_catalog.sum(history.delta_cents), 0)::bigint
  into v_total
  from history
  where history.org_id = p_org_id
    and history.currency = 'usd'
    and history.occurred_at >= p_accrual_month::timestamptz
    and history.occurred_at < (p_accrual_month + interval '1 month')::timestamptz;

  return v_total;
end;
$fn$;

drop function public.revenue_read_accrual_inputs(uuid, date);
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
  referral jsonb,
  refund_amount_cents bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if p_operator_org_id is null or p_accrual_month is null
    or p_accrual_month <> pg_catalog.date_trunc('month', p_accrual_month)::date
  then
    raise exception using errcode = '22023', message = 'invalid revenue accrual input';
  end if;

  return query
  select organization.id, organization.base_price_cents, organization.seat_price_cents,
    (
      select pg_catalog.jsonb_build_object(
        'provider', subscription.provider, 'status', subscription.status::text,
        'seat_quantity', subscription.seat_quantity
      ) from public.operator_subscriptions as subscription
      where subscription.org_id = organization.id
    ),
    coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'provider', subscription.provider, 'price_cents', subscription.price_cents
      ) order by subscription.id)
      from public.consumer_subscriptions as subscription
      join public.clients as client on client.id = subscription.client_id
      where client.org_id = organization.id and subscription.status = 'active'
    ), '[]'::jsonb),
    (
      select pg_catalog.jsonb_build_object(
        'id', referral_row.id, 'referrer_org_id', referral_row.referrer_org_id,
        'referred_org_id', referral_row.referred_org_id, 'pct', referral_row.pct,
        'months', referral_row.months, 'base', referral_row.base,
        'started_at', referral_row.started_at
      ) from public.saas_referrals as referral_row
      where referral_row.referred_org_id = organization.id
        and p_accrual_month >= pg_catalog.date_trunc('month', referral_row.started_at)::date
        and p_accrual_month < (
          pg_catalog.date_trunc('month', referral_row.started_at)
          + pg_catalog.make_interval(months => referral_row.months)
        )::date
    ),
    public.revenue_read_refund_total(organization.id, p_accrual_month)
  from public.orgs as organization where organization.id = p_operator_org_id;
end;
$fn$;

revoke all on function public.revenue_read_settlement_status(text, uuid)
  from public, anon, authenticated;
revoke all on function public.revenue_mark_settlement(text, uuid, public.settlement_status, public.settlement_status, uuid)
  from public, anon, authenticated;
revoke all on function public.billing_record_refund_observation(text,text,text,text,bigint,text,timestamptz)
  from public, anon, authenticated;
revoke all on function public.revenue_read_refund_total(uuid,date)
  from public, anon, authenticated;
revoke all on function public.revenue_read_accrual_inputs(uuid,date)
  from public, anon, authenticated;

grant execute on function public.revenue_read_settlement_status(text, uuid) to service_role;
grant execute on function public.revenue_mark_settlement(text, uuid, public.settlement_status, public.settlement_status, uuid) to service_role;
grant execute on function public.billing_record_refund_observation(text,text,text,text,bigint,text,timestamptz) to service_role;
grant execute on function public.revenue_read_refund_total(uuid,date) to service_role;
grant execute on function public.revenue_read_accrual_inputs(uuid,date) to service_role;

comment on table public.billing_refund_observations is
  'Append-only cumulative refund evidence. Event identity supplies replay safety; no provider body is stored.';

commit;
