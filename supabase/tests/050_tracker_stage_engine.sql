begin;

set local search_path = public, extensions;

-- 2026-08-17 R1A-03: carry the governed-client trigger and direct-write denial.
select plan(62);

select results_eq(
  $$
    select enumlabel::text collate "C"
    from pg_enum
    join pg_type on pg_type.oid = pg_enum.enumtypid
    join pg_namespace on pg_namespace.oid = pg_type.typnamespace
    where pg_namespace.nspname = 'public'
      and pg_type.typname = 'client_stage'
    order by enumsortorder
  $$,
  $$
    values
      ('onboarding'::text collate "C"),
      ('optimization'::text collate "C"),
      ('ready'::text collate "C"),
      ('applying'::text collate "C"),
      ('funded'::text collate "C"),
      ('graduate'::text collate "C")
  $$,
  'tracker uses the exact six-stage database taxonomy'
);

select has_table(
  'public',
  'tracker_transition_receipts',
  'durable tracker transition receipts exist'
);
select has_function(
  'public',
  'tracker_transition_client_stage',
  array['uuid', 'client_stage', 'client_stage', 'uuid', 'text', 'text'],
  'the atomic tracker transition function exists'
);

select is(
  (
    select function.prosecdef
      and function.proconfig @> array['search_path=""']
    from pg_proc as function
    join pg_namespace as namespace on namespace.oid = function.pronamespace
    where namespace.nspname = 'public'
      and function.proname = 'tracker_transition_client_stage'
  ),
  true,
  'the transition function is a fixed-path security definer'
);

select is(
  has_function_privilege(
    'anon',
    'public.tracker_transition_client_stage(uuid,public.client_stage,public.client_stage,uuid,text,text)',
    'execute'
  ),
  false,
  'anonymous callers cannot execute the transition function'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.tracker_transition_client_stage(uuid,public.client_stage,public.client_stage,uuid,text,text)',
    'execute'
  ),
  true,
  'authenticated callers can reach the function authorization boundary'
);
select is(
  has_function_privilege(
    'service_role',
    'public.tracker_transition_client_stage(uuid,public.client_stage,public.client_stage,uuid,text,text)',
    'execute'
  ),
  true,
  'service callers can reach the automatic-event boundary'
);

select is(
  (
    select relation.relrowsecurity and relation.relforcerowsecurity
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'tracker_transition_receipts'
  ),
  true,
  'receipt storage enables and forces row security'
);
select is(
  has_table_privilege('anon', 'public.tracker_transition_receipts', 'select'),
  false,
  'anonymous callers have no direct receipt access'
);
select is(
  has_table_privilege('authenticated', 'public.tracker_transition_receipts', 'select'),
  false,
  'authenticated callers have no direct receipt access'
);

select is(
  (
    select count(*)::integer
    from pg_trigger
    where tgrelid = 'public.stage_history'::regclass
      and tgname = 'stage_history_prevent_change'
      and not tgisinternal
  ),
  1,
  'the Phase-1 stage-history append-only guard remains authoritative'
);
select is(
  (
    select count(*)::integer
    from pg_trigger
    where tgrelid = 'public.audit_log'::regclass
      and tgname = 'audit_log_prevent_change'
      and not tgisinternal
  ),
  1,
  'the Phase-1 audit-log append-only guard remains unchanged'
);

select has_trigger(
  'public',
  'clients',
  'clients_guard_governed_write',
  'protected client fields carry the governed-write trigger'
);

select is(
  (
    select count(*)::integer
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'clients'
  ),
  1,
  'public.clients appears exactly once in the Realtime publication'
);

