import { randomUUID } from 'node:crypto';

import { crsPullIsReplaySafe } from '../crs/adapter.ts';
import { CRS_BUREAU_CODES, CRS_REPORT_CODE_BY_BUREAU } from '../crs/constants.ts';
import { getCrsAdapter } from '../crs/types.ts';
import { featureFlag } from '../env.ts';
import { getPlanDriver } from '../llm/driver.ts';
import { runPlanEngine } from '../llm/engine.ts';
import { getNarrativeDriver } from '../llm/narrative/driver.ts';
import { runNarrativeEngine } from '../llm/narrative/engine.ts';
import { buildFactsPack } from '../llm/narrative/facts.ts';
import { trackerAnalysisStageTracker } from '../tracker/analysis-adapter.ts';
import { assertPullAllowed } from '../ancillary/index.ts';
import { loadParsedUploadFeatures } from '../ancillary/report-uploads.ts';
import { extractFeatures } from './features.ts';
import { createSupabaseAnalysisRepository } from './repository.ts';

import type { CrsAdapter, ReportCode } from '../crs/types.ts';
import type { EnvSource } from '../env.ts';
import type { FundingReadinessPlanV1, PlanDriver } from '../llm/types.ts';
import type { FactsPackV2 } from '../llm/narrative/contract.ts';
import type { NarrativeDriver } from '../llm/narrative/driver.ts';
import type {
  AnalysisJob,
  AnalysisJobErrorCode,
  AnalysisJobSourceKind,
  AnalysisRepository,
  AnalysisStageTracker,
  AnalysisTrigger,
} from './ports.ts';
import type { DerivedFeatures } from './features.ts';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_DRAIN_JOBS = 100;
const MAX_ATTEMPTS = 3;
const DEFAULT_LEASE_SECONDS = 300;
const DEFAULT_RETRY_AFTER_SECONDS = 60;
/**
 * The one error `runPlanEngine` raises itself, as against everything it lets
 * through from the driver. Restated here rather than imported because the engine
 * is another lane's module and does not export it; deliberately not exported from
 * this one either, so the test that pins this mapping has to obtain the sentinel
 * by actually running the engine instead of reading it back off the code it is
 * meant to be checking.
 */
const PLAN_ENGINE_REJECTION = 'PLAN_REJECTED';
const ALL_REPORT_CODES: ReportCode[] = CRS_BUREAU_CODES.map(
  (bureau) => CRS_REPORT_CODE_BY_BUREAU[bureau],
);
const PROCESS_WORKER_ID = randomUUID();

const productionRepository = createSupabaseAnalysisRepository();

export interface AnalysisWorkerDependencies {
  env: EnvSource;
  repository: AnalysisRepository;
  tracker: AnalysisStageTracker;
  getAdapter(): CrsAdapter;
  getDriver(): PlanDriver;
  getNarrativeDriver(): NarrativeDriver;
  /**
   * The seam to the rules half. Typed as a dependency rather than imported at the call site so a
   * test can hand the worker a pack without reaching for the rules lane's module at all, and so the
   * placeholder in `narrative/facts.ts` is replaceable by a merge rather than by an edit here.
   */
  buildFactsPack(features: DerivedFeatures, plan: FundingReadinessPlanV1): FactsPackV2;
  assertPullAllowed(clientId: string, cause: AnalysisTrigger, sourceId: string): Promise<{ allowed: boolean; reason?: string }>;
  loadParsedUploadFeatures(clientId: string, uploadId: string): Promise<DerivedFeatures | null>;
  leaseSeconds: number;
  retryAfterSeconds: number;
}

const productionDependencies: AnalysisWorkerDependencies = {
  env: process.env,
  repository: productionRepository,
  tracker: trackerAnalysisStageTracker,
  getAdapter: getCrsAdapter,
  getDriver: getPlanDriver,
  getNarrativeDriver,
  buildFactsPack,
  assertPullAllowed,
  loadParsedUploadFeatures,
  leaseSeconds: DEFAULT_LEASE_SECONDS,
  retryAfterSeconds: DEFAULT_RETRY_AFTER_SECONDS,
};

