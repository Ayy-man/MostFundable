-- R3A-05: direct client creation always begins at the canonical active stage.

create or replace function private.normalize_client_insert_lifecycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  begin
    perform private.require_governed_write('governed_client_write');
    return new;
  exception
    when insufficient_privilege then
      new.stage := 'onboarding';
      new.stage_entered_at := pg_catalog.statement_timestamp();
      new.funded_amount_cents := 0;
      new.status := 'active';
      new.archived_at := null;
      new.archived_by := null;
      new.started_at := current_date;
      new.matches_unlocked_override := false;
      return new;
  end;
end;
$$;

revoke all on function private.normalize_client_insert_lifecycle()
  from public, anon, authenticated, service_role;

drop trigger if exists clients_normalize_insert_lifecycle on public.clients;
create trigger clients_normalize_insert_lifecycle
before insert on public.clients
for each row execute function private.normalize_client_insert_lifecycle();
alter table public.clients enable always trigger clients_normalize_insert_lifecycle;
