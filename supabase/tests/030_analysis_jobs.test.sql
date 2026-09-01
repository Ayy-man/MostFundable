begin;

set local search_path = public, extensions;

select plan(64);

select has_table('public', 'analysis_jobs', 'analysis jobs table exists');
select has_type('public', 'analysis_job_status', 'analysis job status enum exists');
select has_type('public', 'analysis_job_source_kind', 'analysis source kind enum exists');
select has_type('public', 'analysis_job_error_code', 'analysis error code enum exists');

select results_eq(
  $$
    select column_name::text collate "C"
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'analysis_jobs'
    order by ordinal_position
  $$,
  $$
    values
      ('id'::text collate "C"),
      ('job'::text collate "C"),
      ('client_id'::text collate "C"),
      ('source_kind'::text collate "C"),
      ('source_id'::text collate "C"),
      ('analysis_run_id'::text collate "C"),
      ('trigger'::text collate "C"),
      ('subject'::text collate "C"),
      ('window'::text collate "C"),
      ('idempotency_key'::text collate "C"),
      ('status'::text collate "C"),
      ('attempt_count'::text collate "C"),
      ('available_at'::text collate "C"),
      ('lease_owner'::text collate "C"),
      ('lease_until'::text collate "C"),
      ('error_code'::text collate "C"),
      ('created_at'::text collate "C"),
      ('updated_at'::text collate "C")
  $$,
  'queue exposes the exact metadata-only column list'
);

select is(
  (
    select count(*)::integer
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'analysis_jobs'
      and (
        data_type in ('json', 'jsonb', 'bytea', 'ARRAY')
        or column_name ~* '^(payload|body|meta|message|content|snapshot|report|tradeline|headers|prompt)'
      )
  ),
  0,
  'queue has no general content-capable column'
);

select results_eq(
  $$
    select enumlabel::text collate "C"
    from pg_enum
    join pg_type on pg_type.oid = pg_enum.enumtypid
    join pg_namespace on pg_namespace.oid = pg_type.typnamespace
    where pg_namespace.nspname = 'public'
      and pg_type.typname = 'analysis_job_status'
    order by enumsortorder
  $$,
  $$
    values
      ('queued'::text collate "C"),
      ('running'::text collate "C"),
      ('persisted'::text collate "C"),
      ('succeeded'::text collate "C"),
      ('failed'::text collate "C"),
      ('cancelled'::text collate "C")
  $$,
  'status enum includes the terminal cancellation state'
);

select results_eq(
  $$
    select enumlabel::text collate "C"
    from pg_enum
    join pg_type on pg_type.oid = pg_enum.enumtypid
    join pg_namespace on pg_namespace.oid = pg_type.typnamespace
    where pg_namespace.nspname = 'public'
      and pg_type.typname = 'analysis_job_source_kind'
    order by enumsortorder
  $$,
  $$
    values
      ('enrollment'::text collate "C"),
      ('monitoring_event'::text collate "C"),
      ('document_upload'::text collate "C"),
      ('force_pull'::text collate "C")
  $$,
  'source kind enum names the four wired source tables'
);

select results_eq(
  $$
    select enumlabel::text collate "C"
    from pg_enum
    join pg_type on pg_type.oid = pg_enum.enumtypid
    join pg_namespace on pg_namespace.oid = pg_type.typnamespace
    where pg_namespace.nspname = 'public'
      and pg_type.typname = 'analysis_job_error_code'
    order by enumsortorder
  $$,
  $$
    values
      ('source_unavailable'::text collate "C"),
      ('pull_failed'::text collate "C"),
      ('plan_rejected'::text collate "C"),
      ('persistence_failed'::text collate "C"),
      ('tracker_failed'::text collate "C"),
      ('configuration_error'::text collate "C"),
      -- R5C-04. Added by migration 378 and admitted here deliberately, because this assertion is a
      -- closed list on purpose: an error code is written into durable job metadata, so a new one is
      -- a new thing we promise never carries bureau content. `pull_indeterminate` is a state label
      -- meaning recovery declined to re-pull rather than risk a second purchase — it names our own
      -- decision and interpolates nothing. Reviewed and admitted, not appended to make a test green.
      ('pull_indeterminate'::text collate "C"),
      -- Added by migration 389, on the same terms. `plan_unavailable` says the plan stage produced
      -- no candidate at all — the provider call failed — as against `plan_rejected`, which now means
      -- only what its name says: a candidate was produced and refused. It labels our own control
      -- flow and carries nothing from a bureau, a report or a model response. The split exists
      -- because one durable value covering both made a production `error_code` unreadable.
      ('plan_unavailable'::text collate "C")
  $$,
  'error codes are a closed metadata-only enum'
);

