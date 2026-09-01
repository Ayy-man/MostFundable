-- R4A-01 / R4A-05 / R4A-06 / R4A-07 — evidence refuses physical erasure.
--
-- The first five assertions are the class, derived from the catalog rather than from a list
-- kept by hand, so the property cannot rot back into a later round: the selection query that
-- found the defect must return nothing, each affected table must hold exactly the privilege
-- set its own migration declared, and every guarded table must carry an ALWAYS-enabled
-- statement trigger. The rest are the four reproductions plus, for each one, a positive
-- assertion that the legitimate writer still works — the expensive failure here is a guard
-- that silently stops something valid.

begin;
create extension if not exists pgtap with schema extensions;
select plan(38);

-- Phase 8, 2026-08-19: migration 383 gave public.applications.bank_ref a foreign
-- key to public.banks_cache, so the lender handles this file files applications
-- under need catalog rows. Seeded here rather than in seed.sql because each
-- pgTAP file is its own transaction and rolls this back with everything else.
insert into public.banks_cache (bank_ref, name, application_questions)
select handle, handle, '[{"id":"a","label":"A","responseBasis":"x"},{"id":"b","label":"B","responseBasis":"x"},{"id":"c","label":"C","responseBasis":"x"},{"id":"d","label":"D","responseBasis":"x"}]'::jsonb
from unnest(array['r4f1_review']) as handle
on conflict (bank_ref) do nothing;

create temp table r4f1_before on commit drop as
select
  (select count(*) from public.consumer_subscriptions where status = 'active') as active_subscriptions,
  (select count(*) from public.enrollments where status = 'active') as active_enrollments,
  (select count(*) from public.tracker_transition_receipts) as receipts,
  (select count(*) from public.enrollment_milestones) as milestones;

-- =============================================================================================
-- The class, derived from the catalog
-- =============================================================================================

-- Fails on c2df7ae: returns the ten residue tables instead of nothing.
select is_empty(
  $$
    select table_row.relname::text
    from pg_catalog.pg_class as table_row
    join pg_catalog.pg_namespace as schema_row
      on schema_row.oid = table_row.relnamespace and schema_row.nspname = 'public'
    where table_row.relkind in ('r', 'p')
      and exists (
        select 1 from information_schema.role_table_grants as held
        where held.table_schema = 'public' and held.table_name = table_row.relname
          and held.grantee = 'service_role' and held.privilege_type = 'TRUNCATE'
      )
      and not exists (
        select 1 from information_schema.role_table_grants as held
        where held.table_schema = 'public' and held.table_name = table_row.relname
          and held.grantee = 'service_role' and held.privilege_type = 'INSERT'
      )
  $$,
  'no public base table lets service_role truncate a table it cannot insert into'
);

-- Fails on c2df7ae: every row reads REFERENCES,SELECT,TRIGGER,TRUNCATE.
select results_eq(
  $$
    select declared.table_name::text,
           coalesce((
             select string_agg(distinct held.privilege_type::text, ',' order by held.privilege_type::text)
             from information_schema.role_table_grants as held
             where held.table_schema = 'public'
               and held.table_name::text = declared.table_name
               and held.grantee = 'service_role'
           ), '') collate "default"
    from (values
      ('admin_layouts'), ('consumer_subscriptions'), ('eval_runs'), ('idv_sessions'),
      ('kpi_rollups'), ('org_flags'), ('paid_refresh_requests'), ('prompts'),
      ('settings'), ('tracker_transition_receipts')
    ) as declared(table_name)
    order by 1
  $$,
  $$values
    ('admin_layouts'::text, 'SELECT'::text),
    ('consumer_subscriptions', 'SELECT'),
    ('eval_runs', 'SELECT'),
    ('idv_sessions', 'SELECT'),
    ('kpi_rollups', 'SELECT'),
    ('org_flags', 'SELECT'),
    ('paid_refresh_requests', 'SELECT'),
    ('prompts', 'SELECT'),
    ('settings', 'SELECT'),
    ('tracker_transition_receipts', '')
  $$,
  'service_role holds exactly the privilege set each table''s own migration declared'
);

