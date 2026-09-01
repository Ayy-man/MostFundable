begin;

set local search_path = public, extensions;

select plan(57);

select has_table('public', 'analysis_runs', 'analysis runs table exists');
select has_table('public', 'plans', 'plans table exists');
select has_table('public', 'checklist_templates', 'checklist templates table exists');
select has_table('public', 'checklist_items', 'checklist items table exists');
select has_table('public', 'checklist_item_state', 'checklist item state table exists');
select has_table('public', 'stage_history', 'stage history table exists');
select has_table('public', 'audit_log', 'audit log table exists');
select has_type('public', 'analysis_trigger', 'analysis trigger enum exists');
select has_type('public', 'checklist_kind', 'checklist kind enum exists');
select has_type('public', 'checklist_state', 'checklist state enum exists');

select is(
  (
    select count(*)::integer
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in (
        'analysis_runs',
        'plans',
        'checklist_templates',
        'checklist_items',
        'checklist_item_state',
        'stage_history',
        'audit_log'
      )
      and relation.relrowsecurity
  ),
  7,
  'all analysis and tracker tables enable row security'
);

select is(
  (
    select count(*)::integer
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in (
        'analysis_runs',
        'plans',
        'checklist_templates',
        'checklist_items',
        'checklist_item_state',
        'stage_history',
        'audit_log'
      )
      and relation.relforcerowsecurity
  ),
  7,
  'all analysis and tracker tables force row security'
);

select is(
  (
    select count(*)::integer
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'analysis_runs',
        'plans',
        'checklist_templates',
        'checklist_items',
        'checklist_item_state',
        'stage_history',
        'audit_log'
      )
  ),
  -- 8 from Phase 1, plus audit_log_actor_insert_lane_a from Phase 2's
  -- 011_auth_policies.sql. Phase 1 granted `authenticated` select on audit_log
  -- and shipped no insert policy, so PATCH /api/org/settings could not write
  -- its attribution row through the ordinary client; INTERFACES §4 (D-27)
  -- permits a lane to add policies to integration's tables, which makes this
  -- hardcoded total a per-lane carry rather than a fixed number.
  -- Phase 24 carried the total to 10. 2026-08-17 R2A-07 removes the three
  -- authenticated stage-history mutation policies because only the RPC writes.
  7,
  'analysis and tracker tables have expected policies'
);

select is(
  (
    select count(*)::integer
    from pg_indexes
    where schemaname = 'public'
      and indexname in (
        'analysis_runs_client_ran_at_idx',
        'plans_client_created_at_idx',
        'checklist_templates_kind_idx',
        'checklist_items_client_id_idx',
        'checklist_items_template_id_idx',
        'checklist_items_parent_item_id_idx',
        'checklist_item_state_client_id_idx',
        'checklist_item_state_verified_by_run_id_idx',
        'stage_history_client_changed_at_idx',
        'stage_history_changed_by_idx',
        'audit_log_org_occurred_at_idx',
        'audit_log_client_occurred_at_idx',
        'audit_log_actor_profile_id_idx'
      )
  ),
  13,
  'analysis and tracker relationship indexes exist'
);

select is(
  (
    select count(*)::integer
    from pg_proc as function
    join pg_namespace as namespace on namespace.oid = function.pronamespace
    where namespace.nspname = 'private'
      and function.proname in ('derived_features_valid', 'audit_meta_valid')
      and function.provolatile = 'i'
      and function.proconfig @> array['search_path=""']
  ),
  2,
  'JSON validators are immutable and fixed-path'
);

select is(
  (
    select bool_and(
      has_table_privilege(
        'service_role',
        format('public.%I', table_name),
        'select,insert,update,delete'
      )
    )
    from unnest(array[
      'analysis_runs',
      'plans',
      'checklist_templates',
      'checklist_items',
      'checklist_item_state',
      'stage_history',
      'audit_log'
    ]) as table_name
  ),
  true,
  'server role has explicit analysis and tracker table privileges'
);