select is(
  (
    select relation.relrowsecurity and relation.relforcerowsecurity
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'analysis_jobs'
  ),
  true,
  'queue enables and forces row security'
);

select is(
  (
    select count(*)::integer
    from pg_policies
    where schemaname = 'public'
      and tablename = 'analysis_jobs'
  ),
  0,
  'queue has no end-user policy'
);

select is(
  (
    select count(*)::integer
    from pg_indexes
    where schemaname = 'public'
      and indexname in (
        'analysis_jobs_claim_idx',
        'analysis_jobs_client_created_at_idx',
        'analysis_jobs_source_idx',
        'analysis_jobs_source_unique',
        'analysis_jobs_analysis_run_unique',
        'analysis_jobs_idempotency_unique'
      )
  ),
  6,
  'claim, lookup, and uniqueness indexes exist'
);

select is(
  (
    select bool_and(
      function.prosecdef
      and function.proconfig @> array['search_path=""']
    )
    from pg_proc as function
    join pg_namespace as namespace on namespace.oid = function.pronamespace
    where namespace.nspname = 'public'
      and function.proname in (
        'enqueue_analysis_job',
        'claim_analysis_job',
        'persist_analysis_result',
        'finish_analysis_job',
        'fail_analysis_job'
      )
  ),
  true,
  'all queue RPCs are security-definer and fixed-path'
);

select is(
  has_table_privilege('service_role', 'public.analysis_jobs', 'select,insert,update,delete'),
  true,
  'service role has explicit queue table privileges'
);
select is(
  has_table_privilege('anon', 'public.analysis_jobs', 'select'),
  false,
  'anonymous role cannot read queue rows'
);
select is(
  has_table_privilege('authenticated', 'public.analysis_jobs', 'select'),
  false,
  'authenticated role cannot read queue rows'
);
select is(
  has_function_privilege(
    'service_role',
    'public.claim_analysis_job(uuid,integer)',
    'execute'
  ),
  true,
  'service role can execute queue RPCs'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.claim_analysis_job(uuid,integer)',
    'execute'
  ),
  false,
  'authenticated role cannot execute queue RPCs'
);

select matches(
  pg_get_functiondef('public.claim_analysis_job(uuid,integer)'::regprocedure),
  '(?i)for update skip locked',
  'claim uses row locking with skip-locked concurrency semantics'
);

select throws_ok(
  $$
    select *
    from public.claim_analysis_job(
      '53000000-0000-0000-0000-000000000999',
      null::integer
    )
  $$,
  'P0001',
  'ANALYSIS_LEASE_INVALID',
  'claim rejects a missing lease bound with fixed metadata'
);

insert into auth.users (id, email)
values
  ('53000000-0000-0000-0000-000000000011', 'owner.one@analysis-jobs.example'),
  ('53000000-0000-0000-0000-000000000012', 'consumer.one@analysis-jobs.example'),
  ('54000000-0000-0000-0000-000000000021', 'owner.two@analysis-jobs.example'),
  ('54000000-0000-0000-0000-000000000022', 'consumer.two@analysis-jobs.example');

insert into public.orgs (id, name, slug)
values
  ('53000000-0000-0000-0000-000000000001', 'Analysis Job Org One', 'analysis-job-org-one'),
  ('54000000-0000-0000-0000-000000000002', 'Analysis Job Org Two', 'analysis-job-org-two');

