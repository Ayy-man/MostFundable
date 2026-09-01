-- R2C-04 — reconcile immutable refund observations through append-only attribution.

begin;

create table if not exists public.billing_refund_attributions (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  observation_id uuid not null unique references public.billing_refund_observations(id) on delete restrict,
  org_id uuid not null references public.orgs(id) on delete restrict,
  resolved_at timestamptz not null default pg_catalog.now(),
  source text not null,
  constraint billing_refund_attributions_source_valid check (
    source in ('observation', 'reconciliation', 'subscription_upsert', 'accrual', 'export')
  )
);

create index if not exists billing_refund_attributions_org_idx
  on public.billing_refund_attributions (org_id, resolved_at);

create trigger billing_refund_attributions_prevent_change
before update or delete on public.billing_refund_attributions
for each row execute function private.prevent_row_change();

create trigger billing_refund_attributions_no_truncate
before truncate on public.billing_refund_attributions
for each statement execute function public.append_only_guard();
alter table public.billing_refund_attributions
  enable always trigger billing_refund_attributions_no_truncate;

alter table public.billing_refund_attributions enable row level security;
alter table public.billing_refund_attributions force row level security;
revoke all on table public.billing_refund_attributions from public, anon, authenticated, service_role;
grant select on table public.billing_refund_attributions to service_role;

create or replace function private.attribute_refund_observation_on_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.org_id is not null then
    insert into public.billing_refund_attributions (
      observation_id, org_id, source
    ) values (
      new.id, new.org_id, 'observation'
    ) on conflict (observation_id) do nothing;
  end if;
  return new;
end;
$fn$;

revoke all on function private.attribute_refund_observation_on_insert() from public;

create trigger billing_refund_observations_attribute_insert
after insert on public.billing_refund_observations
for each row execute function private.attribute_refund_observation_on_insert();

insert into public.billing_refund_attributions (observation_id, org_id, source, resolved_at)
select observation.id, observation.org_id, 'observation', observation.recorded_at
from public.billing_refund_observations as observation
where observation.org_id is not null
on conflict (observation_id) do nothing;

