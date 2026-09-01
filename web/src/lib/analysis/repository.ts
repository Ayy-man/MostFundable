import type { CrsMemberRef } from '../crs/types.ts';
import type {
  AnalysisClock,
  AnalysisJob,
  AnalysisJobErrorCode,
  AnalysisJobSourceKind,
  AnalysisJobStatus,
  AnalysisRepository,
  AnalysisTrigger,
  ClaimAnalysisJobInput,
  ClaimTargetAnalysisJobInput,
  EnqueueAnalysisJobInput,
  FailAnalysisJobInput,
  FinishAnalysisJobInput,
  PersistAnalysisResultInput,
  PersistedAnalysisRun,
  PullOperation,
} from './ports.ts';

type AdminClient = ReturnType<(typeof import('../supabase/admin.ts'))['createAdminClient']>;

interface RepositoryOptions {
  createClient?: () => AdminClient | Promise<AdminClient>;
}

interface RpcClient {
  rpc(name: string, args: Record<string, unknown>): Promise<{
    data: unknown;
    error: unknown;
  }>;
}

const JOB_KEYS = [
  'id',
  'job',
  'client_id',
  'source_kind',
  'source_id',
  'analysis_run_id',
  'trigger',
  'subject',
  'window',
  'idempotency_key',
  'status',
  'attempt_count',
  'available_at',
  'lease_owner',
  'lease_until',
  'error_code',
  'created_at',
  'updated_at',
] as const;
const SOURCE_KINDS = new Set<AnalysisJobSourceKind>([
  'enrollment',
  'monitoring_event',
  'document_upload',
  'force_pull',
]);
const TRIGGERS = new Set<AnalysisTrigger>(['scheduled', 'alert', 'force_pull', 'upload']);
const SOURCE_TRIGGERS: Readonly<Record<AnalysisJobSourceKind, AnalysisTrigger>> = {
  enrollment: 'scheduled',
  monitoring_event: 'alert',
  document_upload: 'upload',
  force_pull: 'force_pull',
};
const STATUSES = new Set<AnalysisJobStatus>([
  'queued',
  'running',
  'persisted',
  'succeeded',
  'failed',
  'cancelled',
]);
const ERROR_CODES = new Set<AnalysisJobErrorCode>([
  'source_unavailable',
  'pull_failed',
  'plan_rejected',
  'persistence_failed',
  'tracker_failed',
  'configuration_error',
  'pull_indeterminate',
  'plan_unavailable',
]);
const PULL_OPERATION_KEYS = ['idempotency_key', 'state', 'replay'] as const;
const PULL_OPERATION_STATES = new Set<PullOperation['state']>([
  'dispatched',
  'returned',
  'indeterminate',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function mapJob(value: unknown): AnalysisJob {
  if (!isRecord(value) || !hasExactKeys(value, JOB_KEYS)) {
    throw new Error('ANALYSIS_REPOSITORY_RESULT_INVALID');
  }
  if (
    !isString(value.id) ||
    value.job !== 'analysis.run' ||
    !isString(value.client_id) ||
    !isString(value.source_kind) ||
    !SOURCE_KINDS.has(value.source_kind as AnalysisJobSourceKind) ||
    !isString(value.source_id) ||
    !isString(value.analysis_run_id) ||
    !isString(value.trigger) ||
    !TRIGGERS.has(value.trigger as AnalysisTrigger) ||
    SOURCE_TRIGGERS[value.source_kind as AnalysisJobSourceKind] !== value.trigger ||
    !isString(value.subject) ||
    !isString(value.window) ||
    !isString(value.idempotency_key) ||
    !isString(value.status) ||
    !STATUSES.has(value.status as AnalysisJobStatus) ||
    typeof value.attempt_count !== 'number' ||
    !Number.isInteger(value.attempt_count) ||
    value.attempt_count < 0 ||
    !isString(value.available_at) ||
    !(value.lease_owner === null || isString(value.lease_owner)) ||
    !(value.lease_until === null || isString(value.lease_until)) ||
    !(value.error_code === null || (isString(value.error_code) && ERROR_CODES.has(value.error_code as AnalysisJobErrorCode))) ||
    !isString(value.created_at) ||
    !isString(value.updated_at)
  ) {
    throw new Error('ANALYSIS_REPOSITORY_RESULT_INVALID');
  }

  return {
    id: value.id,
    job: 'analysis.run',
    clientId: value.client_id,
    sourceKind: value.source_kind as AnalysisJobSourceKind,
    sourceId: value.source_id,
    analysisRunId: value.analysis_run_id,
    trigger: value.trigger as AnalysisTrigger,
    subject: value.subject,
    window: value.window,
    idempotencyKey: value.idempotency_key,
    status: value.status as AnalysisJobStatus,
    attemptCount: value.attempt_count,
    availableAt: value.available_at,
    leaseOwner: value.lease_owner,
    leaseUntil: value.lease_until,
    errorCode: value.error_code as AnalysisJobErrorCode | null,
    createdAt: value.created_at,
    updatedAt: value.updated_at,
  };
}

async function createProductionClient(): Promise<AdminClient> {
  const { createAdminClient } = await import('../supabase/admin.ts');
  return createAdminClient();
}

function lazyClient(options: RepositoryOptions): () => Promise<AdminClient> {
  let client: Promise<AdminClient> | null = null;
  return () => {
    if (client === null) client = Promise.resolve((options.createClient ?? createProductionClient)());
    return client;
  };
}

function oneJob(data: unknown): AnalysisJob {
  if (!Array.isArray(data) || data.length !== 1) {
    throw new Error('ANALYSIS_REPOSITORY_RESULT_INVALID');
  }
  return mapJob(data[0]);
}

export function createSupabaseAnalysisRepository(
  options: RepositoryOptions = {},
): AnalysisRepository {
  const getClient = lazyClient(options);

  async function call(name: string, args: Record<string, unknown>, code: string): Promise<AnalysisJob> {
    const client = await getClient();
    const result = await (client as unknown as RpcClient).rpc(name, args);
    if (result.error !== null) throw new Error(code);
    return oneJob(result.data);
  }

  return {
    enqueue(input) {
      return call(
        'enqueue_analysis_job',
        {
          p_client_id: input.clientId,
          p_source_kind: input.sourceKind,
          p_source_id: input.sourceId,
          p_trigger: input.trigger,
        },
        'ANALYSIS_REPOSITORY_ENQUEUE_FAILED',
      );
    },

    async claim(input) {
      const client = await getClient();
      const result = await (client as unknown as RpcClient).rpc('claim_analysis_job', {
        p_worker_id: input.workerId,
        p_lease_seconds: input.leaseSeconds,
      });
      if (result.error !== null) throw new Error('ANALYSIS_REPOSITORY_CLAIM_FAILED');
      if (!Array.isArray(result.data)) throw new Error('ANALYSIS_REPOSITORY_RESULT_INVALID');
      if (result.data.length === 0) return null;
      if (result.data.length !== 1) throw new Error('ANALYSIS_REPOSITORY_RESULT_INVALID');
      return mapJob(result.data[0]);
    },

    async claimTarget(input) {
      const client = await getClient();
      const result = await (client as unknown as RpcClient).rpc('claim_analysis_job', {
        p_analysis_run_id: input.analysisRunId,
        p_client_id: input.clientId,
        p_worker_id: input.workerId,
        p_lease_seconds: input.leaseSeconds,
      });
      if (result.error !== null) throw new Error('ANALYSIS_REPOSITORY_CLAIM_FAILED');
      if (!Array.isArray(result.data)) throw new Error('ANALYSIS_REPOSITORY_RESULT_INVALID');
      if (result.data.length === 0) return null;
      if (result.data.length !== 1) throw new Error('ANALYSIS_REPOSITORY_RESULT_INVALID');
      return mapJob(result.data[0]);
    },

    persistResult(input) {
      return call(
        'persist_analysis_result',
        {
          p_job_id: input.jobId,
          p_worker_id: input.workerId,
          p_client_id: input.clientId,
          p_analysis_run_id: input.analysisRunId,
          p_readiness_score: input.readinessScore,
          p_derived: input.derived,
          p_plan_version: input.plan?.schemaVersion ?? null,
          p_plan_body: input.plan,
        },
        'ANALYSIS_REPOSITORY_PERSIST_FAILED',
      );
    },

    finish(input) {
      return call(
        'finish_analysis_job',
        { p_job_id: input.jobId, p_worker_id: input.workerId },
        'ANALYSIS_REPOSITORY_FINISH_FAILED',
      );
    },

    fail(input) {
      return call(
        'fail_analysis_job',
        {
          p_job_id: input.jobId,
          p_worker_id: input.workerId,
          p_error_code: input.errorCode,
          p_retry: input.retry,
          p_retry_after_seconds: input.retryAfterSeconds,
        },
        'ANALYSIS_REPOSITORY_FAIL_FAILED',
      );
    },

    async isAuthorized(clientId) {
      const client = await getClient();
      const result = await (client as unknown as RpcClient).rpc('analysis_is_authorized', {
        p_client_id: clientId,
      });
      if (result.error !== null || typeof result.data !== 'boolean') {
        throw new Error('ANALYSIS_REPOSITORY_AUTHORIZATION_FAILED');
      }
      return result.data;
    },

    async loadEnrollmentMemberRef(clientId) {
      const client = await getClient();
      const result = await client
        .from('enrollments')
        .select('client_id,crs_member_ref')
        .eq('client_id', clientId)
        .maybeSingle();
      if (result.error !== null) throw new Error('ANALYSIS_REPOSITORY_MEMBER_REF_FAILED');
      if (result.data === null || result.data.crs_member_ref === null) return null;
      if (result.data.client_id !== clientId) throw new Error('ANALYSIS_REPOSITORY_RESULT_INVALID');
      return result.data.crs_member_ref as CrsMemberRef;
    },

    async loadPersistedRun(clientId, analysisRunId) {
      const client = await getClient();
      const result = await client
        .from('analysis_runs')
        .select('id,client_id,readiness_score')
        .eq('id', analysisRunId)
        .eq('client_id', clientId)
        .maybeSingle();
      if (result.error !== null) throw new Error('ANALYSIS_REPOSITORY_RUN_FAILED');
      if (result.data === null) return null;
      return {
        clientId: result.data.client_id,
        analysisRunId: result.data.id,
        readinessScore: result.data.readiness_score,
      };
    },

    async beginPullOperation(input) {
      const client = await getClient();
      const result = await (client as unknown as RpcClient).rpc('crs_pull_operation_begin', {
        p_client_id: input.clientId,
        p_analysis_run_id: input.analysisRunId,
        p_report_codes: [...input.reportCodes],
      });
      if (result.error !== null || !Array.isArray(result.data) || result.data.length !== 1) {
        throw new Error('ANALYSIS_REPOSITORY_PULL_OPERATION_FAILED');
      }
      const row = result.data[0];
      if (
        !isRecord(row) ||
        !hasExactKeys(row, PULL_OPERATION_KEYS) ||
        !isString(row.idempotency_key) ||
        !isString(row.state) ||
        !PULL_OPERATION_STATES.has(row.state as PullOperation['state']) ||
        typeof row.replay !== 'boolean'
      ) {
        throw new Error('ANALYSIS_REPOSITORY_RESULT_INVALID');
      }
      return {
        idempotencyKey: row.idempotency_key,
        state: row.state as PullOperation['state'],
        replay: row.replay,
      };
    },

    async recordPullReturned(input) {
      const client = await getClient();
      const result = await (client as unknown as RpcClient).rpc('crs_pull_operation_returned', {
        p_client_id: input.clientId,
        p_analysis_run_id: input.analysisRunId,
        // Bureau codes only. Nothing that came out of the report body reaches this call.
        p_bureaus: [...input.bureaus],
      });
      if (result.error !== null || typeof result.data !== 'boolean') {
        throw new Error('ANALYSIS_REPOSITORY_PULL_OPERATION_FAILED');
      }
      return result.data;
    },

    async markPullIndeterminate(input) {
      const client = await getClient();
      const result = await (client as unknown as RpcClient).rpc(
        'crs_pull_operation_indeterminate',
        { p_client_id: input.clientId, p_analysis_run_id: input.analysisRunId },
      );
      if (result.error !== null || typeof result.data !== 'boolean') {
        throw new Error('ANALYSIS_REPOSITORY_PULL_OPERATION_FAILED');
      }
      return result.data;
    },
  };
}

interface InMemoryRepositoryOptions {
  authorized?: boolean;
  clock?: AnalysisClock;
  enrollments?: Readonly<Record<string, CrsMemberRef>>;
  throwAfterPersistOnce?: boolean;
}

interface StoredResult {
  clientId: string;
  analysisRunId: string;
  readinessScore: number;
  derivedJson: string;
  planJson: string | null;
}

/** R5C-04. The in-memory mirror of one `crs_pull_operations` row. Identifiers only. */
interface StoredPullOperation {
  clientId: string;
  analysisRunId: string;
  idempotencyKey: string;
  reportCodes: string[];
  state: PullOperation['state'];
  bureausReturned: string[] | null;
}

export interface InMemoryAnalysisRepository extends AnalysisRepository {
  readJobs(): AnalysisJob[];
  readRuns(): PersistedAnalysisRun[];
  readPlanCount(): number;
  readPullOperations(): StoredPullOperation[];
}

const systemAnalysisClock: AnalysisClock = {
  now: () => new Date(),
};

function deterministicUuid(counter: number): string {
  return `00000000-0000-4000-8000-${counter.toString(16).padStart(12, '0')}`;
}

function copyJob(job: AnalysisJob): AnalysisJob {
  return { ...job };
}

export function createInMemoryAnalysisRepository(
  options: InMemoryRepositoryOptions = {},
): InMemoryAnalysisRepository {
  const clock = options.clock ?? systemAnalysisClock;
  const jobs = new Map<string, AnalysisJob>();
  const jobIdBySource = new Map<string, string>();
  const results = new Map<string, StoredResult>();
  const pullOperations = new Map<string, StoredPullOperation>();
  const enrollments = new Map(Object.entries(options.enrollments ?? {}));
  const authorized = options.authorized ?? true;
  let counter = 1;
  let throwAfterPersist = options.throwAfterPersistOnce ?? false;

  function nowIso(): string {
    return clock.now().toISOString();
  }

  function sourceKey(input: EnqueueAnalysisJobInput): string {
    return `analysis.run|client:${input.clientId}|${input.sourceKind}|${input.sourceId}`;
  }

  function requireLeased(jobId: string, workerId: string): AnalysisJob {
    const job = jobs.get(jobId);
    if (
      job === undefined ||
      (job.status !== 'running' && job.status !== 'persisted') ||
      job.leaseOwner !== workerId ||
      job.leaseUntil === null ||
      Date.parse(job.leaseUntil) <= clock.now().getTime()
    ) {
      throw new Error('ANALYSIS_REPOSITORY_LEASE_MISMATCH');
    }
    return job;
  }

  return {
    async enqueue(input) {
      const existingId = jobIdBySource.get(sourceKey(input));
      if (existingId !== undefined) return copyJob(jobs.get(existingId) as AnalysisJob);

      const id = deterministicUuid(counter++);
      const analysisRunId = deterministicUuid(counter++);
      const instant = nowIso();
      const job: AnalysisJob = {
        id,
        job: 'analysis.run',
        clientId: input.clientId,
        sourceKind: input.sourceKind,
        sourceId: input.sourceId,
        analysisRunId,
        trigger: input.trigger,
        subject: `client:${input.clientId}`,
        window: `run:${analysisRunId}`,
        idempotencyKey: `analysis.run|client:${input.clientId}|run:${analysisRunId}`,
        status: 'queued',
        attemptCount: 0,
        availableAt: instant,
        leaseOwner: null,
        leaseUntil: null,
        errorCode: null,
        createdAt: instant,
        updatedAt: instant,
      };
      jobs.set(id, job);
      jobIdBySource.set(sourceKey(input), id);
      return copyJob(job);
    },

    async claim(input: ClaimAnalysisJobInput) {
      const now = clock.now().getTime();
      const job = [...jobs.values()].find(
        (candidate) =>
          Date.parse(candidate.availableAt) <= now &&
          (candidate.status === 'queued' ||
            ((candidate.status === 'running' || candidate.status === 'persisted') &&
              (candidate.leaseUntil === null || Date.parse(candidate.leaseUntil) <= now))),
      );
      if (job === undefined) return null;
      if (job.status !== 'persisted') job.status = 'running';
      job.attemptCount += 1;
      job.leaseOwner = input.workerId;
      job.leaseUntil = new Date(now + input.leaseSeconds * 1_000).toISOString();
      job.errorCode = null;
      job.updatedAt = nowIso();
      return copyJob(job);
    },

    async claimTarget(input: ClaimTargetAnalysisJobInput) {
      const job = [...jobs.values()].find(
        (candidate) =>
          candidate.analysisRunId === input.analysisRunId &&
          candidate.clientId === input.clientId,
      );
      if (job === undefined) return null;
      const now = clock.now().getTime();
      const claimable = Date.parse(job.availableAt) <= now && (
        job.status === 'queued' ||
        ((job.status === 'running' || job.status === 'persisted') &&
          (job.leaseUntil === null || Date.parse(job.leaseUntil) <= now))
      );
      if (!claimable) return copyJob(job);
      if (job.status !== 'persisted') job.status = 'running';
      job.attemptCount += 1;
      job.leaseOwner = input.workerId;
      job.leaseUntil = new Date(now + input.leaseSeconds * 1_000).toISOString();
      job.errorCode = null;
      job.updatedAt = nowIso();
      return copyJob(job);
    },

    async persistResult(input: PersistAnalysisResultInput) {
      const job = requireLeased(input.jobId, input.workerId);
      if (job.clientId !== input.clientId || job.analysisRunId !== input.analysisRunId) {
        throw new Error('ANALYSIS_REPOSITORY_LEASE_MISMATCH');
      }
      const noHit = input.derived.bureausPulled.length === 0 && input.derived.accounts.length === 0;
      if ((input.plan === null) !== noHit || (noHit && input.readinessScore !== 0)) {
        throw new Error('ANALYSIS_REPOSITORY_RESULT_INVALID');
      }
      const next: StoredResult = {
        clientId: input.clientId,
        analysisRunId: input.analysisRunId,
        readinessScore: input.readinessScore,
        derivedJson: JSON.stringify(input.derived),
        planJson: input.plan === null ? null : JSON.stringify(input.plan),
      };
      const existing = results.get(input.analysisRunId);
      if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(next)) {
        throw new Error('ANALYSIS_REPOSITORY_RESULT_MISMATCH');
      }
      results.set(input.analysisRunId, next);
      job.status = 'persisted';
      job.errorCode = null;
      job.updatedAt = nowIso();
      if (throwAfterPersist) {
        throwAfterPersist = false;
        throw new Error('ANALYSIS_REPOSITORY_OUTCOME_UNKNOWN');
      }
      return copyJob(job);
    },

    async finish(input: FinishAnalysisJobInput) {
      const job = requireLeased(input.jobId, input.workerId);
      if (job.status !== 'persisted') throw new Error('ANALYSIS_REPOSITORY_LEASE_MISMATCH');
      job.status = 'succeeded';
      job.leaseOwner = null;
      job.leaseUntil = null;
      job.errorCode = null;
      job.updatedAt = nowIso();
      return copyJob(job);
    },

    async fail(input: FailAnalysisJobInput) {
      const job = requireLeased(input.jobId, input.workerId);
      job.status = input.retry
        ? job.status === 'persisted'
          ? 'persisted'
          : 'queued'
        : 'failed';
      job.availableAt = input.retry
        ? new Date(clock.now().getTime() + input.retryAfterSeconds * 1_000).toISOString()
        : job.availableAt;
      job.leaseOwner = null;
      job.leaseUntil = null;
      job.errorCode = input.errorCode;
      job.updatedAt = nowIso();
      return copyJob(job);
    },

    async loadEnrollmentMemberRef(clientId) {
      return enrollments.get(clientId) ?? null;
    },

    async isAuthorized() {
      return authorized;
    },

    async loadPersistedRun(clientId, analysisRunId) {
      const result = results.get(analysisRunId);
      if (result === undefined || result.clientId !== clientId) return null;
      return { clientId, analysisRunId, readinessScore: result.readinessScore };
    },

    readJobs() {
      return [...jobs.values()].map(copyJob);
    },

    readRuns() {
      return [...results.values()].map((result) => ({
        clientId: result.clientId,
        analysisRunId: result.analysisRunId,
        readinessScore: result.readinessScore,
      }));
    },

    async beginPullOperation(input) {
      const existing = pullOperations.get(input.analysisRunId);
      if (existing !== undefined) {
        if (existing.clientId !== input.clientId) {
          throw new Error('CRS_PULL_OPERATION_CLIENT_MISMATCH');
        }
        return { idempotencyKey: existing.idempotencyKey, state: existing.state, replay: true };
      }
      const idempotencyKey = `analysis:${input.analysisRunId}`;
      pullOperations.set(input.analysisRunId, {
        clientId: input.clientId,
        analysisRunId: input.analysisRunId,
        idempotencyKey,
        reportCodes: [...input.reportCodes].sort(),
        state: 'dispatched',
        bureausReturned: null,
      });
      return { idempotencyKey, state: 'dispatched', replay: false };
    },

    async recordPullReturned(input) {
      const operation = pullOperations.get(input.analysisRunId);
      if (
        operation === undefined ||
        operation.clientId !== input.clientId ||
        operation.state !== 'dispatched'
      ) {
        return false;
      }
      operation.state = 'returned';
      operation.bureausReturned = [...input.bureaus];
      return true;
    },

    async markPullIndeterminate(input) {
      const operation = pullOperations.get(input.analysisRunId);
      if (
        operation === undefined ||
        operation.clientId !== input.clientId ||
        operation.state !== 'dispatched'
      ) {
        return false;
      }
      operation.state = 'indeterminate';
      return true;
    },

    readPlanCount() {
      return [...results.values()].filter((result) => result.planJson !== null).length;
    },

    readPullOperations() {
      return [...pullOperations.values()].map((operation) => ({
        ...operation,
        reportCodes: [...operation.reportCodes],
        bureausReturned: operation.bureausReturned === null ? null : [...operation.bureausReturned],
      }));
    },
  };
}