create temporary table test_derived (body jsonb not null) on commit drop;

insert into test_derived (body)
values (
  '{
    "schemaVersion": 1,
    "bureausPulled": ["EQF", "EXP", "TUC"],
    "accounts": [
      {
        "accountRef": "account-one",
        "kind": "revolving",
        "balanceCents": 25000,
        "limitCents": 100000,
        "utilizationPct": 25,
        "ageMonths": 36,
        "isOpen": true,
        "isNegative": false
      }
    ],
    "overallUtilizationPct": 25,
    "inquiriesByBureau": {"EQF": 1, "EXP": 1, "TUC": 0},
    "negativesCount": 0,
    "openRevolvingCount": 1,
    "averageAgeMonths": 36,
    "highestRevolvingLimitCents": 100000,
    "dti": {
      "monthlyDebtPaymentsCents": 50000,
      "statedMonthlyIncomeCents": 500000,
      "ratioPct": 10
    },
    "flags": {
      "utilizationUnder30": true,
      "fourOrMorePersonalAccountsOpen": false,
      "averageAgeTwoYearsOrMore": true,
      "noNegativeItemsReported": true,
      "cardWithTenKLimit": false,
      "twoOrFewerInquiriesEveryBureau": true,
      "thinFile": true
    },
    "computedAt": "2026-08-16T05:00:00Z"
  }'::jsonb
);

select is(
  private.derived_features_valid((select body from test_derived)),
  true,
  'valid derived feature document passes'
);
select is(
  private.derived_features_valid((select body || '{"extra": true}'::jsonb from test_derived)),
  false,
  'unknown top-level derived key fails'
);
select is(
  private.derived_features_valid(
    (select jsonb_set(body, '{flags,extra}', 'true'::jsonb) from test_derived)
  ),
  false,
  'unknown nested derived key fails'
);
select is(
  private.derived_features_valid(
    (select jsonb_set(body, '{schemaVersion}', '"one"'::jsonb) from test_derived)
  ),
  false,
  'wrong derived scalar type fails'
);
select is(
  private.derived_features_valid(
    (select jsonb_set(body, '{negativesCount}', '-1'::jsonb) from test_derived)
  ),
  false,
  'negative derived count fails'
);
select is(
  private.derived_features_valid((select body - 'computedAt' from test_derived)),
  false,
  'missing derived key fails'
);

insert into auth.users (id, email)
values
  ('30000000-0000-0000-0000-000000000900', 'platform@analysis.example'),
  ('30000000-0000-0000-0000-000000000111', 'owner.one@analysis.example'),
  ('30000000-0000-0000-0000-000000000112', 'consumer.one@analysis.example'),
  ('30000000-0000-0000-0000-000000000113', 'affiliate.one@analysis.example'),
  ('40000000-0000-0000-0000-000000000221', 'owner.two@analysis.example'),
  ('40000000-0000-0000-0000-000000000222', 'consumer.two@analysis.example');

insert into public.orgs (id, name, slug)
values
  ('33000000-0000-0000-0000-000000000001', 'Analysis Org One', 'analysis-org-one'),
  ('44000000-0000-0000-0000-000000000002', 'Analysis Org Two', 'analysis-org-two');

insert into public.profiles (id, role, org_id, org_role, full_name, email)
values
  (
    '30000000-0000-0000-0000-000000000900',
    'platform_admin',
    null,
    null,
    'Analysis Platform Admin',
    'platform@analysis.example'
  ),
  (
    '30000000-0000-0000-0000-000000000111',
    'operator_member',
    '33000000-0000-0000-0000-000000000001',
    'owner',
    'Analysis Owner One',
    'owner.one@analysis.example'
  ),
  (
    '30000000-0000-0000-0000-000000000112',
    'consumer',
    '33000000-0000-0000-0000-000000000001',
    null,
    'Analysis Consumer One',
    'consumer.one@analysis.example'
  ),
  (
    '30000000-0000-0000-0000-000000000113',
    'affiliate',
    '33000000-0000-0000-0000-000000000001',
    null,
    'Analysis Affiliate One',
    'affiliate.one@analysis.example'
  ),
  (
    '40000000-0000-0000-0000-000000000221',
    'operator_member',
    '44000000-0000-0000-0000-000000000002',
    'owner',
    'Analysis Owner Two',
    'owner.two@analysis.example'
  ),
  (
    '40000000-0000-0000-0000-000000000222',
    'consumer',
    '44000000-0000-0000-0000-000000000002',
    null,
    'Analysis Consumer Two',
    'consumer.two@analysis.example'
  )
