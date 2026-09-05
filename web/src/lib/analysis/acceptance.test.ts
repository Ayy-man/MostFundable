import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { CRS_BUREAU_CODES, CRS_REPORT_CODE_BY_BUREAU } from '../crs/constants.ts';
import { createCrsAlertPointerCodec } from '../crs/alert-pointer.ts';
import { createMockAdapter } from '../crs/mock/driver.ts';
import {
  createFixedClock,
  createInMemoryMemberRefResolver,
  createInMemoryMonitoringEventStore,
} from '../crs/ports.ts';
import { handleCrsWebhook } from '../crs/webhook-handler.ts';
import { scheduleAnalysisFanOut } from '../crs/wiring.ts';
import {
  ACTION_DURATIONS_V1,
  BUSINESS_CHECKLIST_V1,
  PERSONAL_CHECKLIST_V1,
} from '../llm/checklist-seeds.ts';
import { getPlanDriver } from '../llm/driver.ts';
import { evaluatePlan } from '../llm/evaluator.ts';
import { deriveReadinessPlan } from '../llm/mock-driver.ts';
import {
  createOpenRouterPlanDriver,
  OPENROUTER_MODEL,
} from '../llm/openrouter-driver.ts';
import { extractFeatures } from './features.ts';
import { createMockNarrativeDriver } from '../llm/narrative/driver.ts';
import { NARRATIVE_REFERENCE_DATASET } from '../llm/narrative/reference-pack.ts';
import { createInMemoryAnalysisRepository } from './repository.ts';
import {
  drainAnalysisQueue,
  enqueueAnalysisRun,
  onEnrollmentSucceeded,
} from './worker.ts';

import type { Clock } from '../crs/ports.ts';
import type { CrsAdapter, CrsMemberRef, CrsPersona, ReportCode } from '../crs/types.ts';
import type { CrsWebhookConfig } from '../crs/webhook.ts';
import type { AnalysisFanOutDependencies } from '../crs/wiring.ts';
import type { FundingReadinessPlanV1, PlanDriver } from '../llm/types.ts';
import type {
  AnalysisCompletedInput,
  AnalysisJob,
  AnalysisRepository,
  AnalysisStageTracker,
  PersistAnalysisResultInput,
} from './ports.ts';
import type { InMemoryAnalysisRepository } from './repository.ts';

const POINTER_CODEC = createCrsAlertPointerCodec('not-a-real-pointer-secret-at-least-32-bytes');

const CLIENT_ID = '56000000-0000-4000-8000-000000000101';
const ENROLLMENT_ID = '56000000-0000-4000-8000-000000000201';
const WORKER_ID = '56000000-0000-4000-8000-000000000901';
const INSTANT = '2026-08-16T12:00:00.000Z';
const ENABLED = { FEATURE_ANALYSIS: 'true' };
const SOURCE_CANARY = 'mock-subject-clean';
const ALL_REPORT_CODES: ReportCode[] = CRS_BUREAU_CODES.map(
  (bureau) => CRS_REPORT_CODE_BY_BUREAU[bureau],
);

const WEBHOOK_CONFIG: CrsWebhookConfig = {
  basicUser: 'not-a-real-user',
  basicPass: 'not-a-real-pass',
  hmacSecret: null,
  hmacHeader: 'x-crs-signature',
  sourceIps: [],
};

const REQUIREMENT_MATRIX = {
  'PIPE-01': 'derog persona and stable account-state assertions',
  'PIPE-02': 'clean score and incomplete-label assertions',
  'PIPE-03': 'contained negative fixture rejection before persistence',
  'PIPE-04': 'no-report scanner owner plus source-canary matrix',
  'PIPE-05': 'source dispatch, queue, result, and tracker replay matrix',
  'PIPE-06': 'complete state registries and marker assertions',
  'PIPE-07': 'exhaustive unknown-duration registry assertions',
  'PIPE-08': 'direct extraction and derived-only request/persistence capture',
} as const;

