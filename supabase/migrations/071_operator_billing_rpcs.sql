-- 071_operator_billing_rpcs.sql — the ladder, and the only writer of a rung.
--
-- Four security-definer functions, all revoked from public and granted to
-- service_role only. Exactly one of them writes public.orgs.membership, and
-- exactly two set the transaction-local marker that migration 070's guard looks
-- for. That containment is the point: a privileged path that quietly moved a
-- rung would defeat the guard from the inside, and 071's pgTAP suite asserts it
-- in three places.
--
-- The rung mapping below is the paired implementation of the switch in
-- web/src/lib/billing/operator-ladder.ts. The two must be changed together; the
-- TypeScript table test and this file's pgTAP suite enumerate the same rows.

begin;

-- ---------------------------------------------------------------------------
-- The ladder.
--
-- Order of operations matters and is not stylistic:
--
--   1. Read the organization, then take the subscription row with `for update`,
--      which serialises two concurrent deliveries for the same organization.
--   2. Derive the rung, so the trail row can be written complete. The trail is
--      append-only, so it cannot be claimed first and filled in later.
--   3. Insert the trail row with `on conflict (org_id, event_id) do nothing`. A
--      zero row count means this event already applied, and the function returns
--      before touching public.orgs or the subscription. That is the replay
--      proof, and it holds even if the outer stripe_webhook_events ledger is
--      bypassed entirely.
--   4. Only then write the subscription and, when the rung actually moved, the
--      organization and one attribution row.
--
-- An event whose occurred_at is older than the one already recorded is refused,
-- because the provider does not guarantee delivery order and a redelivered
-- failure must not deactivate an organization a newer payment already restored.
-- ---------------------------------------------------------------------------
create or replace function public.operator_billing_apply_event(
  p_event_id text,
  p_event_type text,
  p_org_id uuid,
  p_subscription_ref text,
  p_status text,
  p_next_attempt_at timestamptz,
  p_attempt_count integer,
  p_current_period_end timestamptz,
  p_occurred_at timestamptz,
  p_source text default 'stripe'
) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  v_sub public.operator_subscriptions%rowtype;
  v_from_membership public.org_membership;
  v_to_membership public.org_membership;
  v_status public.operator_subscription_status;
  v_reason text;
  v_applied boolean;
  v_inserted integer;
  v_grace_started timestamptz;
  v_grace_until timestamptz;
  v_grace_days integer;
