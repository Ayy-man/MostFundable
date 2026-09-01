begin;

set local search_path = public, extensions;

select plan(73);

create function pg_temp.visible_rows_for_org(p_org_id uuid)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
  select
    (select count(*) from public.orgs where id = p_org_id)
    + (select count(*) from public.profiles where org_id = p_org_id)
    + (select count(*) from public.affiliates where org_id = p_org_id)
    + (select count(*) from public.clients where org_id = p_org_id)
    + (
      select count(*)
      from public.affiliate_client_shares as share
      join public.clients as client on client.id = share.client_id
      where client.org_id = p_org_id
    )
    + (
      select count(*)
      from public.consents as consent
      join public.clients as client on client.id = consent.client_id
      where client.org_id = p_org_id
    )
    + (
      select count(*)
      from public.enrollments as enrollment
      join public.clients as client on client.id = enrollment.client_id
      where client.org_id = p_org_id
    )
    + (
      select count(*)
      from public.enrollment_milestones as milestone
      join public.clients as client on client.id = milestone.client_id
      where client.org_id = p_org_id
    )
    + (
      select count(*)
      from public.consumer_subscriptions as subscription
      join public.clients as client on client.id = subscription.client_id
      where client.org_id = p_org_id
    )
    + (
      select count(*)
      from public.monitoring_events as event
      join public.clients as client on client.id = event.client_id
      where client.org_id = p_org_id
    )
    + (
      select count(*)
      from public.analysis_runs as analysis
      join public.clients as client on client.id = analysis.client_id
      where client.org_id = p_org_id
    )
    + (
      select count(*)
      from public.plans as plan_row
      join public.clients as client on client.id = plan_row.client_id
      where client.org_id = p_org_id
    )
    + (
      select count(*)
      from public.checklist_items as item
      join public.clients as client on client.id = item.client_id
      where client.org_id = p_org_id
    )
    + (
      select count(*)
      from public.checklist_item_state as item_state
      join public.clients as client on client.id = item_state.client_id
      where client.org_id = p_org_id
    )
    + (
      select count(*)
      from public.stage_history as history
      join public.clients as client on client.id = history.client_id
      where client.org_id = p_org_id
    )
    + (select count(*) from public.audit_log where org_id = p_org_id)
    + (select count(*) from public.specialist_default_client_view where org_id = p_org_id)
$$;

select is(
  (select count(*)::integer from public.orgs where not brand @> '{"platform_intake": true}'::jsonb),
  2,
  'seed contains exactly two operator organizations'
);
select is(
  (select count(*)::integer from public.orgs where brand @> '{"platform_intake": true}'::jsonb),
  1,
  'seed contains exactly one platform intake organization'
);

select results_eq(
  $$
    select id, name
    from public.orgs
    order by id
  $$,
  $$
    values
      ('a0000000-0000-0000-0000-000000000001'::uuid, 'Northbridge Funding Group'::text),
      ('b0000000-0000-0000-0000-000000000001'::uuid, 'Cedar Harbor Fictional Cooperative'::text),
      ('f0000000-0000-0000-0000-000000000001'::uuid, 'MostFundable Fictional Intake'::text)
  $$,
  'organization identities are deterministic'
);

select is((select count(*)::integer from public.profiles), 10, 'seed contains exactly ten profiles');
select is(
  (select count(*)::integer from public.profiles where role = 'platform_admin'),
  1,
  'seed contains one platform administrator'
);

select results_eq(
  $$
    select role::text, coalesce(org_role::text, ''), count(*)::bigint
    from public.profiles
    where org_id = 'a0000000-0000-0000-0000-000000000001'
    group by role, org_role
    order by role::text, coalesce(org_role::text, '')
  $$,
  $$
    values
      ('affiliate'::text, ''::text, 1::bigint),
      ('consumer'::text, ''::text, 4::bigint),
      ('operator_member'::text, 'owner'::text, 1::bigint),
      ('operator_member'::text, 'prep_specialist'::text, 1::bigint)
  $$,
  'Org A has the required role topology'
);

