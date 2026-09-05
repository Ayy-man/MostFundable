import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createMockAdapter } from '../crs/mock/driver.ts';
import { createFixedClock } from '../crs/ports.ts';
import { createMockPlanDriver } from '../llm/mock-driver.ts';
import { extractFeatures } from './features.ts';
import { createInMemoryAnalysisRepository } from './repository.ts';
import {
  drainAnalysisQueue,
  enqueueAnalysisRun,
  onEnrollmentSucceeded,
} from './worker.ts';

import type { Clock } from '../crs/ports.ts';
import type { CrsAdapter, CrsMemberRef, CrsPersona } from '../crs/types.ts';
import type { CrsWebhookConfig } from '../crs/webhook.ts';
import type { PlanDriver } from '../llm/types.ts';
import type { AnalysisRepository, AnalysisStageTracker } from './ports.ts';
import type { InMemoryAnalysisRepository } from './repository.ts';

const CLIENT_ID = '54000000-0000-4000-8000-000000000101';
const ENROLLMENT_ID = '54000000-0000-4000-8000-000000000201';
const MONITORING_ID = '54000000-0000-4000-8000-000000000301';
const FORCE_PULL_ID = '54000000-0000-4000-8000-000000000401';
const WORKER_ID = '54000000-0000-4000-8000-000000000901';
const INSTANT = '2026-08-16T02:00:00.000Z';
const ENABLED = { FEATURE_ANALYSIS: 'true' };
const DISABLED = {};

const WEBHOOK_CONFIG: CrsWebhookConfig = {
  basicUser: null,
  basicPass: null,
  hmacSecret: null,
  hmacHeader: 'x-crs-signature',
  sourceIps: [],
};

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

function countedAdapter(persona: CrsPersona, pulls: { value: number }): CrsAdapter {
  const adapter = createMockAdapter({
    clock: createFixedClock(INSTANT),
    webhookConfig: WEBHOOK_CONFIG,
  });
  return {
    ...adapter,
    async softPull(_memberRef, reportCodes) {
      pulls.value += 1;
      return adapter.softPull(memberRef(persona), reportCodes);
    },
  };
}

function countedDriver(calls: { candidate: number; supervisor: number }): PlanDriver {
  const driver = createMockPlanDriver();
  return {
    driver: 'mock',
    async generateCandidate(features) {
      calls.candidate += 1;
      return driver.generateCandidate(features);
    },
    async supervise(features, candidate) {
      calls.supervisor += 1;
      return driver.supervise(features, candidate);
    },
  };
}

function recordingTracker(options: { failOnce?: boolean } = {}) {
  const calls: Array<{ clientId: string; analysisRunId: string; readinessScore: number }> = [];
  let fail = options.failOnce ?? false;
  const tracker: AnalysisStageTracker = {
    async recordAnalysisCompleted(input) {
      calls.push({ ...input });
      if (fail) {
        fail = false;
        throw new Error('test tracker failure');
      }
    },
  };
  return { tracker, calls };
}

function repositoryFor(
  persona: CrsPersona,
  clock: Clock = createFixedClock(INSTANT),
  options: { throwAfterPersistOnce?: boolean } = {},
): InMemoryAnalysisRepository {
  return createInMemoryAnalysisRepository({
    clock: { now: () => clock.now() },
    enrollments: { [CLIENT_ID]: memberRef(persona) },
    throwAfterPersistOnce: options.throwAfterPersistOnce,
  });
}

async function enqueue(
  repository: AnalysisRepository,
  sourceId = ENROLLMENT_ID,
): Promise<void> {
  const job = await enqueueAnalysisRun(
    {
      clientId: CLIENT_ID,
      sourceKind: sourceId === ENROLLMENT_ID ? 'enrollment' : 'monitoring_event',
      sourceId,
      trigger: sourceId === ENROLLMENT_ID ? 'scheduled' : 'alert',
    },
    { env: ENABLED, repository },
  );
  assert.ok(job);
}