insert into public.profiles (id, role, org_id, org_role, full_name, email)
values
  (
    '53000000-0000-0000-0000-000000000011',
    'operator_member',
    '53000000-0000-0000-0000-000000000001',
    'owner',
    'Analysis Job Owner One',
    'owner.one@analysis-jobs.example'
  ),
  (
    '53000000-0000-0000-0000-000000000012',
    'consumer',
    '53000000-0000-0000-0000-000000000001',
    null,
    'Analysis Job Consumer One',
    'consumer.one@analysis-jobs.example'
  ),
  (
    '54000000-0000-0000-0000-000000000021',
    'operator_member',
    '54000000-0000-0000-0000-000000000002',
    'owner',
    'Analysis Job Owner Two',
    'owner.two@analysis-jobs.example'
  ),
  (
    '54000000-0000-0000-0000-000000000022',
    'consumer',
    '54000000-0000-0000-0000-000000000002',
    null,
    'Analysis Job Consumer Two',
    'consumer.two@analysis-jobs.example'
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

insert into public.clients (id, org_id, consumer_profile_id, display_name, assigned_to)
values
  (
    '53000000-0000-0000-0000-000000000101',
    '53000000-0000-0000-0000-000000000001',
    '53000000-0000-0000-0000-000000000012',
    'Analysis Job Client One',
    '53000000-0000-0000-0000-000000000011'
  ),
  (
    '54000000-0000-0000-0000-000000000202',
    '54000000-0000-0000-0000-000000000002',
    '54000000-0000-0000-0000-000000000022',
    'Analysis Job Client Two',
    '54000000-0000-0000-0000-000000000021'
  );

insert into public.consents (
  id,
  client_id,
  kind,
  text_version,
  signed_at,
  ip,
  esig_ref
)
values
  (
    '53000000-0000-0000-0000-000000000301',
    '53000000-0000-0000-0000-000000000101',
    'monitoring',
    'analysis-jobs-v1',
    '2026-08-16T01:00:00Z',
    '192.0.2.10',
    'analysis-jobs-esig'
  ),
  (
    '53000000-0000-0000-0000-000000000302',
    '53000000-0000-0000-0000-000000000101',
    'analysis',
    'analysis-jobs-v1',
    '2026-08-16T01:00:00Z',
    '192.0.2.10',
    'analysis-jobs-esig'
  );

insert into public.enrollments (
  id,
  client_id,
  crs_member_ref,
  status,
  monitoring_consent_at,
  analysis_consent_at,
  esig_doc_id,
  idpass
)
values (
  '53000000-0000-0000-0000-000000000401',
  '53000000-0000-0000-0000-000000000101',
  'mock_analysis_job_member',
  'active',
  '2026-08-16T01:00:00Z',
  '2026-08-16T01:00:00Z',
  'analysis-jobs-esig',
  true
);

-- 2026-08-17 R3C-03: an active enrollment and consent still fail closed
-- until exact paid-subscription evidence exists.
select is(
  public.analysis_is_authorized('53000000-0000-0000-0000-000000000101'),
  false,
  'analysis remains unauthorized without an active subscription'
);
insert into public.consumer_subscriptions (
  id, client_id, enrollment_id, provider, customer_ref, subscription_ref,
  price_cents, status, idempotency_key
)
values (
  '53000000-0000-0000-0000-000000000402',
  '53000000-0000-0000-0000-000000000101',
  '53000000-0000-0000-0000-000000000401',
  'mock', 'mock_analysis_job_customer', 'mock_analysis_job_subscription',
  1900, 'active', 'analysis-jobs-active-subscription'
);

insert into public.monitoring_events (id, client_id, event_type, occurred_at, received_at)
values
  (
    '53000000-0000-0000-0000-000000000501',
    '53000000-0000-0000-0000-000000000101',
    'ACCALERT',
    '2026-08-16T01:01:00Z',
    '2026-08-16T01:01:01Z'
  ),
  (
    '53000000-0000-0000-0000-000000000502',
    '53000000-0000-0000-0000-000000000101',
    'REPORTREF',
    '2026-08-16T01:02:00Z',
    '2026-08-16T01:02:01Z'
  ),
  (
    '53000000-0000-0000-0000-000000000503',
    '53000000-0000-0000-0000-000000000101',
    'SCOREREF',
    '2026-08-16T01:03:00Z',
    '2026-08-16T01:03:01Z'
  ),
  (
    '53000000-0000-0000-0000-000000000504',
    '53000000-0000-0000-0000-000000000101',
    'ACCNEW',
    '2026-08-16T01:04:00Z',
    '2026-08-16T01:04:01Z'
  ),
  (
    '54000000-0000-0000-0000-000000000505',
    '54000000-0000-0000-0000-000000000202',
    'ACCALERT',
    '2026-08-16T01:05:00Z',
    '2026-08-16T01:05:01Z'
  );

select throws_ok(
  $$
    insert into public.analysis_jobs (
      client_id,
      source_kind,
      source_id,
      trigger,
      status,
      error_code
    ) values (
      '53000000-0000-0000-0000-000000000101',
      'monitoring_event',
      '53000000-0000-0000-0000-000000000503',
      'alert',
      'failed',
      null
    )
  $$,
  '23514',
  null,
  'failed queue state requires a fixed error code'
);

create temporary table test_analysis_values (
  derived jsonb not null,
  no_hit jsonb not null,
  plan_body jsonb not null
) on commit drop;

insert into test_analysis_values (derived, no_hit, plan_body)
values (
  '{
    "schemaVersion": 1,
    "bureausPulled": ["EQF", "EXP", "TUC"],
    "accounts": [{
      "accountRef": "account-one",
      "kind": "revolving",
      "balanceCents": 25000,
      "limitCents": 100000,
      "utilizationPct": 25,
      "ageMonths": 36,
      "isOpen": true,
      "isNegative": false
    }],
    "overallUtilizationPct": 25,
    "inquiriesByBureau": {"EQF": 1, "EXP": 1, "TUC": 0},
    "negativesCount": 0,
    "openRevolvingCount": 1,
    "averageAgeMonths": 36,
    "highestRevolvingLimitCents": 100000,
    "dti": {
      "monthlyDebtPaymentsCents": 50000,
      "statedMonthlyIncomeCents": null,
      "ratioPct": null
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
    "computedAt": "2026-08-16T01:10:00.000Z"
  }'::jsonb,
  '{
    "schemaVersion": 1,
    "bureausPulled": [],
    "accounts": [],
    "overallUtilizationPct": null,
    "inquiriesByBureau": {"EQF": 0, "EXP": 0, "TUC": 0},
    "negativesCount": 0,
    "openRevolvingCount": 0,
    "averageAgeMonths": null,
    "highestRevolvingLimitCents": null,
    "dti": {
      "monthlyDebtPaymentsCents": 0,
      "statedMonthlyIncomeCents": null,
      "ratioPct": null
    },
    "flags": {
      "utilizationUnder30": false,
      "fourOrMorePersonalAccountsOpen": false,
      "averageAgeTwoYearsOrMore": false,
      "noNegativeItemsReported": false,
      "cardWithTenKLimit": false,
      "twoOrFewerInquiriesEveryBureau": false,
      "thinFile": true
    },
    "computedAt": "2026-08-16T01:10:00.000Z"
  }'::jsonb,
  '{"schemaVersion": 1, "readinessScore": 50}'::jsonb
);

