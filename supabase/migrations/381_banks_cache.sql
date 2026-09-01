-- 381_banks_cache.sql — Phase 8 (S2.2), VAULT-02 · VAULT-03 · VAULT-04 · VAULT-05.
--
-- Migration number: the ledger head when this was written was
-- `380_client_ruling_at_risk_30_days.sql`, and the hosted platform project has
-- the ledger applied through it. The lane's original 040–049 allocation is
-- stale and unusable: migrations replay and push in filename order, and 383's
-- foreign key references `public.applications`, created at 081. A 04x file
-- would therefore run before its own dependency on a clean reset and would be
-- inserted into the middle of an already-applied ledger on the hosted push.
--
--   VAULT-03  no request path queries the CCA VAULT project. This table is the
--             whole read surface; the nightly `vault.sync_banks` job is the
--             only writer, and it upserts. There is no delete path anywhere in
--             this migration — a lender that leaves VAULT is flipped to
--             `is_active = false`, which is what keeps 383's foreign key from
--             ever being orphaned by a sync run.
--
--   VAULT-05  no FICO floor and no time-in-business column is selected into the
--             cache or into the view the API reads. Those columns exist in
--             VAULT (`banks.fico_floor`, `banks.fico_ideal`, `banks.fico_notes`,
--             `banks.tib_floor_months`, `banks.tib_notes`,
--             `bank_requirements.fico_floor`, `.fico_preferred`, `.fico_notes`,
--             `.tib_months_floor`, `.tib_notes`) and they stop at the driver.
--             `supabase/tests/381_banks_cache.test.sql` asserts the absence
--             against `information_schema`, so the assertion is derived from
--             the live catalog rather than transcribed from this file.
--
-- Also deliberately not synced: `banks.vault_full_text`,
-- `bank_application_details.exact_script`, `banks.winning_patterns`,
-- `banks.denial_patterns`, `banks.key_gotchas` and `banks.best_fit_profile`.
-- They are unvetted free-text intel, and this platform's copy rules apply to
-- every string that can reach a surface. The one free-text field that does
-- cross is `rel_manager_tip`, which §6 specifies as a one-line tip; the sync
-- core truncates it and drops it to null when it trips a compliance rule.

-- ---------------------------------------------------------------------------
-- The application-question allow-list.
--
-- Same shape as 081's `private.bank_stats_windows_valid`, including the
-- exception arm that turns a malformed value into `false` rather than an error:
-- a check constraint that can raise is a check constraint that can take an
-- unrelated statement down with it. Rejection is by omission — a key nobody
-- thought of is rejected too, which is the direction that survives a schema
-- change upstream in VAULT.
-- ---------------------------------------------------------------------------

