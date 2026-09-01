-- 383_applications_bank_ref_fk.sql — Phase 8 (S2.2).
--
-- `.planning/INTERFACES.md` §3 records this as Phase 8's to add: "it adds the
-- applications.bank_ref → banks_cache FK when banks_cache exists" (Phase 11
-- ask-1/ask-2). Until now `applications.bank_ref` carried only a shape check,
-- so a typo produced a lender nobody could ever look up.
--
-- Two things had to be true before the constraint could be added safely, and
-- both are now:
--
--   1. The cache can never lose a row underneath it. `vault.sync_banks` upserts
--      and flips `is_active`; 381 ships no delete path and grants no delete to
--      any role but service_role. So a sync run cannot orphan an application.
--
--   2. Every bank_ref an application already names has a row. The local seed
--      holds no application rows at all, but the hosted project's contents are
--      not provable from a lane worktree, so rather than assume, the statement
--      below creates an inactive stub for each ref that is actually there. An
--      inactive stub keeps the historical application readable and its outcomes
--      counted while keeping the lender out of every list the API serves — the
--      same unpublish the sync uses.
--
-- The constraint is then added NOT VALID and validated in the same migration.
-- NOT VALID on its own would be a lie told to the planner and to the next
-- reader: it would leave "this column references a real lender" true for new
-- rows and unknown for old ones forever. Because the backfill above runs first,
-- there is nothing left for VALIDATE to reject, so the two-step is only about
-- lock duration — VALIDATE takes SHARE UPDATE EXCLUSIVE rather than the ACCESS
-- EXCLUSIVE a single ALTER would hold across the scan.
--
-- CONSEQUENCE, deliberately recorded here because it is not behind a flag: from
-- this migration on, an application may only name a lender that exists in
-- public.banks_cache. A foreign key cannot be gated by FEATURE_VAULT, so this
-- changes POST /api/applications on the flag-OFF path too. That is the intended
-- reading of the interface note, but it is a product restriction as much as a
-- data-integrity one — an operator recording an application against a lender
-- outside the synced catalog now needs that lender synced or seeded first.

-- ---------------------------------------------------------------------------
-- Backfill: an inactive stub per orphaned ref.
-- ---------------------------------------------------------------------------

insert into public.banks_cache (
  bank_ref, name, application_questions, is_active, source
)
select
  distinct application.bank_ref,
  application.bank_ref,
  '[
    {"id": "projected-revenue", "label": "Projected revenue", "responseBasis": "Use the business''s own current revenue projection and supporting records."},
    {"id": "projected-personal-income", "label": "Projected personal income", "responseBasis": "Use the applicant''s own current income projection and supporting records."},
    {"id": "projected-monthly-spend", "label": "Projected monthly spend", "responseBasis": "Use the business''s own current operating-budget projection."},
    {"id": "projected-employees", "label": "Projected # employees", "responseBasis": "Use the business''s own current staffing projection."}
  ]'::jsonb,
  false,
  'backfill'
from public.applications as application
where not exists (
  select 1 from public.banks_cache as cache where cache.bank_ref = application.bank_ref
)
on conflict (bank_ref) do nothing;

-- ---------------------------------------------------------------------------
-- The constraint.
-- ---------------------------------------------------------------------------

alter table public.applications
  add constraint applications_bank_ref_fk
  foreign key (bank_ref)
  references public.banks_cache (bank_ref)
  on update restrict
  on delete restrict
  not valid;

alter table public.applications
  validate constraint applications_bank_ref_fk;

comment on constraint applications_bank_ref_fk on public.applications is
  'RESTRICT on delete rather than CASCADE: losing a lender from the catalog '
  'must never take a client''s application history with it. There is no delete '
  'path on public.banks_cache for that reason, so this action is the second '
  'line rather than the first. RESTRICT on update too, and not CASCADE: '
  'migration 317''s applications_guard_identity trigger is ENABLE ALWAYS and '
  'raises on any change to bank_ref, so a cascade would be rejected by that '
  'trigger the moment it fired. A renamed slug in VAULT arrives as a new cache '
  'row; the old one is unpublished and keeps its history.';