on conflict (id) do update
set
  role = excluded.role,
  org_id = excluded.org_id,
  org_role = excluded.org_role,
  full_name = excluded.full_name,
  email = excluded.email;

insert into public.clients (id, org_id, consumer_profile_id, display_name, assigned_to)
values
  (
    '33000000-0000-0000-0000-000000000101',
    '33000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000112',
    'Analysis Client One',
    '30000000-0000-0000-0000-000000000111'
  ),
  (
    '44000000-0000-0000-0000-000000000202',
    '44000000-0000-0000-0000-000000000002',
    '40000000-0000-0000-0000-000000000222',
    'Analysis Client Two',
    '40000000-0000-0000-0000-000000000221'
  );

select throws_ok(
  $$
    insert into public.analysis_runs (
      id,
      client_id,
      trigger,
      readiness_score,
      derived
    )
    select
      '33000000-0000-0000-0000-000000000700',
      '33000000-0000-0000-0000-000000000101',
      'scheduled',
      50,
      body || '{"extra": true}'::jsonb
    from test_derived
  $$,
  '23514',
  null,
  'analysis table rejects a derived document with unknown keys'
);

select throws_ok(
  $$
    insert into public.analysis_runs (
      id,
      client_id,
      trigger,
      readiness_score,
      derived
    )
    select
      '33000000-0000-0000-0000-000000000704',
      '33000000-0000-0000-0000-000000000101',
      'scheduled',
      101,
      body
    from test_derived
  $$,
  '23514',
  null,
  'analysis readiness cannot exceed one hundred'
);

insert into public.analysis_runs (id, client_id, trigger, readiness_score, derived)
select
  '33000000-0000-0000-0000-000000000701',
  '33000000-0000-0000-0000-000000000101',
  'scheduled',
  80,
  body
from test_derived;

insert into public.analysis_runs (id, client_id, trigger, readiness_score, derived)
select
  '44000000-0000-0000-0000-000000000702',
  '44000000-0000-0000-0000-000000000202',
  'alert',
  65,
  body
from test_derived;

insert into public.plans (
  id,
  client_id,
  analysis_run_id,
  version,
  body,
  readiness_score
)
values (
  '33000000-0000-0000-0000-000000000711',
  '33000000-0000-0000-0000-000000000101',
  '33000000-0000-0000-0000-000000000701',
  1,
  '{"summary": "ready"}',
  80
);

select throws_ok(
  $$
    insert into public.plans (
      id,
      client_id,
      analysis_run_id,
      version,
      body,
      readiness_score
    ) values (
      '33000000-0000-0000-0000-000000000712',
      '33000000-0000-0000-0000-000000000101',
      '44000000-0000-0000-0000-000000000702',
      1,
      '{"summary": "cross-client"}',
      65
    )
  $$,
  '23503',
  null,
  'plan cannot attach to another client analysis run'
);

select throws_ok(
  $$
    insert into public.plans (
      id,
      client_id,
      analysis_run_id,
      version,
      body,
      readiness_score
    ) values (
      '44000000-0000-0000-0000-000000000714',
      '44000000-0000-0000-0000-000000000202',
      '44000000-0000-0000-0000-000000000702',
      1,
      '{"summary": "invalid"}',
      -1
    )
  $$,
  '23514',
  null,
  'plan readiness cannot be negative'
);