const ROADMAP_CRITERIA = [
  {
    criterion: "enrolling the 'derog' persona yields a plan with per-account utilization subtasks and readiness < 100",
    owner: 'acceptance persona matrix',
    integration: 'lane B call pending',
  },
  {
    criterion: "'clean' persona ≥ near-Ready",
    owner: 'acceptance persona matrix',
    integration: 'none',
  },
  {
    criterion: 'forbidden-vocabulary evaluator blocks a poisoned prompt fixture',
    owner: 'contained fixture acceptance row and compliance gate',
    integration: 'none',
  },
  {
    criterion: 'raw-payload grep gate green',
    owner: 'no-report scanner',
    integration: 'merge gate rerun',
  },
  {
    criterion: 're-run is idempotent',
    owner: 'acceptance replay matrix and pgTAP 030',
    integration: 'lane B call pending',
  },
] as const;

function memberRef(persona: CrsPersona): CrsMemberRef {
  return `mock_${persona}_000001` as CrsMemberRef;
}

interface MutableClock extends Clock {
  advance(milliseconds: number): void;
}

function mutableClock(): MutableClock {
  let current = Date.parse(INSTANT);
  return {
    now: () => new Date(current),
    advance(milliseconds) {
      current += milliseconds;
    },
  };
}

function candidateResponse(value: unknown): Response {
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(value) } }],
  }), { status: 200 });
}

function scriptedOpenRouter(capturedRequests: string[]): PlanDriver {
  const transport = (async (_url: string | URL | Request, init?: RequestInit) => {
    const requestText = String(init?.body);
    capturedRequests.push(requestText);
    const request = JSON.parse(requestText) as {
      response_format: { json_schema: { name: string } };
      messages: Array<{ content: string }>;
    };
    const user = JSON.parse(request.messages[1].content) as {
      derived: PersistAnalysisResultInput['derived'];
    };
    if (request.response_format.json_schema.name === 'funding_readiness_plan_v1') {
      const plan = deriveReadinessPlan(user.derived);
      return candidateResponse({
        ...plan,
        generation: {
          driver: 'openrouter',
          model: OPENROUTER_MODEL,
          promptVersion: 1,
        },
      });
    }
    return candidateResponse({ approved: true, codes: [] });
  }) as typeof fetch;
  return createOpenRouterPlanDriver({
    apiKey: 'not-a-real-openrouter-key',
    fetch: transport,
  });
}

interface CaptureRepository {
  repository: AnalysisRepository;
  persisted: PersistAnalysisResultInput[];
}

function capturePersistence(inner: InMemoryAnalysisRepository): CaptureRepository {
  const persisted: PersistAnalysisResultInput[] = [];
  return {
    repository: {
      enqueue: (input) => inner.enqueue(input),
      claim: (input) => inner.claim(input),
      claimTarget: (input) => inner.claimTarget(input),
      async persistResult(input) {
        persisted.push(structuredClone(input));
        return inner.persistResult(input);
      },
      finish: (input) => inner.finish(input),
      fail: (input) => inner.fail(input),
      isAuthorized: (clientId) => inner.isAuthorized(clientId),
      loadEnrollmentMemberRef: (clientId) => inner.loadEnrollmentMemberRef(clientId),
      loadPersistedRun: (clientId, analysisRunId) =>
        inner.loadPersistedRun(clientId, analysisRunId),
      // R5C-04. The pre-call record for the provider fan-out (`crs_pull_operations`).
      beginPullOperation: (input) => inner.beginPullOperation(input),
      recordPullReturned: (input) => inner.recordPullReturned(input),
      markPullIndeterminate: (input) => inner.markPullIndeterminate(input),
      attachNarrative: (input) => inner.attachNarrative(input),
    },
    persisted,
  };
}

function tracker(options: { failOnce?: boolean } = {}) {
  const calls: AnalysisCompletedInput[] = [];
  let fail = options.failOnce ?? false;
  const port: AnalysisStageTracker = {
    async recordAnalysisCompleted(input) {
      calls.push({ ...input });
      if (fail) {
        fail = false;
        throw new Error('fixed acceptance interruption');
      }
    },
  };
  return { port, calls };
}

interface PersonaOutcome {
  driver: 'mock' | 'openrouter';
  job: AnalysisJob;
  repository: InMemoryAnalysisRepository;
  persisted: PersistAnalysisResultInput;
  trackerCalls: AnalysisCompletedInput[];
  providerRequests: string[];
  pulls: number;
}