export function getAnalysisWorkerId(): string {
  return PROCESS_WORKER_ID;
}

type WorkerDependencyOverrides = Partial<AnalysisWorkerDependencies>;

function dependencies(overrides: WorkerDependencyOverrides): AnalysisWorkerDependencies {
  return { ...productionDependencies, ...overrides };
}

function requireUuid(value: string, code: string): void {
  if (!UUID_PATTERN.test(value)) throw new Error(code);
}

function assertEnqueueInput(input: {
  clientId: string;
  sourceKind: AnalysisJobSourceKind;
  sourceId: string;
  trigger: AnalysisTrigger;
}): void {
  requireUuid(input.clientId, 'ANALYSIS_CLIENT_ID_INVALID');
  requireUuid(input.sourceId, 'ANALYSIS_SOURCE_ID_INVALID');
  if (!['enrollment', 'monitoring_event', 'document_upload', 'force_pull'].includes(input.sourceKind)) {
    throw new Error('ANALYSIS_SOURCE_KIND_INVALID');
  }
  if (!['scheduled', 'alert', 'force_pull', 'upload'].includes(input.trigger)) {
    throw new Error('ANALYSIS_TRIGGER_INVALID');
  }
  const sourceTrigger: Readonly<Record<AnalysisJobSourceKind, AnalysisTrigger>> = {
    enrollment: 'scheduled',
    monitoring_event: 'alert',
    document_upload: 'upload',
    force_pull: 'force_pull',
  };
  if (sourceTrigger[input.sourceKind] !== input.trigger) {
    throw new Error('ANALYSIS_SOURCE_TRIGGER_INVALID');
  }
}

export interface EnqueueAnalysisRunInput {
  clientId: string;
  sourceKind: AnalysisJobSourceKind;
  sourceId: string;
  trigger: AnalysisTrigger;
}

export async function enqueueAnalysisRun(
  input: EnqueueAnalysisRunInput,
  overrides: WorkerDependencyOverrides = {},
): Promise<AnalysisJob | null> {
  const deps = dependencies(overrides);
  assertEnqueueInput(input);
  if (!featureFlag('FEATURE_ANALYSIS', deps.env)) return null;
  const allowance = await deps.assertPullAllowed(input.clientId, input.trigger, input.sourceId);
  if (!allowance.allowed) return null;
  return deps.repository.enqueue({
    clientId: input.clientId,
    sourceKind: input.sourceKind,
    sourceId: input.sourceId,
    trigger: input.trigger,
  });
}

export interface EnrollmentAnalysisInput {
  clientId: string;
  enrollmentId: string;
}

export function onEnrollmentSucceeded(
  input: EnrollmentAnalysisInput,
  overrides: WorkerDependencyOverrides = {},
): Promise<AnalysisJob | null> {
  return enqueueAnalysisRun(
    {
      clientId: input.clientId,
      sourceKind: 'enrollment',
      sourceId: input.enrollmentId,
      trigger: 'scheduled',
    },
    overrides,
  );
}

class WorkerStageFailure extends Error {
  readonly code: AnalysisJobErrorCode;

  constructor(code: AnalysisJobErrorCode) {
    super('ANALYSIS_WORKER_STAGE_FAILED');
    this.name = 'WorkerStageFailure';
    this.code = code;
  }
}

async function loadPersistedScore(
  job: AnalysisJob,
  deps: AnalysisWorkerDependencies,
): Promise<number> {
  try {
    const run = await deps.repository.loadPersistedRun(job.clientId, job.analysisRunId);
    if (
      run === null ||
      run.clientId !== job.clientId ||
      run.analysisRunId !== job.analysisRunId
    ) {
      throw new WorkerStageFailure('persistence_failed');
    }
    return run.readinessScore;
  } catch (error) {
    if (error instanceof WorkerStageFailure) throw error;
    throw new WorkerStageFailure('persistence_failed');
  }
}

