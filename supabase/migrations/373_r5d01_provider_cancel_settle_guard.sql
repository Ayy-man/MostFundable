-- R5D-01 (second half): the migration-354 obligation could never be discharged, so making it
-- visible to the selector in 371 would have re-armed it forever. (371 adds
-- `private.derived_purge_provider_cancel_outstanding` and folds it into
-- `private.derived_purge_outstanding`; 372 is `r5c06_stale_operator_intents` and is unrelated
-- to the purge selector.)
--
-- `consumer_subscriptions_requires_active_enrollment` (migration 022) fires BEFORE UPDATE and
-- rejects any row whose `subscription_ref is not null` while the enrollment is not active. That
-- guard is about settling: a subscription must not go live under an enrollment that is not.
-- `enrollment_cancel_sub` slips past it only because it writes the subscription before it
-- cancels the enrollment. Every later write loses that ordering, and
-- `consumer_subscription_provider_cancel_completed` — the one function whose entire job is to
-- stamp `provider_cancel_completed_at` on a cancelled subscription — is exactly such a write.
-- It therefore raised 23514 for every consumer who ever cancelled, both from
-- `derived-purge.ts` and from `repository.ts`, and no test caught it because both call sites are
-- exercised against fakes.
--
-- The guard is narrowed to the transition it actually means, never relaxed: an INSERT is checked
-- exactly as before, and an UPDATE is checked only when the row is settling — becoming active,
-- or acquiring or changing a provider reference. Bookkeeping on an already-settled row
-- (completing a cancellation, recording an attempt) no longer needs an active enrollment,
-- which is the only way the cancellation obligation can ever reach zero.

begin;

create or replace function public.assert_enrollment_active_for_subscription()
returns trigger
language plpgsql security definer set search_path = ''
as $fn$
declare
  v_status text;
  v_client_id uuid;
  v_settling boolean;
begin
  select enrollment.status::text, enrollment.client_id into v_status, v_client_id
  from public.enrollments as enrollment
  where enrollment.id = new.enrollment_id;

  if v_client_id is distinct from new.client_id then
    raise exception using
      errcode = '23514',
      message = 'a consumer subscription must match its enrollment client';
  end if;

  -- On insert the row is settling by definition if it arrives live or already referenced.
  -- On update only a change counts: a status crossing into `active`, or a provider reference
  -- appearing or being replaced. Anything else is bookkeeping on a row that already settled
  -- under this same check.
  if tg_op = 'INSERT' then
    v_settling := new.status = 'active' or new.subscription_ref is not null;
  else
    v_settling := (new.status = 'active' and old.status is distinct from 'active')
      or (new.subscription_ref is not null
        and new.subscription_ref is distinct from old.subscription_ref);
  end if;

  if v_settling and v_status is distinct from 'active' then
    raise exception using
      errcode = '23514',
      message = 'a consumer subscription cannot settle before its enrollment is active',
      detail = pg_catalog.format(
        'enrollment %s has status %L',
        new.enrollment_id,
        coalesce(v_status, '<missing>')
      );
  end if;
  return new;
end;
$fn$;

comment on function public.assert_enrollment_active_for_subscription() is
  'R5D-01: rejects a subscription settling under a non-active enrollment. Checks the settling '
  'transition rather than the resting state, so a cancelled subscription can still record the '
  'completion of its provider-cancellation obligation.';

commit;
