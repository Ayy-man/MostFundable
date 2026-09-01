-- 401_alec_flat_fee_funding_trigger.sql
-- A flat success fee may become due only after funded outcomes reach a stated
-- threshold. `trigger_cents` existed before this migration, but the ledger
-- treated it as another fee amount; for the custom model it now means the
-- funded-amount threshold the operator entered.

create or replace function private.fee_recompute_total(
  p_client_id uuid,
  p_basis_cents bigint
)
returns bigint
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (
      select case agreement.model
        when 'percentage' then
          coalesce(agreement.upfront_cents, 0)
            + round(coalesce(agreement.pct, 0) / 100.0 * coalesce(p_basis_cents, 0))::bigint
        when 'custom' then
          coalesce(agreement.upfront_cents, 0)
            + case
                when agreement.trigger_cents is null
                  or coalesce(p_basis_cents, 0) >= agreement.trigger_cents
                then coalesce(agreement.custom_total_cents, 0)
                else 0
              end
        when 'package' then
          coalesce(agreement.upfront_cents, 0)
            + coalesce(agreement.success_cents, 0)
            + coalesce(agreement.trigger_cents, 0)
      end
      from public.fee_agreements as agreement
      where agreement.client_id = p_client_id
        and agreement.status <> 'void'
    ),
    0
  )
$$;

comment on function private.fee_recompute_total(uuid, bigint) is
  'Computes upfront plus the success fee from the agreement and funded outcome basis. For custom flat success fees, trigger_cents is the minimum funded basis at which the full custom_total_cents becomes due.';

-- A custom funded-amount threshold does not charge money before services or
-- before a successful outcome, so that case is independent of the upfront-fee
-- legal gate. Package agreements, positive upfront amounts, and the legacy
-- trigger-payment meaning on other models remain gated exactly as before.
create or replace function private.fee_agreement_legal_gate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_gated boolean;
  v_approved boolean;
begin
  v_gated := new.model = 'package'
    or coalesce(new.upfront_cents, 0) > 0
    or (
      new.model <> 'custom'
      and coalesce(new.trigger_cents, 0) > 0
    );

  if not v_gated then
    return new;
  end if;

  v_approved := coalesce(
    (
      select flag.upfront_fee_approved
      from public.org_flags as flag
      where flag.org_id = new.org_id
    ),
    false
  );

  if not v_approved then
    raise exception using
      errcode = 'PT403',
      message = 'legal_gate',
      detail = 'org has no recorded legal sign-off for the package or upfront fee model';
  end if;

  return new;
end;
$$;

comment on function private.fee_agreement_legal_gate() is
  'BEFORE INSERT OR UPDATE gate on fee_agreements and org_fee_defaults. Package agreements, positive upfront amounts, and non-custom legacy trigger payments require org_flags.upfront_fee_approved; a custom funded-amount threshold does not.';

comment on column public.fee_agreements.trigger_cents is
  'For custom flat success fees, the minimum funded outcome basis at which custom_total_cents becomes due. Package retains its legacy component meaning.';
