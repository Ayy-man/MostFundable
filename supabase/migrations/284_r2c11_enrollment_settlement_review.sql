-- R2C-11 — retain an unexpected provider settlement for durable review.

begin;

alter table public.consumer_subscriptions
  add column if not exists provider_amount_cents integer,
  add column if not exists provider_currency text,
  add column if not exists provider_status text,
  add column if not exists review_code text;

alter table public.consumer_subscriptions
  drop constraint if exists consumer_subscriptions_status_valid,
  add constraint consumer_subscriptions_status_valid
    check (status in ('authorized', 'active', 'cancelled', 'failed', 'review_required')),
  drop constraint if exists consumer_subscriptions_ref_needs_settled,
  add constraint consumer_subscriptions_ref_needs_settled
    check (subscription_ref is null or status in ('active', 'cancelled', 'review_required')),
  add constraint consumer_subscriptions_provider_amount_nonnegative
    check (provider_amount_cents is null or provider_amount_cents >= 0),
  add constraint consumer_subscriptions_provider_currency_shape
    check (provider_currency is null or provider_currency ~ '^[a-z]{3}$'),
  add constraint consumer_subscriptions_review_complete
    check (
      (
        status in ('review_required', 'cancelled')
        and subscription_ref is not null
        and provider_amount_cents is not null
        and provider_currency is not null
        and provider_status is not null
        and review_code = 'provider_response_mismatch'
      )
      or (
        status <> 'review_required'
        and provider_amount_cents is null
        and provider_currency is null
        and provider_status is null
        and review_code is null
      )
    );

create or replace function public.enrollment_review_sub(
  p_enrollment_id uuid,
  p_actor_id uuid,
  p_subscription_ref text,
  p_amount_cents integer,
  p_currency text,
  p_provider_status text,
  p_review_code text
) returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text;
  v_subscription_ref text;
begin
  if nullif(pg_catalog.btrim(p_subscription_ref), '') is null
    or p_amount_cents is null
    or p_amount_cents < 0
    or p_currency is null
    or p_currency !~ '^[a-z]{3}$'
    or nullif(pg_catalog.btrim(p_provider_status), '') is null
    or p_review_code <> 'provider_response_mismatch'
  then
    raise exception using errcode = '22023', message = 'ENROLLMENT_SUBSCRIPTION_REVIEW_INVALID';
  end if;

  perform pg_catalog.set_config('app.actor_id', coalesce(p_actor_id::text, ''), true);
  select subscription.status, subscription.subscription_ref
  into v_status, v_subscription_ref
  from public.consumer_subscriptions as subscription
  where subscription.enrollment_id = p_enrollment_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'ENROLLMENT_SUBSCRIPTION_NOT_FOUND';
  end if;

  if v_status = 'review_required' and v_subscription_ref = p_subscription_ref then
    return;
  end if;
  if v_status <> 'authorized' or v_subscription_ref is not null then
    raise exception using errcode = '23514', message = 'ENROLLMENT_SUBSCRIPTION_REVIEW_BLOCKED';
  end if;

  update public.consumer_subscriptions
  set status = 'review_required',
      subscription_ref = pg_catalog.btrim(p_subscription_ref),
      provider_amount_cents = p_amount_cents,
      provider_currency = p_currency,
      provider_status = pg_catalog.btrim(p_provider_status),
      review_code = p_review_code,
      updated_at = pg_catalog.now()
  where enrollment_id = p_enrollment_id;
end;
$fn$;

revoke all on function public.enrollment_review_sub(uuid,uuid,text,integer,text,text,text)
  from public, anon, authenticated;
grant execute on function public.enrollment_review_sub(uuid,uuid,text,integer,text,text,text)
  to service_role;

commit;
