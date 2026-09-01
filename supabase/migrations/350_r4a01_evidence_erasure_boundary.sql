-- R4A-01 / R4A-05 / R4A-06 / R4A-07 — nothing the product treats as evidence can be
-- physically erased by a role that application code can reach.
--
-- Four findings, one property. Rounds 1–3 each installed the guard on the table the
-- reviewer named and left the rest of the shape open: migration 243 guarded eight tables,
-- migration 312 guarded `outcomes` alone, migration 241 removed authenticated write
-- authority on milestones and stopped. This file closes the class instead of the four
-- reproductions.
--
-- ---------------------------------------------------------------------------------------
-- Part 1 (R4A-07) — the privilege residue, and why the earlier grants did nothing
-- ---------------------------------------------------------------------------------------
--
-- The archetype is `022_billing_tables.sql:146-148`: `revoke all … from anon, authenticated`
-- followed by `grant select … to service_role`. Supabase's default privileges had already
-- given `service_role` ALL on every newly created public table and `service_role` was never
-- named in the revoke, so the grant narrowed nothing and the default stood. Every table
-- below carries the same footprint — `REFERENCES, SELECT, TRIGGER, TRUNCATE` — which is a
-- migration that meant to strip write authority and left the table wipeable.
--
-- The correct shape already exists in the repo at `283_r2c04_refund_attribution.sql:31-32`:
-- revoke from `public, anon, authenticated, service_role` and *then* grant the intended set.
-- `billing_refund_attributions` holds exactly `SELECT` today because of those two lines.
--
-- The selection criterion is catalog-derived, not a hand-kept list: **holds `TRUNCATE`, does
-- not hold `INSERT`, `relkind in ('r','p')`**. That query returned exactly the ten tables
-- below and must return zero rows after this migration (asserted in
-- `supabase/tests/350_r4a01_evidence_erasure_boundary.test.sql`). The criterion also carries
-- the per-table safety proof for free: a table `service_role` cannot INSERT into has no
-- `service_role` writer today, because such a writer would already be failing. Every writer
-- of these ten is an owner-executed SECURITY DEFINER function that never consults
-- `service_role`'s grants — verified against `pg_proc.prosecdef`, not against the SQL files.
--
-- All three residual privileges go, and the decision is made by *intent* rather than by a
-- risk ranking. Each table below has a migration that states the privilege set it meant to
-- leave in place; this file makes the catalog match that statement exactly. Ranking
-- `TRUNCATE` above `TRIGGER` above `REFERENCES` and stopping partway is what produces the
-- next round's finding, because a reviewer who reads `TRIGGER` on a table the product
-- forbids writing will file it, correctly.
--
--   table                        | restores the intent stated in            | writer (all SECURITY DEFINER)
--   -----------------------------+------------------------------------------+------------------------------------------
--   admin_layouts                | 201_admin_analytics.sql:234-236          | admin_set_layout
--   consumer_subscriptions       | 022_billing_tables.sql:146-148           | enrollment_record_setup / _settle_sub /
--                                |                                          | _cancel_sub / _review_sub,
--                                |                                          | begin_consumer_subscription_attempt,
--                                |                                          | consumer_subscription_apply_event,
--                                |                                          | record_consumer_subscription_provider_returned
--   eval_runs                    | 200_admin_settings_prompts.sql:110,113   | admin_record_eval_run
--   idv_sessions                 | 021_enrollment_tables.sql:190,193        | enrollment_idv_started / _idv_settled
--   kpi_rollups                  | 201_admin_analytics.sql:233,235          | admin_upsert_kpi_rollup
--   org_flags                    | 090_org_legal_flags.sql:169-179          | org_flags_set_upfront_fee_approved (INVOKER —
--                                |                                          | see the note below)
--   paid_refresh_requests        | 151_paid_refresh_payments.sql:77,79      | create_paid_refresh_request and the six
--                                |                                          | paid-refresh transition definers
--   prompts                      | 200_admin_settings_prompts.sql:109,112   | admin_create_prompt_version /
--                                |                                          | admin_activate_prompt_version
--   settings                     | 200_admin_settings_prompts.sql:108,111   | admin_set_setting
--   tracker_transition_receipts  | 050_tracker_stage_engine.sql:13          | private.tracker_transition_client_stage_r1a03_impl
--
-- `tracker_transition_receipts` is the one table whose stated intent grants `service_role`
-- nothing at all: `050:13` revokes and never grants. It correspondingly holds no `SELECT`
-- today, which is the proof that nothing reads it through PostgREST.
--
-- **This is not the blanket sweep round 3 refused.** That danger was revoking from
-- `authenticated`, where INVOKER functions write through the *caller's* grants and the fee
-- seeder swallows `42501`. Exactly one INVOKER writer survives in this set —
-- `public.org_flags_set_upfront_fee_approved` (`prosecdef = false`), which inserts and
-- updates `org_flags` through the caller's grants and backs the fees legal gate. So this
-- file does not narrow `authenticated` anywhere: for every table it re-grants the full set
-- the source migration declared for *both* roles, which for `org_flags` is
-- `select, insert, update` to `authenticated`. The pre-state was measured first — the
-- `authenticated` column of the live catalog already equalled the declared intent on all
-- ten, so the revoke/grant pair is a no-op for that role by construction, and the truncate
-- guard below would catch a mistake even if it were not.
--
-- ---------------------------------------------------------------------------------------
-- Part 2 (R4A-01, R4A-05, R4A-06) — the four tables that hold real write authority
-- ---------------------------------------------------------------------------------------
--
-- `outcome_reviews` (R4A-01). `080:168-193` makes this the one mandatory correction row per
-- outcome and `081:1075-1095` creates it only on outcome insertion, so an erased review is
-- never recreated while the outcome stays counted and its fee basis receivable. Migration
-- 312 guarded `outcomes` and not the review beside it. `review_outcome` needs only `UPDATE`,
-- nothing in the catalog or in `web/src` deletes a review row, and the delete guard cannot
-- collide with the cascade from `outcomes` because `outcomes_no_delete` already blocks that
-- parent delete outright.
--
-- `enrollment_milestones` (R4A-05). `241:4-12` removed authenticated write authority and left
-- `service_role` the full set, so a completion row could be deleted while its immutable
-- `milestone.complete` audit row survived — the checklist and the audit then disagree and a
-- replay writes a second completion fact. `INSERT` is preserved because
-- `enrollment_record_milestone` is the only writer; it is `on conflict (client_id, kind) do
-- nothing`, so the update guard cannot break its idempotent replay.
--
-- `stripe_webhook_events` (R4A-06). **This one is a deliberate narrowing of a deliberate
-- grant, not a correction of residue** — `022_billing_tables.sql:150` is an explicit
-- `grant all … to service_role`, so it is not in the ten-table class above and must not be
-- read as the same defect. `250:49-78` defines duplicate as "row exists and is terminal", so
-- physically deleting a processed row makes a signed provider event fresh and re-dispatches
-- it across the refund, operator-billing and consumer-billing handlers. `UPDATE` and `INSERT`
-- stay: claim and finish both require them.
--
-- `pull_cap_attempts` (R4A-06 sweep). Same shape and the same kind of explicit grant
-- (`141:572`): `pull_cap_attempts_source_unique (client_id, cause, source_id)` is the
-- reservation and idempotency boundary that `254` and `285` build the paid-refresh cap on,
-- and erasing a row lets a spent reservation be made again. Release is an `UPDATE` in
-- `release_paid_refresh_pull`, never a delete.
--
-- The sweep is narrowed to replay, idempotency, correction and completion evidence. Named
-- and skipped, with the reason:
--   * `background_jobs`, `email_outbox`, `notification_delivery_outbox`,
--     `operator_seat_sync_outbox`, `vault_writeback_outbox`, `outcome_refresh_jobs`,
--     `analysis_jobs` — lifecycle queues with an explicit deletion contract.
--   * `kb_import_seen` — dedup ledger whose rows are owned by `kb_import_runs` through
--     `on delete cascade`, which is a stated deletion contract.
--   * `outcome_notifications` — cascades from orgs, outcomes and profiles by design.
--   * `monitoring_events`, `analysis_runs`, `plans`, `checklist_item_state`,
--     `checklist_items` — `private.purge_derived_enrollment_r2a05_base` deletes them; that
--     is the derived-data purge the compliance rails require.
--
-- Row-level DELETE guards are deliberately *not* added to `tracker_transition_receipts` or
-- `pull_cap_attempts`. Both cascade from `clients`, and both have a live owner-run fixture
-- cleanup that deletes their rows — `web/scripts/verify-tracker-concurrency.mjs:77-96` (under
-- `session_replication_role = replica`, which an ALWAYS trigger fires through anyway) and
-- `web/src/lib/pricing/fixture.ts:132`. Neither role reachable from application code holds
-- `DELETE` on either table once this file runs, which is the property; blocking the owner as
-- well would break a legitimate path, which the protocol calls a finding rather than a fix.
-- `enrollment_milestones` does take the ALWAYS delete guard, because it is written through
-- the app and `verify-tracker-live.mjs` deletes its rows as the table owner — that script's
-- `ROW_GUARDS` list gains the new trigger in the same commit, exactly as it already carries
-- `consents_append_only` and `esignatures_append_only`.
--
-- No `TRUNCATE` statement exists anywhere in `web/scripts`, `web/src` or `supabase/seed.sql`,
-- and the seed issues no `DELETE`, so every truncate guard below is unreachable from any
-- supported path.

