-- R3A-02: outcomes are created only through the governed RPC and applications
-- cannot accept caller-forged creation attribution.

revoke insert on table public.outcomes from authenticated;
drop policy if exists outcomes_insert_scoped on public.outcomes;

create or replace function private.normalize_application_created_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.role()) = 'authenticated' then
    new.created_by := (select auth.uid());
  end if;
  return new;
end;
$$;

revoke all on function private.normalize_application_created_by()
  from public, anon, authenticated, service_role;

drop trigger if exists applications_normalize_created_by on public.applications;
create trigger applications_normalize_created_by
before insert on public.applications
for each row execute function private.normalize_application_created_by();
alter table public.applications enable always trigger applications_normalize_created_by;
