-- R3C-06: close an expired hosted Checkout intent after provider verification.

create or replace function public.operator_billing_fail_expired_checkout_intent(
  p_org_id uuid,
  p_operation_id uuid,
  p_provider_ref text
) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  v_intent public.operator_subscription_creation_intents%rowtype;
begin
  select * into v_intent from public.operator_subscription_creation_intents
  where operation_id=p_operation_id and org_id=p_org_id for update;
  if v_intent.operation_id is null then
    return pg_catalog.jsonb_build_object('applied',false,'reason_code','not_found');
  end if;
  if v_intent.creation_path <> 'checkout' or v_intent.status <> 'created'
    or v_intent.provider_ref is distinct from p_provider_ref then
    return pg_catalog.jsonb_build_object('applied',false,'reason_code','state_changed');
  end if;
  update public.operator_subscription_creation_intents
  set status='failed', provider_ref=null, completed_at=null, updated_at=pg_catalog.now()
  where operation_id=p_operation_id;
  return pg_catalog.jsonb_build_object('applied',true,'reason_code','expired');
end;
$fn$;

revoke all on function public.operator_billing_fail_expired_checkout_intent(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.operator_billing_fail_expired_checkout_intent(uuid,uuid,text) to service_role;
