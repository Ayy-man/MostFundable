import type { CrsMemberRef } from '../crs/types.ts';
import type { DerivedFeatures } from './features.ts';
import type { FundingReadinessPlanV1 } from '../llm/types.ts';

export type AnalysisJobSourceKind =
  | 'enrollment'
  | 'monitoring_event'
  | 'document_upload'
  | 'force_pull';
export type AnalysisTrigger = 'scheduled' | 'alert' | 'force_pull' | 'upload';
export type AnalysisJobStatus = 'queued' | 'running' | 'persisted' | 'succeeded' | 'failed' | 'cancelled';
export type AnalysisJobErrorCode =
  | 'source_unavailable'
  | 'pull_failed'
  | 'plan_rejected'
  | 'persistence_failed'
  | 'tracker_failed'
  | 'configuration_error'
  /**
   * R5C-04. A durable record says this operation already reached the provider, and the provider
   * bills per report, so recovery refused to call again. Never retried: retrying is the purchase
   * the code exists to prevent.
   */
  | 'pull_indeterminate'
  /**
   * Migration 389. The plan stage produced no candidate — the provider call failed, timed out, or
   * came back unusable — as against `plan_rejected`, which now means only what its name says: a
   * candidate was produced and the engine refused it. Both stay retryable; the split is so a
   * durable row can answer which happened.
   */
  | 'plan_unavailable';

export interface AnalysisJob {
  id: string;
  job: 'analysis.run';
  clientId: string;
  sourceKind: AnalysisJobSourceKind;
  sourceId: string;
  analysisRunId: string;
  trigger: AnalysisTrigger;
  subject: string;
  window: string;
  idempotencyKey: string;
  status: AnalysisJobStatus;
  attemptCount: number;
  availableAt: string;
  leaseOwner: string | null;
  leaseUntil: string | null;
  errorCode: AnalysisJobErrorCode | null;
  createdAt: string;
  updatedAt: string;
}

export interface EnqueueAnalysisJobInput {
  clientId: string;
  sourceKind: AnalysisJobSourceKind;
  sourceId: string;
  trigger: AnalysisTrigger;
}

export interface ClaimAnalysisJobInput {
  workerId: string;
  leaseSeconds: number;
}

export interface ClaimTargetAnalysisJobInput extends ClaimAnalysisJobInput {
  analysisRunId: string;
  clientId: string;
}

export interface PersistAnalysisResultInput {
  jobId: string;
  workerId: string;
  clientId: string;
  analysisRunId: string;
  readinessScore: number;
  derived: DerivedFeatures;
  plan: FundingReadinessPlanV1 | null;
}

export interface FinishAnalysisJobInput {
  jobId: string;
  workerId: string;
}

export interface FailAnalysisJobInput extends FinishAnalysisJobInput {
  errorCode: AnalysisJobErrorCode;
  retry: boolean;
  retryAfterSeconds: number;
}

export interface PersistedAnalysisRun {
  clientId: string;
  analysisRunId: string;
  readinessScore: number;
}

export interface BeginPullOperationInput {
  clientId: string;
  analysisRunId: string;
  reportCodes: readonly string[];
}

/**
 * R5C-04. The durable pre-call record, read back.
 *
 * It carries identifiers and one classification and nothing else — never any part of a report.
 * `replay` is the whole point: it is the difference between "never pulled" and "a request for this
 * operation already went out", which is what recovery could not tell before.
 */
export interface PullOperation {
  /** Derived from the analysis operation, so it is identical on every attempt at it. */
  idempotencyKey: string;
  state: 'dispatched' | 'returned' | 'indeterminate';
  replay: boolean;
}

export interface SettlePullOperationInput {
  clientId: string;
  analysisRunId: string;
}

export interface RecordPullReturnedInput extends SettlePullOperationInput {
  /** Bureau codes only. Nothing derived from the report's contents. */
  bureaus: readonly string[];
}

export interface AnalysisRepository {
  enqueue(input: EnqueueAnalysisJobInput): Promise<AnalysisJob>;
  claim(input: ClaimAnalysisJobInput): Promise<AnalysisJob | null>;
  claimTarget(input: ClaimTargetAnalysisJobInput): Promise<AnalysisJob | null>;
  persistResult(input: PersistAnalysisResultInput): Promise<AnalysisJob>;
  finish(input: FinishAnalysisJobInput): Promise<AnalysisJob>;
  fail(input: FailAnalysisJobInput): Promise<AnalysisJob>;
  isAuthorized(clientId: string): Promise<boolean>;
  loadEnrollmentMemberRef(clientId: string): Promise<CrsMemberRef | null>;
  loadPersistedRun(clientId: string, analysisRunId: string): Promise<PersistedAnalysisRun | null>;
  /** Records the intent to call the provider, before the call. See {@link PullOperation}. */
  beginPullOperation(input: BeginPullOperationInput): Promise<PullOperation>;
  recordPullReturned(input: RecordPullReturnedInput): Promise<boolean>;
  markPullIndeterminate(input: SettlePullOperationInput): Promise<boolean>;
}

export interface AnalysisClock {
  now(): Date;
}

export interface AnalysisWorkerIdentity {
  workerId(): string;
}

export interface AnalysisCompletedInput {
  clientId: string;
  analysisRunId: string;
  readinessScore: number;
}

export interface AnalysisStageTracker {
  /** Implementations must deduplicate repeated calls on analysisRunId. */
  recordAnalysisCompleted(input: AnalysisCompletedInput): Promise<void>;
}

export const noopAnalysisStageTracker: AnalysisStageTracker = Object.freeze({
  recordAnalysisCompleted(): Promise<void> {
    return Promise.resolve();
  },
});
