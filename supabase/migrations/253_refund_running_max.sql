-- R1C-07: cumulative refund deltas use the maximum prior observation, including
-- equal-second peers ordered by event id. A delta belongs to the month of its
-- observation; the prior maximum is lifetime-to-date, so a prior-month amount
-- is the baseline and only a later month's increase is charged to that month.

create or replace function public.revenue_read_refund_total(
  p_org_id uuid,
  p_accrual_month date
)
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
    or p_accrual_month <> pg_catalog.date_trunc('month', p_accrual_month)::date then
    raise exception using errcode = '22023', message = 'REFUND_WINDOW_INVALID';
  end if;

  with history as (
    select
      observation.org_id,
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
  )
  select coalesce(pg_catalog.sum(history.delta_cents), 0)::bigint
  into v_total
  from history
  where history.org_id = p_org_id
    and history.currency = 'usd'
    and history.occurred_at >= p_accrual_month::timestamptz
    and history.occurred_at < (p_accrual_month + interval '1 month')::timestamptz;

  return v_total;
end
$fn$;

revoke all on function public.revenue_read_refund_total(uuid, date)
  from public, anon, authenticated;
grant execute on function public.revenue_read_refund_total(uuid, date) to service_role;
