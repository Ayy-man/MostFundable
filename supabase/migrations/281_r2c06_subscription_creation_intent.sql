-- R2C-06 — serialize both public subscription-creation paths per organization.

begin;

create table if not exists public.operator_subscription_creation_intents (
  operation_id uuid primary key default pg_catalog.gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  creation_path text not null,
  status text not null default 'pending',
  provider_ref text,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  completed_at timestamptz,
  constraint operator_subscription_creation_intents_path_valid
    check (creation_path in ('checkout', 'direct')),
  constraint operator_subscription_creation_intents_status_valid
    check (status in ('pending', 'created', 'failed')),
  constraint operator_subscription_creation_intents_completion_valid
    check (
      (status = 'created' and provider_ref is not null and completed_at is not null)
      or (status <> 'created' and provider_ref is null and completed_at is null)
    )
);

create unique index if not exists operator_subscription_creation_intents_live_org_key
  on public.operator_subscription_creation_intents (org_id)
  where status in ('pending', 'created');

create unique index if not exists operator_subscription_creation_intents_provider_ref_key
  on public.operator_subscription_creation_intents (provider_ref)
  where provider_ref is not null;

alter table public.operator_subscription_creation_intents enable row level security;
alter table public.operator_subscription_creation_intents force row level security;
revoke all on table public.operator_subscription_creation_intents from anon, authenticated;
grant all on table public.operator_subscription_creation_intents to service_role;

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
      'operation_id', null, 'provider_ref', null, 'status', null
    );
  end if;

  perform 1
  from public.orgs as organization
  where organization.id = p_org_id
  for update;

  if not found then
    return pg_catalog.jsonb_build_object(
      'claimed', false, 'reason_code', 'no_organization',
      'operation_id', null, 'provider_ref', null, 'status', null
    );
  end if;

  select intent.* into v_intent
  from public.operator_subscription_creation_intents as intent
  where intent.org_id = p_org_id
    and intent.status in ('pending', 'created')
  order by intent.created_at desc, intent.operation_id desc
  limit 1;

  if v_intent.operation_id is not null then
    if v_intent.creation_path <> p_creation_path then
      return pg_catalog.jsonb_build_object(
        'claimed', false, 'reason_code', 'path_conflict',
        'operation_id', v_intent.operation_id,
        'provider_ref', v_intent.provider_ref,
        'status', v_intent.status
      );
    end if;

    return pg_catalog.jsonb_build_object(
      'claimed', true,
      'reason_code', case when v_intent.status = 'created' then 'provider_returned' else 'recovered' end,
      'operation_id', v_intent.operation_id,
      'provider_ref', v_intent.provider_ref,
      'status', v_intent.status
    );
  end if;

  if exists (
    select 1 from public.operator_subscriptions as subscription
    where subscription.org_id = p_org_id
      and subscription.subscription_ref is not null
  ) then
    return pg_catalog.jsonb_build_object(
      'claimed', false, 'reason_code', 'active_subscription',
      'operation_id', null, 'provider_ref', null, 'status', null
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
    'provider_ref', null, 'status', v_intent.status
  );
end;
$fn$;

create or replace function public.operator_billing_complete_subscription_intent(
  p_org_id uuid,
  p_operation_id uuid,
  p_creation_path text,
  p_provider_ref text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_intent public.operator_subscription_creation_intents%rowtype;
begin
  select intent.* into v_intent
  from public.operator_subscription_creation_intents as intent
  where intent.operation_id = p_operation_id
    and intent.org_id = p_org_id
  for update;

  if v_intent.operation_id is null then
    return pg_catalog.jsonb_build_object('applied', false, 'reason_code', 'not_found');
  end if;

  if v_intent.creation_path <> p_creation_path then
    return pg_catalog.jsonb_build_object('applied', false, 'reason_code', 'path_conflict');
  end if;

  if v_intent.status = 'created' then
    return pg_catalog.jsonb_build_object(
      'applied', v_intent.provider_ref = p_provider_ref,
      'reason_code', case when v_intent.provider_ref = p_provider_ref then 'duplicate' else 'provider_conflict' end
    );
  end if;

  if v_intent.status <> 'pending' or nullif(p_provider_ref, '') is null then
    return pg_catalog.jsonb_build_object('applied', false, 'reason_code', 'invalid_state');
  end if;

  update public.operator_subscription_creation_intents
  set status = 'created',
      provider_ref = p_provider_ref,
      completed_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  where operation_id = p_operation_id;

  return pg_catalog.jsonb_build_object('applied', true, 'reason_code', 'created');
end;
$fn$;

revoke all on function public.operator_billing_claim_subscription_intent(uuid, text)
  from public, anon, authenticated;
grant execute on function public.operator_billing_claim_subscription_intent(uuid, text)
  to service_role;

revoke all on function public.operator_billing_complete_subscription_intent(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.operator_billing_complete_subscription_intent(uuid, uuid, text, text)
  to service_role;

comment on table public.operator_subscription_creation_intents is
  'Server-owned durable operation identity shared by direct and hosted operator subscription creation.';

commit;