begin;

-- ---------------------------------------------------------------------------------------
-- Part 1 — restore each residue table to the privilege set its own migration declared.
-- ---------------------------------------------------------------------------------------
do $$
declare
  intent record;
begin
  for intent in
    select *
    from (values
      ('admin_layouts',               'select',                 'select'),
      ('consumer_subscriptions',      'select',                 'select'),
      ('eval_runs',                   'select',                 'select'),
      ('idv_sessions',                'select',                 'select'),
      ('kpi_rollups',                 'select',                 'select'),
      ('org_flags',                   'select, insert, update', 'select'),
      ('paid_refresh_requests',       '',                       'select'),
      ('prompts',                     'select',                 'select'),
      ('settings',                    'select',                 'select'),
      ('tracker_transition_receipts', '',                       '')
    ) as declared(table_name, authenticated_privileges, service_role_privileges)
  loop
    execute format(
      'revoke all on table public.%I from public, anon, authenticated, service_role',
      intent.table_name
    );

    if intent.authenticated_privileges <> '' then
      execute format(
        'grant %s on table public.%I to authenticated',
        intent.authenticated_privileges,
        intent.table_name
      );
    end if;

    if intent.service_role_privileges <> '' then
      execute format(
        'grant %s on table public.%I to service_role',
        intent.service_role_privileges,
        intent.table_name
      );
    end if;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------------------
