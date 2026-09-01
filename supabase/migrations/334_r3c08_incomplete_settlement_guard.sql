-- R3C-08: incomplete revenue rows cannot advance settlement state.

create or replace function public.revenue_mark_settlement(
  p_ledger_kind text,
  p_ledger_id uuid,
  p_expected_status public.settlement_status,
  p_status public.settlement_status,
  p_actor_id uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  v_complete boolean;
  v_current public.settlement_status;
  v_org_id uuid;
begin
  if not private.revenue_actor_is_platform_admin(p_actor_id) then
    raise exception using errcode = '42501', message = 'SETTLEMENT_PLATFORM_ADMIN_REQUIRED';
  end if;
  if not ((p_expected_status='accrued' and p_status='exported') or (p_expected_status='exported' and p_status='paid')) then
    raise exception using errcode = '22023', message = 'SETTLEMENT_TRANSITION_INVALID';
  end if;

  if p_ledger_kind = 'operator' then
    select ledger.settlement_status, ledger.operator_org_id, ledger.is_complete
    into v_current, v_org_id, v_complete
    from public.operator_earnings_ledger ledger where ledger.id=p_ledger_id for update;
  elsif p_ledger_kind = 'referral' then
    select ledger.settlement_status, ledger.referrer_org_id, ledger.is_complete
    into v_current, v_org_id, v_complete
    from public.referral_ledger ledger where ledger.id=p_ledger_id for update;
  else
    raise exception using errcode = '22023', message = 'SETTLEMENT_LEDGER_INVALID';
  end if;

  if not found then
    return pg_catalog.jsonb_build_object('applied',false,'reason_code','not_found','ledger',p_ledger_kind,'ledger_id',p_ledger_id);
  end if;
  if not v_complete then
    return pg_catalog.jsonb_build_object('applied',false,'reason_code','incomplete','ledger',p_ledger_kind,'ledger_id',p_ledger_id,'status',v_current::text);
  end if;
  if v_current <> p_expected_status then
    return pg_catalog.jsonb_build_object('applied',false,'reason_code','stale','ledger',p_ledger_kind,'ledger_id',p_ledger_id,'status',v_current::text);
  end if;

  if p_status = 'exported' then perform public.billing_attribute_unmatched_refunds('export'); end if;
  perform pg_catalog.set_config('app.settlement_write','on',true);
  if p_ledger_kind='operator' then
    update public.operator_earnings_ledger set settlement_status=p_status where id=p_ledger_id;
  else
    update public.referral_ledger set settlement_status=p_status where id=p_ledger_id;
  end if;
  perform pg_catalog.set_config('app.settlement_write','off',true);

  insert into public.audit_log(org_id,client_id,actor_profile_id,action,subject_type,subject_id,occurred_at,meta)
  values(v_org_id,null,p_actor_id,'billing.settlement_changed','settlement',p_ledger_id,pg_catalog.now(),
    pg_catalog.jsonb_build_object('from',v_current::text,'to',p_status::text,'source',p_ledger_kind));
  return pg_catalog.jsonb_build_object('applied',true,'reason_code','applied','ledger',p_ledger_kind,'ledger_id',p_ledger_id,'status',p_status::text);
end;
$fn$;
