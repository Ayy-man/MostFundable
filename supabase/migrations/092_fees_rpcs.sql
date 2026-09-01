-- 092_fees_rpcs.sql
--
-- The callable surface over the fee schema. Every function here is SECURITY
-- INVOKER, which is the point rather than an omission: `web/src/lib/fees/` is
-- forbidden the admin client (12-CONTEXT D-10, and the two-entry allow-list at
-- verify-source-gates.mjs:27), so RLS is the boundary, and a definer function
-- would hand the caller the owner's rights and quietly become a fifth path
-- toward the package model. Not one function here is a definer function, and
-- web/scripts/verify-fee-legal-gate.mjs fails the build if that changes. The
-- banned two-word phrase is deliberately not written anywhere in this file, so
-- that the scan can stay a plain grep with nothing to talk it out of a match.
--
-- The two writers that can carry a gated option — fees_set_agreement and
-- fees_set_org_default — simply write the table and let the 091 trigger
-- adjudicate. The gate is deliberately not re-implemented here, because two
-- copies of a rule drift and the copy that drifts is always the one nobody
-- tested.
--
-- Attribution is never a parameter. `approved_by`, `recorded_by`, `reversed_by`
-- and `updated_by` are all taken from private.auth_profile_id() inside the
-- function, so a caller cannot file a sign-off or a payment under someone
-- else's name.

-- The provenance of the percentage basis. Phase 11 passes it through
-- recordApprovedOutcomeBasis(clientId, basisCents, source) when an outcome is
-- approved or withdrawn (ask-12-1), and without somewhere to put it the third
-- argument of the seam would be accepted and silently discarded. Added here
-- rather than in 091 because it exists for this RPC and for nothing else.
alter table public.fee_ledger add column outcome_basis_source text;

alter table public.fee_ledger add constraint fee_ledger_basis_source_len
  check (outcome_basis_source is null or length(outcome_basis_source) between 1 and 64);

comment on column public.fee_ledger.outcome_basis_source is
  'Free text naming what last moved outcome_basis_cents. Written only by public.fees_set_outcome_basis(); Phase 12 never reads a Phase 11 table and never guesses one''s name.';

-- ---------------------------------------------------------------------------
-- The legal gate's own writer and reader.
-- ---------------------------------------------------------------------------

create function public.org_flags_set_upfront_fee_approved(
  p_org_id uuid,
  p_approved boolean,
  p_signoff_ref text default null
)
returns public.org_flags
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.org_flags;
begin
  if p_approved and coalesce(btrim(p_signoff_ref), '') = '' then
    raise exception 'approving the package fee model requires a written legal sign-off reference'
      using errcode = '22023';
  end if;

  insert into public.org_flags (
    org_id, upfront_fee_approved, legal_signoff_ref, approved_by, approved_at
  ) values (
    p_org_id,
    p_approved,
    case when p_approved then btrim(p_signoff_ref) end,
    -- Forced from the session, never read from an argument. A signature that
    -- accepted an approver would let one platform admin file another's sign-off,
    -- which is the evidence half of DEC-D7 rather than the permission half.
    case when p_approved then private.auth_profile_id() end,
    case when p_approved then now() end
  )
  on conflict (org_id) do update
  set
    upfront_fee_approved = excluded.upfront_fee_approved,
    legal_signoff_ref = excluded.legal_signoff_ref,
    approved_by = excluded.approved_by,
    approved_at = excluded.approved_at
  returning * into v_row;

  return v_row;
end;
$$;

