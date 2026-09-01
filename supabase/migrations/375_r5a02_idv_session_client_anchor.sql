-- R5A-02 — an identity session belongs to the client that owns its enrollment, in the database.
--
-- `idv_sessions` carried two independent foreign keys — one to `clients`, one to `enrollments` —
-- and nothing tying the pair together. `enrollment_idv_started` updates the enrollment only when
-- both ids match and then inserts the session row unconditionally, so Cedar's enrollment id
-- persisted beside Casey's client id with `passed|pass`. Migrations 353, 355 and 356 all look the
-- session up by `enrollment_id` alone, so that one row satisfies the IDV settlement gate and the
-- pre-charge dispatch claim alike, and a consumer can be charged against another person's
-- identity check.
--
-- Both halves of the fix are here and both are required.
--
-- **The anchor.** A composite foreign key from `(enrollment_id, client_id)` to
-- `enrollments (id, client_id)` makes the pairing structural, so the database refuses the row no
-- matter which writer produces it — a definer, the table owner, or a future RPC nobody has written
-- yet. It needs a unique key on `enrollments (id, client_id)` to reference, which is what the first
-- statement adds; `id` is already the primary key, so the pair is unique by construction and the
-- index costs nothing in correctness terms. The old single-column `enrollments` reference is
-- dropped because the composite subsumes it exactly, same `on delete restrict`.
--
-- **The refusal.** `enrollment_idv_started` raises on a mismatch rather than updating nothing and
-- then inserting anyway. Silently writing a row the update just declined to act on is the behaviour
-- that produces the cross-client proof; with the composite key installed the insert would fail
-- anyway, but it would fail as a foreign-key violation from inside a definer, which tells the caller
-- nothing about what it did wrong. Round 4's R4A-08 narrowing forbids a table-level CHECK where an
-- owner-executed definer is the only writer, and this is not one — it is a foreign key, which is
-- what expresses a parent relationship, plus an explicit precondition in the writer.
--
-- The caller in `web/src/lib/enrollment/service.ts` passes both ids out of one state object today.
-- That is the finding's own mitigation stated as its rationale, and it is exactly the shape round 5
-- classifies as mechanism 2: a check held at the caller with the authority left open underneath.

begin;

-- The parent key the composite reference needs. `id` is already unique, so this adds a second
-- index over the same rows and no new constraint on what `enrollments` may contain.
alter table public.enrollments
  drop constraint if exists enrollments_id_client_id_key;
alter table public.enrollments
  add constraint enrollments_id_client_id_key unique (id, client_id);

-- The anchor itself.
alter table public.idv_sessions
  drop constraint if exists idv_sessions_enrollment_client_fkey;
alter table public.idv_sessions
  add constraint idv_sessions_enrollment_client_fkey
  foreign key (enrollment_id, client_id)
  references public.enrollments (id, client_id)
  on delete restrict;

-- Subsumed exactly by the composite above.
alter table public.idv_sessions
  drop constraint if exists idv_sessions_enrollment_id_fkey;

-- The writer refuses loudly instead of half-acting.
create or replace function public.enrollment_idv_started(
  p_enrollment_id uuid,
  p_client_id uuid,
  p_actor_id uuid,
  p_driver text,
  p_kind text,
  p_max_attempts integer,
  p_member_ref text
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
    max_attempts
  ) values (
    p_enrollment_id,
    p_client_id,
    p_member_ref,
    p_driver,
    p_kind,
    'sms_sent',
    p_max_attempts
  )
  on conflict (enrollment_id) do nothing;
end;
$fn$;

revoke all on function public.enrollment_idv_started(uuid,uuid,uuid,text,text,integer,text)
  from public, anon, authenticated;
grant execute on function public.enrollment_idv_started(uuid,uuid,uuid,text,text,integer,text)
  to service_role;

commit;
