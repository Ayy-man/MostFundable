-- R5A-01 — the erasure boundary becomes a catalog predicate instead of a list.
--
-- The reported defect is one table: `service_role` holds `DELETE` and `TRUNCATE` on
-- `public.operator_subscription_creation_intents`, so deleting a parked `review` row removes
-- migration 358's whole safety predicate — the parked row is what keeps the organization in the
-- live unique index and makes both creation paths return `needs_review` — and the next
-- `operator_billing_claim_subscription_intent` returns `claimed=true, reason_code=created` with a
-- fresh operation id, which `startOperatorSubscription` turns into a second provider create.
--
-- Migration 350 missed it because its selection criterion was **holds `TRUNCATE` while lacking
-- `INSERT`**, and this table holds both. Adding one table to 350's fourteen-table list reproduces
-- the same failure one member wider, so this file does not do that. It replaces the list with a
-- predicate computed from the catalog, installs the boundary over everything the predicate
-- returns, and gives `supabase/tests/374_r5a01_erasure_boundary_predicate.test.sql` the same
-- predicate to assert — so a table added in a later phase that qualifies fails the test until it
-- is covered or its deletion contract is declared.
--
-- ---------------------------------------------------------------------------------------
-- The predicate
-- ---------------------------------------------------------------------------------------
--
-- A public base table carries **a durable operation, intent or evidence record that a product
-- invariant depends on continuing to exist** when all three hold, each read from the catalog:
--
--   1. a `SECURITY DEFINER` function in `public` or `private` writes it — the product creates the
--      record through governed authority rather than through a caller's own grants;
--   2. no function in either schema deletes from it or truncates it — the product's own authority
--      never removes the record, so nothing in the design expects it to disappear;
--   3. no RLS policy grants `DELETE` (or `ALL`) to an application role — deleting the row is not
--      an operation the surfaces offer.
--
-- Condition 3 is what keeps `affiliates`, `profiles`, `orgs`, `clients`, `affiliate_client_shares`,
-- `org_flags` and the fee tables out: each has an operator- or platform-facing delete policy, so
-- deletion is a declared feature and the catalog says so without anyone maintaining a list.
--
-- The predicate returns 51 tables against migration 350's fourteen, and it contains thirteen of
-- those fourteen. The one it does not contain is `org_flags`, whose only writer is the INVOKER
-- `org_flags_set_upfront_fee_approved` that backs the fees legal gate — condition 1 excludes it and
-- condition 3 would too. Migration 350 already holds that table; nothing here loosens it.
--
-- ---------------------------------------------------------------------------------------
-- What the boundary means, in three parts
-- ---------------------------------------------------------------------------------------
--
-- **TRUNCATE is swept universally, with no predicate and no exemption.** There is no `TRUNCATE`
-- statement anywhere in `web/src`, `web/scripts` or `supabase/seed.sql` — migration 350 established
-- that and it is still true — so no role an application connection can assume has any business
-- holding it on any table. Sweeping it everywhere rather than over the predicate's members removes
-- the whole residue class instead of the part of it this round happened to look at.
--
-- **DELETE is revoked over the predicate's members**, except where the row is already refused by a
-- stronger mechanism or a deletion contract is declared:
--
--   * an enabled `BEFORE DELETE ... FOR EACH ROW` guard already exists. The trigger binds the table
--     owner too, which a grant never does, so revoking on top of it would change nothing except the
--     SQLSTATE the caller sees — and the existing refusal assertions in `002`, `003`, `020`, `030`,
--     `050`, `070` and `110` read that SQLSTATE. `consents`, `audit_log`, `stage_history`,
--     `application_notes`, `operator_billing_events`, `operator_earnings_ledger`, `referral_ledger`,
--     `consent_revocations`, `esignatures`, `fee_payments`, `outcomes`, `outcome_reviews`,
--     `enrollment_milestones`, `stripe_webhook_events` and `paid_refresh_payment_events` are inside
--     the boundary by that route.
--   * the table is registered in `private.erasure_deletion_contracts` with its contract written
--     down. Round 4's R4A-06 narrowing governs the queue members; the rest are paths that exist in
--     code today and would break, which the protocol calls a finding rather than a fix.
--
-- **Every predicate member carries an ALWAYS statement truncate guard**, on migration 243's and
-- 350's pattern, so a future `SECURITY DEFINER` function cannot wipe a table the way a grant-only
-- fix would let it.
--
-- ---------------------------------------------------------------------------------------
-- Declared deletion contracts, each with its reason
-- ---------------------------------------------------------------------------------------
--
--   background_jobs, email_outbox, notification_delivery_outbox, operator_seat_sync_outbox,
--   outcome_refresh_jobs   — lifecycle queues with an explicit deletion contract (R4A-06).
--   kb_import_seen         — dedup ledger owned by `kb_import_runs` through `on delete cascade`.
--   outcome_notifications  — cascades from orgs, outcomes and profiles by design.
--   trainings              — `web/src/lib/ancillary/repository.ts:159` deletes a training row
--                            through the admin client; deleting it is the product operation.
--   document_uploads       — `web/src/lib/ancillary/upload-repository.ts:113`, same shape.
--   enrollments,
--   operator_subscriptions — `web/scripts/verify-billing-ops-api.mjs:356-358` tears its fixtures
--                            down as `service_role`; revoking here breaks a supported path.
--
-- A contract row for a table the predicate does not return is itself a violation, so a contract
-- cannot outlive the reason it was written for.