insert into public.plans (
  id,
  client_id,
  analysis_run_id,
  version,
  body,
  readiness_score
)
values (
  '44000000-0000-0000-0000-000000000713',
  '44000000-0000-0000-0000-000000000202',
  '44000000-0000-0000-0000-000000000702',
  1,
  '{"summary": "ready"}',
  65
);

insert into public.checklist_templates (id, kind, key, title, blocking, sort_order)
values
  (
    '33000000-0000-0000-0000-000000000601',
    'personal_credit',
    'state-one',
    'Readiness state one',
    true,
    0
  ),
  (
    '33000000-0000-0000-0000-000000000602',
    'business_setup',
    'state-two',
    'Readiness state two',
    true,
    0
  );

insert into public.checklist_items (
  id,
  client_id,
  template_id,
  title,
  blocking,
  sort_order
)
values
  (
    '33000000-0000-0000-0000-000000000801',
    '33000000-0000-0000-0000-000000000101',
    '33000000-0000-0000-0000-000000000601',
    'Client One readiness state',
    true,
    0
  ),
  (
    '44000000-0000-0000-0000-000000000802',
    '44000000-0000-0000-0000-000000000202',
    '33000000-0000-0000-0000-000000000601',
    'Client Two readiness state',
    true,
    0
  );

select throws_ok(
  $$
    insert into public.checklist_items (
      id,
      client_id,
      template_id,
      parent_item_id,
      title,
      blocking,
      sort_order
    ) values (
      '44000000-0000-0000-0000-000000000803',
      '44000000-0000-0000-0000-000000000202',
      '33000000-0000-0000-0000-000000000602',
      '33000000-0000-0000-0000-000000000801',
      'Invalid parent state',
      true,
      1
    )
  $$,
  'P0001',
  'checklist parent must belong to the same client',
  'checklist parent cannot cross clients'
);

select throws_ok(
  $$
    insert into public.checklist_item_state (
      checklist_item_id,
      client_id,
      state,
      reported_at,
      verifying_at,
      verified_at
    ) values (
      '33000000-0000-0000-0000-000000000801',
      '33000000-0000-0000-0000-000000000101',
      'verified',
      '2026-08-16T05:01:00Z',
      '2026-08-16T05:02:00Z',
      '2026-08-16T05:03:00Z'
    )
  $$,
  '23514',
  null,
  'verified checklist state requires analysis provenance'
);

select throws_ok(
  $$
    insert into public.checklist_item_state (
      checklist_item_id,
      client_id,
      state,
      reported_at,
      verifying_at,
      verified_at,
      verified_by_run_id
    ) values (
      '33000000-0000-0000-0000-000000000801',
      '33000000-0000-0000-0000-000000000101',
      'verified',
      '2026-08-16T05:01:00Z',
      '2026-08-16T05:02:00Z',
      '2026-08-16T05:03:00Z',
      '44000000-0000-0000-0000-000000000702'
    )
  $$,
  '23503',
  null,
  'checklist verification cannot use another client analysis run'
);

select lives_ok(
  $$
    insert into public.checklist_item_state (
      checklist_item_id,
      client_id,
      state,
      reported_at,
      verifying_at,
      verified_at,
      verified_by_run_id
    ) values (
      '33000000-0000-0000-0000-000000000801',
      '33000000-0000-0000-0000-000000000101',
      'verified',
      '2026-08-16T05:01:00Z',
      '2026-08-16T05:02:00Z',
      '2026-08-16T05:03:00Z',
      '33000000-0000-0000-0000-000000000701'
    )
  $$,
  'same-client checklist verification succeeds'
);

insert into public.checklist_item_state (checklist_item_id, client_id)
values (
  '44000000-0000-0000-0000-000000000802',
  '44000000-0000-0000-0000-000000000202'
);

