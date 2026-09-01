-- One counted approved-outcome sum drives both the fee basis and the tracker
-- funded amount. Keeping the writes in the existing outcome trigger means an
-- insert, correction, or deletion cannot leave the two projections split.

create or replace function private.sync_outcome_fee_basis()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client_id uuid := coalesce(new.client_id, old.client_id);
  v_org_id uuid;
  v_basis bigint;
  v_source text;
  v_previous_fee_marker text := current_setting('app.governed_fee_basis_write', true);
  v_previous_client_marker text := current_setting('app.governed_client_write', true);
begin
  select client.org_id into strict v_org_id
  from public.clients as client where client.id = v_client_id;

  select coalesce(sum(outcome.amount_cents), 0)::bigint into v_basis
  from public.outcomes as outcome
  where outcome.client_id = v_client_id
    and outcome.kind = 'approved'
    and outcome.state = 'counted';

  v_source := case
    when tg_op = 'UPDATE' and new.state = 'removed' then 'outcome_withdrawn'
    else 'outcome_approved'
  end;

  perform pg_catalog.set_config('app.governed_fee_basis_write', 'on', true);
  perform pg_catalog.set_config('app.governed_client_write', 'on', true);
  insert into public.fee_ledger(client_id, org_id, outcome_basis_cents, outcome_basis_source)
  values(v_client_id, v_org_id, v_basis, v_source)
  on conflict(client_id) do update
  set outcome_basis_cents = excluded.outcome_basis_cents,
      outcome_basis_source = excluded.outcome_basis_source;
  update public.clients
  set funded_amount_cents = v_basis
  where id = v_client_id;

  perform pg_catalog.set_config(
    'app.governed_fee_basis_write', coalesce(v_previous_fee_marker, ''), true
  );
  perform pg_catalog.set_config(
    'app.governed_client_write', coalesce(v_previous_client_marker, ''), true
  );

  return coalesce(new, old);
end;
$$;

-- Repair genuine outcome-backed clients already present without erasing an
-- explicitly recorded legacy funded amount on clients that have no outcome
-- rows yet.
do $$
declare
  v_previous_client_marker text := current_setting('app.governed_client_write', true);
begin
  perform pg_catalog.set_config('app.governed_client_write', 'on', true);
  update public.clients as client
  set funded_amount_cents = basis.total_cents
  from (
    select
      outcome.client_id,
      coalesce(sum(outcome.amount_cents) filter (
        where outcome.kind = 'approved' and outcome.state = 'counted'
      ), 0)::bigint as total_cents
    from public.outcomes as outcome
    group by outcome.client_id
  ) as basis
  where client.id = basis.client_id;
  perform pg_catalog.set_config(
    'app.governed_client_write', coalesce(v_previous_client_marker, ''), true
  );
end;
$$;

revoke all on function private.sync_outcome_fee_basis() from public;
