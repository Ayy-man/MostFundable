-- R3A-03: an application's identity anchor is immutable after creation.

create or replace function private.guard_application_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.client_id is distinct from old.client_id
    or new.bank_ref is distinct from old.bank_ref
    or new.created_by is distinct from old.created_by
  then
    raise exception using errcode = '42501', message = 'APPLICATION_IDENTITY_IMMUTABLE';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_application_identity()
  from public, anon, authenticated, service_role;

drop trigger if exists applications_guard_identity on public.applications;
create trigger applications_guard_identity
before update on public.applications
for each row execute function private.guard_application_identity();
alter table public.applications enable always trigger applications_guard_identity;