select is(
  (
    select count(*)::integer
    from public.tracker_transition_receipts
    where event_key in (
      'seed:tracker:clean:optimization',
      'seed:tracker:thin-file:applying'
    )
  ),
  2,
  'seed tracker transitions retain exactly two stable idempotency receipts'
);
select results_eq(
  $$
    select id, stage
    from public.clients
    where id in (
      'a3000000-0000-0000-0000-000000000001',
      'a3000000-0000-0000-0000-000000000002',
      'a3000000-0000-0000-0000-000000000003'
    )
    order by id
  $$,
  $$
    values
      ('a3000000-0000-0000-0000-000000000001'::uuid, 'optimization'::public.client_stage),
      ('a3000000-0000-0000-0000-000000000002'::uuid, 'optimization'::public.client_stage),
      ('a3000000-0000-0000-0000-000000000003'::uuid, 'applying'::public.client_stage)
  $$,
  'seed scenarios expose deterministic tracker stages'
);
select is(
  (
    select bool_and(client.stage_entered_at = history.changed_at)
    from public.clients as client
    join public.stage_history as history
      on history.client_id = client.id
     and history.to_stage = client.stage
    where client.id in (
      'a3000000-0000-0000-0000-000000000001',
      'a3000000-0000-0000-0000-000000000003'
    )
  ),
  true,
  'seed stage timers begin at the persisted transition time'
);
select results_eq(
  $$
    select id, client_id, readiness_score, ran_at
    from public.analysis_runs
    where id between
      'a6000000-0000-0000-0000-000000000001'::uuid and
      'a6000000-0000-0000-0000-000000000003'::uuid
    order by id
  $$,
  $$
    values
      ('a6000000-0000-0000-0000-000000000001'::uuid, 'a3000000-0000-0000-0000-000000000001'::uuid, 92, '2026-08-15T09:00:00Z'::timestamptz),
      ('a6000000-0000-0000-0000-000000000002'::uuid, 'a3000000-0000-0000-0000-000000000002'::uuid, 58, '2026-08-15T09:05:00Z'::timestamptz),
      ('a6000000-0000-0000-0000-000000000003'::uuid, 'a3000000-0000-0000-0000-000000000003'::uuid, 64, '2026-08-15T09:10:00Z'::timestamptz)
  $$,
  'seed analysis projections use stable numeric readiness inputs'
);
select is(
  (
    select count(*)::integer
    from public.plans as plan_row
    join public.analysis_runs as run on run.id = plan_row.analysis_run_id
    where plan_row.id between
      'a7000000-0000-0000-0000-000000000001'::uuid and
      'a7000000-0000-0000-0000-000000000003'::uuid
      and run.client_id = plan_row.client_id
      and run.readiness_score = plan_row.readiness_score
  ),
  3,
  'each seeded plan links to its persisted analysis projection'
);
select results_eq(
  $$
    select checklist_item_id, state
    from public.checklist_item_state
    where checklist_item_id between
      'a9000000-0000-0000-0000-000000000001'::uuid and
      'a9000000-0000-0000-0000-000000000003'::uuid
    order by checklist_item_id
  $$,
  $$
    values
      ('a9000000-0000-0000-0000-000000000001'::uuid, 'verified'::public.checklist_state),
      ('a9000000-0000-0000-0000-000000000002'::uuid, 'todo'::public.checklist_state),
      ('a9000000-0000-0000-0000-000000000003'::uuid, 'todo'::public.checklist_state)
  $$,
  'seed checklist scenarios include verified and open work'
);
select is(
  (
    select count(*)::integer
    from public.enrollments
    where id between
      'a5000000-0000-0000-0000-000000000001'::uuid and
      'a5000000-0000-0000-0000-000000000003'::uuid
      -- 2026-08-17 R3C-03 seed carry: tracker projections imply settled activation.
      and status = 'active'
      and persona_hint is not null
  ),
  3,
  'seed tracker personas retain deterministic active status and persona metadata'
);
select is(
  (
    select count(*)::integer
    from public.consents
    where client_id in (
      'a3000000-0000-0000-0000-000000000001',
      'a3000000-0000-0000-0000-000000000002',
      'a3000000-0000-0000-0000-000000000003'
    )
      and action = 'granted'
  ),
  6,
  'seed scenarios include granted monitoring and analysis consent metadata'
);
select is(
  (
    select count(*)::integer
    from public.monitoring_events
    where client_id in (
      'a3000000-0000-0000-0000-000000000001',
      'a3000000-0000-0000-0000-000000000002',
      'a3000000-0000-0000-0000-000000000003'
    )
  ),
  0,
  'seed scenarios contain no monitoring content'
);
select is(
  (
    select count(*)::integer
    from public.clients
    where id in (
      'a3000000-0000-0000-0000-000000000001',
      'a3000000-0000-0000-0000-000000000002',
      'a3000000-0000-0000-0000-000000000003'
    )
      and funded_amount_cents = 0
  ),
  3,
  'seed scenarios contain no recorded outcome amount'
);
select is(
  (
    select count(*)::integer
    from public.stage_history
    where client_id in (
      'a3000000-0000-0000-0000-000000000001',
      'a3000000-0000-0000-0000-000000000003'
    )
  ),
  2,
  'seed tracker transitions produce one history row per changed stage'
);
select is(
  (
    select count(*)::integer
    from public.audit_log
    where client_id in (
      'a3000000-0000-0000-0000-000000000001',
      'a3000000-0000-0000-0000-000000000003'
    )
      and action = 'client.stage.transitioned'
  ),
  2,
  'seed tracker transitions produce one audit row per changed stage'
);