begin;

-- ---------------------------------------------------------------------------------------
-- Part 1 — the declared deletion contracts.
-- ---------------------------------------------------------------------------------------
create table if not exists private.erasure_deletion_contracts (
  table_name text primary key,
  contract text not null,
  declared_at timestamptz not null default pg_catalog.now(),
  constraint erasure_deletion_contracts_contract_stated check (pg_catalog.btrim(contract) <> '')
);

revoke all on table private.erasure_deletion_contracts
  from public, anon, authenticated, service_role;

insert into private.erasure_deletion_contracts (table_name, contract)
values
  ('background_jobs',
   'lifecycle queue with an explicit deletion contract (round 4 R4A-06 narrowing)'),
  ('email_outbox',
   'lifecycle queue with an explicit deletion contract (round 4 R4A-06 narrowing)'),
  ('notification_delivery_outbox',
   'lifecycle queue with an explicit deletion contract (round 4 R4A-06 narrowing)'),
  ('operator_seat_sync_outbox',
   'lifecycle queue with an explicit deletion contract (round 4 R4A-06 narrowing)'),
  ('outcome_refresh_jobs',
   'lifecycle queue with an explicit deletion contract (round 4 R4A-06 narrowing)'),
  ('kb_import_seen',
   'dedup ledger owned by kb_import_runs through on delete cascade'),
  ('outcome_notifications',
   'cascades from orgs, outcomes and profiles by design'),
  ('trainings',
   'web/src/lib/ancillary/repository.ts deletes a training row through the admin client'),
  ('document_uploads',
   'web/src/lib/ancillary/upload-repository.ts deletes an upload row through the admin client'),
  ('enrollments',
   'web/scripts/verify-billing-ops-api.mjs tears its fixtures down as service_role'),
  ('operator_subscriptions',
   'web/scripts/verify-billing-ops-api.mjs tears its fixtures down as service_role')
on conflict (table_name) do update set contract = excluded.contract;

-- ---------------------------------------------------------------------------------------
-- Part 2 — the predicate, as a function both this file and the pgTAP read.
-- ---------------------------------------------------------------------------------------
create or replace function private.erasure_boundary_tables()
returns table (table_name text)
language sql
stable
security definer
set search_path = ''
as $fn$
  select boundary.relname::text
  from pg_catalog.pg_class as boundary
  join pg_catalog.pg_namespace as schema_row
    on schema_row.oid = boundary.relnamespace and schema_row.nspname = 'public'
  where boundary.relkind in ('r', 'p')
    -- 1. written through governed authority
    and exists (
      select 1
      from pg_catalog.pg_proc as writer
      where writer.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
        and writer.prosecdef
        and (
          writer.prosrc ~* ('insert[[:space:]]+into[[:space:]]+(public\.)?' || boundary.relname || '\M')
          or writer.prosrc ~* ('update[[:space:]]+(only[[:space:]]+)?(public\.)?' || boundary.relname || '\M')
        )
    )
    -- 2. no function in the product's own authority removes the record
    and not exists (
      select 1
      from pg_catalog.pg_proc as remover
      where remover.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
        and (
          remover.prosrc ~* ('delete[[:space:]]+from[[:space:]]+(public\.)?' || boundary.relname || '\M')
          or remover.prosrc ~* ('truncate[[:space:]]+(table[[:space:]]+)?(public\.)?' || boundary.relname || '\M')
        )
    )
    -- 3. no surface offers deletion as a product operation
    and not exists (
      select 1
      from pg_catalog.pg_policy as policy_row
      where policy_row.polrelid = boundary.oid
        and policy_row.polcmd in ('d', '*')
        and exists (
          select 1
          from pg_catalog.pg_roles as policy_role
          where policy_role.oid = any (policy_row.polroles)
            and policy_role.rolname in ('anon', 'authenticated', 'service_role')
        )
    )
$fn$;

revoke all on function private.erasure_boundary_tables()
  from public, anon, authenticated, service_role;