select results_eq(
  $$
    select role::text, coalesce(org_role::text, ''), count(*)::bigint
    from public.profiles
    where org_id = 'b0000000-0000-0000-0000-000000000001'
    group by role, org_role
    order by role::text, coalesce(org_role::text, '')
  $$,
  $$
    values
      ('consumer'::text, ''::text, 1::bigint),
      ('operator_member'::text, 'owner'::text, 1::bigint)
  $$,
  'Org B has an owner and consumer control pair'
);

select is((select count(*)::integer from public.affiliates), 1, 'seed contains one affiliate');
select is(
  (
    select count(*)::integer
    from public.affiliates as affiliate
    join public.profiles as profile on profile.id = affiliate.profile_id
    where affiliate.id = 'a2000000-0000-0000-0000-000000000001'
      and affiliate.org_id = 'a0000000-0000-0000-0000-000000000001'
      and profile.org_id = affiliate.org_id
      and profile.role = 'affiliate'
      and affiliate.referral_slug = 'northbridge-fictional-partner'
  ),
  1,
  'affiliate identity, organization, and slug reconcile'
);

select is((select count(*)::integer from public.clients), 5, 'seed contains exactly five clients');
select is(
  (
    select count(*)::integer
    from public.clients
    where org_id = 'a0000000-0000-0000-0000-000000000001'
  ),
  4,
  'Org A contains four consumer-linked clients'
);

select results_eq(
  $$
    select client.id, client.consumer_profile_id
    from public.clients as client
    where client.org_id = 'b0000000-0000-0000-0000-000000000001'
  $$,
  $$
    values (
      'b3000000-0000-0000-0000-000000000001'::uuid,
      'b1000000-0000-0000-0000-000000000011'::uuid
    )
  $$,
  'Org B contains the isolated consumer-linked client'
);

select is((select count(*)::integer from public.enrollments), 4, 'every seeded client except the un-enrolled demo newcomer has an enrollment');

select results_eq(
  $$
    select enrollment.persona_hint::text
    from public.enrollments as enrollment
    join public.clients as client on client.id = enrollment.client_id
    where client.org_id = 'a0000000-0000-0000-0000-000000000001'
    order by enrollment.persona_hint::text
  $$,
  $$
    values ('clean'::text), ('derog'::text), ('thin_file'::text)
  $$,
  'Org A enrollment personas match the frozen seeded set'
);

select is(
  (
    select persona_hint::text
    from public.enrollments
    where client_id = 'b3000000-0000-0000-0000-000000000001'
  ),
  null,
  'the Org B isolation enrollment has no demo persona'
);

-- The mock CRS driver decodes the persona out of the member ref itself
-- (`mock_<persona>_<sequence>`); there is no registry mapping a ref to a
-- persona. The analysis worker resolves its source file from `crs_member_ref`
-- alone, so a null ref returns `source_unavailable` before any adapter is
-- asked, and a ref whose persona disagrees with `persona_hint` silently
-- analyses the wrong person. Both were true of this seed until 2026-08-16, and
-- neither is visible from the persona assertion above.
select results_eq(
  $$
    select enrollment.persona_hint::text || ' ' || enrollment.crs_member_ref
    from public.enrollments as enrollment
    join public.clients as client on client.id = enrollment.client_id
    where client.org_id = 'a0000000-0000-0000-0000-000000000001'
    order by enrollment.persona_hint::text
  $$,
  $$
    values
      ('clean mock_clean_000001'::text),
      ('derog mock_derog_000002'::text),
      ('thin_file mock_thin_file_000003'::text)
  $$,
  'each demo enrollment carries a mock member ref encoding its own persona'
);

select is(
  (
    select crs_member_ref
    from public.enrollments
    where client_id = 'b3000000-0000-0000-0000-000000000001'
  ),
  null,
  'the Org B isolation enrollment stays unanalysable, with no member ref'
);

