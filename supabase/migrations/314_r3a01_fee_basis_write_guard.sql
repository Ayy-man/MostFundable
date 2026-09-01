-- R3A-01: the fee outcome basis is derived only by the outcome synchronizer.

create or replace function private.guard_fee_outcome_basis()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    or new.outcome_basis_cents <> 0
    or new.outcome_basis_source is not null
  then
    perform private.require_governed_write('governed_fee_basis_write');
  end if;
  return new;
end;
$$;

revoke all on function private.guard_fee_outcome_basis()
  from public, anon, authenticated, service_role;

drop trigger if exists fee_ledger_guard_outcome_basis on public.fee_ledger;
create trigger fee_ledger_guard_outcome_basis
before insert or update of outcome_basis_cents, outcome_basis_source
on public.fee_ledger
for each row execute function private.guard_fee_outcome_basis();
alter table public.fee_ledger enable always trigger fee_ledger_guard_outcome_basis;

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
  v_previous_marker text := current_setting('app.governed_fee_basis_write', true);
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
  insert into public.fee_ledger(client_id, org_id, outcome_basis_cents, outcome_basis_source)
  values(v_client_id, v_org_id, v_basis, v_source)
  on conflict(client_id) do update
  set outcome_basis_cents = excluded.outcome_basis_cents,
      outcome_basis_source = excluded.outcome_basis_source;
  perform pg_catalog.set_config(
    'app.governed_fee_basis_write', coalesce(v_previous_marker, ''), true
  );
  return coalesce(new, old);
end;
$$;

revoke all on function private.sync_outcome_fee_basis()
  from public, anon, authenticated, service_role;
