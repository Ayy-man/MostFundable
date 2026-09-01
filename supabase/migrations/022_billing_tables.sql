begin;

create table if not exists public.consumer_subscriptions (
  id uuid primary key default extensions.gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  enrollment_id uuid not null references public.enrollments(id) on delete restrict,
  provider text not null,
  customer_ref text not null,
  setup_intent_ref text,
  payment_method_ref text,
  subscription_ref text,
  price_ref text,
  price_cents integer not null,
  currency text not null default 'usd',
  status text not null default 'authorized',
  idempotency_key text not null,
  -- G3-07: provider idempotency expires after 24 hours, so reconciliation
  -- needs the attempt timestamp and must not replay a stale subscription call.
  subscription_attempt_at timestamptz,
  activated_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint consumer_subscriptions_provider_valid
    check (provider in ('mock', 'stripe')),
  constraint consumer_subscriptions_status_valid
    check (status in ('authorized', 'active', 'cancelled', 'failed')),
  constraint consumer_subscriptions_active_needs_ref
    check (status <> 'active' or subscription_ref is not null),
  constraint consumer_subscriptions_ref_needs_settled
    check (subscription_ref is null or status in ('active', 'cancelled')),
  constraint consumer_subscriptions_price_positive check (price_cents > 0),
  constraint consumer_subscriptions_currency_lower check (currency = lower(currency))
);

create unique index if not exists uniq_sub_per_enrollment
  on public.consumer_subscriptions (enrollment_id);
create unique index if not exists uniq_active_sub_per_client
  on public.consumer_subscriptions (client_id)
  where status = 'active';
create index if not exists idx_consumer_subscriptions_client
  on public.consumer_subscriptions (client_id);

-- Authorization is recorded before verification, so the row can be inserted
-- while its enrollment is enrolled. This guard runs on insert and update, but
-- checks the parent only when the row becomes money-bearing.
create or replace function public.assert_enrollment_active_for_subscription()
returns trigger
language plpgsql security definer set search_path = '' as $fn$
declare
  v_status text;
  v_client_id uuid;
begin
  select e.status::text, e.client_id into v_status, v_client_id
  from public.enrollments e
  where e.id = new.enrollment_id;

  if v_client_id is distinct from new.client_id then
    raise exception using
      errcode = '23514',
      message = 'a consumer subscription must match its enrollment client';
  end if;

  if new.status = 'active' or new.subscription_ref is not null then
    if v_status is distinct from 'active' then
      raise exception using
        errcode = '23514',
        message = 'a consumer subscription cannot settle before its enrollment is active',
        detail = format(
          'enrollment %s has status %L',
          new.enrollment_id,
          coalesce(v_status, '<missing>')
        );
    end if;
  end if;
  return new;
end;
$fn$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'consumer_subscriptions_requires_active_enrollment'
      and tgrelid = 'public.consumer_subscriptions'::regclass
  ) then
    create trigger consumer_subscriptions_requires_active_enrollment
      before insert or update on public.consumer_subscriptions
      for each row execute function public.assert_enrollment_active_for_subscription();
  end if;
end
$$;
alter table public.consumer_subscriptions
  enable always trigger consumer_subscriptions_requires_active_enrollment;

-- Global replay ledger. It retains event identity, type, status and timestamps
-- only; provider event content is never persisted here.
create table if not exists public.stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  received_at timestamptz not null default pg_catalog.now(),
  processed_at timestamptz,
  status text not null default 'received',
  attempts integer not null default 0,
  last_error_code text,
  constraint stripe_webhook_events_status_valid
    check (status in ('received', 'processed', 'ignored', 'failed')),
  constraint stripe_webhook_events_error_code_short
    check (last_error_code is null or length(last_error_code) <= 64)
);

create index if not exists idx_stripe_webhook_events_status
  on public.stripe_webhook_events (status, received_at);

alter table public.consumer_subscriptions enable row level security;
alter table public.consumer_subscriptions force row level security;
create policy consumer_subscriptions_select_platform_admin
  on public.consumer_subscriptions
  for select to authenticated
  using ((select private.auth_app_role()) = 'platform_admin');
create policy consumer_subscriptions_select_consumer
  on public.consumer_subscriptions
  for select to authenticated
  using (
    exists (
      select 1 from public.clients c
      where c.id = consumer_subscriptions.client_id
        and c.consumer_profile_id = (select auth.uid())
    )
  );
create policy consumer_subscriptions_select_operator
  on public.consumer_subscriptions
  for select to authenticated
  using (
    (select private.auth_app_role()) = 'operator_member'
    and (select private.can_access_client(client_id))
  );