-- 2026-08-17 R3C-03 seed carry: persisted analysis and plan surfaces now imply the same paid
-- activation state as the product path, while the Cedar isolation control remains pre-activation.
select results_eq(
  $$
    select status::text, count(*)::bigint
    from public.enrollments
    group by status
    order by status::text
  $$,
  $$ values ('active'::text, 3::bigint), ('enrolled'::text, 1::bigint) $$,
  'three derived-data personas are active and the Cedar control remains enrolled'
);
select is(
  (select count(*)::integer from public.consumer_subscriptions),
  3,
  'seed contains exactly three active demo subscriptions'
);
select is(
  (
    select count(*)::integer
    from public.consumer_subscriptions as subscription
    join public.enrollments as enrollment
      on enrollment.id = subscription.enrollment_id
     and enrollment.client_id = subscription.client_id
    where subscription.provider = 'mock'
      and subscription.price_cents = 4900
      and subscription.currency = 'usd'
      and subscription.status = 'active'
      and subscription.operation_state = 'settled'
      and subscription.idempotency_key = 'enroll:' || enrollment.id::text || ':sub'
      and subscription.activated_at < (
        select min(run.ran_at)
        from public.analysis_runs as run
        where run.client_id = subscription.client_id
      )
  ),
  3,
  'each active demo subscription matches the governed product activation shape'
);
select is(
  (
    select count(*)::integer
    from public.consumer_subscriptions as subscription
    where subscription.client_id in (
      'a3000000-0000-0000-0000-000000000004',
      'b3000000-0000-0000-0000-000000000001'
    )
  ),
  0,
  'the newcomer and Cedar control have no subscription without a derived surface'
);

select is((select count(*)::integer from public.consents), 8, 'seed contains two consent grants per enrolled client');
select is(
  (
    select bool_and(consent_count = 2)
    from (
      select client.id, count(consent.id) as consent_count
      from public.clients as client
      join public.enrollments as enrollment
        on enrollment.client_id = client.id
      left join public.consents as consent
        on consent.client_id = client.id
       and consent.action = 'granted'
      group by client.id
    ) as consent_counts
  ),
  true,
  'every enrolled client has exactly two consent grants'
);

select is(
  (
    select bool_and(
      exists (
        select 1
        from public.consents as consent
        where consent.client_id = enrollment.client_id
          and consent.kind = 'monitoring'
          and consent.signed_at = enrollment.monitoring_consent_at
          and consent.esig_ref = enrollment.esig_doc_id
      )
      and exists (
        select 1
        from public.consents as consent
        where consent.client_id = enrollment.client_id
          and consent.kind = 'analysis'
          and consent.signed_at = enrollment.analysis_consent_at
          and consent.esig_ref = enrollment.esig_doc_id
      )
    )
    from public.enrollments as enrollment
  ),
  true,
  'enrollment timestamps and signature references match both grants'
);

select is(
  (
    select bool_and(consent.signed_at < enrollment.created_at)
    from public.consents as consent
    join public.enrollments as enrollment on enrollment.client_id = consent.client_id
  ),
  true,
  'every consent grant predates enrollment creation'
);

select is(
  (
    select bool_and(latest_consent_at < enrollment.created_at)
    from public.enrollments as enrollment
    join (
      select client_id, max(signed_at) as latest_consent_at
      from public.consents
      group by client_id
    ) as consent_times on consent_times.client_id = enrollment.client_id
  ),
  true,
  'each enrollment follows its latest required consent'
);