async function createAndPersistResult(
  job: AnalysisJob,
  deps: AnalysisWorkerDependencies,
  workerId: string,
): Promise<number> {
  let derived: DerivedFeatures;
  if (job.sourceKind === 'document_upload') {
    try {
      const uploaded = await deps.loadParsedUploadFeatures(job.clientId, job.sourceId);
      if (uploaded === null) throw new WorkerStageFailure('source_unavailable');
      derived = uploaded;
    } catch (error) {
      if (error instanceof WorkerStageFailure) throw error;
      throw new WorkerStageFailure('source_unavailable');
    }
  } else {
    try {
      if (!await deps.repository.isAuthorized(job.clientId)) {
        throw new WorkerStageFailure('source_unavailable');
      }
    } catch (error) {
      if (error instanceof WorkerStageFailure) throw error;
      throw new WorkerStageFailure('source_unavailable');
    }

    let memberRef;
    try {
      memberRef = await deps.repository.loadEnrollmentMemberRef(job.clientId);
    } catch {
      throw new WorkerStageFailure('source_unavailable');
    }
    if (memberRef === null) throw new WorkerStageFailure('source_unavailable');

    let adapter;
    try {
      adapter = deps.getAdapter();
    } catch {
      throw new WorkerStageFailure('configuration_error');
    }

    // R5C-04. The pre-call record goes down before the call, so a crash between the provider's
    // response and the first persistence commit leaves evidence that a request went out. Without
    // it, lease recovery re-ran `softPull` and bought the same per-report-billed reports again.
    let operation;
    try {
      operation = await deps.repository.beginPullOperation({
        clientId: job.clientId,
        analysisRunId: job.analysisRunId,
        reportCodes: ALL_REPORT_CODES,
      });
    } catch {
      throw new WorkerStageFailure('persistence_failed');
    }

    // A row that already existed means a request for this operation has already reached the
    // provider. On a billable driver that ends the attempt with no outbound call at all: buying the
    // reports again is the defect, and an ambiguous charge is a thing for a person to resolve, not
    // for a retry loop to resolve by spending more. The mock driver fabricates locally, so a repeat
    // costs nothing and the ordinary local and end-to-end paths are unchanged.
    if (operation.replay && !crsPullIsReplaySafe(adapter)) {
      try {
        await deps.repository.markPullIndeterminate({
          clientId: job.clientId,
          analysisRunId: job.analysisRunId,
        });
      } catch {
        // The classification is a courtesy to whoever reconciles this; the refusal below is the
        // invariant, and it does not depend on the write succeeding.
      }
      throw new WorkerStageFailure('pull_indeterminate');
    }

    let report;
    try {
      // The key is derived from the analysis operation, so it is the same value on every attempt.
      report = await adapter.softPull(memberRef, ALL_REPORT_CODES, {
        idempotencyKey: operation.idempotencyKey,
      });
    } catch {
      throw new WorkerStageFailure('pull_failed');
    }

    try {
      // Bureau codes, nothing else. The report body never leaves this function.
      await deps.repository.recordPullReturned({
        clientId: job.clientId,
        analysisRunId: job.analysisRunId,
        bureaus: report.bureaus,
      });
    } catch {
      throw new WorkerStageFailure('persistence_failed');
    }

    try {
      derived = extractFeatures(report);
    } catch {
      throw new WorkerStageFailure('pull_failed');
    }
  }

  let plan;
  try {
    plan = await runPlanEngine(deps.getDriver(), derived);
  } catch (error) {
    // Migration 389. `runPlanEngine` raises exactly one error of its own, and this
    // is the only signal that separates the two cases: the engine ran its
    // candidate loop and neither the supervisor nor the deterministic evaluator
    // approved. Everything else reaching here escaped `driver.generateCandidate`
    // as a raw error — a 429, a socket reset, a truncated body — and means no
    // candidate ever existed to judge. The bare `catch` that used to be here
    // flattened both into `plan_rejected`, so a hosted row reading `plan_rejected`
    // was evidence of neither, and a production diagnosis had to go around it by
    // correlating against `eval_runs`.
    //
    // BOTH REMAIN RETRYABLE, and that is a decision rather than an oversight. The
    // classification below is an inference from a caught error's message, so
    // anything that perturbs that sentinel silently reclassifies transport faults;
    // making either code terminal would then let one transient 503 destroy a
    // consumer's analysis permanently, recoverable only by hand. A retryable job
    // self-heals as soon as the prompt or evaluator seam is corrected. This split
    // is diagnosability, not policy.
    throw new WorkerStageFailure(
      error instanceof Error && error.message === PLAN_ENGINE_REJECTION
        ? 'plan_rejected'
        : 'plan_unavailable',
    );
  }

  const readinessScore = plan?.readinessScore ?? 0;
  try {
    await deps.repository.persistResult({
      jobId: job.id,
      workerId,
      clientId: job.clientId,
      analysisRunId: job.analysisRunId,
      readinessScore,
      derived,
      plan,
    });
  } catch {
    throw new WorkerStageFailure('persistence_failed');
  }

  await attachNarrative(job, derived, plan, deps);

  return readinessScore;
}

