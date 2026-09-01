-- 070_operator_billing.sql — the operator billing schema (Phase 10, S2.1).
--
-- Phase 10 makes an operator organization's membership rung a consequence of
-- provider webhooks and nothing else. Two Phase 1 policies, orgs_operator_update
-- and orgs_settings_update_lane_a, let an operator owner or admin UPDATE every
-- column of their own organization, and Postgres row security cannot restrict a
-- policy to a column subset. So the rule is enforced here by a BEFORE UPDATE
-- trigger instead: the five billing columns raise unless the transaction has set
-- app.billing_write, which only the security-definer billing functions in
-- migration 071 do.
--
-- Everything below is additive. Nothing Phase 1 shipped is dropped or altered,
-- and no existing policy is replaced.

begin;

-- ---------------------------------------------------------------------------
-- The provider's subscription statuses, carried verbatim.
--
-- These are the eight values the pinned SDK's Subscription.Status union carries.
-- public.orgs.membership stays the product-facing rung and is derived from this
-- column; collapsing the two would lose the difference between a subscription
-- that has never been paid and one that was paid before and is failing now.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1
    from pg_type as t
    join pg_namespace as n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'operator_subscription_status'
  ) then
    create type public.operator_subscription_status as enum (
      'trialing',
      'active',
      'incomplete',
      'incomplete_expired',
      'past_due',
      'canceled',
      'unpaid',
      'paused'
    );
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- One subscription row per organization.
--
-- base_price_ref and seat_price_ref are not null so that no subscription can
-- exist without a recorded price reference — that is BILL-03 as a constraint
-- rather than as a code review.
-- ---------------------------------------------------------------------------
create table if not exists public.operator_subscriptions (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null unique references public.orgs(id) on delete cascade,
  provider text not null default 'stripe',
  customer_ref text,
  subscription_ref text,
  base_item_ref text,
  seat_item_ref text,
  base_price_ref text not null,
  seat_price_ref text not null,
  seat_quantity integer not null default 0,
  status public.operator_subscription_status not null default 'incomplete',
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  grace_started_at timestamptz,
  grace_until timestamptz,
  last_event_id text,
  last_event_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint operator_subscriptions_provider_valid
    check (provider in ('stripe', 'mock')),
  constraint operator_subscriptions_seat_quantity_nonnegative
    check (seat_quantity >= 0)
);

-- Partial, because a mock subscription and an incomplete real one legitimately
-- have no provider reference yet, while two organizations must never share one.
create unique index if not exists operator_subscriptions_subscription_ref_key
  on public.operator_subscriptions (subscription_ref)
  where subscription_ref is not null;

-- ---------------------------------------------------------------------------
-- The append-only ladder trail.
--
-- The (org_id, event_id) constraint is the replay proof: operator_billing_apply_event
-- inserts here first and returns without touching anything when the insert
-- conflicts, so a redelivered event is a no-op even if the outer
-- stripe_webhook_events ledger is bypassed entirely.
-- ---------------------------------------------------------------------------
create table if not exists public.operator_billing_events (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  event_id text not null,
  event_type text not null,
  from_membership public.org_membership,
  to_membership public.org_membership,
  from_status public.operator_subscription_status,
  to_status public.operator_subscription_status,
  reason_code text not null,
  applied boolean not null,
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default pg_catalog.now(),
  constraint operator_billing_events_org_event_unique unique (org_id, event_id)
);

create index if not exists operator_billing_events_org_recorded_at_idx
  on public.operator_billing_events (org_id, recorded_at desc);

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'operator_billing_events_prevent_change'
      and tgrelid = 'public.operator_billing_events'::regclass
  ) then
    create trigger operator_billing_events_prevent_change
      before update or delete on public.operator_billing_events
      for each row execute function private.prevent_row_change();
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- The seat sync outbox.
--
-- org_id is the primary key, so the table holds at most one pending row per
-- organization and the latest desired quantity always wins. That is the whole
-- idempotency story: no queue, no job, and a member added and then taken off the
-- organization within one minute leaves one row carrying the final count.
-- ---------------------------------------------------------------------------
create table if not exists public.operator_seat_sync_outbox (
  org_id uuid primary key references public.orgs(id) on delete cascade,
  desired_quantity integer not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  last_error_code text,
  enqueued_at timestamptz not null default pg_catalog.now(),
  processed_at timestamptz,
  constraint operator_seat_sync_outbox_quantity_nonnegative
    check (desired_quantity >= 0),
  constraint operator_seat_sync_outbox_status_valid
    check (status in ('pending', 'synced', 'failed')),
  constraint operator_seat_sync_outbox_error_code_short
    check (last_error_code is null or length(last_error_code) <= 64)
);

