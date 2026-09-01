import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { cleanFeatures } from '../llm/__fixtures__/features.ts';
import { deriveReadinessPlan } from '../llm/mock-driver.ts';
import { noopAnalysisStageTracker } from './ports.ts';
import {
  createInMemoryAnalysisRepository,
  createSupabaseAnalysisRepository,
} from './repository.ts';

import type { CrsMemberRef } from '../crs/types.ts';

const CLIENT_ID = '53000000-0000-0000-0000-000000000101';
const SOURCE_ID = '53000000-0000-0000-0000-000000000401';
const WORKER_ID = '53000000-0000-0000-0000-000000000901';
const INSTANT = '2026-08-16T01:00:00.000Z';

function databaseJob(overrides: Record<string, unknown> = {}) {
  const analysisRunId = '53000000-0000-4000-8000-000000000701';
  return {
    id: '53000000-0000-4000-8000-000000000601',
    job: 'analysis.run',
    client_id: CLIENT_ID,
    source_kind: 'enrollment',
    source_id: SOURCE_ID,
    analysis_run_id: analysisRunId,
    trigger: 'scheduled',
    subject: `client:${CLIENT_ID}`,
    window: `run:${analysisRunId}`,
    idempotency_key: `analysis.run|client:${CLIENT_ID}|run:${analysisRunId}`,
    status: 'queued',
    attempt_count: 0,
    available_at: INSTANT,
    lease_owner: null,
    lease_until: null,
    error_code: null,
    created_at: INSTANT,
    updated_at: INSTANT,
    ...overrides,
  };
}

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

interface SelectCall {
  table: string;
  columns: string;
  filters: Array<{ column: string; value: unknown }>;
}

class FakeAnalysisClient {
  readonly rpcCalls: RpcCall[] = [];
  readonly selectCalls: SelectCall[] = [];
  rpcError = false;
  selectError = false;
  rpcRows: unknown[] = [databaseJob()];
  enrollment: { client_id: string; crs_member_ref: string | null } | null = {
    client_id: CLIENT_ID,
    crs_member_ref: 'mock_member_analysis',
  };
  run: { id: string; client_id: string; readiness_score: number } | null = null;

  async rpc(name: string, args: Record<string, unknown>) {
    this.rpcCalls.push({ name, args });
    return { data: this.rpcRows, error: this.rpcError ? { code: 'FAKE_RPC' } : null };
  }

  from(table: string) {
    return {
      select: (columns: string) => {
        const call: SelectCall = { table, columns, filters: [] };
        this.selectCalls.push(call);
        const chain = {
          eq: (column: string, value: unknown) => {
            call.filters.push({ column, value });
            return chain;
          },
          maybeSingle: async () => ({
            data: table === 'enrollments' ? this.enrollment : this.run,
            error: this.selectError ? { code: 'FAKE_SELECT' } : null,
          }),
        };
        return chain;
      },
    };
  }
}