-- Part 2 — narrow the four tables that keep real write authority to what their writers use.
-- ---------------------------------------------------------------------------------------
revoke delete, truncate on table public.outcome_reviews
  from public, anon, authenticated, service_role;
revoke update, delete, truncate on table public.enrollment_milestones
  from public, anon, authenticated, service_role;
revoke delete, truncate on table public.stripe_webhook_events
  from public, anon, authenticated, service_role;
revoke delete, truncate on table public.pull_cap_attempts
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------
-- Part 3 — the statement guard, on the migration 243 pattern, for every table above.
-- An ALWAYS trigger fires for the table owner and inside a replication session too, so a
-- future SECURITY DEFINER function cannot wipe the table the way a grant-only fix would let
-- it. Idempotent so the file replays from empty.
-- ---------------------------------------------------------------------------------------
do $$
declare
  guarded_table text;
begin
  foreach guarded_table in array array[
    'admin_layouts',
    'consumer_subscriptions',
    'enrollment_milestones',
    'eval_runs',
    'idv_sessions',
    'kpi_rollups',
    'org_flags',
    'outcome_reviews',
    'paid_refresh_requests',
    'prompts',
    'pull_cap_attempts',
    'settings',
    'stripe_webhook_events',
    'tracker_transition_receipts'
  ] loop
    if not exists (
      select 1
      from pg_catalog.pg_trigger as trigger_row
      where trigger_row.tgname = guarded_table || '_no_truncate'
        and trigger_row.tgrelid = ('public.' || guarded_table)::regclass
        and not trigger_row.tgisinternal
    ) then
      execute format(
        'create trigger %I before truncate on public.%I '
        'for each statement execute function public.append_only_guard()',
        guarded_table || '_no_truncate',
        guarded_table
      );
    end if;

    execute format(
      'alter table public.%I enable always trigger %I',
      guarded_table,
      guarded_table || '_no_truncate'
    );
  end loop;
end
$$;

-- ---------------------------------------------------------------------------------------
-- Part 4 — row guards where physical row loss is the defect, on the migration 312 pattern.
-- ---------------------------------------------------------------------------------------
drop trigger if exists outcome_reviews_no_delete on public.outcome_reviews;
create trigger outcome_reviews_no_delete
before delete on public.outcome_reviews
for each row execute function public.append_only_guard();
alter table public.outcome_reviews enable always trigger outcome_reviews_no_delete;

drop trigger if exists stripe_webhook_events_no_delete on public.stripe_webhook_events;
create trigger stripe_webhook_events_no_delete
before delete on public.stripe_webhook_events
for each row execute function public.append_only_guard();
alter table public.stripe_webhook_events enable always trigger stripe_webhook_events_no_delete;

-- `enrollment_record_milestone` is `on conflict do nothing`, so nothing in the product ever
-- updates a completion row either; both verbs are refused together.
drop trigger if exists enrollment_milestones_append_only on public.enrollment_milestones;
create trigger enrollment_milestones_append_only
before update or delete on public.enrollment_milestones
for each row execute function public.append_only_guard();
alter table public.enrollment_milestones
  enable always trigger enrollment_milestones_append_only;

commit;