select is((select count(*)::integer from public.monitoring_events), 0, 'seed contains no monitoring activity');
select is((select count(*)::integer from public.analysis_runs), 3, 'seed contains three tracker analysis projections');
select is((select count(*)::integer from public.plans), 3, 'seed contains three generated tracker plans');
-- The checklist workflow is asserted per table and by shape, not as one summed count: the
-- sum (8, then 12 once the Optimization read seeded the derogatory persona's two rows) said
-- nothing about which table moved, and it could not tell an item added with its state row
-- from an item added without one — the case the consumer Optimization overlay depends on.
select is((select count(*)::integer from public.checklist_templates), 2, 'seed contains the two tracker checklist templates');
select is((select count(*)::integer from public.checklist_items), 5, 'seed contains the five tracker checklist items');
select is(
  (
    select count(*)::integer
    from public.checklist_items i
    left join public.checklist_item_state s on s.checklist_item_id = i.id and s.client_id = i.client_id
    where s.checklist_item_id is null
  ),
  0,
  'every seeded checklist item carries exactly one state row for its own client'
);
select is(
  (select count(*)::integer from public.checklist_item_state s left join public.checklist_items i on i.id = s.checklist_item_id where i.id is null),
  0,
  'no seeded checklist state row is orphaned from its item'
);
select is((select count(*)::integer from public.stage_history), 3, 'seed contains three tracker stage-history rows, including the initial-stage backfill');
select is((select count(*)::integer from public.audit_log where action = 'client.stage.transitioned'), 3, 'seed contains three tracker transition audit rows, including the initial-stage backfill');
select is((select count(*)::integer from public.audit_log where action = 'consent.create'), 8, 'seed consents each fire the enrollment audit trigger (migration 020)');
select is((select count(*)::integer from public.audit_log where action = 'enrollment.create'), 4, 'seed enrollments each fire the enrollment audit trigger (migration 020)');
-- 2026-08-17 Round 2 carry (integrator): R2A-09 moved affiliate-share attribution
-- into a fixed-action database trigger, so the seed's single share appends one
-- `affiliate.client_shared` row to the fourteen tracker/enrollment rows. The
-- pass-1 value of 22 was measured on a shared stack still holding eight reviewer
-- probe rows; a clean `supabase db reset` produces exactly fifteen.
-- 2026-08-17 R3C-03 seed carry: the three settled demo subscriptions each append their governed
-- setup-intent audit row, so a clean reset now produces eighteen rows.
-- 2026-08-18 R5A-03 seed carry: the three passing identity sessions each fire migration 020's
-- `enrollment.idv_started` trigger, exactly as the product path does, so a clean reset now produces
-- twenty-one.
select is((select count(*)::integer from public.audit_log where action = 'enrollment.idv_started'), 3, 'seed identity sessions each fire the enrollment audit trigger (migration 020)');
-- 2026-08-22 chat rebuild carry: every seeded support message is sent through
-- the send RPC, exactly as a live message is, so each one appends its own
-- governed audit row. That part of the total is derived rather than added to the
-- constant, and deliberately so — the count comes from `public.support_messages`,
-- which is a different table, so a message inserted around the RPC moves one side
-- and not the other and fails here. The constant still guards the non-support
-- seed exactly. The threads themselves are upserted on `(client_id) where kind =
-- 'team_chat'` rather than opened through `support_open_thread`, because the seed
-- has to survive a stack where a consumer already opened their own thread, and
-- the RPC has no upsert. So a clean seed writes no `support.thread_opened` row at
-- all, and the permitted set below is a ceiling rather than a roll call.
select is(
  (select count(*)::integer from public.audit_log where action = 'support.message_sent'),
  (select count(*)::integer from public.support_messages),
  'every seeded support message left the audit row a live send leaves, so none was inserted around the RPC'
);
-- What the seed is allowed to write at all. A reviewer probe or a stray app
-- click shows up as an action nobody expected, which is the failure the old
-- exact total was really there to catch.
--
-- This asks whether anything OUTSIDE the permitted set appears, not whether the
-- set matches exactly, and the difference is the whole point. Equality also
-- demands that every permitted action actually occur, which couples the test to
-- how much the seed happens to do: this assertion passed for a day on a shared
-- local stack only because a consumer had clicked through the app and left a
-- `support.thread_opened` row behind, and it failed the first time it met a
-- clean `supabase db reset`. A permitted list is a ceiling. Volume is guarded by
-- the derived total below and by the per-action counts above.
select is(
  (
    select array_agg(distinct entry.action order by entry.action)
    from public.audit_log as entry
    where entry.action <> all (array[
      'affiliate.client_shared',
      'billing.setup_intent_recorded',
      'client.stage.transitioned',
      'consent.create',
      'client.assignment_changed',
      'document_request.created',
      'document_review.recorded',
      'enrollment.create',
      'enrollment.idv_started',
      'support.message_sent',
      'support.thread_opened'
    ]::text[])
  ),
  null::text[],
  'seed audit_log writes no action outside the governed set'
);
select is(
  (select count(*)::integer from public.audit_log),
  25
    + (select count(*)::integer from public.support_messages)
    + (select count(*)::integer from public.audit_log where action = 'support.thread_opened'),
  'seed audit_log holds exactly the governed seed trigger rows, nothing else'
);
select is((select count(*)::integer from public.audit_log where action = 'affiliate.client_shared'), 1, 'the seeded affiliate share fires its fixed-action audit trigger (migration 273)');
select is((select count(*)::integer from public.enrollment_milestones), 0, 'seed contains no milestone activity');

select is((select count(*)::integer from public.affiliate_client_shares), 1, 'seed contains one affiliate share');
select is(
  (
    select count(*)::integer
    from public.affiliate_client_shares as share
    join public.affiliates as affiliate on affiliate.id = share.affiliate_id
    join public.clients as client on client.id = share.client_id
    where affiliate.org_id = client.org_id
      and affiliate.org_id = 'a0000000-0000-0000-0000-000000000001'
      and share.expected_commission_cents = 12500
      and share.payment_status = 'not_ready'
  ),
  1,
  'affiliate share values reconcile with same-org source rows'
);

select results_eq(
  $$
    select column_name::text collate "C"
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'affiliate_client_view'
    order by ordinal_position
  $$,
  $$
    values
      ('started_at'::text collate "C"),
      ('stage'::text collate "C"),
      ('funded_amount_cents'::text collate "C"),
      ('expected_commission_cents'::text collate "C"),
      ('payment_status'::text collate "C")
  $$,
  'affiliate view retains exactly five ordered columns'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'authenticated', 'sub', 'a1000000-0000-0000-0000-000000000001')::text,
  true
);