describe('Supabase analysis repository', () => {
  it('claims the exact analysis run and client through the targeted RPC', async () => {
    const fake = new FakeAnalysisClient();
    const claimed = databaseJob({
      status: 'running',
      lease_owner: WORKER_ID,
      lease_until: '2026-08-16T01:01:00.000Z',
    });
    fake.rpcRows = [claimed];
    const repository = createSupabaseAnalysisRepository({ createClient: () => fake as never });
    assert.equal(
      (await repository.claimTarget({
        analysisRunId: claimed.analysis_run_id as string,
        clientId: CLIENT_ID,
        leaseSeconds: 60,
        workerId: WORKER_ID,
      }))?.analysisRunId,
      claimed.analysis_run_id,
    );
    assert.deepEqual(fake.rpcCalls, [{
      name: 'claim_analysis_job',
      args: {
        p_analysis_run_id: claimed.analysis_run_id,
        p_client_id: CLIENT_ID,
        p_lease_seconds: 60,
        p_worker_id: WORKER_ID,
      },
    }]);
  });

  it('creates the service client lazily and sends exact source-keyed enqueue arguments', async () => {
    const fake = new FakeAnalysisClient();
    fake.rpcRows = [databaseJob({ source_kind: 'force_pull', trigger: 'force_pull' })];
    let created = 0;
    const repository = createSupabaseAnalysisRepository({
      createClient: () => {
        created += 1;
        return fake as never;
      },
    });
    assert.equal(created, 0);

    const result = await repository.enqueue({
      clientId: CLIENT_ID,
      sourceKind: 'force_pull',
      sourceId: SOURCE_ID,
      trigger: 'force_pull',
    });
    assert.equal(created, 1);
    assert.deepEqual(fake.rpcCalls, [
      {
        name: 'enqueue_analysis_job',
        args: {
          p_client_id: CLIENT_ID,
          p_source_kind: 'force_pull',
          p_source_id: SOURCE_ID,
          p_trigger: 'force_pull',
        },
      },
    ]);
    assert.equal(result.sourceKind, 'force_pull');
    assert.equal(result.trigger, 'force_pull');
    assert.deepEqual(Object.keys(result).sort(), [
      'analysisRunId',
      'attemptCount',
      'availableAt',
      'clientId',
      'createdAt',
      'errorCode',
      'id',
      'idempotencyKey',
      'job',
      'leaseOwner',
      'leaseUntil',
      'sourceId',
      'sourceKind',
      'status',
      'subject',
      'trigger',
      'updatedAt',
      'window',
    ]);
  });

  it('rejects a source and trigger pairing the SQL contract does not accept', async () => {
    const fake = new FakeAnalysisClient();
    fake.rpcRows = [databaseJob({ source_kind: 'force_pull', trigger: 'scheduled' })];
    const repository = createSupabaseAnalysisRepository({ createClient: () => fake as never });
    await assert.rejects(
      repository.enqueue({
        clientId: CLIENT_ID,
        sourceKind: 'force_pull',
        sourceId: SOURCE_ID,
        trigger: 'force_pull',
      }),
      { message: 'ANALYSIS_REPOSITORY_RESULT_INVALID' },
    );
  });

  it('sends only named derived result fields and maps the fixed persisted row', async () => {
    const fake = new FakeAnalysisClient();
    fake.rpcRows = [databaseJob({
      status: 'persisted',
      lease_owner: WORKER_ID,
      lease_until: '2026-08-16T01:01:00.000Z',
    })];
    const repository = createSupabaseAnalysisRepository({ createClient: () => fake as never });
    const derived = cleanFeatures();
    const plan = deriveReadinessPlan(derived);
    const job = await repository.persistResult({
      jobId: databaseJob().id as string,
      workerId: WORKER_ID,
      clientId: CLIENT_ID,
      analysisRunId: databaseJob().analysis_run_id as string,
      readinessScore: 99,
      derived,
      plan,
    });

    assert.equal(job.status, 'persisted');
    assert.deepEqual(fake.rpcCalls[0], {
      name: 'persist_analysis_result',
      args: {
        p_job_id: databaseJob().id,
        p_worker_id: WORKER_ID,
        p_client_id: CLIENT_ID,
        p_analysis_run_id: databaseJob().analysis_run_id,
        p_readiness_score: 99,
        p_derived: derived,
        p_plan_version: 1,
        p_plan_body: plan,
      },
    });
  });

  it('uses exact lookup projections for enrollment and persisted run metadata', async () => {
    const fake = new FakeAnalysisClient();
    fake.run = {
      id: databaseJob().analysis_run_id as string,
      client_id: CLIENT_ID,
      readiness_score: 99,
    };
    const repository = createSupabaseAnalysisRepository({ createClient: () => fake as never });

    assert.equal(await repository.loadEnrollmentMemberRef(CLIENT_ID), 'mock_member_analysis');
    assert.deepEqual(
      await repository.loadPersistedRun(CLIENT_ID, databaseJob().analysis_run_id as string),
      {
        clientId: CLIENT_ID,
        analysisRunId: databaseJob().analysis_run_id,
        readinessScore: 99,
      },
    );
    assert.deepEqual(fake.selectCalls, [
      {
        table: 'enrollments',
        columns: 'client_id,crs_member_ref',
        filters: [{ column: 'client_id', value: CLIENT_ID }],
      },
      {
        table: 'analysis_runs',
        columns: 'id,client_id,readiness_score',
        filters: [
          { column: 'id', value: databaseJob().analysis_run_id },
          { column: 'client_id', value: CLIENT_ID },
        ],
      },
    ]);
  });

  it('exposes fixed metadata for database and result-shape failures', async () => {
    const fake = new FakeAnalysisClient();
    fake.rpcError = true;
    const repository = createSupabaseAnalysisRepository({ createClient: () => fake as never });
    await assert.rejects(
      repository.enqueue({
        clientId: CLIENT_ID,
        sourceKind: 'enrollment',
        sourceId: SOURCE_ID,
        trigger: 'scheduled',
      }),
      { message: 'ANALYSIS_REPOSITORY_ENQUEUE_FAILED' },
    );

    fake.rpcError = false;
    fake.rpcRows = [{ id: 'too-narrow' }];
    await assert.rejects(repository.claim({ workerId: WORKER_ID, leaseSeconds: 60 }), {
      message: 'ANALYSIS_REPOSITORY_RESULT_INVALID',
    });
  });

  it('has only the closed analysis operations and an inert default tracker', async () => {
    const fake = new FakeAnalysisClient();
    const repository = createSupabaseAnalysisRepository({ createClient: () => fake as never });
    assert.deepEqual(Object.keys(repository).sort(), [
      'beginPullOperation',
      'claim',
      'claimTarget',
      'enqueue',
      'fail',
      'finish',
      'isAuthorized',
      'loadEnrollmentMemberRef',
      'loadPersistedRun',
      'markPullIndeterminate',
      'persistResult',
      'recordPullReturned',
    ]);

    const completion = {
      clientId: CLIENT_ID,
      analysisRunId: databaseJob().analysis_run_id as string,
      readinessScore: 99,
    };
    await noopAnalysisStageTracker.recordAnalysisCompleted(completion);
    await noopAnalysisStageTracker.recordAnalysisCompleted(completion);
    assert.equal(fake.rpcCalls.length, 0);
  });
});