select throws_ok(
  $$
    insert into public.audit_log (
      id,
      org_id,
      client_id,
      action,
      subject_type,
      subject_id,
      meta
    ) values (
      '33000000-0000-0000-0000-000000000901',
      '33000000-0000-0000-0000-000000000001',
      '33000000-0000-0000-0000-000000000101',
      'test.invalid',
      'client',
      '33000000-0000-0000-0000-000000000101',
      '{"unknown": "value"}'
    )
  $$,
  '23514',
  null,
  'audit metadata rejects unknown keys'
);

select throws_ok(
  $$
    insert into public.audit_log (
      id,
      org_id,
      client_id,
      action,
      subject_type,
      subject_id,
      meta
    ) values (
      '33000000-0000-0000-0000-000000000902',
      '33000000-0000-0000-0000-000000000001',
      '33000000-0000-0000-0000-000000000101',
      'test.invalid',
      'client',
      '33000000-0000-0000-0000-000000000101',
      '{"source": {"nested": true}}'
    )
  $$,
  '23514',
  null,
  'audit metadata rejects nested content'
);

select throws_ok(
  $$
    insert into public.audit_log (
      id,
      org_id,
      client_id,
      action,
      subject_type,
      subject_id
    ) values (
      '33000000-0000-0000-0000-000000000903',
      '44000000-0000-0000-0000-000000000002',
      '33000000-0000-0000-0000-000000000101',
      'test.invalid',
      'client',
      '33000000-0000-0000-0000-000000000101'
    )
  $$,
  'P0001',
  'audit organization and client anchors must agree',
  'audit anchors cannot cross organizations'
);

select throws_ok(
  $$
    insert into public.stage_history (
      id,
      client_id,
      from_stage,
      to_stage,
      changed_by
    ) values (
      '33000000-0000-0000-0000-000000000911',
      '33000000-0000-0000-0000-000000000101',
      'onboarding',
      'optimization',
      '40000000-0000-0000-0000-000000000221'
    )
  $$,
  'P0001',
  'stage actor must be global or belong to the client organization',
  'stage actor cannot cross organizations'
);

insert into public.stage_history (id, client_id, from_stage, to_stage, changed_by)
values
  (
    '33000000-0000-0000-0000-000000000912',
    '33000000-0000-0000-0000-000000000101',
    'onboarding',
    'optimization',
    '30000000-0000-0000-0000-000000000111'
  ),
  (
    '44000000-0000-0000-0000-000000000913',
    '44000000-0000-0000-0000-000000000202',
    'onboarding',
    'optimization',
    '40000000-0000-0000-0000-000000000221'
  );

insert into public.audit_log (
  id,
  org_id,
  client_id,
  actor_profile_id,
  action,
  subject_type,
  subject_id,
  meta
)
values
  (
    '33000000-0000-0000-0000-000000000921',
    '33000000-0000-0000-0000-000000000001',
    '33000000-0000-0000-0000-000000000101',
    '30000000-0000-0000-0000-000000000111',
    'test.recorded',
    'client',
    '33000000-0000-0000-0000-000000000101',
    '{"source": "test"}'
  ),
  (
    '44000000-0000-0000-0000-000000000922',
    '44000000-0000-0000-0000-000000000002',
    '44000000-0000-0000-0000-000000000202',
    '40000000-0000-0000-0000-000000000221',
    'test.recorded',
    'client',
    '44000000-0000-0000-0000-000000000202',
    '{"source": "test"}'
  ),
  (
    '30000000-0000-0000-0000-000000000923',
    null,
    null,
    '30000000-0000-0000-0000-000000000900',
    'test.platform',
    'system',
    '30000000-0000-0000-0000-000000000900',
    '{"source": "test"}'
  );

