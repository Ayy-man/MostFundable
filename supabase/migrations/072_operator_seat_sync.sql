-- 072_operator_seat_sync.sql — capturing a seat change at the source of truth.
--
-- Seat count is a fact about public.profiles, so it is captured where the fact
-- changes rather than by a job that periodically recounts. The trigger writes a
-- single outbox row per organization, keyed on org_id, so a member added and
-- then taken off the organization a minute later leaves one row carrying the
-- final number instead of two rows that have to be reconciled.
--
-- Two things this function deliberately does not do, both of which are the
-- reason it can run during seeding and during every other lane's writes:
--
--   * It writes no public.audit_log row. Phase 1's seed suite asserts the exact
--     composition of the audit trail after seeding, and lane B had to escalate
--     when its own writes moved that count. Adding an attribution row here would
--     repeat that conflict for no gain — the billing RPCs in 071 already attribute
--     the seat quantity when it is actually recorded against the provider.
--   * It calls no operator_billing_* function. The trigger records intent; the
--     drain records the outcome. Calling the provider from inside a profiles
--     write would put a network round trip inside someone else's transaction.
--
-- It also returns early for an organization with no operator_subscriptions row,
-- which is what keeps a seeded organization or a consumer-only tenant quiet.

begin;

create or replace function private.operator_seat_outbox_enqueue()
returns trigger
language plpgsql
set search_path = ''
as $fn$
declare
  v_org_id uuid;
  v_count integer;
  v_included integer;
begin
  -- An update of org_id changes two counts, so both the organization the member
  -- left and the one it joined are recomputed. The distinct union collapses the
  -- insert and delete cases, where only one of the two is present.
  for v_org_id in
    select distinct affected.org_id
    from (
      select new.org_id as org_id
      union all
      select old.org_id as org_id
    ) as affected
    where affected.org_id is not null
  loop
    if not exists (
      select 1
      from public.operator_subscriptions as subscription
      where subscription.org_id = v_org_id
    ) then
      continue;
    end if;

    select pg_catalog.count(*)::integer
    into v_count
    from public.profiles as member
    where member.org_id = v_org_id
      and member.role = 'operator_member';

    select organization.seats_included
    into v_included
    from public.orgs as organization
    where organization.id = v_org_id;

    insert into public.operator_seat_sync_outbox (
      org_id,
      desired_quantity,
      status,
      attempts,
      last_error_code,
      enqueued_at,
      processed_at
    ) values (
      v_org_id,
      -- greatest and coalesce are grammar constructs rather than schema
      -- functions, so an empty search_path does not hide them.
      greatest(0, v_count - coalesce(v_included, 0)),
      'pending',
      0,
      null,
      pg_catalog.now(),
      null
    )
    on conflict (org_id) do update
    set desired_quantity = excluded.desired_quantity,
        status = 'pending',
        attempts = 0,
        last_error_code = null,
        enqueued_at = excluded.enqueued_at,
        processed_at = null;
  end loop;

  -- The triggers below are AFTER triggers, so the return value is discarded.
  -- Returning null says that rather than implying this function shapes the row.
  return null;
end;
$fn$;

revoke all on function private.operator_seat_outbox_enqueue() from public;

comment on function private.operator_seat_outbox_enqueue() is
  'Captures an operator seat count change into public.operator_seat_sync_outbox. Writes no public.audit_log row on purpose, so the seed audit composition asserted by 004_seed_isolation.test.sql is unchanged, and calls no billing function, so no provider round trip lands inside a profiles transaction.';

-- Two triggers rather than one, so the update case can name the columns that
-- actually change a count. A profile whose full_name changes must not enqueue.
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'profiles_operator_seat_sync'
      and tgrelid = 'public.profiles'::regclass
  ) then
    create trigger profiles_operator_seat_sync
      after insert or delete on public.profiles
      for each row execute function private.operator_seat_outbox_enqueue();
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'profiles_operator_seat_sync_update'
      and tgrelid = 'public.profiles'::regclass
  ) then
    create trigger profiles_operator_seat_sync_update
      after update of org_id, role on public.profiles
      for each row execute function private.operator_seat_outbox_enqueue();
  end if;
end
$$;

commit;