describe('analysis dispatch seams', () => {
  it('runs every enqueue cause through one cap guard and skips blocked work', async () => {
    for (const input of [
      { sourceKind: 'enrollment', sourceId: ENROLLMENT_ID, trigger: 'scheduled' },
      { sourceKind: 'monitoring_event', sourceId: MONITORING_ID, trigger: 'alert' },
      { sourceKind: 'document_upload', sourceId: MONITORING_ID, trigger: 'upload' },
      { sourceKind: 'force_pull', sourceId: FORCE_PULL_ID, trigger: 'force_pull' },
    ] as const) {
      const repository = repositoryFor('clean');
      const calls: string[] = [];
      const result = await enqueueAnalysisRun(
        { clientId: CLIENT_ID, ...input },
        {
          env: ENABLED,
          repository,
          async assertPullAllowed(clientId, cause, sourceId) {
            calls.push(`${clientId}:${cause}:${sourceId}`);
            return { allowed: input.trigger !== 'force_pull' };
          },
        },
      );
      assert.equal(calls.length, 1);
      assert.equal(
        calls[0],
        `${CLIENT_ID}:${input.trigger}:${input.sourceId}`,
      );
      assert.equal(result === null, input.trigger === 'force_pull');
      assert.equal(repository.readJobs().length, input.trigger === 'force_pull' ? 0 : 1);
    }
  });

  it('passes exact force-pull provenance through the public analysis seam', async () => {
    const repository = repositoryFor('clean');
    const calls: Array<{ clientId: string; cause: string; sourceId: string }> = [];
    const job = await enqueueAnalysisRun(
      {
        clientId: CLIENT_ID,
        sourceKind: 'force_pull',
        sourceId: FORCE_PULL_ID,
        trigger: 'force_pull',
      },
      {
        env: ENABLED,
        repository,
        async assertPullAllowed(clientId, cause, sourceId) {
          calls.push({ clientId, cause, sourceId });
          return { allowed: true };
        },
      },
    );
    assert.deepEqual(calls, [{ clientId: CLIENT_ID, cause: 'force_pull', sourceId: FORCE_PULL_ID }]);
    assert.equal(job?.sourceKind, 'force_pull');
    assert.equal(job?.trigger, 'force_pull');
    assert.equal(job?.sourceId, FORCE_PULL_ID);
  });

  it('rejects unknown source kinds and mismatched source-trigger pairs', async () => {
    const repository = repositoryFor('clean');
    await assert.rejects(
      enqueueAnalysisRun(
        {
          clientId: CLIENT_ID,
          sourceKind: 'unknown' as never,
          sourceId: FORCE_PULL_ID,
          trigger: 'force_pull',
        },
        { env: ENABLED, repository },
      ),
      { message: 'ANALYSIS_SOURCE_KIND_INVALID' },
    );
    await assert.rejects(
      enqueueAnalysisRun(
        {
          clientId: CLIENT_ID,
          sourceKind: 'force_pull',
          sourceId: FORCE_PULL_ID,
          trigger: 'scheduled',
        },
        { env: ENABLED, repository },
      ),
      { message: 'ANALYSIS_SOURCE_TRIGGER_INVALID' },
    );
    assert.equal(repository.readJobs().length, 0);
  });

  it('does nothing under the default-off flag before touching a dependency', async () => {
    let repositoryCalls = 0;
    const repository = new Proxy({} as AnalysisRepository, {
      get() {
        repositoryCalls += 1;
        throw new Error('dependency touched');
      },
    });
    assert.equal(
      await enqueueAnalysisRun(
        {
          clientId: CLIENT_ID,
          sourceKind: 'enrollment',
          sourceId: ENROLLMENT_ID,
          trigger: 'scheduled',
        },
        { env: DISABLED, repository },
      ),
      null,
    );
    assert.deepEqual(
      await drainAnalysisQueue(
        { maxJobs: 1, workerId: WORKER_ID },
        { env: DISABLED, repository },
      ),
      { claimed: 0, succeeded: 0, failed: 0 },
    );
    assert.equal(repositoryCalls, 0);
  });

  it('uses the persisted enrollment id, scheduled provenance, and stable duplicate identity', async () => {
    const repository = repositoryFor('clean');
    const first = await onEnrollmentSucceeded(
      { clientId: CLIENT_ID, enrollmentId: ENROLLMENT_ID },
      { env: ENABLED, repository },
    );
    const second = await onEnrollmentSucceeded(
      { clientId: CLIENT_ID, enrollmentId: ENROLLMENT_ID },
      { env: ENABLED, repository },
    );
    assert.deepEqual(first, second);
    assert.equal(first?.sourceId, ENROLLMENT_ID);
    assert.equal(first?.sourceKind, 'enrollment');
    assert.equal(first?.trigger, 'scheduled');
    assert.equal(repository.readJobs().length, 1);
  });

  it('rejects malformed persisted source metadata with a fixed code', async () => {
    const repository = repositoryFor('clean');
    await assert.rejects(
      onEnrollmentSucceeded(
        { clientId: CLIENT_ID, enrollmentId: 'not-a-persisted-uuid' },
        { env: ENABLED, repository },
      ),
      { message: 'ANALYSIS_SOURCE_ID_INVALID' },
    );
  });
});

