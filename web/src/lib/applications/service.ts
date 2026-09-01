/**
 * The route-facing API for applications and outcomes.
 *
 * Every function takes its collaborators as a second argument with a production
 * default, in the shape `web/src/lib/enrollment/service.ts:49` uses. The default
 * is resolved lazily through dynamic imports, so a caller that injects its own
 * dependencies never loads the Supabase repository, the tracker seam or the
 * write-back driver at all — which is what lets this file's tests run with no
 * database, no credential and no environment.
 *
 * Two things this layer deliberately does not do. It does not decide whether an
 * outcome counts: `outcomes.state` defaults to `counted` in the schema (D-01),
 * so APPS-02 holds even if every line here is wrong. And it does not open the
 * paired review or enqueue the recompute: `public.record_outcome` and the two
 * triggers behind it do that in one transaction, so there is no ordering this
 * layer could get wrong.
 */

import { APPLICATION_LIST_CEILING, ApplicationsError } from "./types.ts";

import type {
  ApplicationsRepository,
  BankRetrievalDocumentRepository,
  VaultWritebackDeliveryResult,
  VaultWritebackDriver,
} from "./ports.ts";
import type { ApplicationStagePort, ApplicationStageResult } from "./stage.ts";
import type {
  AddNoteInput,
  Application,
  ApplicationNote,
  BankOutcomeStats,
  BankRetrievalDocument,
  CreateApplicationInput,
  Outcome,
  OutcomeReview,
  RecordOutcomeInput,
  ReviewOutcomeInput,
  ReviewOutcomeResult,
  UpdateApplicationInput,
  VaultWritebackState,
} from "./types.ts";

export async function listBankRetrievalDocuments(
  bankRefs?: readonly string[],
  supplied?: BankRetrievalDocumentRepository,
): Promise<BankRetrievalDocument[]> {
  if (bankRefs?.length === 0) return [];
  const repository = supplied ?? (await import("./repository.ts")).bankRetrievalDocumentRepository;
  return repository.listBankRetrievalDocuments(bankRefs);
}

export interface ApplicationsServiceDependencies {
  repository: ApplicationsRepository;
  stage: ApplicationStagePort;
  writeback: VaultWritebackDriver;
}

export interface CreateApplicationResult {
  application: Application;
  /** Best effort. See `stage.ts` for why `unavailable` is the demo-mode norm. */
  stage: ApplicationStageResult;
}

export interface RecordOutcomeResult {
  outcome: Outcome;
  /** The review the trigger opened, always `pending` on a fresh outcome. */
  review: OutcomeReview | null;
  stage: ApplicationStageResult;
}

export interface ReadOutcomeResult {
  outcome: Outcome;
  review: OutcomeReview | null;
}

export interface ReviewOutcomeServiceResult extends ReviewOutcomeResult {
  /** Null when no delivery was attempted: a repeat decision, or a correction. */
  delivery: VaultWritebackDeliveryResult | null;
}

async function defaultDependencies(): Promise<ApplicationsServiceDependencies> {
  const [{ supabaseApplicationsRepository }, stage, { createVaultWritebackDriver }] =
    await Promise.all([
      import("./repository.ts"),
      import("./stage.ts"),
      import("./writeback.ts"),
    ]);

  return {
    repository: supabaseApplicationsRepository,
    stage: stage.trackerApplicationStagePort,
    writeback: createVaultWritebackDriver(process.env),
  };
}

function dependencies(
  supplied?: ApplicationsServiceDependencies,
): Promise<ApplicationsServiceDependencies> {
  return supplied === undefined
    ? defaultDependencies()
    : Promise.resolve(supplied);
}

// --- Applications ----------------------------------------------------------

export async function listApplications(
  clientId: string,
  supplied?: ApplicationsServiceDependencies,
): Promise<Application[]> {
  const deps = await dependencies(supplied);
  return deps.repository.listApplications(clientId);
}

export async function listApplicationsBounded(
  clientId: string,
  limit: number,
  supplied?: ApplicationsServiceDependencies,
): Promise<Application[]> {
  const deps = await dependencies(supplied);
  return deps.repository.listApplications(clientId, Math.min(APPLICATION_LIST_CEILING, Math.max(1, Math.trunc(limit))));
}

export async function listApplicationsByBankBounded(bankRef: string, limit: number): Promise<Application[]> {
  const repository = await import("./repository.ts");
  return repository.listVisibleApplicationsByBank(bankRef, limit);
}

export async function readApplication(
  applicationId: string,
  supplied?: ApplicationsServiceDependencies,
): Promise<Application | null> {
  const deps = await dependencies(supplied);
  return deps.repository.readApplication(applicationId);
}