begin
  select organization.membership into v_from_membership
  from public.orgs as organization
  where organization.id = p_org_id;

  if v_from_membership is null then
    return pg_catalog.jsonb_build_object(
      'applied', false,
      'reason_code', 'no_subscription',
      'from_membership', null,
      'to_membership', null
    );
  end if;

  select * into v_sub
  from public.operator_subscriptions as subscription
  where subscription.org_id = p_org_id
  for update;

  -- The provider's status union carries an escape for values it has not
  -- published yet, so an unrecognized string is a real runtime case rather than
  -- a defensive nicety. It maps to no rung.
  v_status := case
    when p_status in (
      'trialing', 'active', 'incomplete', 'incomplete_expired',
      'past_due', 'canceled', 'unpaid', 'paused'
    )
    then p_status::public.operator_subscription_status
    else null
  end;

  v_to_membership := v_from_membership;

  if v_sub.org_id is null then
    v_reason := 'no_subscription';
  elsif v_sub.last_event_at is not null and p_occurred_at < v_sub.last_event_at then
    v_reason := 'stale_event';
  elsif p_event_type = 'invoice.paid' then
    v_to_membership := 'current';
    v_reason := 'applied';
  elsif p_event_type = 'invoice.payment_failed' then
    -- No further attempt scheduled means the provider's retries are spent, and
    -- that invoice signal is what opens the grace window. Which terminal
    -- subscription status the account produces afterwards is a setting we
    -- cannot read, so the ladder deliberately does not depend on it.
    v_to_membership := case
      when p_next_attempt_at is null then 'grace'::public.org_membership
      else 'past_due'::public.org_membership
    end;
    v_reason := 'applied';
  elsif p_event_type = 'customer.subscription.deleted' then
    v_to_membership := 'deactivated';
    v_reason := 'applied';
  else
    case v_status
      when 'active' then
        v_to_membership := 'current';
        v_reason := 'applied';
      when 'trialing' then
        v_to_membership := 'trial';
        v_reason := 'applied';
      when 'past_due' then
        v_to_membership := 'past_due';
        v_reason := 'applied';
      when 'unpaid' then
        v_to_membership := 'deactivated';
        v_reason := 'applied';
      when 'canceled' then
        v_to_membership := 'deactivated';
        v_reason := 'applied';
      when 'incomplete_expired' then
        v_to_membership := 'deactivated';
        v_reason := 'applied';
      else
        v_reason := 'unknown_status';
    end case;
  end if;

  v_applied := v_reason = 'applied';

  insert into public.operator_billing_events (
    org_id,
    event_id,
    event_type,
    from_membership,
    to_membership,
    from_status,
    to_status,
    reason_code,
    applied,
    occurred_at
  ) values (
    p_org_id,
    p_event_id,
    p_event_type,
    v_from_membership,
    v_to_membership,
    v_sub.status,
    coalesce(v_status, v_sub.status),
    v_reason,
    v_applied,
    p_occurred_at
  )
  on conflict (org_id, event_id) do nothing;

  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    return pg_catalog.jsonb_build_object(
      'applied', false,
      'reason_code', 'duplicate_event',
      'from_membership', v_from_membership::text,
      'to_membership', v_from_membership::text
    );
  end if;

  if v_reason in ('no_subscription', 'stale_event') then
    return pg_catalog.jsonb_build_object(
      'applied', false,
      'reason_code', v_reason,
      'from_membership', v_from_membership::text,
      'to_membership', v_from_membership::text
    );
  end if;

  -- The grace window has no duration anywhere in the documents, so it is read
  -- from a setting with a documented default of seven days and there is no
  -- expiry job: moving off grace still requires an event. Nothing deactivates
  -- an organization on a timer we invented.
  if v_to_membership = 'grace' then
    v_grace_started := coalesce(v_sub.grace_started_at, pg_catalog.now());
    v_grace_days := coalesce(
      nullif(pg_catalog.current_setting('app.operator_grace_days', true), '')::integer,
      7
    );
    v_grace_until := v_grace_started + pg_catalog.make_interval(days => v_grace_days);
  elsif v_to_membership in ('current', 'trial') then
    v_grace_started := null;
    v_grace_until := null;
  else
    v_grace_started := v_sub.grace_started_at;
    v_grace_until := v_sub.grace_until;
  end if;

  update public.operator_subscriptions
  set status = coalesce(v_status, status),
      subscription_ref = coalesce(subscription_ref, p_subscription_ref),
      current_period_end = coalesce(p_current_period_end, current_period_end),
      grace_started_at = v_grace_started,
      grace_until = v_grace_until,
      last_event_id = p_event_id,
      last_event_at = p_occurred_at,
      updated_at = pg_catalog.now()
  where org_id = p_org_id;

  if v_to_membership is distinct from v_from_membership then
    perform pg_catalog.set_config('app.billing_write', 'on', true);
    update public.orgs
    set membership = v_to_membership
    where id = p_org_id;
    perform pg_catalog.set_config('app.billing_write', 'off', true);

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
      p_org_id,
      null,
      null,
      'billing.membership_change',
      'org',
      p_org_id,
      pg_catalog.now(),
      pg_catalog.jsonb_build_object(
        'from_state', v_from_membership::text,
        'to_state', v_to_membership::text,
        'reason_code', v_reason,
        'source', coalesce(p_source, 'stripe'),
        'status', coalesce(v_status::text, 'unrecognized')
      )
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'applied', v_applied,
    'reason_code', v_reason,
    'from_membership', v_from_membership::text,
    'to_membership', v_to_membership::text
  );
end;
$fn$;

revoke all on function public.operator_billing_apply_event(
  text,text,uuid,text,text,timestamptz,integer,timestamptz,timestamptz,text
) from public, anon, authenticated;
grant execute on function public.operator_billing_apply_event(
  text,text,uuid,text,text,timestamptz,integer,timestamptz,timestamptz,text
) to service_role;