select throws_ok(
  $$
    select *
    from public.enqueue_analysis_job(
      '54000000-0000-0000-0000-000000000202',
      'monitoring_event',
      '53000000-0000-0000-0000-000000000501',
      'alert'
    )
  $$,
  'P0001',
  'ANALYSIS_NOT_AUTHORIZED',
  'an unauthorized cross-client source enqueue fails closed'
);

create temporary table first_enqueue on commit drop as
select *
from public.enqueue_analysis_job(
  '53000000-0000-0000-0000-000000000101',
  'enrollment',
  '53000000-0000-0000-0000-000000000401',
  'scheduled'
);

create temporary table duplicate_enqueue on commit drop as
select *
from public.enqueue_analysis_job(
  '53000000-0000-0000-0000-000000000101',
  'enrollment',
  '53000000-0000-0000-0000-000000000401',
  'scheduled'
);

select is(
  (select count(*)::integer from first_enqueue),
  1,
  'first source enqueue returns one row'
);
select results_eq(
  $$ select id, analysis_run_id from first_enqueue $$,
  $$ select id, analysis_run_id from duplicate_enqueue $$,
  'independent duplicate enqueue returns the original job and run UUID'
);
select is(
  (
    select idempotency_key
    from first_enqueue
  ),
  (
    select
      'analysis.run|client:' || client_id::text || '|run:' || analysis_run_id::text
    from first_enqueue
  ),
  'stored idempotency key is the exact job subject window serialization'
);
select is(
  (
    select count(*)::integer
    from public.analysis_jobs
    where source_kind = 'enrollment'
      and source_id = '53000000-0000-0000-0000-000000000401'
  ),
  1,
  'duplicate source tuple stores one queue row'
);
select is(
  (
    select count(*)::integer
    from public.audit_log
    where subject_id = (select id from first_enqueue)
      and action = 'analysis_job.transition'
      and subject_type = 'analysis_job'
      and client_id = '53000000-0000-0000-0000-000000000101'
      and org_id is null
      and actor_profile_id is null
      and meta = '{
        "job": "analysis.run",
        "from_state": "absent",
        "to_state": "queued"
      }'::jsonb
  ),
  1,
  'first enqueue appends one exact metadata-only transition audit row'
);
select results_eq(
  $$
    select key::text collate "C"
    from public.audit_log,
      lateral jsonb_object_keys(meta) as key
    where subject_id = (select id from first_enqueue)
    order by key
  $$,
  $$
    values
      ('from_state'::text collate "C"),
      ('job'::text collate "C"),
      ('to_state'::text collate "C")
  $$,
  'queue audit metadata has exactly three allowed keys'
);