/**
 * Create an application and, best effort, move the client to Applying.
 *
 * The stage move is attempted after the row exists and its result is reported
 * rather than thrown: a client who cannot be moved still has the application,
 * and an environment that cannot move stages must not stop one being recorded.
 */
export async function createApplication(
  input: CreateApplicationInput,
  supplied?: ApplicationsServiceDependencies,
): Promise<CreateApplicationResult> {
  const deps = await dependencies(supplied);
  const application = await deps.repository.createApplication(input);
  const stage = await deps.stage.advance(application.clientId, "applying");
  return { application, stage };
}

export async function updateApplication(
  input: UpdateApplicationInput,
  supplied?: ApplicationsServiceDependencies,
): Promise<Application> {
  const deps = await dependencies(supplied);
  return deps.repository.updateApplication(input);
}

// --- Notes -----------------------------------------------------------------

export async function listNotes(
  applicationId: string,
  supplied?: ApplicationsServiceDependencies,
): Promise<ApplicationNote[]> {
  const deps = await dependencies(supplied);
  return deps.repository.listNotes(applicationId);
}

/**
 * Add a note, refusing an unattested operator note before the database has to.
 *
 * `application_notes_operator_attestation` is still the authority — it holds
 * against a direct insert this function never sees — and this check exists only
 * so the caller gets `attestation_required` instead of a generic constraint
 * violation that has to be decoded from a SQLSTATE.
 */
export async function addNote(
  input: AddNoteInput,
  supplied?: ApplicationsServiceDependencies,
): Promise<ApplicationNote> {
  if (input.authorKind === "operator" && !input.attested) {
    throw new ApplicationsError("attestation_required");
  }
  const deps = await dependencies(supplied);
  return deps.repository.addNote(input);
}

// --- Outcomes --------------------------------------------------------------

/**
 * Record an outcome. It counts on entry, by column default, and its review row
 * opens `pending` in the same transaction.
 *
 * An approved outcome also asks the tracker for Funded, best effort. A stage
 * that cannot move never fails the outcome that triggered it — by the time this
 * runs the outcome is already durable and already counted.
 */
export async function recordOutcome(
  input: RecordOutcomeInput,
  supplied?: ApplicationsServiceDependencies,
): Promise<RecordOutcomeResult> {
  const deps = await dependencies(supplied);
  const outcomeId = await deps.repository.recordOutcome(input);

  const [outcome, review] = await Promise.all([
    deps.repository.readOutcome(outcomeId),
    deps.repository.readReview(outcomeId),
  ]);
  if (outcome === null) throw new ApplicationsError("failed");

  // `skipped` rather than a fourth value: nothing was attempted because nothing
  // needed to be, which is exactly what the tracker's own no-op result means.
  const stage =
    input.kind === "approved"
      ? await deps.stage.advance(outcome.clientId, "funded")
      : ("skipped" as ApplicationStageResult);

  return { outcome, review, stage };
}

export async function listOutcomes(
  clientId: string,
  supplied?: ApplicationsServiceDependencies,
): Promise<Outcome[]> {
  const deps = await dependencies(supplied);
  return deps.repository.listOutcomes(clientId);
}

/**
 * A client's outcomes, each paired with its review.
 *
 * Two queries rather than one per row: the review is what tells a reader
 * whether a counted outcome is still under correction, so a list that omitted
 * it would send every caller straight back for the detail of every row.
 */
export async function listOutcomesWithReviews(
  clientId: string,
  supplied?: ApplicationsServiceDependencies,
): Promise<ReadOutcomeResult[]> {
  const deps = await dependencies(supplied);
  const outcomes = await deps.repository.listOutcomes(clientId);
  if (outcomes.length === 0) return [];

  const reviews = await deps.repository.listReviews(
    outcomes.map((outcome) => outcome.id),
  );
  const byOutcome = new Map(reviews.map((review) => [review.outcomeId, review]));

  // `null` rather than a fabricated pending row: an outcome with no review
  // predates `private.ensure_outcome_review` and saying so is more useful than
  // inventing a state nothing wrote.
  return outcomes.map((outcome) => ({
    outcome,
    review: byOutcome.get(outcome.id) ?? null,
  }));
}