-- ---------------------------------------------------------------------------
-- Starting or re-attaching a subscription.
--
-- This function writes no public.orgs column and therefore does not set the
-- billing marker. An organization that has just started a subscription stays on
-- whatever rung it was on until an invoice.paid arrives, which is precisely what
-- "the rung is derived from webhooks" means. Setting membership = 'current' here
-- is the obvious way this phase would quietly break its own requirement, so it
-- is called out rather than left to a reader to notice.
-- ---------------------------------------------------------------------------
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
      )
      then p_status::public.operator_subscription_status
      else null
    end,
    'incomplete'::public.operator_subscription_status
  );

  insert into public.operator_subscriptions (
    org_id,
    provider,
    customer_ref,
    subscription_ref,
    base_item_ref,
    seat_item_ref,
    base_price_ref,
    seat_price_ref,
    status,
    current_period_end
  ) values (
    p_org_id,
    coalesce(p_provider, 'stripe'),
    p_customer_ref,
    p_subscription_ref,
    p_base_item_ref,
    p_seat_item_ref,
    p_base_price_ref,
    p_seat_price_ref,
    v_status,
    p_current_period_end
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
      current_period_end = coalesce(
        excluded.current_period_end,
        public.operator_subscriptions.current_period_end
      ),
      updated_at = pg_catalog.now()
  returning (xmax = 0), operator_subscriptions.subscription_ref
  into v_created, v_subscription_ref;

  insert into public.audit_log (
    org_id, client_id, actor_profile_id, action, subject_type, subject_id, occurred_at, meta
  ) values (
    p_org_id,
    null,
    null,
    'billing.subscription_upsert',
    'org',
    p_org_id,
    pg_catalog.now(),
    pg_catalog.jsonb_build_object(
      'driver', coalesce(p_provider, 'stripe'),
      'status', v_status::text
    )
  );

  return pg_catalog.jsonb_build_object(
    'applied', true,
    'reason_code', 'applied',
    'created', v_created,
    'subscription_ref', v_subscription_ref,
    'status', v_status::text
  );
end;
$fn$;

revoke all on function public.operator_billing_upsert_subscription(
  uuid,text,text,text,text,text,text,text,text,timestamptz
) from public, anon, authenticated;
grant execute on function public.operator_billing_upsert_subscription(
  uuid,text,text,text,text,text,text,text,text,timestamptz
) to service_role;

-- ---------------------------------------------------------------------------
-- Recording a seat quantity after the provider accepted it.
--
-- Like the upsert, this writes no public.orgs column and does not set the
-- billing marker. The outbox row is marked synced only when the quantity just
-- recorded is the one it asked for: a newer enqueue that arrived while the
-- provider call was in flight must stay pending so the next drain picks it up.
-- ---------------------------------------------------------------------------
create or replace function public.operator_billing_set_seat_quantity(
  p_org_id uuid,
  p_quantity integer,
  p_source text
) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  v_updated integer;
  v_outbox_status text;
begin
  update public.operator_subscriptions
  set seat_quantity = p_quantity,
      updated_at = pg_catalog.now()
  where org_id = p_org_id;

  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    return pg_catalog.jsonb_build_object(
      'applied', false,
      'reason_code', 'no_subscription',
      'seat_quantity', null
    );
  end if;

  update public.operator_seat_sync_outbox
  set status = 'synced',
      last_error_code = null,
      processed_at = pg_catalog.now()
  where org_id = p_org_id
    and desired_quantity = p_quantity;

  select outbox.status into v_outbox_status
  from public.operator_seat_sync_outbox as outbox
  where outbox.org_id = p_org_id;

  insert into public.audit_log (
    org_id, client_id, actor_profile_id, action, subject_type, subject_id, occurred_at, meta
  ) values (
    p_org_id,
    null,
    null,
    'billing.seat_quantity_change',
    'org',
    p_org_id,
    pg_catalog.now(),
    pg_catalog.jsonb_build_object(
      'count', p_quantity,
      'source', coalesce(p_source, 'route')
    )
  );

  return pg_catalog.jsonb_build_object(
    'applied', true,
    'reason_code', 'applied',
    'seat_quantity', p_quantity,
    'outbox_status', v_outbox_status
  );
end;
$fn$;

revoke all on function public.operator_billing_set_seat_quantity(uuid,integer,text)
  from public, anon, authenticated;
grant execute on function public.operator_billing_set_seat_quantity(uuid,integer,text)
  to service_role;

-- ---------------------------------------------------------------------------
-- A plan tier change.
--
-- This one does set the billing marker, because orgs.plan sits behind the same
-- guard, and it writes plan only — never membership. No route exposes it in this
-- phase; it exists and is tested so that the 070 guard cannot strand a tier
-- change the day someone decides an operator may self-serve one.
-- ---------------------------------------------------------------------------
create or replace function public.operator_billing_change_plan(
  p_org_id uuid,
  p_plan text,
  p_base_price_ref text
) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  v_from_plan public.org_plan;
  v_to_plan public.org_plan;
begin
  select organization.plan into v_from_plan
  from public.orgs as organization
  where organization.id = p_org_id;

  if v_from_plan is null then
    return pg_catalog.jsonb_build_object(
      'applied', false,
      'reason_code', 'no_organization',
      'from_plan', null,
      'to_plan', null
    );
  end if;

  v_to_plan := p_plan::public.org_plan;

  perform pg_catalog.set_config('app.billing_write', 'on', true);
  update public.orgs
  set plan = v_to_plan
  where id = p_org_id;
  perform pg_catalog.set_config('app.billing_write', 'off', true);

  if p_base_price_ref is not null then
    update public.operator_subscriptions
    set base_price_ref = p_base_price_ref,
        updated_at = pg_catalog.now()
    where org_id = p_org_id;
  end if;

  insert into public.audit_log (
    org_id, client_id, actor_profile_id, action, subject_type, subject_id, occurred_at, meta
  ) values (
    p_org_id,
    null,
    null,
    'billing.plan_change',
    'org',
    p_org_id,
    pg_catalog.now(),
    pg_catalog.jsonb_build_object(
      'from_state', v_from_plan::text,
      'to_state', v_to_plan::text,
      'source', 'billing'
    )
  );

  return pg_catalog.jsonb_build_object(
    'applied', true,
    'reason_code', 'applied',
    'from_plan', v_from_plan::text,
    'to_plan', v_to_plan::text
  );
end;
$fn$;

revoke all on function public.operator_billing_change_plan(uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.operator_billing_change_plan(uuid,text,text)
  to service_role;

commit;