-- Passes on c2df7ae and must keep passing: the revoke/grant pair restores the INVOKER caller's
-- grants too, so public.org_flags_set_upfront_fee_approved is not stranded the way round 3
-- warned a blanket authenticated sweep would strand the fees seeder.
select results_eq(
  $$
    select declared.table_name::text,
           coalesce((
             select string_agg(distinct held.privilege_type::text, ',' order by held.privilege_type::text)
             from information_schema.role_table_grants as held
             where held.table_schema = 'public'
               and held.table_name::text = declared.table_name
               and held.grantee = 'authenticated'
           ), '') collate "default"
    from (values
      ('admin_layouts'), ('consumer_subscriptions'), ('eval_runs'), ('idv_sessions'),
      ('kpi_rollups'), ('org_flags'), ('paid_refresh_requests'), ('prompts'),
      ('settings'), ('tracker_transition_receipts')
    ) as declared(table_name)
    order by 1
  $$,
  $$values
    ('admin_layouts'::text, 'SELECT'::text),
    ('consumer_subscriptions', 'SELECT'),
    ('eval_runs', 'SELECT'),
    ('idv_sessions', 'SELECT'),
    ('kpi_rollups', 'SELECT'),
    ('org_flags', 'INSERT,SELECT,UPDATE'),
    ('paid_refresh_requests', ''),
    ('prompts', 'SELECT'),
    ('settings', 'SELECT'),
    ('tracker_transition_receipts', '')
  $$,
  'authenticated keeps exactly the set its migration declared, including the org_flags writes'
);

-- Fails on c2df7ae: fourteen (table, service_role) pairs come back.
select is_empty(
  $$
    select held.table_name::text, held.grantee::text
    from information_schema.role_table_grants as held
    where held.table_schema = 'public'
      and held.privilege_type = 'TRUNCATE'
      and held.grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
      and held.table_name in (
        'admin_layouts', 'consumer_subscriptions', 'enrollment_milestones', 'eval_runs',
        'idv_sessions', 'kpi_rollups', 'org_flags', 'outcome_reviews', 'paid_refresh_requests',
        'prompts', 'pull_cap_attempts', 'settings', 'stripe_webhook_events',
        'tracker_transition_receipts'
      )
  $$,
  'no role an application connection can assume holds TRUNCATE on an evidence table'
);

-- Fails on c2df7ae: all fourteen are missing the guard.
select is_empty(
  $$
    select expected.table_name
    from (values
      ('admin_layouts'), ('consumer_subscriptions'), ('enrollment_milestones'), ('eval_runs'),
      ('idv_sessions'), ('kpi_rollups'), ('org_flags'), ('outcome_reviews'),
      ('paid_refresh_requests'), ('prompts'), ('pull_cap_attempts'), ('settings'),
      ('stripe_webhook_events'), ('tracker_transition_receipts')
    ) as expected(table_name)
    where not exists (
      select 1
      from pg_catalog.pg_trigger as guard
      where guard.tgrelid = ('public.' || expected.table_name)::regclass
        and guard.tgname = expected.table_name || '_no_truncate'
        and guard.tgenabled = 'A'
        and not guard.tgisinternal
    )
  $$,
  'every guarded evidence table carries an ALWAYS-enabled statement truncate guard'
);

-- Fails on c2df7ae: all three row guards are missing.
select is_empty(
  $$
    select expected.trigger_name
    from (values
      ('outcome_reviews', 'outcome_reviews_no_delete'),
      ('enrollment_milestones', 'enrollment_milestones_append_only'),
      ('stripe_webhook_events', 'stripe_webhook_events_no_delete')
    ) as expected(table_name, trigger_name)
    where not exists (
      select 1
      from pg_catalog.pg_trigger as guard
      where guard.tgrelid = ('public.' || expected.table_name)::regclass
        and guard.tgname = expected.trigger_name
        and guard.tgenabled = 'A'
        and not guard.tgisinternal
    )
  $$,
  'the three row-loss guards are installed and enabled ALWAYS'
);

-- =============================================================================================
-- R4A-07 — consumer_subscriptions is the authorization fact migration 330 made it
-- =============================================================================================

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

select throws_ok(
  $$truncate table public.consumer_subscriptions$$,
  '42501', null,
  'service role cannot truncate the subscription evidence that carries paid access'
);
reset role;