/**
 * The narrative, attached after the analysis is durable, and unable to hurt it.
 *
 * Everything above this point can fail a job and get it retried, because everything above it is
 * the analysis. This is prose about an analysis that is already computed, already scored and
 * already committed, so every failure here — the facts pack, the model, the checker, the write — is
 * caught, logged once and dropped. A consumer whose narrative did not arrive sees the surface's
 * template copy; a consumer whose analysis was thrown away over a model timeout would see nothing
 * and wait for a retry, and that trade is not close.
 *
 * `plan` being null means the pull was a no-hit: there is no plan row to attach to and nothing to
 * narrate, so the whole step is skipped rather than attempted and swallowed.
 */
async function attachNarrative(
  job: AnalysisJob,
  derived: DerivedFeatures,
  plan: FundingReadinessPlanV1 | null,
  deps: AnalysisWorkerDependencies,
): Promise<void> {
  if (plan === null) return;
  try {
    const pack = deps.buildFactsPack(derived, plan);
    const narrative = await runNarrativeEngine(deps.getNarrativeDriver(), pack);
    if (narrative === null) return;
    await deps.repository.attachNarrative({ analysisRunId: job.analysisRunId, narrative });
  } catch (error) {
    // One line, no report content, no identifiers beyond the run this already logs against.
    console.warn(JSON.stringify({
      event: 'analysis.narrative_skipped',
      analysisRunId: job.analysisRunId,
      reason: error instanceof Error ? error.message : 'unknown',
    }));
  }
}

async function notifyAndFinish(
  job: AnalysisJob,
  readinessScore: number,
  deps: AnalysisWorkerDependencies,
  workerId: string,
): Promise<void> {
  try {
    await deps.tracker.recordAnalysisCompleted({
      clientId: job.clientId,
      analysisRunId: job.analysisRunId,
      readinessScore,
    });
  } catch {
    throw new WorkerStageFailure('tracker_failed');
  }

  try {
    await deps.repository.finish({ jobId: job.id, workerId });
  } catch {
    throw new WorkerStageFailure('persistence_failed');
  }
}

async function failClaim(
  job: AnalysisJob,
  failure: WorkerStageFailure,
  deps: AnalysisWorkerDependencies,
  workerId: string,
): Promise<void> {
  try {
    await deps.repository.fail({
      jobId: job.id,
      workerId,
      errorCode: failure.code,
      // R5C-04. `pull_indeterminate` is never retried: the retry is the second purchase the code
      // exists to prevent, and no number of attempts makes an ambiguous charge less ambiguous.
      retry: failure.code !== 'pull_indeterminate' && job.attemptCount < MAX_ATTEMPTS,
      retryAfterSeconds: deps.retryAfterSeconds,
    });
  } catch {
    // An unknown finish/persist outcome can already have released the lease. The durable row is
    // authoritative, so the next bounded drain resolves it without reflecting caught metadata.
  }
}

export interface DrainAnalysisQueueInput {
  target?: { analysisRunId: string; clientId: string };
  maxJobs: number;
  workerId: string;
}

