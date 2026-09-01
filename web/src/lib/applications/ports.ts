/**
 * The seams Phase 11's service layer is written against.
 *
 * Same shape as `web/src/lib/analysis/ports.ts`: an interface per collaborator,
 * plus a frozen no-op implementation for the one collaborator that has nothing
 * real behind it yet. Keeping the service written against these rather than
 * against Supabase is what lets plan 04's tests run with no database at all.
 */

import type {
  AddNoteInput,
  Application,
  ApplicationNote,
  BankOutcomeStats,
  BankRetrievalDocument,
  CreateApplicationInput,
  FailRefreshJobInput,
  Outcome,
  OutcomeNotification,
  OutcomeRefreshJob,
  OutcomeReview,
  RecordOutcomeInput,
  ReviewOutcomeInput,
  ReviewOutcomeResult,
  UpdateApplicationInput,
  VaultWritebackRow,
  VaultWritebackState,
} from "./types.ts";

export interface BankRetrievalDocumentRepository {
  listBankRetrievalDocuments(bankRefs?: readonly string[]): Promise<BankRetrievalDocument[]>;
}

export interface ApplicationsRepository {
  listApplications(clientId: string, limit?: number): Promise<Application[]>;
  readApplication(applicationId: string): Promise<Application | null>;
  createApplication(input: CreateApplicationInput): Promise<Application>;
  updateApplication(input: UpdateApplicationInput): Promise<Application>;

  listNotes(applicationId: string): Promise<ApplicationNote[]>;
  addNote(input: AddNoteInput): Promise<ApplicationNote>;

  /** Returns the new outcome's id; the row and its review are read back separately. */
  recordOutcome(input: RecordOutcomeInput): Promise<string>;
  readOutcome(outcomeId: string): Promise<Outcome | null>;
  listOutcomes(clientId: string, limit?: number): Promise<Outcome[]>;
  readReview(outcomeId: string): Promise<OutcomeReview | null>;
  /**
   * The reviews for a batch of outcomes, so a list endpoint pairs each outcome
   * with its review state in one round trip rather than one per row.
   */
  listReviews(outcomeIds: readonly string[]): Promise<OutcomeReview[]>;
  /** The platform-admin correction queue, oldest first. */
  listPendingReviews(): Promise<OutcomeReview[]>;
  reviewOutcome(input: ReviewOutcomeInput): Promise<ReviewOutcomeResult>;

  readBankStats(bankRef: string): Promise<BankOutcomeStats | null>;
  listBankStats(bankRefs: readonly string[]): Promise<BankOutcomeStats[]>;
  listNotifications(profileId: string): Promise<OutcomeNotification[]>;

  /**
   * The queue side. Every one of these reaches a table revoked from
   * `authenticated`, so an implementation uses the admin client and nothing
   * else. A claim that returns null means the queue is empty, not that
   * something failed.
   */
  enqueueRefreshJob(bankRef: string, changeId: string): Promise<OutcomeRefreshJob>;
  claimRefreshJob(
    workerId: string,
    leaseSeconds: number,
    target?: { bankRef: string; changeId: string },
  ): Promise<OutcomeRefreshJob | null>;
  runRefreshJob(jobId: string, workerId: string): Promise<OutcomeRefreshJob>;
  failRefreshJob(input: FailRefreshJobInput): Promise<OutcomeRefreshJob>;

  listWritebackOutbox(state: VaultWritebackState): Promise<VaultWritebackRow[]>;
  /**
   * The one row `review_outcome` staged for an outcome, by the outbox's unique
   * `outcome_id`. The write-back needs the row the database built — its target,
   * its allow-listed payload and its id — and a scan of every recorded row
   * filtered in TypeScript would be the same answer at a worse cost.
   */
  readWriteback(outcomeId: string): Promise<VaultWritebackRow | null>;
  markWriteback(
    id: string,
    state: VaultWritebackState,
    failureCode: string | null,
  ): Promise<void>;
}

export interface VaultWritebackDeliveryResult {
  state: VaultWritebackState;
  failureCode?: string;
}

export interface VaultWritebackDriver {
  deliver(row: VaultWritebackRow): Promise<VaultWritebackDeliveryResult>;
}

export interface ApplicationsClock {
  now(): Date;
}

export interface ApplicationsWorkerIdentity {
  workerId(): string;
}

/**
 * The default write-back driver, and the only one reachable without
 * credentials. It leaves the row exactly where `review_outcome` put it, which
 * is the honest answer for a system with no VAULT keys: the intent is durable
 * and replayable, and nothing claims to have been sent. The `supabase` arm that
 * would actually deliver is KA-11-1 and reports SKIPPED, never PASSED.
 */
export const noopVaultWritebackDriver: VaultWritebackDriver = Object.freeze({
  deliver(): Promise<VaultWritebackDeliveryResult> {
    return Promise.resolve({ state: "recorded" });
  },
});

export const systemApplicationsClock: ApplicationsClock = Object.freeze({
  now(): Date {
    return new Date();
  },
});