select is(
  (select count(*) from public.consumer_subscriptions where status = 'active'),
  (select active_subscriptions from r4f1_before),
  'every active subscription survives the refused truncate'
);
select is(
  (select count(*) from public.enrollments where status = 'active'),
  (select active_enrollments from r4f1_before),
  'and no enrollment was disturbed either'
);
select is(
  (select count(*) from public.enrollments as enrollment
   where enrollment.status = 'active'
     and public.monitoring_is_authorized(enrollment.client_id)
     and public.analysis_is_authorized(enrollment.client_id)),
  (select active_enrollments from r4f1_before),
  'both authorization helpers still return true for every paid consumer'
);

-- The positive half of the privilege correction: two owner-executed definers still write two
-- of the ten residue tables after the revoke.
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$select * from public.admin_set_setting(
      'TRIAL_DAYS', '31'::jsonb, '00000000-0000-0000-0000-000000000001'
    )$$,
  'the settings definer still writes a table service_role can no longer touch directly'
);
select lives_ok(
  $$select * from public.admin_upsert_kpi_rollup('platform', 'platform', current_date)$$,
  'and so does the KPI rollup definer'
);
reset role;

select is(
  (select value from public.settings where key = 'TRIAL_DAYS'),
  '31'::jsonb,
  'and the value it wrote is actually there'
);

-- =============================================================================================
-- R4A-01 — the mandatory correction row beside a counted outcome
-- =============================================================================================

insert into public.applications (id, client_id, bank_ref, created_by)
values (
  '35000000-0000-4000-8000-000000000001',
  'a3000000-0000-0000-0000-000000000004',
  'r4f1_review', 'a1000000-0000-0000-0000-000000000001'
);
insert into public.outcomes (
  id, application_id, bank_ref, client_id, kind, amount_cents, recorded_by, recorded_by_kind
) values (
  '35000000-0000-4000-8000-000000000002',
  '35000000-0000-4000-8000-000000000001',
  'r4f1_review', 'a3000000-0000-0000-0000-000000000004',
  'approved', 12345, 'a1000000-0000-0000-0000-000000000001', 'operator'
);

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok(
  $$delete from public.outcome_reviews
    where outcome_id = '35000000-0000-4000-8000-000000000002'$$,
  '42501', null,
  'service role cannot delete the correction row for a counted outcome'
);
select throws_ok(
  $$truncate table public.outcome_reviews$$,
  '42501', null,
  'service role cannot truncate the platform-admin review queue'
);
reset role;

select is(
  (select state::text from public.outcome_reviews
   where outcome_id = '35000000-0000-4000-8000-000000000002'),
  'pending',
  'the pending review still stands after both refusals'
);

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$select public.review_outcome(
      '35000000-0000-4000-8000-000000000002', 'approved',
      '00000000-0000-0000-0000-000000000001'
    )$$,
  'and the governed correction path can still decide it'
);
reset role;

select is(
  (select state::text from public.outcome_reviews
   where outcome_id = '35000000-0000-4000-8000-000000000002'),
  'approved',
  'the decision lands on the row that could not be erased'
);

-- =============================================================================================
-- R4A-05 — a completion fact and its audit row stay in agreement
-- =============================================================================================

select public.enrollment_record_milestone(
  'a3000000-0000-0000-0000-000000000001',
  'onboarding_call_completed',
  'a1000000-0000-0000-0000-000000000001'
);

select is(
  (select count(*) from public.enrollment_milestones
   where client_id = 'a3000000-0000-0000-0000-000000000001'
     and kind = 'onboarding_call_completed'),
  1::bigint,
  'the production RPC records exactly one completion row'
);

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok(
  $$delete from public.enrollment_milestones
    where client_id = 'a3000000-0000-0000-0000-000000000001'
      and kind = 'onboarding_call_completed'$$,
  '42501', null,
  'service role cannot delete a completed milestone'
);
select throws_ok(
  $$update public.enrollment_milestones set completed_at = pg_catalog.now()
    where client_id = 'a3000000-0000-0000-0000-000000000001'
      and kind = 'onboarding_call_completed'$$,
  '42501', null,
  'nor rewrite when it was completed'
);
select throws_ok(
  $$truncate table public.enrollment_milestones$$,
  '42501', null,
  'nor erase the whole checklist'
);
reset role;

