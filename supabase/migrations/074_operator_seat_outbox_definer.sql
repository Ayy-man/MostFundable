-- 074_operator_seat_outbox_definer.sql — let the seat trigger run for every writer of profiles.
--
-- Migration 072 put an AFTER trigger on public.profiles and left its function
-- SECURITY INVOKER, which is only correct if every role that writes a profile
-- row can also read public.orgs and public.operator_subscriptions and write
-- public.operator_seat_sync_outbox. One important role cannot: GoTrue runs as
-- supabase_auth_admin, that role holds no grant on any of the three, and
-- public.operator_seat_sync_outbox additionally has FORCE ROW LEVEL SECURITY
-- with no insert policy. Deleting a user through Supabase Auth cascades to
-- public.profiles, fires this trigger, and the whole delete fails with a 500.
--
-- The insert path hid it. A profile created by migration 010's
-- on_auth_user_created trigger carries org_id null, the loop filters that row
-- out before touching any table, and nothing is ever read. Only a delete or an
-- org_id change reaches the queries, so the first symptom is "an operator
-- member cannot be removed" — found by the Phase 10 e2e suite, not by the
-- pgTAP suite, because pgTAP runs as an owner that has every privilege.
--
-- SECURITY DEFINER is the narrow fix rather than granting supabase_auth_admin
-- rights on three tables it otherwise has no business in. The function takes no
-- argument, is reachable only as a trigger on public.profiles, and writes one
-- derived count to one row keyed by the organization it just recomputed, so
-- running it as the owner adds no reachable capability. `set search_path = ''`
-- was already in place, which is the part that makes a definer function safe.
--
-- The body below is migration 072's, unchanged except for the security clause.
-- It is repeated in full because `create or replace function` has no way to
-- alter one attribute, and the triggers keep pointing at the same function.

begin;

create or replace function private.operator_seat_outbox_enqueue()
returns trigger
language plpgsql
security definer
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

-- Restated rather than assumed: `create or replace` keeps whatever grants the
-- function already had, and a definer function that public can execute is the
-- one shape this must never take. Nothing calls it directly — it is reached
-- only through the two triggers migration 072 created.
revoke all on function private.operator_seat_outbox_enqueue() from public;

comment on function private.operator_seat_outbox_enqueue() is
  'Captures an operator seat count change into public.operator_seat_sync_outbox. SECURITY DEFINER because it fires for every writer of public.profiles, including GoTrue as supabase_auth_admin, which holds no grant on the tables it reads. Writes no public.audit_log row on purpose, so the seed audit composition asserted by 004_seed_isolation.test.sql is unchanged, and calls no billing function, so no provider round trip lands inside a profiles transaction.';

commit;