insert into public.analysis_jobs (client_id, source_kind, source_id, trigger, available_at)
values
  (
    '53000000-0000-0000-0000-000000000101',
    'monitoring_event',
    '53000000-0000-0000-0000-000000000501',
    'alert',
    now() + interval '1 hour'
  ),
  (
    '53000000-0000-0000-0000-000000000101',
    'monitoring_event',
    '53000000-0000-0000-0000-000000000502',
    'alert',
    now() + interval '1 hour'
  );

update public.analysis_jobs
set available_at = now() - interval '2 minutes'
where id = (select id from first_enqueue);

create temporary table first_claim on commit drop as
select *
from public.claim_analysis_job(
  '53000000-0000-0000-0000-000000000901',
  60
);

select is((select status::text from first_claim), 'running', 'queued job claims as running');
select is((select attempt_count from first_claim), 1, 'first claim increments attempt count');
select is(
  (
    select count(*)::integer
    from public.audit_log
    where subject_id = (select id from first_claim)
      and meta = '{
        "job": "analysis.run",
        "from_state": "queued",
        "to_state": "running"
      }'::jsonb
  ),
  1,
  'queued claim appends one queued to running transition'
);

update public.analysis_jobs
set available_at = now() - interval '1 minute'
where source_id = '53000000-0000-0000-0000-000000000501';

create temporary table second_claim on commit drop as
select *
from public.claim_analysis_job(
  '53000000-0000-0000-0000-000000000902',
  60
);

select isnt(
  (select id from first_claim),
  (select id from second_claim),
  'a second consumer cannot receive the active leased row'
);

update public.analysis_jobs
set lease_until = now() - interval '1 second'
where id = (select id from first_claim);
update public.analysis_jobs
set available_at = now() + interval '1 hour'
where id <> (select id from first_claim)
  and status in ('queued', 'running', 'persisted');

create temporary table recovered_claim on commit drop as
select *
from public.claim_analysis_job(
  '53000000-0000-0000-0000-000000000903',
  60
);

select is((select id from recovered_claim), (select id from first_claim), 'expired lease recovers the same job');
select is((select attempt_count from recovered_claim), 2, 'lease recovery increments attempt count');
select is(
  (
    select count(*)::integer
    from public.audit_log
    where subject_id = (select id from first_claim)
      and meta ->> 'to_state' = 'running'
  ),
  1,
  'same-state lease recovery appends no transition audit row'
);

select throws_ok(
  $$
    select *
    from public.persist_analysis_result(
      (select id from recovered_claim),
      '53000000-0000-0000-0000-000000000999',
      (select client_id from recovered_claim),
      (select analysis_run_id from recovered_claim),
      50,
      (select derived from test_analysis_values),
      1,
      (select plan_body from test_analysis_values)
    )
  $$,
  'P0001',
  'ANALYSIS_LEASE_MISMATCH',
  'wrong worker cannot persist a claimed result'
);