insert into auth.users (id, email)
values
  ('61000000-0000-0000-0000-000000000001', 'owner-a@tracker.test'),
  ('61000000-0000-0000-0000-000000000002', 'prep-a@tracker.test'),
  ('61000000-0000-0000-0000-000000000003', 'funding-a@tracker.test'),
  ('61000000-0000-0000-0000-000000000004', 'hidden-a@tracker.test'),
  ('61000000-0000-0000-0000-000000000005', 'affiliate-a@tracker.test'),
  ('61000000-0000-0000-0000-000000000011', 'consumer-a1@tracker.test'),
  ('61000000-0000-0000-0000-000000000012', 'consumer-a2@tracker.test'),
  ('62000000-0000-0000-0000-000000000001', 'owner-b@tracker.test'),
  ('62000000-0000-0000-0000-000000000011', 'consumer-b@tracker.test');

insert into public.orgs (id, name, slug, team_sees_all_clients)
values
  ('61000000-0000-0000-0000-000000000100', 'Tracker Test Org A', 'tracker-test-org-a', false),
  ('62000000-0000-0000-0000-000000000100', 'Tracker Test Org B', 'tracker-test-org-b', false);

insert into public.profiles (id, role, org_id, org_role, full_name, email)
values
  (
    '61000000-0000-0000-0000-000000000001',
    'operator_member',
    '61000000-0000-0000-0000-000000000100',
    'owner',
    'Tracker Owner A',
    'owner-a@tracker.test'
  ),
  (
    '61000000-0000-0000-0000-000000000002',
    'operator_member',
    '61000000-0000-0000-0000-000000000100',
    'prep_specialist',
    'Tracker Prep A',
    'prep-a@tracker.test'
  ),
  (
    '61000000-0000-0000-0000-000000000003',
    'operator_member',
    '61000000-0000-0000-0000-000000000100',
    'funding_specialist',
    'Tracker Funding A',
    'funding-a@tracker.test'
  ),
  (
    '61000000-0000-0000-0000-000000000004',
    'operator_member',
    '61000000-0000-0000-0000-000000000100',
    'prep_specialist',
    'Tracker Hidden A',
    'hidden-a@tracker.test'
  ),
  (
    '61000000-0000-0000-0000-000000000005',
    'affiliate',
    '61000000-0000-0000-0000-000000000100',
    null,
    'Tracker Affiliate A',
    'affiliate-a@tracker.test'
  ),
  (
    '61000000-0000-0000-0000-000000000011',
    'consumer',
    '61000000-0000-0000-0000-000000000100',
    null,
    'Tracker Consumer A1',
    'consumer-a1@tracker.test'
  ),
  (
    '61000000-0000-0000-0000-000000000012',
    'consumer',
    '61000000-0000-0000-0000-000000000100',
    null,
    'Tracker Consumer A2',
    'consumer-a2@tracker.test'
  ),
  (
    '62000000-0000-0000-0000-000000000001',
    'operator_member',
    '62000000-0000-0000-0000-000000000100',
    'owner',
    'Tracker Owner B',
    'owner-b@tracker.test'
  ),
  (
    '62000000-0000-0000-0000-000000000011',
    'consumer',
    '62000000-0000-0000-0000-000000000100',
    null,
    'Tracker Consumer B',
    'consumer-b@tracker.test'
  )