async function runPersona(persona: CrsPersona, driverName: 'mock' | 'openrouter'): Promise<PersonaOutcome> {
  const clock = createFixedClock(INSTANT);
  const inner = createInMemoryAnalysisRepository({
    clock,
    enrollments: { [CLIENT_ID]: memberRef(persona) },
  });
  const capture = capturePersistence(inner);
  const tracked = tracker();
  const providerRequests: string[] = [];
  const driver = driverName === 'mock' ? getPlanDriver() : scriptedOpenRouter(providerRequests);
  const adapter = createMockAdapter({ clock, webhookConfig: WEBHOOK_CONFIG });
  let pulls = 0;
  const countedAdapter: CrsAdapter = {
    ...adapter,
    async softPull(_memberRef, reportCodes) {
      pulls += 1;
      return adapter.softPull(memberRef(persona), reportCodes);
    },
  };
  const first = await onEnrollmentSucceeded(
    { clientId: CLIENT_ID, enrollmentId: ENROLLMENT_ID },
    { env: ENABLED, repository: capture.repository },
  );
  const duplicate = await onEnrollmentSucceeded(
    { clientId: CLIENT_ID, enrollmentId: ENROLLMENT_ID },
    { env: ENABLED, repository: capture.repository },
  );
  assert.ok(first);
  assert.deepEqual(first, duplicate);
  assert.deepEqual(
    await drainAnalysisQueue(
      { maxJobs: 1, workerId: WORKER_ID },
      {
        env: ENABLED,
        repository: capture.repository,
        tracker: tracked.port,
        getAdapter: () => countedAdapter,
        getDriver: () => driver,
        // The narrative runs on every successful analysis, so the acceptance path has to carry it
        // or the surfaces below are not the surfaces production produces. The pack is hand-built
        // from the contract types, which is also what makes the canary assertion meaningful: no
        // value in it came from the provider's report at all.
        getNarrativeDriver: createMockNarrativeDriver,
        buildFactsPack: () => NARRATIVE_REFERENCE_DATASET[0],
      },
    ),
    { claimed: 1, succeeded: 1, failed: 0 },
  );
  assert.equal(capture.persisted.length, 1);
  return {
    driver: driverName,
    job: inner.readJobs()[0],
    repository: inner,
    persisted: capture.persisted[0],
    trackerCalls: tracked.calls,
    providerRequests,
    pulls,
  };
}

function normalizedPlan(input: PersistAnalysisResultInput) {
  if (input.plan === null) return null;
  const plan: Partial<FundingReadinessPlanV1> = structuredClone(input.plan);
  delete plan.generation;
  return plan;
}

describe('Phase 5 contract registry', () => {
  it('maps every PIPE requirement and every verbatim roadmap criterion to an owner', () => {
    assert.deepEqual(Object.keys(REQUIREMENT_MATRIX), [
      'PIPE-01',
      'PIPE-02',
      'PIPE-03',
      'PIPE-04',
      'PIPE-05',
      'PIPE-06',
      'PIPE-07',
      'PIPE-08',
    ]);
    assert.equal(Object.values(REQUIREMENT_MATRIX).every((owner) => owner.length > 0), true);
    assert.equal(ROADMAP_CRITERIA.length, 5);
    assert.equal(ROADMAP_CRITERIA.every((row) => row.owner.length > 0), true);
    assert.equal(
      ROADMAP_CRITERIA.filter((row) => row.integration === 'lane B call pending').length,
      2,
    );
  });
});

