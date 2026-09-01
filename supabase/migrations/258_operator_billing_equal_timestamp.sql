-- R1C-04: equal-timestamp events pause for an authoritative provider snapshot.

create function public.operator_billing_apply_event_convergent(
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
  v_membership public.org_membership;
begin
  select * into v_sub from public.operator_subscriptions
  where org_id = p_org_id for update;
  select membership into v_membership from public.orgs where id = p_org_id;

  if v_sub.org_id is not null
     and v_sub.last_event_at = p_occurred_at
     and v_sub.last_event_id is distinct from p_event_id
     and p_event_type <> 'provider.snapshot' then
    return jsonb_build_object(
      'applied', false,
      'reason_code', 'equal_timestamp',
      'from_membership', v_membership::text,
      'to_membership', v_membership::text
    );
  end if;

  return public.operator_billing_apply_event(
    p_event_id,p_event_type,p_org_id,p_subscription_ref,p_status,
    p_next_attempt_at,p_attempt_count,p_current_period_end,p_occurred_at,p_source
  );
end;
$fn$;

revoke all on function public.operator_billing_apply_event_convergent(text,text,uuid,text,text,timestamptz,integer,timestamptz,timestamptz,text)
  from public, anon, authenticated;
grant execute on function public.operator_billing_apply_event_convergent(text,text,uuid,text,text,timestamptz,integer,timestamptz,timestamptz,text)
  to service_role;