-- Upsert, not a plain insert: migration 010's `on_auth_user_created` trigger
-- writes a `public.profiles` row for every `auth.users` insert, so by the time
-- this statement runs each row already exists and a plain insert raises 23505.
-- The trigger's row is the narrow fallback shape — role `consumer`, `org_id`
-- null — and this fixture needs real roles bound to real organizations, so the
-- conflict resolves as `do update`: the fixture decides the final values, not
-- the fallback. `do nothing` is wrong here for the same reason; it leaves the
-- fallback row in place and the client insert then fails its role check.
on conflict (id) do update
set
  role = excluded.role,
  org_id = excluded.org_id,
  org_role = excluded.org_role,
  full_name = excluded.full_name,
  email = excluded.email;

insert into public.affiliates (id, org_id, profile_id, name, referral_slug)
values (
  '61000000-0000-0000-0000-000000000200',
  '61000000-0000-0000-0000-000000000100',
  '61000000-0000-0000-0000-000000000005',
  'Tracker Affiliate',
  'tracker-test-affiliate'
);

-- 2026-08-17 R3A-05: stage-engine fixtures need their explicit starting
-- stages, so mark only this setup insert as governed.
select pg_catalog.set_config('app.governed_client_write', 'on', true);
insert into public.clients (
  id,
  org_id,
  consumer_profile_id,
  display_name,
  stage,
  assigned_to,
  stage_entered_at
)
values
  (
    '61000000-0000-0000-0000-000000001001',
    '61000000-0000-0000-0000-000000000100',
    '61000000-0000-0000-0000-000000000011',
    'Manual Transition Client',
    'onboarding',
    '61000000-0000-0000-0000-000000000001',
    '2026-08-01T00:00:00Z'
  ),
  (
    '61000000-0000-0000-0000-000000001002',
    '61000000-0000-0000-0000-000000000100',
    '61000000-0000-0000-0000-000000000012',
    'Automatic Transition Client',
    'onboarding',
    '61000000-0000-0000-0000-000000000002',
    '2026-08-02T00:00:00Z'
  ),
  (
    '61000000-0000-0000-0000-000000001003',
    '61000000-0000-0000-0000-000000000100',
    null,
    'Hidden Client',
    'ready',
    '61000000-0000-0000-0000-000000000001',
    '2026-08-03T00:00:00Z'
  ),
  (
    '61000000-0000-0000-0000-000000001004',
    '61000000-0000-0000-0000-000000000100',
    null,
    'Prep Outside Default Client',
    'applying',
    '61000000-0000-0000-0000-000000000002',
    '2026-08-04T00:00:00Z'
  ),
  (
    '61000000-0000-0000-0000-000000001005',
    '61000000-0000-0000-0000-000000000100',
    null,
    'Funding Outside Default Client',
    'onboarding',
    '61000000-0000-0000-0000-000000000003',
    '2026-08-05T00:00:00Z'
  ),
  (
    '62000000-0000-0000-0000-000000001001',
    '62000000-0000-0000-0000-000000000100',
    '62000000-0000-0000-0000-000000000011',
    'Foreign Client',
    'onboarding',
    '62000000-0000-0000-0000-000000000001',
    '2026-08-06T00:00:00Z'
  );
select pg_catalog.set_config('app.governed_client_write', '', true);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'authenticated', 'sub', '61000000-0000-0000-0000-000000000001')::text,
  true
);

select throws_ok(
  $$
    update public.clients
    set stage = 'funded',
        stage_entered_at = '2099-01-01T00:00:00Z',
        funded_amount_cents = 999999999
    where id = '61000000-0000-0000-0000-000000001001'
  $$,
  '42501',
  'CLIENT_GOVERNED_WRITE_REQUIRED',
  'an operator cannot directly change stage, transition time, or funded amount'
);

