-- R4C-09 — an operator subscription intent that cannot be reconciled parks in a
-- durable review state instead of being redispatched on a stale idempotency key.
--
-- Migration 281 gave the intent three statuses, and none of them can carry this
-- case. `pending` means "safe to dispatch", which is the one thing an intent
-- older than the provider's idempotency-retention window is not; `failed` drops
-- out of the live-org unique index, so the next claim opens a fresh operation id
-- and creates exactly the second subscription this is here to prevent. `review`
-- is therefore a fourth status that keeps the organization locked — every claim
-- against it answers `needs_review` and nothing dispatches — until a human
-- reconciles it against the provider.
--
-- `created_at` already existed and is now returned by the claim RPC, because the
-- age of the intent is what decides whether a zero-match lookup is a provider
-- read that has not caught up yet or a key that will no longer deduplicate.

begin;

alter table public.operator_subscription_creation_intents
  add column if not exists review_reason text;

alter table public.operator_subscription_creation_intents
  drop constraint if exists operator_subscription_creation_intents_status_valid;
alter table public.operator_subscription_creation_intents
  add constraint operator_subscription_creation_intents_status_valid
    check (status in ('pending', 'created', 'failed', 'review'));

-- Recorded rather than inferred: the two ways an intent reaches review need
-- opposite remediations. `ambiguous_provider_match` means more than one
-- subscription answers to this operation and one of them may need cancelling;
-- `unreconciled_past_retention` means none was found after the key stopped
-- deduplicating. Reading a bare `review` and guessing between them is how a
-- second charge happens.
alter table public.operator_subscription_creation_intents
  drop constraint if exists operator_subscription_creation_intents_review_valid;
alter table public.operator_subscription_creation_intents
  add constraint operator_subscription_creation_intents_review_valid
    check (
      (status = 'review' and review_reason in ('ambiguous_provider_match', 'unreconciled_past_retention'))
      or (status <> 'review' and review_reason is null)
    );

-- A review intent stays live. Dropping it out of this index would hand the next
-- claim a clean slate over an unresolved provider state.
drop index if exists public.operator_subscription_creation_intents_live_org_key;
create unique index if not exists operator_subscription_creation_intents_live_org_key
  on public.operator_subscription_creation_intents (org_id)
  where status in ('pending', 'created', 'review');

create or replace function public.operator_billing_claim_subscription_intent(
  p_org_id uuid,
  p_creation_path text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_intent public.operator_subscription_creation_intents%rowtype;
begin
  if p_creation_path not in ('checkout', 'direct') then
    return pg_catalog.jsonb_build_object(
      'claimed', false, 'reason_code', 'invalid_path',
      'operation_id', null, 'provider_ref', null, 'status', null, 'created_at', null
    );
  end if;

  perform 1
  from public.orgs as organization
  where organization.id = p_org_id
  for update;

  if not found then
    return pg_catalog.jsonb_build_object(
      'claimed', false, 'reason_code', 'no_organization',
      'operation_id', null, 'provider_ref', null, 'status', null, 'created_at', null
    );
  end if;

  select intent.* into v_intent
  from public.operator_subscription_creation_intents as intent
  where intent.org_id = p_org_id
    and intent.status in ('pending', 'created', 'review')
  order by intent.created_at desc, intent.operation_id desc
  limit 1;

  if v_intent.operation_id is not null then
    -- Answered before the path check, because a review intent is not a
    -- disagreement about which route is creating the subscription; it is a
    -- refusal to create one on either route until somebody looks.
    if v_intent.status = 'review' then
      return pg_catalog.jsonb_build_object(
        'claimed', false, 'reason_code', 'needs_review',
        'operation_id', v_intent.operation_id,
        'provider_ref', v_intent.provider_ref,
        'status', v_intent.status,
        'created_at', v_intent.created_at
      );
    end if;

    if v_intent.creation_path <> p_creation_path then
      return pg_catalog.jsonb_build_object(
        'claimed', false, 'reason_code', 'path_conflict',
        'operation_id', v_intent.operation_id,
        'provider_ref', v_intent.provider_ref,
        'status', v_intent.status,
        'created_at', v_intent.created_at
      );
    end if;

    return pg_catalog.jsonb_build_object(
      'claimed', true,
      'reason_code', case when v_intent.status = 'created' then 'provider_returned' else 'recovered' end,
      'operation_id', v_intent.operation_id,
      'provider_ref', v_intent.provider_ref,
      'status', v_intent.status,
      'created_at', v_intent.created_at
    );
  end if;

  if exists (
    select 1 from public.operator_subscriptions as subscription
    where subscription.org_id = p_org_id
      and subscription.subscription_ref is not null
  ) then
    return pg_catalog.jsonb_build_object(
      'claimed', false, 'reason_code', 'active_subscription',
      'operation_id', null, 'provider_ref', null, 'status', null, 'created_at', null
    );
  end if;

  insert into public.operator_subscription_creation_intents (
    org_id, creation_path
  ) values (
    p_org_id, p_creation_path
  ) returning * into v_intent;

  return pg_catalog.jsonb_build_object(
    'claimed', true, 'reason_code', 'created',
    'operation_id', v_intent.operation_id,
    'provider_ref', null, 'status', v_intent.status,
    'created_at', v_intent.created_at
  );
end;
$fn$;

-- The only writer of `review`, and a compare-and-set like migration 335's: it
-- moves a pending intent and refuses anything else, so a caller that raced a
-- completion cannot bury a subscription the provider already created.
create or replace function public.operator_billing_review_subscription_intent(
  p_org_id uuid,
  p_operation_id uuid,
  p_reason_code text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_intent public.operator_subscription_creation_intents%rowtype;
begin
  if p_reason_code not in ('ambiguous_provider_match', 'unreconciled_past_retention') then
    return pg_catalog.jsonb_build_object('applied', false, 'reason_code', 'invalid_reason');
  end if;

  select intent.* into v_intent
  from public.operator_subscription_creation_intents as intent
  where intent.operation_id = p_operation_id
    and intent.org_id = p_org_id
  for update;

  if v_intent.operation_id is null then
    return pg_catalog.jsonb_build_object('applied', false, 'reason_code', 'not_found');
  end if;

  if v_intent.status = 'review' then
    return pg_catalog.jsonb_build_object('applied', true, 'reason_code', 'duplicate');
  end if;

  if v_intent.status <> 'pending' then
    return pg_catalog.jsonb_build_object('applied', false, 'reason_code', 'state_changed');
  end if;

  update public.operator_subscription_creation_intents
  set status = 'review',
      review_reason = p_reason_code,
      updated_at = pg_catalog.now()
  where operation_id = p_operation_id;

  return pg_catalog.jsonb_build_object('applied', true, 'reason_code', 'review');
end;
$fn$;

revoke all on function public.operator_billing_review_subscription_intent(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.operator_billing_review_subscription_intent(uuid, uuid, text)
  to service_role;

comment on column public.operator_subscription_creation_intents.review_reason is
  'Why a pending intent was parked: ambiguous_provider_match or unreconciled_past_retention (R4C-09).';

commit;