select throws_ok(
  $$
    update public.stage_history
    set to_stage = 'ready'
    where id = '33000000-0000-0000-0000-000000000912'
  $$,
  'P0001',
  'stage_history rows are append-only',
  'stage history cannot be updated'
);
select throws_ok(
  $$
    delete from public.stage_history
    where id = '33000000-0000-0000-0000-000000000912'
  $$,
  'P0001',
  'stage_history rows are append-only',
  'stage history cannot be deleted'
);
select throws_ok(
  $$
    update public.audit_log
    set action = 'test.changed'
    where id = '33000000-0000-0000-0000-000000000921'
  $$,
  'P0001',
  'audit_log rows are append-only',
  'audit log cannot be updated'
);
select throws_ok(
  $$
    delete from public.audit_log
    where id = '33000000-0000-0000-0000-000000000921'
  $$,
  'P0001',
  'audit_log rows are append-only',
  'audit log cannot be deleted'
);

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"30000000-0000-0000-0000-000000000111"}';

select is((select count(*)::integer from public.analysis_runs), 1, 'Org One owner sees one own analysis run');
select is((select count(*)::integer from public.plans), 1, 'Org One owner sees one own plan');
select is((select count(*)::integer from public.checklist_items), 1, 'Org One owner sees one own checklist item');
select is((select count(*)::integer from public.checklist_item_state), 1, 'Org One owner sees one own checklist state');
select is((select count(*)::integer from public.stage_history), 1, 'Org One owner sees one own stage row');
select is((select count(*)::integer from public.audit_log), 1, 'Org One owner sees one own audit row');
select is(
  (
    select count(*)::integer
    from public.checklist_templates
    where id in (
      '33000000-0000-0000-0000-000000000601',
      '33000000-0000-0000-0000-000000000602'
    )
  ),
  2,
  'operator can read both analysis-foundation checklist templates'
);
select is(
  (
    select count(*)::integer
    from public.analysis_runs
    where client_id = '44000000-0000-0000-0000-000000000202'
  ),
  0,
  'Org One owner sees no Org Two analysis run'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"30000000-0000-0000-0000-000000000112"}';

select is((select count(*)::integer from public.analysis_runs), 1, 'consumer sees own analysis run');
select is((select count(*)::integer from public.plans), 1, 'consumer sees own plan');
select is(
  (
    select count(*)::integer
    from public.checklist_templates
    where id in (
      '33000000-0000-0000-0000-000000000601',
      '33000000-0000-0000-0000-000000000602'
    )
  ),
  2,
  'consumer can read both analysis-foundation checklist templates'
);
select is((select count(*)::integer from public.audit_log), 1, 'consumer sees own client audit row');
select is(
  (
    select count(*)::integer
    from public.audit_log
    where id = '30000000-0000-0000-0000-000000000923'
  ),
  0,
  'consumer sees no unanchored platform audit row'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"30000000-0000-0000-0000-000000000113"}';

select is((select count(*)::integer from public.analysis_runs), 0, 'affiliate sees no analysis runs');
select is((select count(*)::integer from public.checklist_templates), 0, 'affiliate sees no checklist templates');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"30000000-0000-0000-0000-000000000900"}';

select is(
  (
    select count(*)::integer
    from public.analysis_runs
    where id in (
      '33000000-0000-0000-0000-000000000701',
      '44000000-0000-0000-0000-000000000702'
    )
  ),
  2,
  'platform administrator sees both analysis-foundation runs'
);
select is(
  (
    select count(*)::integer
    from public.audit_log
    where id = '30000000-0000-0000-0000-000000000923'
  ),
  1,
  'platform administrator sees the unanchored platform audit row'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"40000000-0000-0000-0000-000000000222"}';

select is(
  (
    select count(*)::integer
    from public.analysis_runs
    where client_id = '33000000-0000-0000-0000-000000000101'
  ),
  0,
  'Org Two consumer sees no Org One analysis run'
);
select results_eq(
  $$ select client_id from public.analysis_runs order by client_id $$,
  $$ values ('44000000-0000-0000-0000-000000000202'::uuid) $$,
  'Org Two consumer sees exactly the linked analysis run'
);

reset role;

select * from finish();

rollback;