export interface DrainAnalysisQueueResult {
  claimed: number;
  succeeded: number;
  failed: number;
  pending?: number;
  terminal?: number;
  /**
   * Which terminal status the targeted job was already in. `analysis.run`'s
   * handler needs the distinction: migration 370 revives an inner row whose
   * status is `failed`, but it only ever reaches one through an *outer* row that
   * is also `failed`, so a caller that reports every terminal status the same
   * way puts the pair beyond that sweep.
   */
  terminalStatus?: 'succeeded' | 'failed' | 'cancelled';
  /**
   * The stage code of the last claim this drain failed, so a caller can say why
   * rather than only that. A closed domain constant — it reaches a runtime log
   * and the tick's response body.
   */
  errorCode?: AnalysisJobErrorCode;
  /**
   * Why a targeted drain came back with nothing done. `claim_analysis_job`
   * (migration 252) has two quite different ways of declining, and `pending`
   * alone reported them identically:
   *
   *   `missing`     — no `analysis_jobs` row for this (client, run) at all. The
   *                   outer tuple points at nothing, so no number of attempts
   *                   will satisfy it; `revive_row_window_queue_row` agrees and
   *                   returns false for it.
   *   `unclaimable` — the row is there and the claim was declined: it is inside
   *                   its own `available_at` retry backoff, or another worker's
   *                   lease is still live. Ordinary contention; it resolves on
   *                   its own.
   *
   * One is a wiring or data defect and the other is a Tuesday, and production
   * logged both as `handler_failed` with no detail.
   */
  pendingReason?: 'missing' | 'unclaimable';
}

export async function drainAnalysisQueue(
  input: DrainAnalysisQueueInput,
  overrides: WorkerDependencyOverrides = {},
): Promise<DrainAnalysisQueueResult> {
  const deps = dependencies(overrides);
  if (!featureFlag('FEATURE_ANALYSIS', deps.env)) {
    return { claimed: 0, succeeded: 0, failed: 0 };
  }
  requireUuid(input.workerId, 'ANALYSIS_WORKER_ID_INVALID');
  if (input.target) {
    requireUuid(input.target.analysisRunId, 'ANALYSIS_RUN_ID_INVALID');
    requireUuid(input.target.clientId, 'ANALYSIS_CLIENT_ID_INVALID');
  }
  if (!Number.isInteger(input.maxJobs) || input.maxJobs < 0 || input.maxJobs > MAX_DRAIN_JOBS) {
    throw new Error('ANALYSIS_MAX_JOBS_INVALID');
  }

  const result: DrainAnalysisQueueResult = { claimed: 0, succeeded: 0, failed: 0 };
  for (let index = 0; index < input.maxJobs; index += 1) {
    let job;
    try {
      job = input.target
        ? await deps.repository.claimTarget({
            ...input.target,
            workerId: input.workerId,
            leaseSeconds: deps.leaseSeconds,
          })
        : await deps.repository.claim({
            workerId: input.workerId,
            leaseSeconds: deps.leaseSeconds,
          });
    } catch {
      throw new Error('ANALYSIS_WORKER_CLAIM_FAILED');
    }
    if (job === null) {
      if (input.target) {
        result.pending = 1;
        result.pendingReason = 'missing';
      }
      break;
    }
    if (input.target && (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled')) {
      result.terminal = 1;
      result.terminalStatus = job.status;
      break;
    }
    if (input.target && (job.status === 'queued' || job.leaseOwner !== input.workerId)) {
      result.pending = 1;
      result.pendingReason = 'unclaimable';
      break;
    }
    result.claimed += 1;

    try {
      const readinessScore = job.status === 'persisted'
        ? await loadPersistedScore(job, deps)
        : await createAndPersistResult(job, deps, input.workerId);
      await notifyAndFinish(job, readinessScore, deps, input.workerId);
      result.succeeded += 1;
    } catch (error) {
      const failure = error instanceof WorkerStageFailure
        ? error
        : new WorkerStageFailure('configuration_error');
      await failClaim(job, failure, deps, input.workerId);
      result.failed += 1;
      result.errorCode = failure.code;
    }
  }
  return result;
}