select is(
  (select count(*) from public.enrollment_milestones
   where client_id = 'a3000000-0000-0000-0000-000000000001'
     and kind = 'onboarding_call_completed'),
  1::bigint,
  'the completion row survives all three refusals'
);
select is(
  (select count(*) from public.audit_log
   where action = 'milestone.complete'
     and client_id = 'a3000000-0000-0000-0000-000000000001'
     and meta ->> 'status' = 'onboarding_call_completed'),
  1::bigint,
  'and the immutable audit row still has exactly one completion fact to agree with'
);

select lives_ok(
  $$select public.enrollment_record_milestone(
      'a3000000-0000-0000-0000-000000000001',
      'onboarding_call_completed',
      'a1000000-0000-0000-0000-000000000001'
    )$$,
  'replaying the idempotent RPC is still allowed'
);
select is(
  (select count(*) from public.enrollment_milestones
   where client_id = 'a3000000-0000-0000-0000-000000000001'
     and kind = 'onboarding_call_completed')
  + (select count(*) from public.audit_log
     where action = 'milestone.complete'
       and client_id = 'a3000000-0000-0000-0000-000000000001'
       and meta ->> 'status' = 'onboarding_call_completed'),
  2::bigint,
  'and the replay still yields one milestone row and one audit row, not two of either'
);

-- =============================================================================================
-- R4A-06 — replay and idempotency evidence
-- =============================================================================================

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

select is(
  public.claim_stripe_webhook_event(
    'evt_r4f1_replay_01', 'invoice.payment_failed',
    '35000000-0000-4000-8000-000000000011', 300
  ),
  true,
  'a fresh provider event claims'
);
select is(
  public.finish_stripe_webhook_event(
    'evt_r4f1_replay_01', '35000000-0000-4000-8000-000000000011', 'processed', null
  ),
  true,
  'and reaches its terminal state'
);
select throws_ok(
  $$delete from public.stripe_webhook_events where event_id = 'evt_r4f1_replay_01'$$,
  '42501', null,
  'service role cannot delete the processed replay row'
);
select throws_ok(
  $$truncate table public.stripe_webhook_events$$,
  '42501', null,
  'nor truncate the global replay ledger'
);
select is(
  public.claim_stripe_webhook_event(
    'evt_r4f1_replay_01', 'invoice.payment_failed',
    '35000000-0000-4000-8000-000000000012', 300
  ),
  false,
  'so the same signed event still cannot be dispatched a second time'
);
select is(
  public.claim_stripe_webhook_event(
    'evt_r4f1_replay_02', 'invoice.payment_failed',
    '35000000-0000-4000-8000-000000000013', 300
  ),
  true,
  'while a genuinely new event is still admitted'
);

select throws_ok(
  $$truncate table public.tracker_transition_receipts$$,
  '42501', null,
  'service role cannot truncate the tracker idempotency receipts'
);
select throws_ok(
  $$delete from public.pull_cap_attempts where client_id = 'a3000000-0000-0000-0000-000000000001'$$,
  '42501', null,
  'service role cannot delete a spent pull-cap reservation'
);
select throws_ok(
  $$truncate table public.pull_cap_attempts$$,
  '42501', null,
  'nor truncate the reservation ledger'
);
reset role;

select is(
  (select count(*) from public.tracker_transition_receipts),
  (select receipts from r4f1_before),
  'every tracker receipt survives the refused truncate'
);

-- =============================================================================================
-- The INVOKER path this migration was most likely to break
-- =============================================================================================

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'role', 'authenticated', 'sub', '00000000-0000-0000-0000-000000000001'
  )::text,
  true
);
select lives_ok(
  $$select public.org_flags_set_upfront_fee_approved(
      'a0000000-0000-0000-0000-000000000001', true, 'r4f1-LGL-PROBE'
    )$$,
  'the one INVOKER writer in the set still writes org_flags through the caller''s grants'
);
reset role;

select is(
  (select upfront_fee_approved from public.org_flags
   where org_id = 'a0000000-0000-0000-0000-000000000001'),
  true,
  'and the legal gate it governs actually changed'
);

select * from finish();
rollback;
