-- CRS v3's DIT + SMFA flow records a hosted magic-link challenge, while the original enrollment
-- ledger admitted only the mock driver's SMS-code and quiz kinds. Keep the existing ledger intact
-- and expand the constraint through a new migration so a real CRS start cannot fail after the
-- provider account has already been created.

begin;

alter table public.idv_sessions
  drop constraint if exists idv_sessions_kind_valid;

alter table public.idv_sessions
  add constraint idv_sessions_kind_valid
  check (kind in ('sms', 'quiz', 'smfa_link'));

-- Vercel may run enrollment creation and status polling in different processes. Persist only the
-- AES-GCM ciphertext produced at the CRS boundary; the SMFA token itself never enters the ledger.
alter table public.idv_sessions
  add column if not exists continuation_ciphertext text;

create or replace function public.enrollment_idv_started(
  p_enrollment_id uuid,
  p_client_id uuid,
  p_actor_id uuid,
  p_driver text,
  p_kind text,
  p_max_attempts integer,
  p_member_ref text,
  p_continuation text
) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_owner uuid;
begin
  perform pg_catalog.set_config('app.actor_id', coalesce(p_actor_id::text, ''), true);

  select enrollment.client_id into v_owner
  from public.enrollments as enrollment
  where enrollment.id = p_enrollment_id
  for update;

  if v_owner is null then
    raise exception using errcode = 'P0002', message = 'ENROLLMENT_NOT_FOUND';
  end if;
  if v_owner is distinct from p_client_id then
    raise exception using errcode = '23503', message = 'ENROLLMENT_IDV_CLIENT_MISMATCH';
  end if;

  update public.enrollments
  set crs_member_ref = p_member_ref
  where id = p_enrollment_id and client_id = p_client_id;

  insert into public.idv_sessions (
    enrollment_id,
    client_id,
    member_ref,
    driver,
    kind,
    state,
    max_attempts,
    continuation_ciphertext
  ) values (
    p_enrollment_id,
    p_client_id,
    p_member_ref,
    p_driver,
    p_kind,
    'sms_sent',
    p_max_attempts,
    p_continuation
  )
  on conflict (enrollment_id) do nothing;
end;
$fn$;

revoke all on function public.enrollment_idv_started(uuid,uuid,uuid,text,text,integer,text,text)
  from public, anon, authenticated;
grant execute on function public.enrollment_idv_started(uuid,uuid,uuid,text,text,integer,text,text)
  to service_role;

commit;
