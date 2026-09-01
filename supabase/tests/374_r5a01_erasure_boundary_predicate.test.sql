-- R5A-01 — the erasure boundary is a catalog predicate, and a parked operator intent survives it.
--
-- The first three assertions are the property, computed at test time from `pg_class`, `pg_proc`,
-- `pg_policy`, `pg_trigger` and `information_schema.role_table_grants`. Nothing here transcribes
-- the set migration 374 happened to install: `private.erasure_boundary_violations()` recomputes
-- which tables qualify and which of them are uncovered, so a table added by a later phase that
-- qualifies makes this file red until it is covered or its deletion contract is declared.
--
-- Fails on d6ae268 in the obvious way — the predicate functions do not exist there. Fails on the
-- same tree with only migration 374's Part 3 removed with 72 violations: 41 `truncate_grant`,
-- 21 `missing_truncate_guard` and 10 `delete_grant`, `operator_subscription_creation_intents`
-- among the last group.
--
-- The rest is the reproduction: the parked `review` row that carries migration 358's whole safety
-- predicate cannot be erased through the role every server request uses, and the next claim still
-- refuses.

begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

-- =============================================================================================
-- The property, derived from the catalog
-- =============================================================================================

select is_empty(
  $$ select table_name, violation from private.erasure_boundary_violations() $$,
  'no public base table qualifies for the erasure boundary while still being erasable'
);

-- The predicate has to be doing real work rather than returning nothing, and it has to still
-- contain what round 4 already held. Both halves are computed, not listed: the count comes from
-- the predicate and the containment is a set difference against migration 350's own table list.
select cmp_ok(
  (select count(*)::int from private.erasure_boundary_tables()),
  '>',
  14,
  'the predicate returns materially more than migration 350''s fourteen hand-kept tables'
);

-- `org_flags` is the one member of 350's list the predicate does not return: its only writer is
-- the INVOKER fees-gate function and it carries a platform delete policy, so conditions 1 and 3
-- both exclude it. Migration 350 still holds it, which the violation query above proves.
select is_empty(
  $$
    select round4.table_name
    from (values
      ('admin_layouts'), ('consumer_subscriptions'), ('enrollment_milestones'), ('eval_runs'),
      ('idv_sessions'), ('kpi_rollups'), ('outcome_reviews'), ('paid_refresh_requests'),
      ('prompts'), ('pull_cap_attempts'), ('settings'), ('stripe_webhook_events'),
      ('tracker_transition_receipts')
    ) as round4(table_name)
    where round4.table_name not in (
      select boundary.table_name from private.erasure_boundary_tables() as boundary
    )
  $$,
  'the predicate contains every table migration 350 guarded whose writer is a definer'
);

-- Every declared deletion contract states its reason, so a skip can never be silent.
select is_empty(
  $$
    select table_name from private.erasure_deletion_contracts
    where pg_catalog.length(pg_catalog.btrim(contract)) < 20
  $$,
  'every declared deletion contract carries a written reason'
);

-- =============================================================================================
-- R5A-01 — the parked intent cannot be erased, and the boundary still refuses the second create
-- =============================================================================================

insert into public.orgs (id, name, slug)
values ('5a010000-0000-4000-8000-000000000001', 'R5 intent erasure', 'r5-intent-erasure');

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

create temp table r5a01_first on commit drop as
select (public.operator_billing_claim_subscription_intent(
  '5a010000-0000-4000-8000-000000000001', 'direct'
) ->> 'operation_id') as operation_id;

select is(
  public.operator_billing_review_subscription_intent(
    '5a010000-0000-4000-8000-000000000001',
    (select operation_id from r5a01_first)::uuid,
    'unreconciled_past_retention'
  ) ->> 'reason_code',
  'review',
  'the intent parks in review, which is what keeps the organization in the live unique index'
);

-- Fails on d6ae268: the delete succeeds and reports DELETE 1.
select throws_ok(
  $$
    delete from public.operator_subscription_creation_intents
    where org_id = '5a010000-0000-4000-8000-000000000001'
  $$,
  '42501', null,
  'service role cannot delete the parked intent that carries the needs_review predicate'
);

-- Fails on d6ae268: the truncate succeeds and wipes every intent in the table.
select throws_ok(
  $$truncate table public.operator_subscription_creation_intents$$,
  '42501', null,
  'nor truncate the intent ledger'
);

reset role;

select is(
  (select count(*)::int from public.operator_subscription_creation_intents
   where org_id = '5a010000-0000-4000-8000-000000000001'),
  1,
  'the parked row survives both refusals'
);

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

-- Fails on d6ae268 after the delete above: this returns claimed=true / created with a fresh
-- operation id, which `startOperatorSubscription` turns into a second provider create.
select is(
  public.operator_billing_claim_subscription_intent(
    '5a010000-0000-4000-8000-000000000001', 'direct'
  ) ->> 'reason_code',
  'needs_review',
  'so the next claim still refuses instead of minting a second provider create'
);
select is(
  (select count(distinct operation_id)::int
   from public.operator_subscription_creation_intents
   where org_id = '5a010000-0000-4000-8000-000000000001'),
  1,
  'and exactly one operation id has ever existed for this organization'
);

-- The positive half: the governed writers of two boundary tables still work after the revoke.
select lives_ok(
  $$select public.operator_billing_review_subscription_intent(
      '5a010000-0000-4000-8000-000000000001',
      (select operation_id from r5a01_first)::uuid,
      'unreconciled_past_retention'
    )$$,
  'the governed review definer still writes the table service_role can no longer erase'
);
reset role;

select lives_ok(
  $$select public.enqueue_background_job('purge.derived', 'r5a01-subject', 'r5a01-window')$$,
  'and a table with a declared deletion contract keeps the lifecycle writes it contracts for'
);

select is_empty(
  $$
    select grant_row.table_name::text
    from information_schema.role_table_grants as grant_row
    join pg_catalog.pg_class as table_row
      on table_row.relname = grant_row.table_name::name
     and table_row.relnamespace = 'public'::regnamespace
     and table_row.relkind in ('r', 'p')
    where grant_row.table_schema = 'public'
      and grant_row.privilege_type = 'TRUNCATE'
      and grant_row.grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
  $$,
  'no application-reachable role holds TRUNCATE on any public base table at all'
);

select * from finish();
rollback;
