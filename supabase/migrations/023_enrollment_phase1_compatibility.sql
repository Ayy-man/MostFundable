-- Lane B. Preserve Phase 1 consent semantics after the 020 hardening layer.
begin;

-- Phase 1 records revocation as a second append-only consent event that may
-- retain the original e-signature reference. Only grants are unique per
-- e-signature and kind.
drop index if exists public.uniq_consent_per_esig_kind;

create unique index uniq_consent_per_esig_kind
  on public.consents (client_id, kind, esig_ref)
  where esig_ref is not null and action = 'granted';

-- Phase 1 pins P0001 and an exact message for consent mutation attempts.
-- The same shared guard keeps 42501 for lane B's retained artifacts.
create or replace function public.append_only_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if tg_table_name = 'consents' then
    raise exception 'consents rows are append-only';
  end if;

  raise exception using
    errcode = '42501',
    message = format('%I is append-only', tg_table_name),
    detail = format('attempted %s', tg_op);
end;
$fn$;

revoke all on function public.append_only_guard() from public, anon, authenticated;

commit;