select is(
  pg_temp.visible_rows_for_org('b0000000-0000-0000-0000-000000000001'),
  0::bigint,
  'Org A owner sees zero rows through foreign-org paths'
);
select is((select count(*)::integer from public.clients), 4, 'Org A owner sees all four own clients');

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'authenticated', 'sub', 'a1000000-0000-0000-0000-000000000002')::text,
  true
);

select is(
  pg_temp.visible_rows_for_org('b0000000-0000-0000-0000-000000000001'),
  0::bigint,
  'Org A prep specialist sees zero rows through foreign-org paths'
);
select is((select count(*)::integer from public.clients), 4, 'Org A prep specialist retains base access to own clients');
select results_eq(
  $$
    select id
    from public.specialist_default_client_view
    order by id
  $$,
  $$
    values
      ('a3000000-0000-0000-0000-000000000001'::uuid),
      ('a3000000-0000-0000-0000-000000000002'::uuid),
      ('a3000000-0000-0000-0000-000000000004'::uuid)
  $$,
  'prep specialist view returns the seeded onboarding and optimization clients'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'authenticated', 'sub', 'a1000000-0000-0000-0000-000000000011')::text,
  true
);

select is(
  pg_temp.visible_rows_for_org('b0000000-0000-0000-0000-000000000001'),
  0::bigint,
  'clean persona consumer sees zero rows through foreign-org paths'
);
select results_eq(
  $$ select id from public.clients $$,
  $$ values ('a3000000-0000-0000-0000-000000000001'::uuid) $$,
  'clean persona consumer sees only the linked client'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'authenticated', 'sub', 'a1000000-0000-0000-0000-000000000012')::text,
  true
);

select is(
  pg_temp.visible_rows_for_org('b0000000-0000-0000-0000-000000000001'),
  0::bigint,
  'derog persona consumer sees zero rows through foreign-org paths'
);
select results_eq(
  $$ select id from public.clients $$,
  $$ values ('a3000000-0000-0000-0000-000000000002'::uuid) $$,
  'derog persona consumer sees only the linked client'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'authenticated', 'sub', 'a1000000-0000-0000-0000-000000000013')::text,
  true
);

select is(
  pg_temp.visible_rows_for_org('b0000000-0000-0000-0000-000000000001'),
  0::bigint,
  'thin-file persona consumer sees zero rows through foreign-org paths'
);
select results_eq(
  $$ select id from public.clients $$,
  $$ values ('a3000000-0000-0000-0000-000000000003'::uuid) $$,
  'thin-file persona consumer sees only the linked client'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'authenticated', 'sub', 'a1000000-0000-0000-0000-000000000003')::text,
  true
);

select is(
  pg_temp.visible_rows_for_org('b0000000-0000-0000-0000-000000000001'),
  0::bigint,
  'Org A affiliate sees zero rows through foreign-org paths'
);
select is((select count(*)::integer from public.clients), 0, 'affiliate sees no base client row');
select is(
  (select count(*)::integer from public.affiliate_client_shares),
  0,
  'affiliate sees no base share row'
);
select results_eq(
  $$
    select
      started_at,
      stage,
      funded_amount_cents,
      expected_commission_cents,
      payment_status
    from public.affiliate_client_view
  $$,
  $$
    values (
      '2026-08-01'::date,
      'optimization'::public.client_stage,
      0::bigint,
      12500::bigint,
      'not_ready'::public.affiliate_payment_status
    )
  $$,
  'affiliate sees the one five-value owner-context projection'
);
select is((select count(*)::integer from public.affiliates), 1, 'affiliate sees its own affiliate identity');

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'authenticated', 'sub', 'b1000000-0000-0000-0000-000000000001')::text,
  true
);