describe('Phase 5 persona and driver matrix', () => {
  const personas: readonly CrsPersona[] = ['clean', 'derog', 'thin_file', 'no_hit'];
  const drivers = ['mock', 'openrouter'] as const;

  for (const persona of personas) {
    it(`keeps ${persona} deterministic and locally equivalent across both drivers`, async () => {
      const outcomes = await Promise.all(drivers.map((driver) => runPersona(persona, driver)));
      const [mock, openrouter] = outcomes;
      assert.deepEqual(mock.persisted.derived, openrouter.persisted.derived);
      assert.equal(mock.persisted.readinessScore, openrouter.persisted.readinessScore);
      assert.deepEqual(normalizedPlan(mock.persisted), normalizedPlan(openrouter.persisted));
      assert.equal(mock.repository.readJobs().length, 1);
      assert.equal(openrouter.repository.readJobs().length, 1);
      assert.equal(mock.repository.readRuns().length, 1);
      assert.equal(openrouter.repository.readRuns().length, 1);
      assert.equal(mock.trackerCalls.length, 1);
      assert.equal(openrouter.trackerCalls.length, 1);
      assert.equal(mock.job.idempotencyKey, `analysis.run|client:${CLIENT_ID}|run:${mock.job.analysisRunId}`);

      if (persona === 'derog') {
        assert.ok(mock.persisted.plan);
        assert.equal(mock.persisted.plan.readinessScore, 33);
        assert.equal(mock.persisted.plan.readinessScore < 100, true);
        assert.deepEqual(
          mock.persisted.plan.personalChecklist[2].children.map((child) => ({
            accountRef: child.accountRef,
            observedUtilizationPct: child.observedUtilizationPct,
          })),
          [
            { accountRef: 'account-1', observedUtilizationPct: 92.9 },
            { accountRef: 'account-2', observedUtilizationPct: 92.8 },
            { accountRef: 'account-3', observedUtilizationPct: 64.7 },
            { accountRef: 'account-4', observedUtilizationPct: 86.7 },
          ],
        );
      }
      if (persona === 'clean') {
        assert.ok(mock.persisted.plan);
        assert.equal(mock.persisted.plan.readinessScore, 99);
        assert.equal(mock.persisted.plan.readinessLabel, 'Near Ready');
        assert.equal(openrouter.providerRequests.length, 2);
      }
      if (persona === 'thin_file') {
        assert.ok(mock.persisted.plan);
        const states = new Map(
          mock.persisted.plan.personalChecklist.map((state) => [state.key, state.state]),
        );
        assert.equal(states.get('four_personal_accounts_open'), 'unverified');
        assert.equal(states.get('average_age_two_years'), 'unverified');
        assert.equal(states.get('personal_card_ten_k_limit'), 'unverified');
      }
      if (persona === 'no_hit') {
        assert.equal(mock.persisted.readinessScore, 0);
        assert.equal(mock.persisted.plan, null);
        assert.deepEqual(mock.persisted.derived.accounts, []);
        assert.equal(openrouter.providerRequests.length, 0);
        assert.equal(mock.repository.readPlanCount(), 0);
      }
    });
  }

  it('keeps both state registries, markers, and duration defaults complete', async () => {
    const outcome = await runPersona('clean', 'mock');
    assert.ok(outcome.persisted.plan);
    assert.equal(PERSONAL_CHECKLIST_V1.length, 8);
    assert.equal(BUSINESS_CHECKLIST_V1.length, 7);
    const states = [
      ...outcome.persisted.plan.personalChecklist,
      ...outcome.persisted.plan.businessChecklist,
    ];
    assert.equal(states.length, 15);
    assert.equal(states.every((state) => state.todo === 'TODO(#127)'), true);
    assert.equal(
      Object.values(ACTION_DURATIONS_V1).every(
        (duration) => duration.label === 'TBD' && duration.days === null,
      ),
      true,
    );
    assert.deepEqual(outcome.persisted.plan.estimatedCompletion, { label: 'TBD', days: null });
  });
});