describe('in-memory analysis repository', () => {
  it('collapses independent source enqueue calls to one job and run identity', async () => {
    const repository = createInMemoryAnalysisRepository({
      clock: { now: () => new Date(INSTANT) },
    });
    const input = {
      clientId: CLIENT_ID,
      sourceKind: 'enrollment' as const,
      sourceId: SOURCE_ID,
      trigger: 'scheduled' as const,
    };
    const first = await repository.enqueue(input);
    const second = await repository.enqueue({ ...input });

    assert.deepEqual(first, second);
    assert.equal(repository.readJobs().length, 1);
    assert.equal(first.idempotencyKey, `analysis.run|client:${CLIENT_ID}|run:${first.analysisRunId}`);
  });

  it('models leases, equal replay, mismatch rejection, and fixed completion', async () => {
    let current = Date.parse(INSTANT);
    const repository = createInMemoryAnalysisRepository({
      clock: { now: () => new Date(current) },
    });
    const enqueued = await repository.enqueue({
      clientId: CLIENT_ID,
      sourceKind: 'enrollment',
      sourceId: SOURCE_ID,
      trigger: 'scheduled',
    });
    const claimed = await repository.claim({ workerId: WORKER_ID, leaseSeconds: 60 });
    assert.equal(claimed?.id, enqueued.id);
    assert.equal(claimed?.status, 'running');
    assert.equal(await repository.claim({ workerId: 'other-worker', leaseSeconds: 60 }), null);

    const derived = cleanFeatures();
    const plan = deriveReadinessPlan(derived);
    const persistedInput = {
      jobId: enqueued.id,
      workerId: WORKER_ID,
      clientId: CLIENT_ID,
      analysisRunId: enqueued.analysisRunId,
      readinessScore: 99,
      derived,
      plan,
    };
    assert.equal((await repository.persistResult(persistedInput)).status, 'persisted');
    assert.equal((await repository.persistResult({ ...persistedInput })).status, 'persisted');
    assert.equal(repository.readRuns().length, 1);
    await assert.rejects(
      repository.persistResult({ ...persistedInput, readinessScore: 98 }),
      { message: 'ANALYSIS_REPOSITORY_RESULT_MISMATCH' },
    );
    assert.equal((await repository.finish({ jobId: enqueued.id, workerId: WORKER_ID })).status, 'succeeded');

    current += 61_000;
  });

  it('preserves a committed result across an unknown client outcome', async () => {
    const repository = createInMemoryAnalysisRepository({
      clock: { now: () => new Date(INSTANT) },
      enrollments: { [CLIENT_ID]: 'mock_member_analysis' as CrsMemberRef },
      throwAfterPersistOnce: true,
    });
    const job = await repository.enqueue({
      clientId: CLIENT_ID,
      sourceKind: 'enrollment',
      sourceId: SOURCE_ID,
      trigger: 'scheduled',
    });
    await repository.claim({ workerId: WORKER_ID, leaseSeconds: 60 });
    const derived = cleanFeatures();
    const input = {
      jobId: job.id,
      workerId: WORKER_ID,
      clientId: CLIENT_ID,
      analysisRunId: job.analysisRunId,
      readinessScore: 99,
      derived,
      plan: deriveReadinessPlan(derived),
    };
    await assert.rejects(repository.persistResult(input), {
      message: 'ANALYSIS_REPOSITORY_OUTCOME_UNKNOWN',
    });
    assert.equal(repository.readRuns().length, 1);
    assert.equal((await repository.persistResult(input)).status, 'persisted');
    assert.equal(await repository.loadEnrollmentMemberRef(CLIENT_ID), 'mock_member_analysis');
  });
});