create function private.bank_application_questions_valid(p_questions jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  question jsonb;
  seen text[] := array[]::text[];
  question_id text;
begin
  if p_questions is null or jsonb_typeof(p_questions) <> 'array' then
    return false;
  end if;

  -- §6: the per-bank table varies by bank but always carries the four standing
  -- questions, so an empty array is never a legal cache row.
  if jsonb_array_length(p_questions) < 4 then
    return false;
  end if;

  for question in select value from jsonb_array_elements(p_questions) as value
  loop
    if jsonb_typeof(question) <> 'object' then
      return false;
    end if;

    if (select array_agg(key order by key collate "C") from jsonb_object_keys(question) as key)
       is distinct from array['id', 'label', 'responseBasis'] then
      return false;
    end if;

    if jsonb_typeof(question -> 'id') <> 'string'
      or jsonb_typeof(question -> 'label') <> 'string'
      or jsonb_typeof(question -> 'responseBasis') <> 'string' then
      return false;
    end if;

    question_id := question ->> 'id';
    if question_id = '' or question_id = any (seen) then
      return false;
    end if;
    seen := seen || question_id;
  end loop;

  return true;
exception
  when others then
    return false;
end;
$$;

comment on function private.bank_application_questions_valid(jsonb) is
  'Allow-list validator for public.banks_cache.application_questions: an array '
  'of at least the four standing §6 questions, each exactly {id, label, '
  'responseBasis} of strings, ids non-empty and unique. Rejects by omission so '
  'a key added upstream in VAULT cannot arrive unnoticed.';

grant execute on function private.bank_application_questions_valid(jsonb) to service_role, authenticated;

-- ---------------------------------------------------------------------------
-- The cache.
-- ---------------------------------------------------------------------------

create table public.banks_cache (
  bank_ref text primary key,
  name text not null,
  products text[] not null default array[]::text[],
  bureau_pulls text,
  qualification_summary text,
  channel_type text,
  channel_value text,
  checking_required boolean,
  checking_deposit_cents integer,
  checking_seasoning text,
  rel_manager boolean,
  rel_manager_tip text,
  application_questions jsonb not null,
  source_updated_at date,
  is_active boolean not null default true,
  source text not null default 'vault',
  synced_at timestamptz not null default now(),
  constraint banks_cache_bank_ref_shape check (bank_ref ~ '^[a-z0-9][a-z0-9_-]{0,62}$'),
  constraint banks_cache_name_present check (length(btrim(name)) > 0),
  constraint banks_cache_channel_type_check
    check (channel_type is null or channel_type in ('online', 'phone', 'in-person')),
  -- The in-person channel is the one that carries no value: §6's detail page
  -- answers it with "research your local branch" rather than a link or a
  -- number, and a stored value there would have nowhere to render.
  constraint banks_cache_channel_value_shape check (
    (channel_type is null and channel_value is null)
    or (channel_type = 'in-person' and channel_value is null)
    or (channel_type in ('online', 'phone') and channel_value is not null and length(btrim(channel_value)) > 0)
  ),
  constraint banks_cache_checking_deposit_nonnegative
    check (checking_deposit_cents is null or checking_deposit_cents >= 0),
  constraint banks_cache_rel_manager_tip_length
    check (rel_manager_tip is null or length(rel_manager_tip) <= 240),
  constraint banks_cache_application_questions_valid
    check (private.bank_application_questions_valid(application_questions)),
  constraint banks_cache_source_check check (source in ('vault', 'fixture', 'backfill'))
);

comment on table public.banks_cache is
  'The synced lender catalog (BACKEND-SPEC §6). Written only by the nightly '
  'vault.sync_banks job, which upserts and never deletes: a lender that leaves '
  'VAULT is flipped to is_active = false so the applications.bank_ref foreign '
  'key added in 383 can never be orphaned by a sync run. No FICO floor and no '
  'time-in-business column exists here or in public.bank_read_model, and none '
  'may be added — VAULT-05 is a product and compliance boundary, not a '
  'preference about which columns are useful.';

comment on column public.banks_cache.source is
  'vault when the row came from a real sync run, fixture for the illustrative '
  'catalog migration 382 ships so the read model renders and 383 has something '
  'to validate against, backfill for the inactive stub 383 creates for a '
  'bank_ref an application already named. The sync overwrites fixture and '
  'backfill rows with vault rows as the real catalog arrives.';

comment on column public.banks_cache.is_active is
  'The unpublish flag that stands in for a delete. False keeps the row (and the '
  'foreign key) intact while removing the lender from every list the API '
  'serves.';

comment on column public.banks_cache.application_questions is
  'The §6 per-bank application table. Always carries the four standing '
  'questions — projected revenue, projected personal income, projected monthly '
  'spend, projected number of employees — ahead of whatever the bank adds.';

create index banks_cache_active_name_idx
  on public.banks_cache (name)
  where is_active;

-- ---------------------------------------------------------------------------
-- The read model the API selects from.
--
-- The join lives here rather than in the route so that VAULT-05's exclusion is
-- assertable against the live catalog for the exact object the API reads. A
-- lender with no counted outcome has no bank_outcome_stats row, so the join is
-- a left join and the stats columns are null — which is a fact about the
-- lender, not a missing row, exactly as 081 treats a null last_outcome_at.
-- ---------------------------------------------------------------------------

create view public.bank_read_model
with (security_invoker = true)
as
select
  cache.bank_ref,
  cache.name,
  cache.products,
  cache.bureau_pulls,
  cache.qualification_summary,
  cache.channel_type,
  cache.channel_value,
  cache.checking_required,
  cache.checking_deposit_cents,
  cache.checking_seasoning,
  cache.rel_manager,
  cache.rel_manager_tip,
  cache.application_questions,
  cache.source_updated_at,
  cache.synced_at,
  stats.heat_level,
  stats.windows,
  stats.last_outcome_at,
  stats.approved_amount_cents_total,
  stats.outcome_count_total,
  stats.computed_at as stats_computed_at
from public.banks_cache as cache
left join public.bank_outcome_stats as stats on stats.bank_ref = cache.bank_ref
where cache.is_active;

comment on view public.bank_read_model is
  'banks_cache joined to Phase 11''s bank_outcome_stats, active lenders only. '
  'security_invoker so the caller''s own grants and policies decide the read '
  'rather than the view owner''s. Phase 8 reads this and recomputes nothing: '
  'the aggregate is produced by public.run_outcome_refresh_job and reconciling '
  'it a second time here would give the numbers two owners.';

-- ---------------------------------------------------------------------------
-- Row security.
-- ---------------------------------------------------------------------------

alter table public.banks_cache enable row level security;
-- FORCE applies the policies to the table owner too, which ENABLE alone does
-- not. It is worth having and it is not a boundary: BYPASSRLS and superuser
-- connections are unaffected, which is exactly why the amended pgTAP files can
-- seed catalog rows against a table with no insert policy. The boundary that
-- does hold is the grant block below — no application-reachable role is granted
-- a write at all.
alter table public.banks_cache force row level security;

revoke all on table public.banks_cache from anon, authenticated, service_role;
revoke all on table public.bank_read_model from anon, authenticated, service_role;

-- The catalog crosses tenancy on purpose, exactly as bank_outcome_stats does:
-- it carries no client, organization or profile column, and one operator's
-- view of a lender is not another operator's secret. It does not cross roles:
-- the policy below narrows the read to the two the Bank Vault is for. Writes
-- belong to the sync job alone, which runs as service_role.
grant select on table public.banks_cache to authenticated;
grant select on table public.bank_read_model to authenticated;

-- The revoke above names service_role deliberately: this project's default
-- privileges hand service_role everything on a new public table, TRUNCATE
-- included, so a migration that only grants can never subtract. Migration 374's
-- erasure-boundary predicate rejects TRUNCATE held by any application-reachable
-- role on any public base table, and it catches exactly this — leaving the
-- default in place fails `374_r5a01_erasure_boundary_predicate.test.sql`.
--
-- What is granted back is what the sync actually does. It upserts, so DELETE is
-- a privilege it has no use for, and withholding it is what turns "there is no
-- delete path to orphan migration 383's foreign key with" from a description
-- into a property of the grants.
grant select, insert, update on table public.banks_cache to service_role;
grant select on table public.bank_read_model to service_role;

-- The Bank Vault is an operator surface, and `/api/banks` refuses anyone who is
-- not an operator member or a platform admin. The policy says the same thing,
-- so the boundary does not depend on the route being the only door: a consumer
-- reaches lender information through their plan and an affiliate's whole portal
-- is the five columns of `affiliate_client_view`, so neither has business
-- reading the catalog directly.
create policy banks_cache_select_active
on public.banks_cache
for select
to authenticated
using (
  is_active
  and private.auth_app_role() in (
    'operator_member'::public.app_role,
    'platform_admin'::public.app_role
  )
);

comment on policy banks_cache_select_active on public.banks_cache is
  'Read-only, active rows only, and only for the two roles the Bank Vault is '
  'for. There is no insert, update or delete policy at all, so no signed-in '
  'role can write the catalog by any path; the sync job reaches the table as '
  'service_role, which row security does not apply to.';