select throws_ok(
  $$
    select *
    from public.persist_analysis_result(
      (select id from recovered_claim),
      '53000000-0000-0000-0000-000000000903',
      '54000000-0000-0000-0000-000000000202',
      (select analysis_run_id from recovered_claim),
      50,
      (select derived from test_analysis_values),
      1,
      (select plan_body from test_analysis_values)
    )
  $$,
  'P0001',
  'ANALYSIS_LEASE_MISMATCH',
  'cross-client result persistence fails closed'
);

select throws_ok(
  $$
    select *
    from public.persist_analysis_result(
      (select id from recovered_claim),
      '53000000-0000-0000-0000-000000000903',
      (select client_id from recovered_claim),
      (select analysis_run_id from recovered_claim),
      50,
      (select derived || '{"extra": true}'::jsonb from test_analysis_values),
      1,
      (select plan_body from test_analysis_values)
    )
  $$,
  'P0001',
  'ANALYSIS_RESULT_INVALID',
  'Phase 1 derived validator rejects an invalid result'
);

create temporary table persisted_result on commit drop as
select *
from public.persist_analysis_result(
  (select id from recovered_claim),
  '53000000-0000-0000-0000-000000000903',
  (select client_id from recovered_claim),
  (select analysis_run_id from recovered_claim),
  50,
  (select derived from test_analysis_values),
  1,
  (select plan_body from test_analysis_values)
);

select is((select status::text from persisted_result), 'persisted', 'atomic result persistence marks the job persisted');
select is(
  (
    select count(*)::integer
    from public.analysis_runs
    where id = (select analysis_run_id from recovered_claim)
  ),
  1,
  'result persistence writes one stable analysis run'
);
select is(
  (
    select count(*)::integer
    from public.plans
    where analysis_run_id = (select analysis_run_id from recovered_claim)
  ),
  1,
  'result persistence writes at most one plan'
);

select lives_ok(
  $$
    select *
    from public.persist_analysis_result(
      (select id from persisted_result),
      '53000000-0000-0000-0000-000000000903',
      (select client_id from persisted_result),
      (select analysis_run_id from persisted_result),
      50,
      (select derived from test_analysis_values),
      1,
      (select plan_body from test_analysis_values)
    )
  $$,
  'equal replay is an idempotent no-op'
);
select is(
  (
    select count(*)::integer
    from public.audit_log
    where subject_id = (select id from persisted_result)
      and meta ->> 'to_state' = 'persisted'
  ),
  1,
  'equal replay appends no duplicate persisted audit row'
);

select throws_ok(
  $$
    select *
    from public.persist_analysis_result(
      (select id from persisted_result),
      '53000000-0000-0000-0000-000000000903',
      (select client_id from persisted_result),
      (select analysis_run_id from persisted_result),
      51,
      (select derived from test_analysis_values),
      1,
      '{"schemaVersion": 1, "readinessScore": 51}'::jsonb
    )
  $$,
  'P0001',
  'ANALYSIS_RESULT_MISMATCH',
  'mismatched replay fails closed'
);

select lives_ok(
  $$
    select *
    from public.fail_analysis_job(
      (select id from persisted_result),
      '53000000-0000-0000-0000-000000000903',
      'tracker_failed',
      true,
      0
    )
  $$,
  'retryable tracker failure preserves the persisted checkpoint'
);
select is(
  (
    select status::text
    from public.analysis_jobs
    where id = (select id from persisted_result)
  ),
  'persisted',
  'tracker retry does not return a persisted job to generation'
);
select is(
  (
    select count(*)::integer
    from public.audit_log
    where subject_id = (select id from persisted_result)
      and meta ->> 'to_state' = 'persisted'
  ),
  1,
  'persisted retry scheduling appends no same-state audit row'
);

update public.analysis_jobs
set available_at = now() + interval '1 hour'
where id <> (select id from persisted_result)
  and status in ('queued', 'running', 'persisted');
update public.analysis_jobs
set available_at = now() - interval '1 second'
where id = (select id from persisted_result);

create temporary table persisted_reclaim on commit drop as
select *
from public.claim_analysis_job(
  '53000000-0000-0000-0000-000000000906',
  60
);

select is(
  (select id from persisted_reclaim),
  (select id from persisted_result),
  'persisted tracker retry reclaims the stable job'
);
select is(
  (select status::text from persisted_reclaim),
  'persisted',
  'persisted reclaim skips the generation state'
);