select is(
  pg_temp.visible_rows_for_org('a0000000-0000-0000-0000-000000000001'),
  0::bigint,
  'Org B owner sees zero rows through foreign-org paths'
);
select results_eq(
  $$ select id from public.clients $$,
  $$ values ('b3000000-0000-0000-0000-000000000001'::uuid) $$,
  'Org B owner sees the one own client'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'authenticated', 'sub', 'b1000000-0000-0000-0000-000000000011')::text,
  true
);

select is(
  pg_temp.visible_rows_for_org('a0000000-0000-0000-0000-000000000001'),
  0::bigint,
  'Org B consumer sees zero rows through foreign-org paths'
);
select results_eq(
  $$ select id from public.clients $$,
  $$ values ('b3000000-0000-0000-0000-000000000001'::uuid) $$,
  'Org B consumer sees only the linked client'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'authenticated', 'sub', '00000000-0000-0000-0000-000000000001')::text,
  true
);

select is((select count(*)::integer from public.orgs), 3, 'platform administrator sees all three organizations');
select is((select count(*)::integer from public.clients), 5, 'platform administrator sees all five clients');
select is((select count(*)::integer from public.profiles), 10, 'platform administrator sees all profiles');
select is((select count(*)::integer from public.enrollments), 4, 'platform administrator sees all enrollments');

reset role;

-- 2026-08-18 R5A-03: the seed contains only state the current authority could have produced.
--
-- Migration 355 refuses settlement unless the same enrollment holds a locked `idv_sessions` row in
-- `state='passed'`, so a settled subscription without one is a row the product can no longer make.
-- This is deliberately a property over the whole seeded set rather than three named personas —
-- re-listing Casey, Devon and Taylor is exactly how this file passed 64/64 while all three had zero
-- IDV rows, and a fourth persona added later would inherit the same blind spot.
--
-- Fails on d6ae268: all three active enrollments come back.
select is_empty(
  $$
    select enrollment.id::text
    from public.enrollments as enrollment
    join public.consumer_subscriptions as subscription
      on subscription.enrollment_id = enrollment.id
    where enrollment.status = 'active'
      and subscription.operation_state = 'settled'
      and not exists (
        select 1
        from public.idv_sessions as session
        where session.enrollment_id = enrollment.id
          and session.client_id = enrollment.client_id
          and session.state = 'passed'
          and session.outcome = 'pass'
      )
  $$,
  'every active enrollment with a settled subscription holds a passing IDV session of its own client'
);

-- The assertion above is empty for two different reasons, so the count it ranges over is asserted
-- separately: a seed that stopped activating anyone would satisfy it silently.
select cmp_ok(
  (
    select count(*)::int
    from public.enrollments as enrollment
    join public.consumer_subscriptions as subscription
      on subscription.enrollment_id = enrollment.id
    where enrollment.status = 'active' and subscription.operation_state = 'settled'
  ),
  '>',
  0,
  'and the seed still activates at least one consumer for that property to range over'
);

-- The sessions are the shape the machine writes, not rows bolted on to satisfy the query: the
-- member reference matches the enrollment's own, no lock window is set, and nothing was retried.
select is_empty(
  $$
    select session.id::text
    from public.idv_sessions as session
    join public.enrollments as enrollment on enrollment.id = session.enrollment_id
    where session.state = 'passed'
      and (
        session.member_ref is distinct from enrollment.crs_member_ref
        or session.locked_until is not null
        or session.attempts_used <> 0
        or session.updated_at > (
          select subscription.activated_at
          from public.consumer_subscriptions as subscription
          where subscription.enrollment_id = enrollment.id
        )
      )
  $$,
  'each passing session carries the enrollment''s member reference and settles before the charge'
);

select * from finish();
rollback;
