-- 073_operator_seat_sync_drain.sql — recording that a seat sync did not land.
--
-- The success half of the drain already exists: operator_billing_set_seat_quantity
-- in 071 marks the outbox row synced once the provider has actually accepted the
-- quantity. The failure half needs its own writer for two reasons.
--
-- The first is containment. Every other write to these tables goes through a
-- security-definer function granted to service_role alone, and the application's
-- gate (web/scripts/verify-source-gates.mjs) refuses a table write from anywhere
-- but lane B's enrollment repository. A `.from('operator_seat_sync_outbox').update()`
-- in the billing repository would be the one place the pattern broke, so the
-- increment lives here instead and the repository only ever calls rpc().
--
-- The second is the race. A drain reports a failure after the call to the
-- provider returned, and by then the provider may already have applied the
-- change and delivered a webhook that marked the row synced. Blindly writing
-- status = 'pending' would resend a seat quantity that already landed, so the
-- function refuses to touch a row that is no longer pending and says so.
--
-- No public.audit_log row is written here, matching 072: a retry is not a
-- state change, and the seat quantity is attributed when it is actually
-- recorded against the provider. Only a short error *code* is stored, never a
-- provider message, so nothing from a third party's response reaches the table.

begin;

create or replace function public.operator_seat_sync_record_failure(
  p_org_id uuid,
  p_error_code text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text;
  v_attempts integer;
begin
  select outbox.status, outbox.attempts
  into v_status, v_attempts
  from public.operator_seat_sync_outbox as outbox
  where outbox.org_id = p_org_id
  for update;

  if v_status is null then
    return pg_catalog.jsonb_build_object(
      'applied', false,
      'reason_code', 'no_outbox_row',
      'attempts', null,
      'status', null
    );
  end if;

  if v_status <> 'pending' then
    return pg_catalog.jsonb_build_object(
      'applied', false,
      'reason_code', 'not_pending',
      'attempts', v_attempts,
      'status', v_status
    );
  end if;

  -- The column is constrained to 64 characters, so the code is trimmed here
  -- rather than left to raise a check violation the caller cannot act on.
  -- NULLIF is a grammar construct rather than a schema function, so it stays
  -- unqualified; an empty search_path does not hide it, and pg_catalog has no
  -- such entry to point at.
  update public.operator_seat_sync_outbox
  set attempts = attempts + 1,
      last_error_code = pg_catalog.left(nullif(p_error_code, ''), 64)
  where org_id = p_org_id;

  -- status and processed_at are deliberately untouched: the row stays pending
  -- so the next drain picks it up, and nothing here invents a maximum attempt
  -- count that would silently stop retrying a real seat change.
  return pg_catalog.jsonb_build_object(
    'applied', true,
    'reason_code', 'recorded',
    'attempts', v_attempts + 1,
    'status', 'pending'
  );
end;
$fn$;

revoke all on function public.operator_seat_sync_record_failure(uuid, text)
  from public, anon, authenticated;
grant execute on function public.operator_seat_sync_record_failure(uuid, text)
  to service_role;

comment on function public.operator_seat_sync_record_failure(uuid, text) is
  'Increments the attempt count on a pending operator seat sync outbox row and stores a short error code, leaving the row pending. Refuses a row that is no longer pending so a sync the provider already accepted is not resent.';

commit;
