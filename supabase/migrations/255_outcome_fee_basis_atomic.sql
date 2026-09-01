-- R1C-11: counted outcome changes and the client fee basis share one transaction.

create function private.sync_outcome_fee_basis()
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

  insert into public.fee_ledger(client_id, org_id, outcome_basis_cents, outcome_basis_source)
  values(v_client_id, v_org_id, v_basis, v_source)
  on conflict(client_id) do update
  set outcome_basis_cents = excluded.outcome_basis_cents,
      outcome_basis_source = excluded.outcome_basis_source;
  return coalesce(new, old);
end;
$$;

create trigger outcomes_sync_fee_basis
after insert or update of state, kind, amount_cents on public.outcomes
for each row execute function private.sync_outcome_fee_basis();

revoke all on function private.sync_outcome_fee_basis() from public;