select lives_ok(
  $$
    select *
    from public.finish_analysis_job(
      (select id from persisted_result),
      '53000000-0000-0000-0000-000000000906'
    )
  $$,
  'lease owner can finish a persisted job'
);
select is(
  (
    select status::text
    from public.analysis_jobs
    where id = (select id from persisted_result)
  ),
  'succeeded',
  'finish moves persisted job to succeeded'
);
select is(
  (
    select count(*)::integer
    from public.audit_log
    where subject_id = (select id from persisted_result)
      and action = 'analysis_job.transition'
  ),
  4,
  'completed job has exactly one audit row per real status change'
);

update public.analysis_jobs
set available_at = now() - interval '1 minute'
where source_id = '53000000-0000-0000-0000-000000000502';

create temporary table no_hit_claim on commit drop as
select *
from public.claim_analysis_job(
  '53000000-0000-0000-0000-000000000904',
  60
);

select throws_ok(
  $$
    select *
    from public.persist_analysis_result(
      (select id from no_hit_claim),
      '53000000-0000-0000-0000-000000000904',
      (select client_id from no_hit_claim),
      (select analysis_run_id from no_hit_claim),
      50,
      (select derived from test_analysis_values),
      null,
      null
    )
  $$,
  'P0001',
  'ANALYSIS_RESULT_INVALID',
  'a non-no-hit result cannot omit its plan'
);

select lives_ok(
  $$
    select *
    from public.persist_analysis_result(
      (select id from no_hit_claim),
      '53000000-0000-0000-0000-000000000904',
      (select client_id from no_hit_claim),
      (select analysis_run_id from no_hit_claim),
      0,
      (select no_hit from test_analysis_values),
      null,
      null
    )
  $$,
  'valid no-hit result persists without a plan'
);
select is(
  (
    select count(*)::integer
    from public.plans
    where analysis_run_id = (select analysis_run_id from no_hit_claim)
  ),
  0,
  'no-hit result creates no plan row'
);

update public.analysis_jobs
set available_at = now() - interval '1 minute'
where source_id = '53000000-0000-0000-0000-000000000501';

select lives_ok(
  $$
    select *
    from public.fail_analysis_job(
      (select id from second_claim),
      '53000000-0000-0000-0000-000000000902',
      'pull_failed',
      true,
      0
    )
  $$,
  'retryable running failure returns the job to queued'
);
select is(
  (
    select status::text
    from public.analysis_jobs
    where id = (select id from second_claim)
  ),
  'queued',
  'retryable running failure records queued state'
);

update public.analysis_jobs
set available_at = now() + interval '1 hour'
where id <> (select id from second_claim)
  and status in ('queued', 'running', 'persisted');
update public.analysis_jobs
set available_at = now() - interval '1 second'
where id = (select id from second_claim);

create temporary table retry_claim on commit drop as
select *
from public.claim_analysis_job(
  '53000000-0000-0000-0000-000000000905',
  60
);

select lives_ok(
  $$
    select *
    from public.fail_analysis_job(
      (select id from retry_claim),
      '53000000-0000-0000-0000-000000000905',
      'pull_failed',
      false,
      0
    )
  $$,
  'final fixed-code failure is accepted'
);
select is(
  (
    select status::text
    from public.analysis_jobs
    where id = (select id from retry_claim)
  ),
  'failed',
  'final failure moves the job to failed'
);

select throws_ok(
  $$
    update public.audit_log
    set action = 'analysis_job.changed'
    where subject_id = (select id from first_enqueue)
  $$,
  'P0001',
  'audit_log rows are append-only',
  'queue audit rows remain append-only on update'
);
select throws_ok(
  $$
    delete from public.audit_log
    where subject_id = (select id from first_enqueue)
  $$,
  'P0001',
  'audit_log rows are append-only',
  'queue audit rows remain append-only on delete'
);

set local role anon;
select throws_ok(
  $$ select count(*) from public.analysis_jobs $$,
  '42501',
  null,
  'anonymous role cannot query queue table'
);
select throws_ok(
  $$
    select *
    from public.claim_analysis_job(
      '53000000-0000-0000-0000-000000000999',
      60
    )
  $$,
  '42501',
  null,
  'anonymous role cannot call queue functions'
);
reset role;

select * from finish();
rollback;