create or replace function public.billing_attribute_unmatched_refunds(
  p_source text default 'reconciliation'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_ambiguous integer := 0;
  v_attributed integer := 0;
  v_candidates uuid[];
  v_observation public.billing_refund_observations%rowtype;
  v_unmatched integer := 0;
begin
  if p_source not in ('reconciliation', 'subscription_upsert', 'accrual', 'export') then
    raise exception using errcode = '22023', message = 'REFUND_ATTRIBUTION_SOURCE_INVALID';
  end if;

  for v_observation in
    select observation.*
    from public.billing_refund_observations as observation
    where observation.org_id is null
      and not exists (
        select 1 from public.billing_refund_attributions as attribution
        where attribution.observation_id = observation.id
      )
    order by observation.recorded_at, observation.id
    for update skip locked
  loop
    select pg_catalog.array_agg(candidate.org_id order by candidate.org_id)
    into v_candidates
    from (
      select subscription.org_id
      from public.operator_subscriptions as subscription
      where (v_observation.customer_ref is not null and subscription.customer_ref = v_observation.customer_ref)
         or (v_observation.subscription_ref is not null and subscription.subscription_ref = v_observation.subscription_ref)
      union
      select client.org_id
      from public.consumer_subscriptions as subscription
      join public.clients as client on client.id = subscription.client_id
      where (v_observation.customer_ref is not null and subscription.customer_ref = v_observation.customer_ref)
         or (v_observation.subscription_ref is not null and subscription.subscription_ref = v_observation.subscription_ref)
    ) as candidate;

    if coalesce(pg_catalog.array_length(v_candidates, 1), 0) = 1 then
      insert into public.billing_refund_attributions (
        observation_id, org_id, source
      ) values (
        v_observation.id, v_candidates[1], p_source
      ) on conflict (observation_id) do nothing;
      if found then v_attributed := v_attributed + 1; end if;
    elsif coalesce(pg_catalog.array_length(v_candidates, 1), 0) > 1 then
      v_ambiguous := v_ambiguous + 1;
    else
      v_unmatched := v_unmatched + 1;
    end if;
  end loop;

  return pg_catalog.jsonb_build_object(
    'attributed', v_attributed,
    'ambiguous', v_ambiguous,
    'unmatched', v_unmatched
  );
end;
$fn$;

create or replace function public.operator_billing_upsert_subscription(
  p_org_id uuid,
  p_provider text,
  p_customer_ref text,
  p_subscription_ref text,
  p_base_item_ref text,
  p_seat_item_ref text,
  p_base_price_ref text,
  p_seat_price_ref text,
  p_status text,
  p_current_period_end timestamptz
) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  v_created boolean;
  v_status public.operator_subscription_status;
  v_subscription_ref text;
begin
  v_status := coalesce(
    case
      when p_status in (
        'trialing', 'active', 'incomplete', 'incomplete_expired',
        'past_due', 'canceled', 'unpaid', 'paused'
      ) then p_status::public.operator_subscription_status
      else null
    end,
    'incomplete'::public.operator_subscription_status
  );

  insert into public.operator_subscriptions (
    org_id, provider, customer_ref, subscription_ref, base_item_ref, seat_item_ref,
    base_price_ref, seat_price_ref, status, current_period_end
  ) values (
    p_org_id, coalesce(p_provider, 'stripe'), p_customer_ref, p_subscription_ref,
    p_base_item_ref, p_seat_item_ref, p_base_price_ref, p_seat_price_ref,
    v_status, p_current_period_end
  )
  on conflict (org_id) do update
  set provider = coalesce(excluded.provider, public.operator_subscriptions.provider),
      customer_ref = coalesce(excluded.customer_ref, public.operator_subscriptions.customer_ref),
      subscription_ref = coalesce(excluded.subscription_ref, public.operator_subscriptions.subscription_ref),
      base_item_ref = coalesce(excluded.base_item_ref, public.operator_subscriptions.base_item_ref),
      seat_item_ref = coalesce(excluded.seat_item_ref, public.operator_subscriptions.seat_item_ref),
      base_price_ref = excluded.base_price_ref,
      seat_price_ref = excluded.seat_price_ref,
      status = excluded.status,
      current_period_end = coalesce(excluded.current_period_end, public.operator_subscriptions.current_period_end),
      updated_at = pg_catalog.now()
  returning (xmax = 0), operator_subscriptions.subscription_ref
  into v_created, v_subscription_ref;

  perform public.billing_attribute_unmatched_refunds('subscription_upsert');

  insert into public.audit_log (
    org_id, client_id, actor_profile_id, action, subject_type, subject_id, occurred_at, meta
  ) values (
    p_org_id, null, null, 'billing.subscription_upsert', 'org', p_org_id,
    pg_catalog.now(),
    pg_catalog.jsonb_build_object(
      'driver', coalesce(p_provider, 'stripe'), 'status', v_status::text
    )
  );

  return pg_catalog.jsonb_build_object(
    'applied', true, 'reason_code', 'applied', 'created', v_created,
    'subscription_ref', v_subscription_ref, 'status', v_status::text
  );
end;
$fn$;

create or replace function public.revenue_read_refund_total(
  p_org_id uuid,
  p_accrual_month date
) returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_total bigint;
begin
  if p_org_id is null or p_accrual_month is null
    or p_accrual_month <> pg_catalog.date_trunc('month', p_accrual_month)::date then
    raise exception using errcode = '22023', message = 'REFUND_WINDOW_INVALID';
  end if;

  perform public.billing_attribute_unmatched_refunds('accrual');

  with history as (
    select
      attribution.org_id,
      observation.currency,
      observation.occurred_at,
      greatest(
        observation.cumulative_amount_refunded_cents - coalesce(
          max(observation.cumulative_amount_refunded_cents) over (
            partition by observation.charge_ref
            order by observation.occurred_at, observation.event_id
            rows between unbounded preceding and 1 preceding
          ),
          0
        ),
        0
      )::bigint as delta_cents
    from public.billing_refund_observations as observation
    left join public.billing_refund_attributions as attribution
      on attribution.observation_id = observation.id
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

alter function public.revenue_read_accrual_inputs(uuid, date) volatile;

create or replace function public.revenue_mark_settlement(
  p_ledger_kind text,
  p_ledger_id uuid,
  p_expected_status public.settlement_status,
  p_status public.settlement_status,
  p_actor_id uuid
) returns jsonb
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

  if p_status = 'exported' then
    perform public.billing_attribute_unmatched_refunds('export');
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
      'from', v_current::text, 'to', p_status::text, 'source', p_ledger_kind
    )
  );

  return pg_catalog.jsonb_build_object(
    'applied', true, 'reason_code', 'applied',
    'ledger', p_ledger_kind, 'ledger_id', p_ledger_id,
    'status', p_status::text
  );
end;
$fn$;

revoke all on function public.billing_attribute_unmatched_refunds(text) from public, anon, authenticated;
grant execute on function public.billing_attribute_unmatched_refunds(text) to service_role;

commit;