select results_eq(
  $$
    select result, current_stage, stage_entered_at is not null
    from public.tracker_transition_client_stage(
      '61000000-0000-0000-0000-000000001001',
      'graduate',
      'onboarding',
      '61000000-0000-0000-0000-000000000001',
      'manual',
      null
    )
  $$,
  $$ values ('transitioned'::text, 'graduate'::public.client_stage, true) $$,
  'manual transitions may target any valid stage without an invented graph'
);

select is(
  (select stage from public.clients where id = '61000000-0000-0000-0000-000000001001'),
  'graduate'::public.client_stage,
  'a real transition changes the client stage'
);
select is(
  (select count(*)::integer from public.stage_history where client_id = '61000000-0000-0000-0000-000000001001'),
  1,
  'a real transition appends exactly one history row'
);
select is(
  (
    select count(*)::integer
    from public.audit_log
    where client_id = '61000000-0000-0000-0000-000000001001'
      and action = 'client.stage.transitioned'
  ),
  1,
  'a real transition appends exactly one audit row'
);
select is(
  (
    select client.stage_entered_at = history.changed_at
      and history.changed_at = audit.occurred_at
    from public.clients as client
    join public.stage_history as history on history.client_id = client.id
    join public.audit_log as audit on audit.client_id = client.id
      and audit.action = 'client.stage.transitioned'
    where client.id = '61000000-0000-0000-0000-000000001001'
  ),
  true,
  'client, history, and audit evidence share one transaction timestamp'
);
select results_eq(
  $$
    select meta
    from public.audit_log
    where client_id = '61000000-0000-0000-0000-000000001001'
      and action = 'client.stage.transitioned'
  $$,
  $$
    values (
      '{"eventKey":"","from":"onboarding","source":"manual","to":"graduate"}'::jsonb
    )
  $$,
  'the transition audit metadata records from, to, source, and eventKey'
);

select results_eq(
  $$
    select result, current_stage
    from public.tracker_transition_client_stage(
      '61000000-0000-0000-0000-000000001001',
      'graduate',
      'graduate',
      '61000000-0000-0000-0000-000000000001',
      'manual',
      null
    )
  $$,
  $$ values ('unchanged'::text, 'graduate'::public.client_stage) $$,
  'a same-target manual retry returns unchanged'
);
select is(
  (
    select count(*)::integer
    from public.stage_history
    where client_id = '61000000-0000-0000-0000-000000001001'
  ),
  1,
  'a same-target retry appends no second history row'
);

select results_eq(
  $$
    select result, current_stage
    from public.tracker_transition_client_stage(
      '61000000-0000-0000-0000-000000001001',
      'ready',
      'onboarding',
      '61000000-0000-0000-0000-000000000001',
      'manual',
      null
    )
  $$,
  $$ values ('stale'::text, 'graduate'::public.client_stage) $$,
  'a stale expected stage returns stale'
);
select is(
  (
    select count(*)::integer
    from public.audit_log
    where client_id = '61000000-0000-0000-0000-000000001001'
      and action = 'client.stage.transitioned'
  ),
  1,
  'a stale transition appends no audit row'
);

select results_eq(
  $$
    select result, current_stage, stage_entered_at
    from public.tracker_transition_client_stage(
      '61000000-0000-0000-0000-000000009999',
      'optimization',
      'onboarding',
      '61000000-0000-0000-0000-000000000001',
      'manual',
      null
    )
  $$,
  $$ values ('not_found'::text, null::public.client_stage, null::timestamptz) $$,
  'a missing client returns not_found'
);

reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select results_eq(
  $$
    select result, current_stage
    from public.tracker_transition_client_stage(
      '61000000-0000-0000-0000-000000001002',
      'optimization',
      'onboarding',
      null,
      'enrollment',
      'enrollment:tracker-test:active'
    )
  $$,
  $$ values ('transitioned'::text, 'optimization'::public.client_stage) $$,
  'an enrollment event performs the only allowed automatic transition'
);
select results_eq(
  $$
    select result, current_stage
    from public.tracker_transition_client_stage(
      '61000000-0000-0000-0000-000000001002',
      'optimization',
      'onboarding',
      null,
      'analysis',
      'analysis:tracker-test:complete'
    )
  $$,
  $$ values ('unchanged'::text, 'optimization'::public.client_stage) $$,
  'a distinct analysis event is consumed without restarting the stage'
);

reset role;

select is(
  (
    select count(*)::integer
    from public.tracker_transition_receipts
    where client_id = '61000000-0000-0000-0000-000000001002'
  ),
  2,
  'both automatic event keys have durable receipts'
);
select is(
  (
    select count(*)::integer
    from public.stage_history
    where client_id = '61000000-0000-0000-0000-000000001002'
  ),
  1,
  'overlapping automatic causes produce one history row'
);
select is(
  (
    select count(*)::integer
    from public.audit_log
    where client_id = '61000000-0000-0000-0000-000000001002'
      and action = 'client.stage.transitioned'
  ),
  1,
  'overlapping automatic causes produce one audit row'
);

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select results_eq(
  $$
    select result, current_stage
    from public.tracker_transition_client_stage(
      '61000000-0000-0000-0000-000000001002',
      'optimization',
      'onboarding',
      null,
      'enrollment',
      'enrollment:tracker-test:active'
    )
  $$,
  $$ values ('duplicate'::text, 'optimization'::public.client_stage) $$,
  'a repeated automatic event key returns duplicate'
);
select is(
  (
    select stage_entered_at = (
      select changed_at
      from public.stage_history
      where client_id = '61000000-0000-0000-0000-000000001002'
    )
    from public.clients
    where id = '61000000-0000-0000-0000-000000001002'
  ),
  true,
  'automatic retries preserve the original stage timestamp'
);

select throws_ok(
  $$
    select *
    from public.tracker_transition_client_stage(
      '61000000-0000-0000-0000-000000001003',
      'ready',
      'onboarding',
      null,
      'analysis',
      'analysis:tracker-test:invalid-target'
    )
  $$,
  '22023',
  null,
  'automatic sources reject any target other than optimization'
);
select throws_ok(
  $$
    select *
    from public.tracker_transition_client_stage(
      '61000000-0000-0000-0000-000000001003',
      'optimization',
      'ready',
      null,
      'enrollment',
      'enrollment:tracker-test:invalid-source-stage'
    )
  $$,
  '22023',
  null,
  'automatic sources reject an expected stage other than onboarding'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'authenticated', 'sub', '62000000-0000-0000-0000-000000000001')::text,
  true
);
select throws_ok(
  $$
    select *
    from public.tracker_transition_client_stage(
      '61000000-0000-0000-0000-000000001003',
      'funded',
      'ready',
      '62000000-0000-0000-0000-000000000001',
      'manual',
      null
    )
  $$,
  '42501',
  null,
  'a cross-organization operator cannot transition a client'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'authenticated', 'sub', '61000000-0000-0000-0000-000000000004')::text,
  true
);
select throws_ok(
  $$
    select *
    from public.tracker_transition_client_stage(
      '61000000-0000-0000-0000-000000001003',
      'funded',
      'ready',
      '61000000-0000-0000-0000-000000000004',
      'manual',
      null
    )
  $$,
  '42501',
  null,
  'a same-organization hidden member cannot transition a client'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'authenticated', 'sub', '61000000-0000-0000-0000-000000000011')::text,
  true
);
select throws_ok(
  $$
    select *
    from public.tracker_transition_client_stage(
      '61000000-0000-0000-0000-000000001001',
      'ready',
      'graduate',
      '61000000-0000-0000-0000-000000000011',
      'manual',
      null
    )
  $$,
  '42501',
  null,
  'a consumer owner cannot transition their own client'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'authenticated', 'sub', '61000000-0000-0000-0000-000000000012')::text,
  true
);
select throws_ok(
  $$
    select *
    from public.tracker_transition_client_stage(
      '61000000-0000-0000-0000-000000001001',
      'ready',
      'graduate',
      '61000000-0000-0000-0000-000000000012',
      'manual',
      null
    )
  $$,
  '42501',
  null,
  'a wrong consumer cannot transition another client'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'authenticated', 'sub', '61000000-0000-0000-0000-000000000005')::text,
  true
);
select throws_ok(
  $$
    select *
    from public.tracker_transition_client_stage(
      '61000000-0000-0000-0000-000000001003',
      'funded',
      'ready',
      '61000000-0000-0000-0000-000000000005',
      'manual',
      null
    )
  $$,
  '42501',
  null,
  'an affiliate cannot transition a client'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'authenticated', 'sub', '61000000-0000-0000-0000-000000000002')::text,
  true
);
select is(
  (
    select count(*)::integer
    from public.clients
    where id = '61000000-0000-0000-0000-000000001004'
  ),
  1,
  'a prep specialist retains direct access outside the default stage filter'
);
select results_eq(
  $$
    select result, current_stage
    from public.tracker_transition_client_stage(
      '61000000-0000-0000-0000-000000001004',
      'funded',
      'applying',
      '61000000-0000-0000-0000-000000000002',
      'manual',
      null
    )
  $$,
  $$ values ('transitioned'::text, 'funded'::public.client_stage) $$,
  'a visible prep specialist can transition outside the default stage filter'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'authenticated', 'sub', '61000000-0000-0000-0000-000000000003')::text,
  true
);
select is(
  (
    select count(*)::integer
    from public.clients
    where id = '61000000-0000-0000-0000-000000001005'
  ),
  1,
  'a funding specialist retains direct access outside the default stage filter'
);
select results_eq(
  $$
    select result, current_stage
    from public.tracker_transition_client_stage(
      '61000000-0000-0000-0000-000000001005',
      'ready',
      'onboarding',
      '61000000-0000-0000-0000-000000000003',
      'manual',
      null
    )
  $$,
  $$ values ('transitioned'::text, 'ready'::public.client_stage) $$,
  'a visible funding specialist can transition outside the default stage filter'
);

reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'authenticated', 'sub', 'a1000000-0000-0000-0000-000000000001')::text,
  true
);
select is(
  (
    select count(*)::integer
    from public.analysis_runs
    where id between
      'a6000000-0000-0000-0000-000000000001'::uuid and
      'a6000000-0000-0000-0000-000000000003'::uuid
  ),
  3,
  'the seeded operator owner can read same-org analysis projections'
);
select is(
  (
    select count(*)::integer
    from public.plans
    where id between
      'a7000000-0000-0000-0000-000000000001'::uuid and
      'a7000000-0000-0000-0000-000000000003'::uuid
  ),
  3,
  'the seeded operator owner can read same-org plans'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'authenticated', 'sub', 'a1000000-0000-0000-0000-000000000011')::text,
  true
);
select is(
  (
    select count(*)::integer
    from public.analysis_runs
    where id between
      'a6000000-0000-0000-0000-000000000001'::uuid and
      'a6000000-0000-0000-0000-000000000003'::uuid
  ),
  1,
  'the seeded consumer reads only their own analysis projection'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'authenticated', 'sub', 'b1000000-0000-0000-0000-000000000001')::text,
  true
);
select is(
  (
    select count(*)::integer
    from public.analysis_runs
    where id between
      'a6000000-0000-0000-0000-000000000001'::uuid and
      'a6000000-0000-0000-0000-000000000003'::uuid
  ),
  0,
  'the seeded control-org owner cannot read organization A analysis projections'
);

reset role;

select throws_ok(
  $$
    update public.stage_history
    set to_stage = 'ready'
    where client_id = '61000000-0000-0000-0000-000000001001'
  $$,
  'P0001',
  'stage_history rows are append-only',
  'stage history cannot be updated'
);
select throws_ok(
  $$
    delete from public.stage_history
    where client_id = '61000000-0000-0000-0000-000000001001'
  $$,
  'P0001',
  'stage_history rows are append-only',
  'stage history cannot be deleted'
);

select * from finish();
rollback;