create function public.fees_upfront_gate_state(p_org_id uuid)
returns table (
  approved boolean,
  signoff_ref text,
  approved_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return query
  select
    flag.upfront_fee_approved,
    flag.legal_signoff_ref,
    flag.approved_at
  from public.org_flags as flag
  where flag.org_id = p_org_id;

  -- No row and an unreadable row are the same answer, for the same reason the
  -- gate trigger coalesces its read: two ways of saying "not approved" is one
  -- more than the number that can stay consistent.
  if not found then
    return query select false, null::text, null::timestamptz;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Agreements and workspace defaults.
-- ---------------------------------------------------------------------------

create function public.fees_set_agreement(
  p_client_id uuid,
  p_model public.fee_model,
  p_pct numeric default null,
  p_upfront_cents bigint default null,
  p_success_cents bigint default null,
  p_trigger_cents bigint default null,
  p_custom_total_cents bigint default null,
  p_status public.fee_agreement_status default 'draft'
)
returns public.fee_agreements
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_source text;
  v_row public.fee_agreements;
begin
  select client.org_id into v_org_id
  from public.clients as client
  where client.id = p_client_id;

  -- Under RLS an inaccessible client is indistinguishable from a missing one,
  -- and it should be: telling a caller which of the two it was would leak the
  -- existence of another tenant's client.
  if v_org_id is null then
    raise exception 'client is unknown or not visible to this caller'
      using errcode = '42501';
  end if;

  v_source := case
    when private.auth_app_role() = 'platform_admin' then 'platform_admin'
    else 'operator_override'
  end;

  insert into public.fee_agreements (
    client_id, org_id, model, pct, upfront_cents, success_cents,
    trigger_cents, custom_total_cents, status, source
  ) values (
    p_client_id, v_org_id, p_model, p_pct, p_upfront_cents, p_success_cents,
    p_trigger_cents, p_custom_total_cents, coalesce(p_status, 'draft'), v_source
  )
  on conflict (client_id) do update
  set
    model = excluded.model,
    pct = excluded.pct,
    upfront_cents = excluded.upfront_cents,
    success_cents = excluded.success_cents,
    trigger_cents = excluded.trigger_cents,
    custom_total_cents = excluded.custom_total_cents,
    status = excluded.status,
    source = excluded.source,
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

create function public.fees_set_org_default(
  p_org_id uuid,
  p_model public.fee_model,
  p_pct numeric default null,
  p_upfront_cents bigint default null,
  p_success_cents bigint default null,
  p_trigger_cents bigint default null,
  p_custom_total_cents bigint default null
)
returns public.org_fee_defaults
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.org_fee_defaults;
begin
  insert into public.org_fee_defaults (
    org_id, model, pct, upfront_cents, success_cents,
    trigger_cents, custom_total_cents, updated_by
  ) values (
    p_org_id, p_model, p_pct, p_upfront_cents, p_success_cents,
    p_trigger_cents, p_custom_total_cents, private.auth_profile_id()
  )
  on conflict (org_id) do update
  set
    model = excluded.model,
    pct = excluded.pct,
    upfront_cents = excluded.upfront_cents,
    success_cents = excluded.success_cents,
    trigger_cents = excluded.trigger_cents,
    custom_total_cents = excluded.custom_total_cents,
    updated_by = excluded.updated_by,
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Payments. Payouts happen off platform (BACKEND-SPEC §5), so this is a person
-- recording that money moved somewhere else.
-- ---------------------------------------------------------------------------

create function public.fees_record_payment(
  p_client_id uuid,
  p_amount_cents bigint,
  p_received_on date,
  p_method public.fee_payment_method,
  p_reference text default null,
  p_note text default null
)
returns public.fee_payments
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_row public.fee_payments;
begin
  select client.org_id into v_org_id
  from public.clients as client
  where client.id = p_client_id;

  if v_org_id is null then
    raise exception 'client is unknown or not visible to this caller'
      using errcode = '42501';
  end if;

  insert into public.fee_payments (
    client_id, org_id, amount_cents, received_on, method, reference, note, recorded_by
  ) values (
    p_client_id,
    v_org_id,
    p_amount_cents,
    p_received_on,
    p_method,
    nullif(btrim(coalesce(p_reference, '')), ''),
    nullif(btrim(coalesce(p_note, '')), ''),
    private.auth_profile_id()
  )
  returning * into v_row;

  return v_row;
end;
$$;

create function public.fees_reverse_payment(p_payment_id uuid)
returns public.fee_payments
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.fee_payments;
begin
  -- The append-only trigger permits exactly this pair and nothing else, so the
  -- worst a bug in this function could do is fail.
  update public.fee_payments
  set
    reversed_at = now(),
    reversed_by = private.auth_profile_id()
  where id = p_payment_id
    and reversed_at is null
  returning * into v_row;

  -- A null return covers three cases the caller must not be able to tell apart:
  -- the payment does not exist, it belongs to another tenant, or it is already
  -- reversed. The route maps all three to the same answer.
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- The Phase-11 seam (12-CONTEXT D-08, ask-12-1).
-- ---------------------------------------------------------------------------
--
-- The only writer of the percentage basis. Phase 11 owns approved outcomes and
-- its tables do not exist on this branch, so this phase holds the column and
-- exposes one named entry point rather than guessing a table name that would
-- fail to apply after the merge.

create function public.fees_set_outcome_basis(
  p_client_id uuid,
  p_basis_cents bigint,
  p_source text default null
)
returns public.fee_ledger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_row public.fee_ledger;
begin
  if p_basis_cents is null or p_basis_cents < 0 then
    raise exception 'the approved outcome basis must be zero or more cents'
      using errcode = '22023';
  end if;

  select client.org_id into v_org_id
  from public.clients as client
  where client.id = p_client_id;

  if v_org_id is null then
    raise exception 'client is unknown or not visible to this caller'
      using errcode = '42501';
  end if;

  insert into public.fee_ledger (client_id, org_id, outcome_basis_cents, outcome_basis_source)
  values (p_client_id, v_org_id, p_basis_cents, nullif(btrim(coalesce(p_source, '')), ''))
  on conflict (client_id) do update
  set
    outcome_basis_cents = excluded.outcome_basis_cents,
    outcome_basis_source = excluded.outcome_basis_source
  returning * into v_row;

  -- total_cents follows from the BEFORE trigger on fee_ledger; nothing here
  -- computes it, so there is one implementation of the arithmetic.
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reads for the two surfaces.
-- ---------------------------------------------------------------------------

create function public.fees_read_client_fees(p_client_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'clientId', p_client_id,
    'agreement', (
      select to_jsonb(agreement)
      from public.fee_agreements as agreement
      where agreement.client_id = p_client_id
    ),
    'ledger', (
      select to_jsonb(ledger)
      from public.fee_ledger as ledger
      where ledger.client_id = p_client_id
    ),
    'payments', coalesce(
      (
        select jsonb_agg(to_jsonb(payment) order by payment.received_on desc, payment.recorded_at desc)
        from public.fee_payments as payment
        where payment.client_id = p_client_id
      ),
      '[]'::jsonb
    )
  )
  into v_result;

  return v_result;
end;
$$;

create function public.fees_list_org_receivables(
  p_org_id uuid,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  client_id uuid,
  display_name text,
  model public.fee_model,
  status public.fee_agreement_status,
  total_cents bigint,
  paid_cents bigint,
  balance_cents bigint,
  last_payment_on date
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return query
  select
    client.id,
    client.display_name,
    agreement.model,
    agreement.status,
    coalesce(ledger.total_cents, 0),
    coalesce(ledger.paid_cents, 0),
    coalesce(ledger.balance_cents, 0),
    (
      select max(payment.received_on)
      from public.fee_payments as payment
      where payment.client_id = client.id
        and payment.reversed_at is null
    )
  from public.clients as client
  left join public.fee_agreements as agreement on agreement.client_id = client.id
  left join public.fee_ledger as ledger on ledger.client_id = client.id
  where client.org_id = p_org_id
    and (agreement.client_id is not null or ledger.client_id is not null)
  order by coalesce(ledger.balance_cents, 0) desc, client.display_name asc
  limit greatest(1, least(coalesce(p_limit, 50), 200))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants.
-- ---------------------------------------------------------------------------
--
-- PG 17 grants EXECUTE on a new function to PUBLIC at creation, so without the
-- revoke every one of these would be callable by `anon` over the Data API. The
-- full argument type list is spelled out on each line because an
-- overload-insensitive revoke silently misses. Form copied from
-- 050_tracker_stage_engine.sql:277-290.

revoke all on function public.org_flags_set_upfront_fee_approved(uuid, boolean, text) from public, anon;
revoke all on function public.fees_upfront_gate_state(uuid) from public, anon;
revoke all on function public.fees_set_agreement(
  uuid,
  public.fee_model,
  numeric,
  bigint,
  bigint,
  bigint,
  bigint,
  public.fee_agreement_status
) from public, anon;
revoke all on function public.fees_set_org_default(
  uuid,
  public.fee_model,
  numeric,
  bigint,
  bigint,
  bigint,
  bigint
) from public, anon;
revoke all on function public.fees_record_payment(
  uuid,
  bigint,
  date,
  public.fee_payment_method,
  text,
  text
) from public, anon;
revoke all on function public.fees_reverse_payment(uuid) from public, anon;
revoke all on function public.fees_set_outcome_basis(uuid, bigint, text) from public, anon;
revoke all on function public.fees_read_client_fees(uuid) from public, anon;
revoke all on function public.fees_list_org_receivables(uuid, integer, integer) from public, anon;

grant execute on function public.org_flags_set_upfront_fee_approved(uuid, boolean, text) to authenticated;
grant execute on function public.fees_upfront_gate_state(uuid) to authenticated;
grant execute on function public.fees_set_agreement(
  uuid,
  public.fee_model,
  numeric,
  bigint,
  bigint,
  bigint,
  bigint,
  public.fee_agreement_status
) to authenticated;
grant execute on function public.fees_set_org_default(
  uuid,
  public.fee_model,
  numeric,
  bigint,
  bigint,
  bigint,
  bigint
) to authenticated;
grant execute on function public.fees_record_payment(
  uuid,
  bigint,
  date,
  public.fee_payment_method,
  text,
  text
) to authenticated;
grant execute on function public.fees_reverse_payment(uuid) to authenticated;
grant execute on function public.fees_set_outcome_basis(uuid, bigint, text) to authenticated;
grant execute on function public.fees_read_client_fees(uuid) to authenticated;
grant execute on function public.fees_list_org_receivables(uuid, integer, integer) to authenticated;