describe('Phase 5 rejection and absence boundaries', () => {
  it('rejects the contained compliance fixture before result persistence', async () => {
    const contained = JSON.parse(
      readFileSync(
        new URL('../llm/__fixtures__/compliance/poisoned-plan.json', import.meta.url),
        'utf8',
      ),
    );
    const clock = createFixedClock(INSTANT);
    const inner = createInMemoryAnalysisRepository({
      clock,
      enrollments: { [CLIENT_ID]: memberRef('clean') },
    });
    const capture = capturePersistence(inner);
    const adapter = createMockAdapter({ clock, webhookConfig: WEBHOOK_CONFIG });
    const driver: PlanDriver = {
      driver: 'mock',
      async generateCandidate() {
        return structuredClone(contained);
      },
      async supervise() {
        return { approved: true, codes: [] };
      },
    };
    await onEnrollmentSucceeded(
      { clientId: CLIENT_ID, enrollmentId: ENROLLMENT_ID },
      { env: ENABLED, repository: capture.repository },
    );
    assert.deepEqual(
      await drainAnalysisQueue(
        { maxJobs: 1, workerId: WORKER_ID },
        {
          env: ENABLED,
          repository: capture.repository,
          getAdapter: () => adapter,
          getDriver: () => driver,
        },
      ),
      // `plan_rejected` in its post-migration-389 sense: the engine ran and refused
      // this candidate, as against never having received one.
      { claimed: 1, succeeded: 0, failed: 1, errorCode: 'plan_rejected' },
    );
    const derived = extractFeatures(
      await adapter.softPull(memberRef('clean'), ALL_REPORT_CODES),
    );
    const evaluation = evaluatePlan(contained, derived);
    assert.equal(evaluation.approved, false);
    assert.equal(
      evaluation.codes.some((code) => code.startsWith('LANGUAGE_')),
      true,
    );
    assert.equal(evaluatePlan(deriveReadinessPlan(derived), derived).approved, true);
    assert.equal(capture.persisted.length, 0);
    assert.equal(inner.readRuns().length, 0);
  });

  it('keeps source-only values out of every captured downstream surface and emits no logs', async (context) => {
    const logs: unknown[][] = [];
    for (const method of ['log', 'info', 'warn', 'error'] as const) {
      context.mock.method(console, method, (...values: unknown[]) => { logs.push(values); });
    }
    const outcome = await runPersona('clean', 'openrouter');
    const surfaces = JSON.stringify({
      job: outcome.job,
      persisted: outcome.persisted,
      tracker: outcome.trackerCalls,
      provider: outcome.providerRequests,
    });
    assert.equal(surfaces.includes(SOURCE_CANARY), false);
    assert.equal(surfaces.includes('subjectRef'), false);
    assert.deepEqual(logs, []);
  });

  it('stays inert behind an absent feature flag after safe singleton selection', async () => {
    let touches = 0;
    const repository = new Proxy({} as AnalysisRepository, {
      get() {
        touches += 1;
        throw new Error('dependency touched');
      },
    });
    const selected = getPlanDriver();
    assert.equal(selected, getPlanDriver());
    assert.equal(
      await onEnrollmentSucceeded(
        { clientId: CLIENT_ID, enrollmentId: ENROLLMENT_ID },
        { env: {}, repository },
      ),
      null,
    );
    assert.deepEqual(
      await drainAnalysisQueue(
        { maxJobs: 1, workerId: WORKER_ID },
        {
          env: {},
          repository,
          getAdapter: () => { touches += 1; throw new Error('adapter touched'); },
          getDriver: () => { touches += 1; return selected; },
          tracker: { async recordAnalysisCompleted() { touches += 1; } },
        },
      ),
      { claimed: 0, succeeded: 0, failed: 0 },
    );
    assert.equal(touches, 0);
  });
});

