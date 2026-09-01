import "server-only";

/**
 * The applications and outcomes server API for Phase 11's routes.
 *
 * This is intentionally the whole public surface, in the shape
 * `web/src/lib/tracker/index.ts` set: the service functions, the drain a route
 * calls inline, the types a caller needs to name, and the approved label
 * strings. The repository, the ports, the write-back driver and the stage seam
 * are all deliberately absent, so a route cannot reach past the service to a
 * database client or invent a second write path to the same table.
 */

export {
  addNote,
  createApplication,
  listApplications,
  listApplicationsByBankBounded,
  listApplicationsBounded,
  listBankStats,
  listBankRetrievalDocuments,
  listNotes,
  listOutcomes,
  listOutcomesWithReviews,
  listOutcomesWithReviewsByBankBounded,
  listOutcomesWithReviewsBounded,
  listPendingReviews,
  readApplication,
  readBankStats,
  readOutcome,
  readWritebackState,
  recordOutcome,
  reviewOutcome,
  updateApplication,
} from "./service";

export type {
  CreateApplicationResult,
  ReadOutcomeResult,
  RecordOutcomeResult,
  ReviewOutcomeServiceResult,
} from "./service";

export { drainOutcomeRefreshJobs } from "./worker";

export type { ApplicationStageResult, ApplicationStageTarget } from "./stage";

export {
  APPLICATION_CONSUMER_STATUS_VALUES,
  APPLICATION_NOTE_AUTHOR_KIND_VALUES,
  APPLICATION_OPERATOR_STATUS_VALUES,
  APPLICATION_VISIBILITY_VALUES,
  APPLICATIONS_DISABLED_CODE,
  APPLICATIONS_DISABLED_MESSAGE,
  APPLICATIONS_ERROR_CODES,
  ApplicationsError,
  ATTESTATION_REQUIRED_CODE,
  BANK_HEAT_LEVEL_VALUES,
  BANK_STATS_LABEL,
  OUTCOME_COUNTED_LABEL,
  OUTCOME_KIND_VALUES,
  OUTCOME_NOTIFICATION_KIND_VALUES,
  OUTCOME_REVIEW_STATE_VALUES,
  OUTCOME_STATE_VALUES,
  WRITEBACK_RECORDED_LABEL,
} from "./types";

export type {
  AddNoteInput,
  Application,
  ApplicationConsumerStatus,
  ApplicationNote,
  ApplicationNoteAuthorKind,
  ApplicationOperatorStatus,
  ApplicationsErrorCode,
  ApplicationVisibility,
  BankHeatLevel,
  BankRetrievalDocument,
  BankRetrievalPayload,
  BankOutcomeStats,
  BankOutcomeStatsWindow,
  CreateApplicationInput,
  Outcome,
  OutcomeKind,
  OutcomeNotification,
  OutcomeReview,
  OutcomeReviewState,
  OutcomeState,
  RecordOutcomeInput,
  ReviewOutcomeInput,
  UpdateApplicationInput,
  VaultWritebackState,
} from "./types";