describe('analysis queue worker', () => {
  it('rechecks current authorization after claim and before the provider pull', async () => {
    const base = repositoryFor('clean');
    await enqueue(base);
    let pulls = 0;
    const repository: AnalysisRepository = {
      ...base,
      async isAuthorized() { return false; },
    };
    const result = await drainAnalysisQueue(
      { maxJobs: 1, workerId: WORKER_ID },
      {
        env: ENABLED,
        repository,
        getAdapter() {
          pulls += 1;
          return countedAdapter('clean', { value: 0 });
        },
      },
    );
    assert.equal(base.readJobs()[0].errorCode, 'source_unavailable');
    // Reported and durable are one fact; see the classification test below.
    assert.deepEqual(result, { claimed: 1, succeeded: 0, failed: 1, errorCode: base.readJobs()[0].errorCode });
    assert.equal(pulls, 0);
  });

  it('loads document-upload derived features without calling CRS and shares the plan/persist/tracker tail', async () => {
    const repository = repositoryFor('clean');
    const adapter = createMockAdapter({ clock: createFixedClock(INSTANT), webhookConfig: WEBHOOK_CONFIG });
    const derived = extractFeatures(await adapter.softPull(memberRef('clean'), ['EQF1001', 'EXP1001', 'TUC3002']));
    await enqueueAnalysisRun(
      { clientId: CLIENT_ID, sourceKind: 'document_upload', sourceId: MONITORING_ID, trigger: 'upload' },
      { env: ENABLED, repository, async assertPullAllowed() { return { allowed: true }; } },
    );
    let crsCalls = 0;
    const tracked = recordingTracker();
    const result = await drainAnalysisQueue(
      { maxJobs: 1, workerId: WORKER_ID },
      {
        env: ENABLED,
        repository,
        tracker: tracked.tracker,
        getAdapter() { crsCalls += 1; throw new Error('document source reached CRS'); },
        getDriver: createMockPlanDriver,
        async loadParsedUploadFeatures(clientId, uploadId) {
          assert.deepEqual([clientId, uploadId], [CLIENT_ID, MONITORING_ID]);
          return derived;
        },
      },
    );
    assert.deepEqual(result, { claimed: 1, succeeded: 1, failed: 0 });
    assert.equal(crsCalls, 0);
    assert.equal(repository.readRuns().length, 1);
    assert.equal(tracked.calls.length, 1);
  });

  for (const expectation of [
    { persona: 'clean' as const, score: 99, planCount: 1 },
    { persona: 'derog' as const, score: 44, planCount: 1 },
    { persona: 'no_hit' as const, score: 0, planCount: 0 },
  ]) {
    it(`persists the ${expectation.persona} outcome through the module-shaped mock boundary`, async () => {
      const repository = repositoryFor(expectation.persona);
      const pulls = { value: 0 };
      const planCalls = { candidate: 0, supervisor: 0 };
      const tracked = recordingTracker();
      await enqueue(repository);
      const result = await drainAnalysisQueue(
        { maxJobs: 1, workerId: WORKER_ID },
        {
          env: ENABLED,
          repository,
          tracker: tracked.tracker,
          getAdapter: () => countedAdapter(expectation.persona, pulls),
          getDriver: () => countedDriver(planCalls),
        },
      );

      assert.deepEqual(result, { claimed: 1, succeeded: 1, failed: 0 });
      assert.equal(pulls.value, 1);
      assert.equal(repository.readRuns()[0].readinessScore, expectation.score);
      assert.equal(repository.readPlanCount(), expectation.planCount);
      assert.equal(planCalls.candidate, expectation.persona === 'no_hit' ? 0 : 1);
      assert.equal(planCalls.supervisor, expectation.persona === 'no_hit' ? 0 : 1);
      assert.equal(tracked.calls[0].analysisRunId, repository.readJobs()[0].analysisRunId);
      assert.equal(tracked.calls[0].readinessScore, expectation.score);
    });
  }

  it('removes source-only report canaries before the repository boundary', async () => {
    const repository = repositoryFor('clean');
    let persisted = '';
    const capturingRepository: AnalysisRepository = {
      ...repository,
      async persistResult(input) {
        persisted = JSON.stringify(input);
        return repository.persistResult(input);
      },
    };
    await enqueue(capturingRepository);
    await drainAnalysisQueue(
      { maxJobs: 1, workerId: WORKER_ID },
      {
        env: ENABLED,
        repository: capturingRepository,
        getAdapter: () => countedAdapter('clean', { value: 0 }),
      },
    );
    assert.notEqual(persisted, '');
    assert.equal(persisted.includes('mock-subject-clean'), false);
    assert.equal(persisted.includes('subjectRef'), false);
  });

  it('withdrawal during softPull reaches the persistence recheck with zero derived rows', async () => {
    const base = repositoryFor('clean');
    let authorized = true;
    let persistenceSawWithdrawal = false;
    const repository: AnalysisRepository = {
      ...base,
      async isAuthorized() { return authorized; },
      async persistResult(input) {
        persistenceSawWithdrawal = !authorized;
        throw new Error(`database cancelled ${input.jobId}`);
      },
    };
    const adapter = countedAdapter('clean', { value: 0 });
    await enqueue(repository);
    const result = await drainAnalysisQueue({ maxJobs: 1, workerId: WORKER_ID }, {
      env: ENABLED,
      repository,
      getAdapter: () => ({
        ...adapter,
        async softPull(member, codes) {
          const report = await adapter.softPull(member, codes);
          authorized = false;
          return report;
        },
      }),
    });
    assert.equal(persistenceSawWithdrawal, true);
    assert.deepEqual(result, { claimed: 1, succeeded: 0, failed: 1, errorCode: 'persistence_failed' });
    assert.equal(base.readRuns().length, 0);
    assert.equal(base.readPlanCount(), 0);
  });

  it('replays an unknown persistence outcome without another pull or plan', async () => {
    const clock = mutableClock();
    const repository = repositoryFor('clean', clock, { throwAfterPersistOnce: true });
    const pulls = { value: 0 };
    const planCalls = { candidate: 0, supervisor: 0 };
    const tracked = recordingTracker();
    await enqueue(repository);
    const overrides = {
      env: ENABLED,
      repository,
      tracker: tracked.tracker,
      getAdapter: () => countedAdapter('clean', pulls),
      getDriver: () => countedDriver(planCalls),
    };

    assert.deepEqual(
      await drainAnalysisQueue({ maxJobs: 1, workerId: WORKER_ID }, overrides),
      { claimed: 1, succeeded: 0, failed: 1, errorCode: 'persistence_failed' },
    );
    assert.equal(repository.readRuns().length, 1);
    clock.advance(61_000);
    assert.deepEqual(
      await drainAnalysisQueue({ maxJobs: 1, workerId: WORKER_ID }, overrides),
      { claimed: 1, succeeded: 1, failed: 0 },
    );
    assert.equal(pulls.value, 1);
    assert.deepEqual(planCalls, { candidate: 1, supervisor: 1 });
    assert.equal(repository.readRuns().length, 1);
    assert.equal(repository.readPlanCount(), 1);
  });

  it('marks a replayed per-request pull indeterminate without an outbound call', async () => {
    const repository = repositoryFor('clean');
    await enqueue(repository);
    const job = repository.readJobs()[0];
    await repository.beginPullOperation({
      clientId: CLIENT_ID,
      analysisRunId: job.analysisRunId,
      reportCodes: ['EQF1001', 'EXP1001', 'TUC3002'],
    });
    let pulls = 0;
    const cached = countedAdapter('clean', { value: 0 });
    const perRequest: CrsAdapter = {
      ...cached,
      pullBilling: 'per-request',
      async softPull() {
        pulls += 1;
        throw new Error('a replay must not reach the bureau');
      },
    };

    assert.deepEqual(
      await drainAnalysisQueue(
        { maxJobs: 1, workerId: WORKER_ID },
        { env: ENABLED, repository, getAdapter: () => perRequest },
      ),
      { claimed: 1, succeeded: 0, failed: 1, errorCode: 'pull_indeterminate' },
    );
    assert.equal(pulls, 0);
    assert.equal(repository.readPullOperations()[0].state, 'indeterminate');
    assert.equal(repository.readJobs()[0].errorCode, 'pull_indeterminate');
  });

  it('retries a persisted tracker failure with the same token and no second source work', async () => {
    const clock = mutableClock();
    const repository = repositoryFor('derog', clock);
    const pulls = { value: 0 };
    const planCalls = { candidate: 0, supervisor: 0 };
    const tracked = recordingTracker({ failOnce: true });
    await enqueue(repository);
    const overrides = {
      env: ENABLED,
      repository,
      tracker: tracked.tracker,
      getAdapter: () => countedAdapter('derog', pulls),
      getDriver: () => countedDriver(planCalls),
    };

    await drainAnalysisQueue({ maxJobs: 1, workerId: WORKER_ID }, overrides);
    clock.advance(61_000);
    await drainAnalysisQueue({ maxJobs: 1, workerId: WORKER_ID }, overrides);

    assert.equal(pulls.value, 1);
    assert.deepEqual(planCalls, { candidate: 1, supervisor: 1 });
    assert.equal(tracked.calls.length, 2);
    assert.deepEqual(tracked.calls[0], tracked.calls[1]);
    assert.equal(repository.readJobs()[0].status, 'succeeded');
  });

  it('uses fixed failure classification and honors the maxJobs bound', async () => {
    const repository = repositoryFor('clean');
    await enqueue(repository);
    await enqueue(repository, MONITORING_ID);
    const result = await drainAnalysisQueue(
      { maxJobs: 1, workerId: WORKER_ID },
      {
        env: ENABLED,
        repository,
        getAdapter: () => {
          throw new Error('must not escape');
        },
      },
    );
    const jobs = repository.readJobs();
    assert.equal(jobs.filter((job) => job.attemptCount === 1).length, 1);
    const attempted = jobs.find((job) => job.attemptCount === 1);
    assert.equal(attempted?.errorCode, 'configuration_error');
    // The reported code and the durable one are the same fact; a caller that logs
    // the result must not be able to say something the row disagrees with.
    assert.deepEqual(result, { claimed: 1, succeeded: 0, failed: 1, errorCode: attempted?.errorCode });
    assert.equal(jobs.filter((job) => job.attemptCount === 0).length, 1);
  });
});
