-- R4C-07: a provider subscription that exists after local cancellation carries a
-- durable cancellation obligation instead of an invisible charge stream.
--
-- Cancellation commits locally first and only calls the provider when the
-- pre-cancel snapshot already carried a canonical `subscription_ref`, so a
-- subscription created during the cancellation has nothing to cancel it.
-- Migration 332 retains that provider reference in the attempt columns; this
-- migration turns the retained reference into an intent that survives a crash
-- and completes only on provider confirmation. The obligation rides the
-- existing `purge.derived` job (INTERFACES §7 job names stay frozen), whose
-- handler already closes a provider-side resource before purging.

begin;

alter table public.consumer_subscriptions
  add column if not exists provider_cancel_ref text,
  add column if not exists provider_cancel_reason text,
  add column if not exists provider_cancel_requested_at timestamptz,
  add column if not exists provider_cancel_completed_at timestamptz;

alter table public.consumer_subscriptions
  add constraint consumer_subscription_provider_cancel_shape
    check (
      (provider_cancel_ref is null and provider_cancel_reason is null
        and provider_cancel_requested_at is null and provider_cancel_completed_at is null)
      or (provider_cancel_ref is not null
        and provider_cancel_reason in ('enrollment_cancelled', 'consent_withdrawn')
        and provider_cancel_requested_at is not null)
    );

-- Records the obligation under the caller's existing row lock. Idempotent for
-- the same reference; a second, different provider reference is an anomaly the
-- product must not silently drop, so it raises.
create or replace function private.require_provider_cancel(
  p_enrollment_id uuid,
  p_subscription_ref text,
  p_reason text
) returns text
language plpgsql security definer set search_path = '' as $fn$
declare
  v_ref text := nullif(pg_catalog.btrim(p_subscription_ref), '');
  v_row public.consumer_subscriptions%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if v_ref is null then
    raise exception using errcode = '22023', message = 'CONSUMER_SUBSCRIPTION_CANCEL_REF_REQUIRED';
  end if;
  if p_reason not in ('enrollment_cancelled', 'consent_withdrawn') then
    raise exception using errcode = '22023', message = 'CONSUMER_SUBSCRIPTION_CANCEL_REASON_INVALID';
  end if;

  select * into v_row from public.consumer_subscriptions
  where enrollment_id = p_enrollment_id for update;
  if v_row.id is null then
    raise exception using errcode = 'P0002', message = 'CONSUMER_SUBSCRIPTION_NOT_FOUND';
  end if;
  if v_row.provider_cancel_ref is not null and v_row.provider_cancel_ref <> v_ref then
    raise exception using errcode = '22023', message = 'CONSUMER_SUBSCRIPTION_CANCEL_INTENT_MISMATCH';
  end if;
  if v_row.provider_cancel_ref is null then
    update public.consumer_subscriptions
    set provider_cancel_ref = v_ref,
        provider_cancel_reason = p_reason,
        provider_cancel_requested_at = v_now,
        updated_at = v_now
    where id = v_row.id;
  end if;
  return v_ref;
end;
$fn$;

create or replace function public.consumer_subscription_pending_provider_cancel(
  p_enrollment_id uuid
) returns jsonb
language sql stable security definer set search_path = '' as $fn$
  select coalesce((
    select pg_catalog.jsonb_build_object(
      'subscription_ref', subscription.provider_cancel_ref,
      'reason_code', subscription.provider_cancel_reason)
    from public.consumer_subscriptions as subscription
    where subscription.enrollment_id = p_enrollment_id
      and subscription.provider_cancel_ref is not null
      and subscription.provider_cancel_completed_at is null
  ), pg_catalog.jsonb_build_object('subscription_ref', null, 'reason_code', null));
$fn$;

create or replace function public.consumer_subscription_provider_cancel_completed(
  p_enrollment_id uuid,
  p_subscription_ref text
) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  v_ref text := nullif(pg_catalog.btrim(p_subscription_ref), '');
  v_row public.consumer_subscriptions%rowtype;
begin
  select * into v_row from public.consumer_subscriptions
  where enrollment_id = p_enrollment_id for update;
  if v_row.id is null then
    raise exception using errcode = 'P0002', message = 'CONSUMER_SUBSCRIPTION_NOT_FOUND';
  end if;
  if v_row.provider_cancel_ref is null or v_row.provider_cancel_ref is distinct from v_ref then
    return pg_catalog.jsonb_build_object('completed', false, 'reason_code', 'no_matching_intent');
  end if;
  if v_row.provider_cancel_completed_at is null then
    update public.consumer_subscriptions
    set provider_cancel_completed_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    where id = v_row.id;
  end if;
  return pg_catalog.jsonb_build_object('completed', true, 'reason_code', 'confirmed');
end;
$fn$;

-- Cancellation now claims the obligation for whichever provider reference is
-- live: the canonical one, or the attempt reference migration 332 retained when
-- the provider returned after the local status had already moved. The
-- subscription row is written before the parent enrollment flips, preserving
-- the R2C-13 ordering the active-parent guard in 022 depends on.
drop function if exists public.enrollment_cancel_sub(uuid,uuid,text);
create function public.enrollment_cancel_sub(
  p_enrollment_id uuid,
  p_actor_id uuid,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  v_client_id uuid;
  v_cancelled_at timestamptz := pg_catalog.clock_timestamp();
  v_window text := pg_catalog.to_char(v_cancelled_at at time zone 'UTC', 'YYYY-MM-DD');
  v_ref text;
begin
  perform pg_catalog.set_config('app.actor_id', coalesce(p_actor_id::text, ''), true);
  select enrollment.client_id into v_client_id
  from public.enrollments as enrollment where enrollment.id = p_enrollment_id for update;
  if v_client_id is null then
    raise exception using errcode = 'P0002', message = 'ENROLLMENT_NOT_FOUND';
  end if;

  select coalesce(subscription.subscription_ref, subscription.attempt_provider_subscription_ref)
  into v_ref
  from public.consumer_subscriptions as subscription
  where subscription.enrollment_id = p_enrollment_id for update;
  if v_ref is not null then
    v_ref := private.require_provider_cancel(p_enrollment_id, v_ref, 'enrollment_cancelled');
  end if;

  update public.consumer_subscriptions
  set status = 'cancelled', cancelled_at = coalesce(cancelled_at, v_cancelled_at), updated_at = v_cancelled_at
  where enrollment_id = p_enrollment_id;

  update public.enrollments
  set status = 'cancelled', parked_until = null, updated_at = v_cancelled_at
  where id = p_enrollment_id and status <> 'cancelled';

  update public.analysis_jobs
  set status = 'cancelled', lease_owner = null, lease_until = null, error_code = null, updated_at = v_cancelled_at
  where client_id = v_client_id and status = 'queued';

  perform public.enqueue_background_job('purge.derived', 'enrollment:' || p_enrollment_id::text, v_window);
  -- p_reason remains excluded from unrestricted persistence and audit metadata.
  return pg_catalog.jsonb_build_object('provider_cancel_ref', v_ref);
end
$fn$;

revoke all on function private.require_provider_cancel(uuid,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.consumer_subscription_pending_provider_cancel(uuid)
  from public, anon, authenticated;
revoke all on function public.consumer_subscription_provider_cancel_completed(uuid,text)
  from public, anon, authenticated;
revoke all on function public.enrollment_cancel_sub(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.consumer_subscription_pending_provider_cancel(uuid) to service_role;
grant execute on function public.consumer_subscription_provider_cancel_completed(uuid,text) to service_role;
grant execute on function public.enrollment_cancel_sub(uuid,uuid,text) to service_role;

commit;