create index if not exists operator_seat_sync_outbox_status_idx
  on public.operator_seat_sync_outbox (status, enqueued_at);

-- ---------------------------------------------------------------------------
-- Row security.
--
-- Enabled and forced on all three, revoked from anon and authenticated, then one
-- scoped read policy each. There is deliberately no insert, update or delete
-- policy for authenticated on any of these tables: every write goes through a
-- security-definer function granted to service_role only, which is what keeps
-- "the rung is webhook-derived" true against a browser holding a valid operator
-- session rather than true only by convention.
-- ---------------------------------------------------------------------------
alter table public.operator_subscriptions enable row level security;
alter table public.operator_subscriptions force row level security;
alter table public.operator_billing_events enable row level security;
alter table public.operator_billing_events force row level security;
alter table public.operator_seat_sync_outbox enable row level security;
alter table public.operator_seat_sync_outbox force row level security;

revoke all on table public.operator_subscriptions from anon, authenticated;
revoke all on table public.operator_billing_events from anon, authenticated;
revoke all on table public.operator_seat_sync_outbox from anon, authenticated;

grant select on table public.operator_subscriptions to authenticated;
grant select on table public.operator_billing_events to authenticated;
grant select on table public.operator_seat_sync_outbox to authenticated;

grant all on table public.operator_subscriptions to service_role;
grant all on table public.operator_billing_events to service_role;
grant all on table public.operator_seat_sync_outbox to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'operator_subscriptions'
      and policyname = 'operator_subscriptions_select_scoped'
  ) then
    create policy operator_subscriptions_select_scoped
      on public.operator_subscriptions
      for select to authenticated
      using (
        (select private.auth_app_role()) = 'platform_admin'
        or (
          (select private.auth_app_role()) = 'operator_member'
          and (select private.auth_org_role()) in ('owner', 'admin')
          and org_id = (select private.auth_org_id())
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'operator_billing_events'
      and policyname = 'operator_billing_events_select_scoped'
  ) then
    create policy operator_billing_events_select_scoped
      on public.operator_billing_events
      for select to authenticated
      using (
        (select private.auth_app_role()) = 'platform_admin'
        or (
          (select private.auth_app_role()) = 'operator_member'
          and (select private.auth_org_role()) in ('owner', 'admin')
          and org_id = (select private.auth_org_id())
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'operator_seat_sync_outbox'
      and policyname = 'operator_seat_sync_outbox_select_scoped'
  ) then
    create policy operator_seat_sync_outbox_select_scoped
      on public.operator_seat_sync_outbox
      for select to authenticated
      using (
        (select private.auth_app_role()) = 'platform_admin'
        or (
          (select private.auth_app_role()) = 'operator_member'
          and (select private.auth_org_role()) in ('owner', 'admin')
          and org_id = (select private.auth_org_id())
        )
      );
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- The billing column guard.
--
-- Compares old to new per column rather than blocking the statement, because
-- lane A's org-settings route writes assignment_mode, default_client_goal_cents
-- and team_sees_all_clients in a single UPDATE that also carries the untouched
-- billing columns. That write has to keep working, and the 070 pgTAP suite
-- asserts it does.
--
-- Seeding is unaffected: the trigger is BEFORE UPDATE and seeds INSERT.
-- ---------------------------------------------------------------------------
create or replace function private.orgs_guard_billing_columns()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if coalesce(current_setting('app.billing_write', true), 'off') = 'on' then
    return new;
  end if;

  if new.membership is distinct from old.membership
    or new.plan is distinct from old.plan
    or new.base_price_cents is distinct from old.base_price_cents
    or new.seat_price_cents is distinct from old.seat_price_cents
    or new.seats_included is distinct from old.seats_included
  then
    raise exception 'billing columns are webhook-derived';
  end if;

  return new;
end;
$fn$;

revoke all on function private.orgs_guard_billing_columns() from public;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'orgs_billing_columns_guard'
      and tgrelid = 'public.orgs'::regclass
  ) then
    create trigger orgs_billing_columns_guard
      before update on public.orgs
      for each row execute function private.orgs_guard_billing_columns();
  end if;
end
$$;

comment on table public.operator_subscriptions is
  'One operator subscription per organization. Written only by the security-definer billing functions in migration 071.';
comment on table public.operator_billing_events is
  'Append-only trail of provider events applied to an organization ladder rung. The (org_id, event_id) constraint makes a redelivered event a no-op.';
comment on table public.operator_seat_sync_outbox is
  'One pending seat quantity per organization. The latest desired quantity wins, so a member added and then taken off the organization leaves one row.';

commit;