export async function listOutcomesWithReviewsBounded(
  clientId: string,
  limit: number,
  supplied?: ApplicationsServiceDependencies,
): Promise<ReadOutcomeResult[]> {
  const deps = await dependencies(supplied);
  const outcomes = await deps.repository.listOutcomes(clientId, Math.min(APPLICATION_LIST_CEILING, Math.max(1, Math.trunc(limit))));
  if (outcomes.length === 0) return [];
  const reviews = await deps.repository.listReviews(outcomes.map((outcome) => outcome.id));
  const byOutcome = new Map(reviews.map((review) => [review.outcomeId, review]));
  return outcomes.map((outcome) => ({ outcome, review: byOutcome.get(outcome.id) ?? null }));
}

export async function listOutcomesWithReviewsByBankBounded(bankRef: string, limit: number): Promise<ReadOutcomeResult[]> {
  const repository = await import("./repository.ts");
  const outcomes = await repository.listVisibleOutcomesByBank(bankRef, limit);
  if (outcomes.length === 0) return [];
  const reviews = await repository.supabaseApplicationsRepository.listReviews(outcomes.map((outcome) => outcome.id));
  const byOutcome = new Map(reviews.map((review) => [review.outcomeId, review]));
  return outcomes.map((outcome) => ({ outcome, review: byOutcome.get(outcome.id) ?? null }));
}

export async function readOutcome(
  outcomeId: string,
  supplied?: ApplicationsServiceDependencies,
): Promise<ReadOutcomeResult | null> {
  const deps = await dependencies(supplied);
  const outcome = await deps.repository.readOutcome(outcomeId);
  if (outcome === null) return null;
  return { outcome, review: await deps.repository.readReview(outcomeId) };
}

export async function listPendingReviews(
  supplied?: ApplicationsServiceDependencies,
): Promise<OutcomeReview[]> {
  const deps = await dependencies(supplied);
  return deps.repository.listPendingReviews();
}

/**
 * Apply a platform admin's decision, then hand the staged outbox row to the
 * write-back driver.
 *
 * The decision is committed by `public.review_outcome` before the driver is
 * called and nothing here can undo it. A driver result of `failed` marks the
 * outbox row and returns; an unreachable VAULT must not be able to stop an
 * admin correcting a lender's counted history (T-11-20).
 *
 * `result === "unchanged"` means the same decision was already in force, so the
 * database wrote nothing and there is nothing to deliver. Plan 06's route turns
 * that into a 409.
 */
export async function reviewOutcome(
  input: ReviewOutcomeInput,
  supplied?: ApplicationsServiceDependencies,
): Promise<ReviewOutcomeServiceResult> {
  const deps = await dependencies(supplied);
  const decided = await deps.repository.reviewOutcome(input);

  if (decided.result === "unchanged") {
    return { ...decided, delivery: null };
  }

  if (input.decision !== "approved") return { ...decided, delivery: null };

  const row = await deps.repository.readWriteback(input.outcomeId);
  if (row === null) return { ...decided, delivery: null };

  let delivery: VaultWritebackDeliveryResult;
  try {
    delivery = await deps.writeback.deliver(row);
  } catch {
    // The driver's contract is that it never throws. Belt and braces: a throw
    // here would roll the review back to the caller as an error even though the
    // decision is already committed.
    delivery = { state: "failed", failureCode: "transport" };
  }

  const failureCode = delivery.failureCode ?? null;
  if (delivery.state !== row.state || failureCode !== row.failureCode) {
    // The fixture arm returns the state the row already holds, so the default
    // path writes nothing at all.
    await deps.repository.markWriteback(
      row.id,
      delivery.state,
      delivery.state === "failed" ? (failureCode ?? "transport") : failureCode,
    );
  }

  return { ...decided, outboxState: delivery.state, delivery };
}

/**
 * The staged write-back's state, and nothing else about the row.
 *
 * The state is the one field a platform admin needs in order to know whether
 * anything left this system. The payload, the row id and the target are
 * operational detail about a third-party integration, so they stop here
 * (T-11-32).
 */
export async function readWritebackState(
  outcomeId: string,
  supplied?: ApplicationsServiceDependencies,
): Promise<VaultWritebackState | null> {
  const deps = await dependencies(supplied);
  const row = await deps.repository.readWriteback(outcomeId);
  return row === null ? null : row.state;
}

// --- Lender statistics -----------------------------------------------------

export async function readBankStats(
  bankRef: string,
  supplied?: ApplicationsServiceDependencies,
): Promise<BankOutcomeStats | null> {
  const deps = await dependencies(supplied);
  return deps.repository.readBankStats(bankRef);
}

export async function listBankStats(
  bankRefs: readonly string[],
  supplied?: ApplicationsServiceDependencies,
): Promise<BankOutcomeStats[]> {
  const deps = await dependencies(supplied);
  return deps.repository.listBankStats(bankRefs);
}
