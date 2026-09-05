begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(16);

-- The three governed prompt families, after migration 435 widened the two closed key sets.

select lives_ok(
  $$ insert into public.prompts (key, version, body) values ('funding-readiness-narrative', 1, 'A narrative prompt body.') $$,
  'the narrative prompt key is allowed on public.prompts'
);
select throws_ok(
  $$ insert into public.prompts (key, version, body) values ('invented-prompt', 1, 'A body.') $$,
  '23514',
  null,
  'the prompt key set stays closed'
);

select lives_ok(
  $$
    insert into public.eval_runs (
      prompt_key, prompt_version, evaluator_key, passed, result,
      policy_version, reference_dataset_hash, driver, model, eligible
    ) values (
      'funding-readiness-narrative', 1, 'narrative.grounding', true, '{"codes": []}'::jsonb,
      'eval-policy-2026-08-17-r2',
      'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      'openrouter', 'openai/gpt-5.6-luna', true
    )
  $$,
  'an evaluation run can name the narrative prompt'
);
select throws_ok(
  $$
    insert into public.eval_runs (
      prompt_key, prompt_version, evaluator_key, passed, result,
      policy_version, reference_dataset_hash, driver, model, eligible
    ) values (
      'invented-prompt', 1, 'narrative.grounding', true, '{"codes": []}'::jsonb,
      'eval-policy-2026-08-17-r2',
      'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      'openrouter', 'openai/gpt-5.6-luna', true
    )
  $$,
  '23514',
  null,
  'the eval-run prompt key set stays closed'
);

-- The activation gate now knows a third required evaluator set. Proving it through the function
-- rather than by reading its source: the narrative version above has no evidence recorded against
-- it yet, so activation must be held rather than granted.

insert into auth.users (id, email)
values ('43500000-0000-4000-8000-000000000011', 'admin@plan-narrative.test');

insert into public.orgs (id, name, slug)
values ('43500000-0000-4000-8000-000000000001', 'Plan Narrative Org', 'plan-narrative-org');

insert into public.profiles (id, role, org_id, full_name, email)
values (
  '43500000-0000-4000-8000-000000000011',
  'platform_admin',
  '43500000-0000-4000-8000-000000000001',
  'Narrative Admin',
  'admin@plan-narrative.test'
)
on conflict (id) do update set role = excluded.role, org_id = excluded.org_id;

select is(
  (
    select decision.status::text
    from public.admin_activate_prompt_version(
      'funding-readiness-narrative',
      1,
      '43500000-0000-4000-8000-000000000011',
      'eval-policy-2026-08-17-r2',
      'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      'openrouter',
      'openai/gpt-5.6-luna'
    ) as decision
  ),
  'held',
  'the narrative prompt is held until its own two evaluators have passing evidence'
);

select throws_ok(
  $$
    select public.admin_activate_prompt_version(
      'invented-prompt', 1, '43500000-0000-4000-8000-000000000011',
      'eval-policy-2026-08-17-r2',
      'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      'openrouter', 'openai/gpt-5.6-luna'
    )
  $$,
  'P0001',
  'ADMIN_PROMPT_INVALID',
  'the activation function still refuses a key outside the set'
);

-- The column, the bound, and the writer.

select has_column('public', 'plans', 'narrative', 'plans carries the narrative column');
select col_is_null('public', 'plans', 'narrative', 'a plan without a narrative is an ordinary plan');

insert into auth.users (id, email)
values ('43500000-0000-4000-8000-000000000012', 'consumer@plan-narrative.test');

insert into public.profiles (id, role, org_id, full_name, email)
values (
  '43500000-0000-4000-8000-000000000012',
  'consumer',
  '43500000-0000-4000-8000-000000000001',
  'Narrative Consumer',
  'consumer@plan-narrative.test'
)
on conflict (id) do update set role = excluded.role, org_id = excluded.org_id;

insert into public.clients (id, org_id, consumer_profile_id, display_name)
values (
  '43500000-0000-4000-8000-000000000101',
  '43500000-0000-4000-8000-000000000001',
  '43500000-0000-4000-8000-000000000012',
  'Narrative Client'
);

