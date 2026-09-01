-- R5D-01 — the provider-cancellation obligation joins the derived-purge selector.
--
-- Migration 354 made provider cancellation durable by hanging it on `purge.derived`, whose
-- handler cancels the provider subscription before it purges anything. Migration 357, one
-- file later, wrote the selector that decides which enrollments that job is owed for — and
-- built its predicate out of the CRS member reference and the derived rows only. So an
-- enrollment with no CRS member and no derived graph is never selected at all:
-- `list_derived_purge_targets` returns nothing for it while
-- `consumer_subscription_pending_provider_cancel` still hands back a live subscription
-- reference, and the provider keeps charging a consumer who cancelled.
--
-- 357's own comment reserved this OR-extension for "a later migration" even though the
-- sibling obligation already existed in the immediately preceding file. This is that
-- migration, written the way 357 said to write it: the data predicate is not restated.

begin;

create or replace function private.derived_purge_provider_cancel_outstanding(p_enrollment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.consumer_subscriptions as subscription
    where subscription.enrollment_id = p_enrollment_id
      and subscription.provider_cancel_ref is not null
      and subscription.provider_cancel_completed_at is null
  );
$fn$;

create or replace function private.derived_purge_outstanding(p_enrollment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select private.derived_purge_data_outstanding(p_enrollment_id)
      or private.derived_purge_provider_cancel_outstanding(p_enrollment_id);
$fn$;

revoke all on function private.derived_purge_provider_cancel_outstanding(uuid)
  from public, anon, authenticated, service_role;

comment on function private.derived_purge_provider_cancel_outstanding(uuid) is
  'R5D-01: the migration-354 cancellation intent, as a derived-purge obligation the 357 selector can see.';

commit;
