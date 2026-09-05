-- C2: accrue Stripe consumer revenue from a retained paid-invoice receipt,
-- never from the configured recurring price.

begin;

create table public.consumer_paid_invoice_evidence (
  id uuid primary key default extensions.gen_random_uuid(),
  event_id text not null unique references public.stripe_webhook_events(event_id) on delete restrict,
  provider_invoice_ref text not null unique,
  subscription_ref text not null,
  amount_paid_cents bigint not null,
  currency text not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  paid_at timestamptz not null,
  recorded_at timestamptz not null default pg_catalog.now(),
  constraint consumer_paid_invoice_evidence_amount_nonnegative check (amount_paid_cents >= 0),
  constraint consumer_paid_invoice_evidence_currency_shape check (currency ~ '^[a-z]{3}$'),
  constraint consumer_paid_invoice_evidence_period_order check (period_end > period_start)
);

create index consumer_paid_invoice_evidence_subscription_paid_idx
  on public.consumer_paid_invoice_evidence(subscription_ref, paid_at);

create trigger consumer_paid_invoice_evidence_prevent_change
before update or delete on public.consumer_paid_invoice_evidence
for each row execute function private.prevent_row_change();

-- Migration 350's erasure boundary: a row-immutable evidence table also refuses
-- truncate, through an always-enabled statement trigger no role can disable.
create trigger consumer_paid_invoice_evidence_no_truncate
before truncate on public.consumer_paid_invoice_evidence
for each statement execute function public.append_only_guard();
alter table public.consumer_paid_invoice_evidence
  enable always trigger consumer_paid_invoice_evidence_no_truncate;

alter table public.consumer_paid_invoice_evidence enable row level security;
alter table public.consumer_paid_invoice_evidence force row level security;
revoke all on table public.consumer_paid_invoice_evidence from public, anon, authenticated, service_role;
grant select on table public.consumer_paid_invoice_evidence to authenticated, service_role;

create policy consumer_paid_invoice_evidence_platform_admin_select
on public.consumer_paid_invoice_evidence for select to authenticated
using ((select private.auth_app_role()) = 'platform_admin');

create function public.billing_record_paid_invoice_evidence(
  p_event_id text,
  p_provider_invoice_ref text,
  p_subscription_ref text,
  p_amount_paid_cents bigint,
  p_currency text,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_paid_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_inserted boolean;
  v_subscription_count integer;
begin
  if nullif(pg_catalog.btrim(p_event_id), '') is null
    or nullif(pg_catalog.btrim(p_provider_invoice_ref), '') is null
    or nullif(pg_catalog.btrim(p_subscription_ref), '') is null
    or p_amount_paid_cents is null or p_amount_paid_cents < 0
    or p_currency is null or p_currency !~ '^[a-z]{3}$'
    or p_period_start is null or p_period_end is null or p_period_end <= p_period_start
    or p_paid_at is null
    or not exists (
      select 1 from public.stripe_webhook_events as event
      where event.event_id = p_event_id and event.event_type = 'invoice.paid'
    )
  then
    raise exception using errcode = '22023', message = 'PAID_INVOICE_EVIDENCE_INVALID';
  end if;

  select count(*) into v_subscription_count
  from public.consumer_subscriptions as subscription
  where subscription.provider = 'stripe'
    and (
      subscription.subscription_ref = pg_catalog.btrim(p_subscription_ref)
      or subscription.attempt_provider_subscription_ref = pg_catalog.btrim(p_subscription_ref)
    );

  -- Operator and non-subscription invoices share this verified endpoint. They
  -- are valid provider events, but are not consumer revenue evidence.
  if v_subscription_count <> 1 then
    return pg_catalog.jsonb_build_object('recorded', false, 'reason_code', 'ignored');
  end if;

  insert into public.consumer_paid_invoice_evidence (
    event_id, provider_invoice_ref, subscription_ref, amount_paid_cents,
    currency, period_start, period_end, paid_at
  ) values (
    pg_catalog.btrim(p_event_id), pg_catalog.btrim(p_provider_invoice_ref),
    pg_catalog.btrim(p_subscription_ref), p_amount_paid_cents, p_currency,
    p_period_start, p_period_end, p_paid_at
  )
  on conflict (provider_invoice_ref) do nothing
  returning true into v_inserted;

  return pg_catalog.jsonb_build_object(
    'recorded', coalesce(v_inserted, false),
    'reason_code', case when v_inserted then 'recorded' else 'duplicate' end
  );
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
volatile
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
        'provider', subscription.provider,
        'price_cents', subscription.price_cents,
        'paid_invoice_amount_cents', coalesce(evidence.amount_paid_cents, 0),
        'paid_invoice_count', coalesce(evidence.invoice_count, 0)
      ) order by subscription.id)
      from public.consumer_subscriptions as subscription
      join public.clients as client on client.id = subscription.client_id
      left join lateral (
        select
          coalesce(sum(invoice.amount_paid_cents), 0)::bigint as amount_paid_cents,
          count(*)::integer as invoice_count
        from public.consumer_paid_invoice_evidence as invoice
        where subscription.provider = 'stripe'
          and invoice.subscription_ref = subscription.subscription_ref
          and invoice.currency = subscription.currency
          and invoice.paid_at >= p_accrual_month::timestamptz
          and invoice.paid_at < (p_accrual_month + interval '1 month')::timestamptz
      ) as evidence on true
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

revoke all on function public.billing_record_paid_invoice_evidence(text,text,text,bigint,text,timestamptz,timestamptz,timestamptz)
  from public, anon, authenticated;
revoke all on function public.revenue_read_accrual_inputs(uuid,date)
  from public, anon, authenticated;
grant execute on function public.billing_record_paid_invoice_evidence(text,text,text,bigint,text,timestamptz,timestamptz,timestamptz)
  to service_role;
grant execute on function public.revenue_read_accrual_inputs(uuid,date) to service_role;

comment on table public.consumer_paid_invoice_evidence is
  'Append-only Stripe invoice.paid evidence for consumer revenue accrual; provider invoice identity supplies replay safety.';

commit;