-- Everything the boundary forbids, computed at call time. Empty is the property.
create or replace function private.erasure_boundary_violations()
returns table (table_name text, violation text)
language sql
stable
security definer
set search_path = ''
as $fn$
  -- (1) TRUNCATE held by an application-reachable role, on any public base table at all.
  select held.relname::text, 'truncate_grant'::text
  from pg_catalog.pg_class as held
  join pg_catalog.pg_namespace as schema_row
    on schema_row.oid = held.relnamespace and schema_row.nspname = 'public'
  where held.relkind in ('r', 'p')
    and exists (
      select 1
      from information_schema.role_table_grants as grant_row
      where grant_row.table_schema = 'public'
        and grant_row.table_name::text = held.relname::text
        and grant_row.grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
        and grant_row.privilege_type = 'TRUNCATE'
    )

  union all

  -- (2) DELETE on a boundary table with neither a row guard nor a declared deletion contract.
  select boundary.table_name, 'delete_grant'::text
  from private.erasure_boundary_tables() as boundary
  where not exists (
      select 1 from private.erasure_deletion_contracts as contract_row
      where contract_row.table_name = boundary.table_name
    )
    and not exists (
      select 1
      from pg_catalog.pg_trigger as guard
      where guard.tgrelid = ('public.' || boundary.table_name)::regclass
        and not guard.tgisinternal
        and guard.tgenabled <> 'D'
        and (guard.tgtype & 8) = 8   -- DELETE
        and (guard.tgtype & 2) = 2   -- BEFORE
        and (guard.tgtype & 1) = 1   -- FOR EACH ROW
    )
    and exists (
      select 1
      from information_schema.role_table_grants as grant_row
      where grant_row.table_schema = 'public'
        and grant_row.table_name::text = boundary.table_name
        and grant_row.grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
        and grant_row.privilege_type = 'DELETE'
    )

  union all

  -- (3) a boundary table with no ALWAYS statement truncate guard.
  select boundary.table_name, 'missing_truncate_guard'::text
  from private.erasure_boundary_tables() as boundary
  where not exists (
    select 1
    from pg_catalog.pg_trigger as guard
    where guard.tgrelid = ('public.' || boundary.table_name)::regclass
      and not guard.tgisinternal
      and guard.tgenabled = 'A'
      and (guard.tgtype & 32) = 32  -- TRUNCATE
  )

  union all

  -- (4) a deletion contract that outlived the table it was written for.
  select contract_row.table_name, 'stale_deletion_contract'::text
  from private.erasure_deletion_contracts as contract_row
  where not exists (
    select 1 from private.erasure_boundary_tables() as boundary
    where boundary.table_name = contract_row.table_name
  )
$fn$;

revoke all on function private.erasure_boundary_violations()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------
-- Part 3 — install the boundary the predicate describes.
-- ---------------------------------------------------------------------------------------
do $$
declare
  target text;
begin
  -- TRUNCATE, everywhere.
  for target in
    select table_row.relname::text
    from pg_catalog.pg_class as table_row
    join pg_catalog.pg_namespace as schema_row
      on schema_row.oid = table_row.relnamespace and schema_row.nspname = 'public'
    where table_row.relkind in ('r', 'p')
    order by 1
  loop
    execute format(
      'revoke truncate on table public.%I from public, anon, authenticated, service_role',
      target
    );
  end loop;

  -- DELETE, and the statement guard, over the predicate's members.
  for target in select boundary.table_name from private.erasure_boundary_tables() as boundary order by 1
  loop
    if not exists (
      select 1 from private.erasure_deletion_contracts as contract_row
      where contract_row.table_name = target
    ) and not exists (
      select 1
      from pg_catalog.pg_trigger as guard
      where guard.tgrelid = ('public.' || target)::regclass
        and not guard.tgisinternal
        and guard.tgenabled <> 'D'
        and (guard.tgtype & 8) = 8
        and (guard.tgtype & 2) = 2
        and (guard.tgtype & 1) = 1
    ) then
      execute format(
        'revoke delete on table public.%I from public, anon, authenticated, service_role',
        target
      );
    end if;

    if not exists (
      select 1
      from pg_catalog.pg_trigger as guard
      where guard.tgname = target || '_no_truncate'
        and guard.tgrelid = ('public.' || target)::regclass
        and not guard.tgisinternal
    ) then
      execute format(
        'create trigger %I before truncate on public.%I '
        'for each statement execute function public.append_only_guard()',
        target || '_no_truncate',
        target
      );
    end if;

    execute format(
      'alter table public.%I enable always trigger %I',
      target,
      target || '_no_truncate'
    );
  end loop;
end
$$;

commit;