describe('Phase 5 replay and audit matrix', () => {
  it('recovers an interrupted persisted result without another pull or plan', async () => {
    const clock = mutableClock();
    const inner = createInMemoryAnalysisRepository({
      clock,
      enrollments: { [CLIENT_ID]: memberRef('clean') },
      throwAfterPersistOnce: true,
    });
    const adapter = createMockAdapter({ clock, webhookConfig: WEBHOOK_CONFIG });
    let pulls = 0;
    const counted: CrsAdapter = {
      ...adapter,
      async softPull(_memberRef, codes) {
        pulls += 1;
        return adapter.softPull(memberRef('clean'), codes);
      },
    };
    await onEnrollmentSucceeded(
      { clientId: CLIENT_ID, enrollmentId: ENROLLMENT_ID },
      { env: ENABLED, repository: inner },
    );
    const deps = {
      env: ENABLED,
      repository: inner,
      getAdapter: () => counted,
      getDriver: getPlanDriver,
    };
    assert.deepEqual(
      await drainAnalysisQueue({ maxJobs: 1, workerId: WORKER_ID }, deps),
      { claimed: 1, succeeded: 0, failed: 1, errorCode: 'persistence_failed' },
    );
    clock.advance(61_000);
    assert.deepEqual(
      await drainAnalysisQueue({ maxJobs: 1, workerId: WORKER_ID }, deps),
      { claimed: 1, succeeded: 1, failed: 0 },
    );
    assert.equal(pulls, 1);
    assert.equal(inner.readJobs().length, 1);
    assert.equal(inner.readRuns().length, 1);
    assert.equal(inner.readPlanCount(), 1);
  });

  it('collapses duplicate full callbacks and reuses one tracker token after interruption', async () => {
    const clock = mutableClock();
    const inner = createInMemoryAnalysisRepository({
      clock,
      enrollments: { [CLIENT_ID]: memberRef('clean') },
    });
    const tracked = tracker({ failOnce: true });
    const adapter = createMockAdapter({ clock, webhookConfig: WEBHOOK_CONFIG });
    let pulls = 0;
    const counted: CrsAdapter = {
      ...adapter,
      async softPull(_memberRef, codes) {
        pulls += 1;
        return adapter.softPull(memberRef('clean'), codes);
      },
    };
    const fanOutDeps: AnalysisFanOutDependencies = {
      env: ENABLED,
      enqueue: (input) => enqueueAnalysisRun(input, { env: ENABLED, repository: inner }),
      drain: (input) => drainAnalysisQueue(input, {
        env: ENABLED,
        repository: inner,
        tracker: tracked.port,
        getAdapter: () => counted,
        getDriver: getPlanDriver,
      }),
      getWorkerId: () => WORKER_ID,
      async notifyCrsAlert() {},
    };
    const store = createInMemoryMonitoringEventStore();
    const resolver = createInMemoryMemberRefResolver([
      { clientId: CLIENT_ID, memberRef: memberRef('clean') },
    ]);
    const rawBody = JSON.stringify([{
      id: 'not-a-real-provider-hook',
      type: 'ACCALERT',
      user_id: memberRef('clean'),
      time: Date.parse('2025-08-16T00:00:00.000Z'),
      alert_id: '550e8400-e29b-41d4-a716-446655440003',
      alert_date: Date.parse('2025-08-15T23:59:00.000Z'),
      alert_source: 'Equifax',
    }]);
    const handlerInput = {
      headers: new Headers({
        authorization: `Basic ${Buffer.from('not-a-real-user:not-a-real-pass').toString('base64')}`,
      }),
      rawBody,
      remoteAddress: null,
      config: WEBHOOK_CONFIG,
      store,
      resolver,
      clock,
      pointerCodec: POINTER_CODEC,
    };
    const first = await handleCrsWebhook(handlerInput);
    const duplicate = await handleCrsWebhook(handlerInput);
    assert.equal(first.fanOut[0].monitoringEventId, duplicate.fanOut[0].monitoringEventId);
    await scheduleAnalysisFanOut(first.fanOut, fanOutDeps);
    await scheduleAnalysisFanOut(duplicate.fanOut, fanOutDeps);
    clock.advance(61_000);
    await drainAnalysisQueue(
      { maxJobs: 1, workerId: WORKER_ID },
      {
        env: ENABLED,
        repository: inner,
        tracker: tracked.port,
        getAdapter: () => counted,
        getDriver: getPlanDriver,
      },
    );
    assert.equal(store.readAll().length, 1);
    assert.equal(inner.readJobs().length, 1);
    assert.equal(inner.readRuns().length, 1);
    assert.equal(inner.readPlanCount(), 1);
    assert.equal(pulls, 1);
    assert.equal(tracked.calls.length, 2);
    assert.deepEqual(tracked.calls[0], tracked.calls[1]);
    assert.equal(new Set(tracked.calls.map((call) => call.analysisRunId)).size, 1);
    assert.equal(
      (await drainAnalysisQueue(
        { maxJobs: 1, workerId: WORKER_ID },
        { env: ENABLED, repository: inner },
      )).claimed,
      0,
    );
  });

  it('pins the real queue audit proof to exact metadata and no-op pgTAP assertions', () => {
    const migration = readFileSync(
      new URL('../../../../supabase/migrations/030_analysis_jobs.sql', import.meta.url),
      'utf8',
    );
    const tap = readFileSync(
      new URL('../../../../supabase/tests/030_analysis_jobs.test.sql', import.meta.url),
      'utf8',
    );
    assert.equal(migration.match(/insert into public\.audit_log/g)?.length, 1);
    assert.match(
      migration,
      /insert into public\.audit_log \(\s*client_id,\s*action,\s*subject_type,\s*subject_id,\s*meta\s*\)/,
    );
    assert.match(
      migration,
      /'analysis_job\.transition',\s*'analysis_job',\s*p_job\.id,/,
    );
    assert.match(
      migration,
      /jsonb_build_object\(\s*'job', p_job\.job,\s*'from_state', p_from_state,\s*'to_state', p_to_state\s*\)/,
    );
    for (const assertion of [
      'first enqueue appends one exact metadata-only transition audit row',
      'same-state lease recovery appends no transition audit row',
      'equal replay appends no duplicate persisted audit row',
      'persisted retry scheduling appends no same-state audit row',
      'completed job has exactly one audit row per real status change',
      'queue audit rows remain append-only on update',
      'queue audit rows remain append-only on delete',
    ]) {
      assert.equal(tap.includes(assertion), true);
    }
  });
});