alter table public.stripe_webhook_events enable row level security;
alter table public.stripe_webhook_events force row level security;
create policy stripe_webhook_events_select_platform_admin
  on public.stripe_webhook_events
  for select to authenticated
  using ((select private.auth_app_role()) = 'platform_admin');

revoke all on table public.consumer_subscriptions from anon, authenticated;
revoke all on table public.stripe_webhook_events from anon, authenticated;
grant select on table public.consumer_subscriptions to authenticated, service_role;
grant select on table public.stripe_webhook_events to authenticated;
grant all on table public.stripe_webhook_events to service_role;

-- No authenticated write policy exists. service_role writes the global replay
-- ledger through the webhook route and continues to be constrained by the guard.

-- Replace the shared function in full so every earlier trigger retains a branch.
create or replace function public.enrollment_audit()
returns trigger
language plpgsql security definer set search_path = '' as $fn$
declare
  v_actor uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
  v_action text;
  v_subject_type text;
  v_subject_id uuid;
  v_client_id uuid;
  v_org_id uuid;
  v_meta jsonb;
begin
  if tg_table_name = 'consents' then
    v_action := 'consent.create';
    v_subject_type := 'consent';
    v_subject_id := new.id;
    v_client_id := new.client_id;
    v_meta := jsonb_build_object(
      'status', new.kind,
      'version', new.text_version
    );
  elsif tg_table_name = 'consent_revocations' then
    v_action := 'consent.revoke';
    v_subject_type := 'consent';
    v_subject_id := new.consent_id;
    v_client_id := new.client_id;
    v_meta := jsonb_build_object('status', new.kind);
  elsif tg_table_name = 'enrollments' then
    if tg_op = 'INSERT' then
      v_action := 'enrollment.create';
      v_meta := jsonb_build_object('to_state', new.status::text);
    elsif old.status is distinct from new.status then
      v_action := case new.status::text
        when 'active' then 'enrollment.activate'
        when 'parked' then 'enrollment.park'
        when 'cancelled' then 'enrollment.cancel'
        else null
      end;
      if v_action is null then return new; end if;
      v_meta := jsonb_build_object(
        'from_state', old.status::text,
        'to_state', new.status::text
      );
    else
      return new;
    end if;
    v_subject_type := 'enrollment';
    v_subject_id := new.id;
    v_client_id := new.client_id;
  elsif tg_table_name = 'idv_sessions' then
    if tg_op = 'INSERT' then
      v_action := 'enrollment.idv_started';
    elsif old.state is distinct from new.state then
      v_action := case new.state
        when 'passed' then 'enrollment.idv_pass'
        when 'locked' then 'enrollment.idv_locked'
        when 'retry' then 'enrollment.idv_retry'
        when 'quiz' then 'enrollment.idv_quiz'
        else null
      end;
      if v_action is null then return new; end if;
    else
      return new;
    end if;
    v_subject_type := 'enrollment';
    v_subject_id := new.enrollment_id;
    v_client_id := new.client_id;
    v_meta := jsonb_build_object(
      'status', new.state,
      'count', new.attempts_used,
      'driver', new.driver
    );
  elsif tg_table_name = 'consumer_subscriptions' then
    if tg_op = 'INSERT' then
      v_action := 'billing.setup_intent_recorded';
    elsif old.status is distinct from new.status then
      v_action := case new.status
        when 'active' then 'billing.subscription_started'
        when 'cancelled' then 'billing.subscription_cancelled'
        else null
      end;
      if v_action is null then return new; end if;
    else
      return new;
    end if;
    v_subject_type := 'consumer_subscription';
    v_subject_id := new.id;
    v_client_id := new.client_id;
    v_meta := jsonb_build_object(
      'driver', new.provider,
      'status', new.status
    );
  elsif tg_table_name = 'enrollment_milestones' then
    v_action := 'milestone.complete';
    v_subject_type := 'enrollment_milestone';
    v_subject_id := new.client_id;
    v_client_id := new.client_id;
    v_meta := jsonb_build_object('status', new.kind);
  end if;

  select client.org_id into v_org_id
  from public.clients as client
  where client.id = v_client_id;

  insert into public.audit_log (
    org_id,
    client_id,
    actor_profile_id,
    action,
    subject_type,
    subject_id,
    occurred_at,
    meta
  ) values (
    v_org_id,
    v_client_id,
    v_actor,
    v_action,
    v_subject_type,
    v_subject_id,
    pg_catalog.now(),
    v_meta
  );
  return new;