insert into public.analysis_runs (id, client_id, trigger, readiness_score, derived)
values (
  '43500000-0000-4000-8000-000000000201',
  '43500000-0000-4000-8000-000000000101',
  'scheduled',
  62,
  '{
    "schemaVersion": 1,
    "bureausPulled": ["EQF"],
    "accounts": [
      {
        "accountRef": "account-one",
        "kind": "revolving",
        "balanceCents": 420000,
        "limitCents": 500000,
        "utilizationPct": 84,
        "ageMonths": 48,
        "isOpen": true,
        "isNegative": false
      }
    ],
    "overallUtilizationPct": 84,
    "inquiriesByBureau": {"EQF": 0, "EXP": 0, "TUC": 0},
    "negativesCount": 0,
    "openRevolvingCount": 1,
    "averageAgeMonths": 48,
    "highestRevolvingLimitCents": 500000,
    "dti": {
      "monthlyDebtPaymentsCents": 50000,
      "statedMonthlyIncomeCents": 500000,
      "ratioPct": 10
    },
    "flags": {
      "utilizationUnder30": false,
      "fourOrMorePersonalAccountsOpen": false,
      "averageAgeTwoYearsOrMore": true,
      "noNegativeItemsReported": true,
      "cardWithTenKLimit": false,
      "twoOrFewerInquiriesEveryBureau": true,
      "thinFile": true
    },
    "computedAt": "2026-09-05T05:00:00Z"
  }'::jsonb
);

insert into public.plans (id, client_id, analysis_run_id, version, body, readiness_score)
values (
  '43500000-0000-4000-8000-000000000301',
  '43500000-0000-4000-8000-000000000101',
  '43500000-0000-4000-8000-000000000201',
  1,
  '{"schemaVersion": 1}'::jsonb,
  62
);

select is(
  public.attach_plan_narrative(
    '43500000-0000-4000-8000-000000000201',
    '{"schemaVersion": 1, "verdict": "Not ready yet. 1 item to fix."}'::jsonb
  ),
  true,
  'the narrative attaches to a plan that exists'
);

select is(
  (select narrative ->> 'verdict' from public.plans where analysis_run_id = '43500000-0000-4000-8000-000000000201'),
  'Not ready yet. 1 item to fix.',
  'the narrative is on the plan row afterwards'
);

-- A re-run of an analysis produces a plan and a narrative that go together. Replacing is the
-- honest outcome; refusing would leave a row describing the previous run.
select is(
  public.attach_plan_narrative(
    '43500000-0000-4000-8000-000000000201',
    '{"schemaVersion": 1, "verdict": "Near Ready. 0 items to fix."}'::jsonb
  ),
  true,
  'a second write replaces rather than refusing'
);
select is(
  (select narrative ->> 'verdict' from public.plans where analysis_run_id = '43500000-0000-4000-8000-000000000201'),
  'Near Ready. 0 items to fix.',
  'the replacement is what the row carries'
);

select is(
  public.attach_plan_narrative(
    '43500000-0000-4000-8000-000000000999',
    '{"schemaVersion": 1}'::jsonb
  ),
  false,
  'a narrative for a plan that was never persisted reports false rather than raising'
);

select throws_ok(
  $$ select public.attach_plan_narrative('43500000-0000-4000-8000-000000000201', '[]'::jsonb) $$,
  'P0001',
  'PLAN_NARRATIVE_INVALID',
  'the narrative has to be an object'
);

select throws_ok(
  $$
    select public.attach_plan_narrative(
      '43500000-0000-4000-8000-000000000201',
      pg_catalog.jsonb_build_object('verdict', pg_catalog.repeat('x', 20000))
    )
  $$,
  'P0001',
  'PLAN_NARRATIVE_INVALID',
  'a narrative past the size bound is refused before it reaches the column'
);

-- The writer is a background worker, not a session, and the grants say so.
select is(
  (
    select pg_catalog.count(*)::integer
    from pg_catalog.pg_proc as routine
    join pg_catalog.pg_namespace as namespace on namespace.oid = routine.pronamespace
    where namespace.nspname = 'public'
      and routine.proname = 'attach_plan_narrative'
      and pg_catalog.has_function_privilege('authenticated', routine.oid, 'execute')
  ),
  0,
  'no session role can attach a narrative'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from pg_catalog.pg_proc as routine
    join pg_catalog.pg_namespace as namespace on namespace.oid = routine.pronamespace
    where namespace.nspname = 'public'
      and routine.proname = 'attach_plan_narrative'
      and pg_catalog.has_function_privilege('service_role', routine.oid, 'execute')
  ),
  1,
  'the service role can'
);

select * from finish();
rollback;