end;
$fn$;

revoke all on function public.enrollment_audit() from public, anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'consumer_subscriptions_audit_insert'
      and tgrelid = 'public.consumer_subscriptions'::regclass
  ) then
    create trigger consumer_subscriptions_audit_insert
      after insert on public.consumer_subscriptions
      for each row execute function public.enrollment_audit();
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'consumer_subscriptions_audit_update'
      and tgrelid = 'public.consumer_subscriptions'::regclass
  ) then
    create trigger consumer_subscriptions_audit_update
      after update of status on public.consumer_subscriptions
      for each row execute function public.enrollment_audit();
  end if;
end
$$;

-- TX-B: persist authorization references before IDV settles.
create or replace function public.enrollment_record_setup(
  p_enrollment_id uuid,
  p_client_id uuid,
  p_actor_id uuid,
  p_provider text,
  p_customer_ref text,
  p_setup_intent_ref text,
  p_payment_method_ref text,
  p_price_ref text,
  p_price_cents integer,
  p_idempotency_key text
) returns void
language plpgsql security definer set search_path = '' as $fn$
begin
  perform set_config('app.actor_id', coalesce(p_actor_id::text, ''), true);
  insert into public.consumer_subscriptions (
    enrollment_id,
    client_id,
    provider,
    customer_ref,
    setup_intent_ref,
    payment_method_ref,
    price_ref,
    price_cents,
    status,
    idempotency_key,
    subscription_attempt_at
  ) values (
    p_enrollment_id,
    p_client_id,
    p_provider,
    p_customer_ref,
    p_setup_intent_ref,
    p_payment_method_ref,
    p_price_ref,
    p_price_cents,
    'authorized',
    p_idempotency_key,
    pg_catalog.now()
  )
  on conflict (enrollment_id) do update
  set customer_ref = excluded.customer_ref,
      setup_intent_ref = excluded.setup_intent_ref,
      payment_method_ref = excluded.payment_method_ref,
      price_ref = excluded.price_ref,
      price_cents = excluded.price_cents,
      idempotency_key = excluded.idempotency_key,
      subscription_attempt_at = pg_catalog.now(),
      updated_at = pg_catalog.now();
end;
$fn$;

revoke all on function public.enrollment_record_setup(
  uuid,uuid,uuid,text,text,text,text,text,integer,text
) from public, anon, authenticated;
grant execute on function public.enrollment_record_setup(
  uuid,uuid,uuid,text,text,text,text,text,integer,text
) to service_role;

-- TX-E: the always-enabled trigger, rather than this RPC, owns the parent-state check.
create or replace function public.enrollment_settle_sub(
  p_enrollment_id uuid,
  p_actor_id uuid,
  p_subscription_ref text
) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_subscription_ref text;
begin
  perform set_config('app.actor_id', coalesce(p_actor_id::text, ''), true);
  select s.subscription_ref into v_subscription_ref
  from public.consumer_subscriptions s
  where s.enrollment_id = p_enrollment_id
  for no key update;

  if v_subscription_ref is not null then
    return;
  end if;

  update public.consumer_subscriptions
  set status = 'active',
      subscription_ref = p_subscription_ref,
      subscription_attempt_at = pg_catalog.now(),
      activated_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  where enrollment_id = p_enrollment_id;
end;
$fn$;

revoke all on function public.enrollment_settle_sub(uuid,uuid,text)
  from public, anon, authenticated;
grant execute on function public.enrollment_settle_sub(uuid,uuid,text)
  to service_role;

create or replace function public.enrollment_cancel_sub(
  p_enrollment_id uuid,
  p_actor_id uuid,
  p_reason text
) returns void
language plpgsql security definer set search_path = '' as $fn$
begin
  perform set_config('app.actor_id', coalesce(p_actor_id::text, ''), true);
  update public.enrollments
  set status = 'cancelled',
      parked_until = null,
      updated_at = pg_catalog.now()
  where id = p_enrollment_id
    and status <> 'cancelled';

  update public.consumer_subscriptions
  set status = 'cancelled',
      cancelled_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  where enrollment_id = p_enrollment_id;

  -- p_reason is accepted for the service contract but is intentionally not
  -- persisted as unrestricted text or added to audit metadata.
end;
$fn$;

revoke all on function public.enrollment_cancel_sub(uuid,uuid,text)
  from public, anon, authenticated;
grant execute on function public.enrollment_cancel_sub(uuid,uuid,text)
  to service_role;

commit;
