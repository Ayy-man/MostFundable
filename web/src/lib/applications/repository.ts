import "server-only";

import { featureFlag } from "@/lib/env";

import {
  APPLICATION_LIST_CEILING,
  ApplicationsError,
  type AddNoteInput,
  type Application,
  type ApplicationNote,
  type BankOutcomeStats,
  type BankRetrievalDocument,
  type FailRefreshJobInput,
  type Outcome,
  type OutcomeNotification,
  type OutcomeRefreshJob,
  type OutcomeReview,
  type RecordOutcomeInput,
  type ReviewOutcomeInput,
  type ReviewOutcomeResult,
  type VaultWritebackRow,
  type VaultWritebackState,
} from "./types.ts";
import type { ApplicationsRepository, BankRetrievalDocumentRepository } from "./ports.ts";

/**
 * The library's only Supabase seam.
 *
 * Nothing else under `web/src/lib/applications/` mentions Supabase, so the
 * service and the worker in plan 04 are testable against a fake repository with
 * no database and no environment.
 *
 * The admin client is reached only through `await import(...)`, inside the
 * function that needs it and never at module scope, which is also why
 * `web/scripts/verify-source-gates.mjs` holds this named repository in its
 * allow-list. It checks both module-scope and deferred imports, so deferred
 * loading remains a performance seam rather than a way to widen privilege.
 */

type AdminClient = ReturnType<
  (typeof import("../supabase/admin.ts"))["createAdminClient"]
>;

interface PostgresErrorLike {
  code?: string;
  message?: string;
  details?: string;
}

interface Result<Row> {
  data: Row | null;
  error: PostgresErrorLike | null;
}

interface Filter<Row> extends PromiseLike<Result<Row[]>> {
  eq(column: string, value: unknown): Filter<Row>;
  in(column: string, values: readonly unknown[]): Filter<Row>;
  limit(value: number): Filter<Row>;
  order(column: string, options: { ascending: boolean }): Filter<Row>;
  maybeSingle(): PromiseLike<Result<Row>>;
}

interface Selectable<Row> {
  select(columns: string): Filter<Row>;
}

interface Table<Row> extends Selectable<Row> {
  insert(values: Record<string, unknown>): Selectable<Row>;
  update(values: Record<string, unknown>): {
    eq(column: string, value: unknown): Selectable<Row>;
  };
}

interface Db {
  from<Row>(table: string): Table<Row>;
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<Result<unknown>>;
}

// Explicit column lists everywhere. `outcomes.recorded_by`,
// `outcomes.removed_by` and `outcome_reviews.reviewed_by` are profile
// identifiers no browser payload needs, and `select('*')` would put all three
// into one by default.
const APPLICATION_COLUMNS =
  "id,client_id,bank_ref,operator_status,consumer_status,amount_cents,visibility,created_at,updated_at";
const NOTE_COLUMNS =
  "id,application_id,author_profile_id,author_kind,body,attested,created_at";
const OUTCOME_COLUMNS =
  "id,application_id,bank_ref,client_id,kind,amount_cents,state,recorded_by_kind,decided_on,created_at";
const REVIEW_COLUMNS = "id,outcome_id,state,reviewed_at,reason_code,created_at";
const STATS_COLUMNS =
  "bank_ref,stats_version,windows,heat_level,last_outcome_at,approved_amount_cents_total,outcome_count_total,computed_at";
const RETRIEVAL_DOCUMENT_COLUMNS =
  "bank_ref,stats_version,document,document_fingerprint,rebuilt_at";
const NOTIFICATION_COLUMNS = "id,outcome_id,kind,created_at,read_at";
const OUTBOX_COLUMNS =
  "id,outcome_id,bank_ref,target,source,payload,state,recorded_at,failure_code";

/**
 * One mapping from SQLSTATE to this library's closed code union. A raw Postgres
 * message names tables, constraints and sometimes row values, so it stops here
 * and the route layer answers with a code and a fixed string.
 */
export function mapError(error: PostgresErrorLike | null | undefined): ApplicationsError {
  const code = error?.code;

  if (code === "42501") return new ApplicationsError("forbidden");
  if (code === "23505") return new ApplicationsError("conflict");
  // Phase 8, migration 383: `applications.bank_ref` references
  // `public.banks_cache`, and a foreign key cannot sit behind a feature flag, so
  // this arm is reachable whether or not FEATURE_VAULT is on. Without it a
  // caller naming a lender the catalog has never heard of gets a 500 for what is
  // an ordinary bad request.
  if (code === "23503") return new ApplicationsError("unknown_reference");
  if (code === "23514") {
    const text = `${error?.message ?? ""} ${error?.details ?? ""}`;
    return new ApplicationsError(
      text.includes("application_notes_operator_attestation")
        ? "attestation_required"
        : "conflict",
    );
  }
  if (code === "P0002" || code === "PGRST116") {
    return new ApplicationsError("not_found");
  }

  return new ApplicationsError("failed");
}

/**
 * The same seam Phase 6 uses at `web/src/lib/tracker/read.server.ts:46-55`.
 *
 * With `FEATURE_REAL_AUTH` on, the cookie-scoped client carries the caller's
 * JWT and Phase 1's policies decide what it can see, so the repository adds no
 * second tenancy check that could drift from `private.can_access_client`. With
 * the flag off — the committed default, and how the demo runs — the frozen
 * session is header-selected and has no JWT, so that client would be `anon`,
 * which every table here revokes; the admin client stands in and the tenancy
 * predicate is applied by the service layer, exactly as `visibleClientRows`
 * does for the tracker. Recorded as G-11-09.
 */
async function dataClient(): Promise<Db> {
  if (featureFlag("FEATURE_REAL_AUTH")) {
    const { createClient } = await import("@/lib/supabase/server");
    return (await createClient()) as unknown as Db;
  }
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient() as unknown as Db;
}

/** The queue tables are revoked from `authenticated` outright, so never scoped. */
async function workerClient(): Promise<Db> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient() as unknown as Db;
}

interface ApplicationRow {
  id: string;
  client_id: string;
  bank_ref: string;
  operator_status: Application["operatorStatus"];
  consumer_status: Application["consumerStatus"];
  amount_cents: number | null;
  visibility: Application["visibility"];
  created_at: string;
  updated_at: string;
}

interface NoteRow {
  id: string;
  application_id: string;
  author_profile_id: string;
  author_kind: ApplicationNote["authorKind"];
  body: string;
  attested: boolean;
  created_at: string;
}

interface OutcomeRow {
  id: string;
  application_id: string;
  bank_ref: string;
  client_id: string;
  kind: Outcome["kind"];
  amount_cents: number | null;
  state: Outcome["state"];
  recorded_by_kind: Outcome["recordedByKind"];
  decided_on: string;
  created_at: string;
}

interface ReviewRow {
  id: string;
  outcome_id: string;
  state: OutcomeReview["state"];
  reviewed_at: string | null;
  reason_code: string | null;
  created_at: string;
}

interface StatsRow {
  bank_ref: string;
  stats_version: number;
  windows: BankOutcomeStats["windows"];
  heat_level: BankOutcomeStats["heatLevel"];
  last_outcome_at: string | null;
  approved_amount_cents_total: number;
  outcome_count_total: number;
  computed_at: string;
}

interface RetrievalDocumentRow {
  bank_ref: string;
  stats_version: number;
  document: BankRetrievalDocument["document"];
  document_fingerprint: string;
  rebuilt_at: string;
}

interface NotificationRow {
  id: string;
  outcome_id: string;
  kind: OutcomeNotification["kind"];
  created_at: string;
  read_at: string | null;
}

interface JobRow {
  id: string;
  bank_ref: string;
  change_id: string;
  subject: string;
  window: string;
  idempotency_key: string;
  status: OutcomeRefreshJob["status"];
  attempt_count: number;
  error_code: string | null;
}

interface OutboxRow {
  id: string;
  outcome_id: string;
  bank_ref: string;
  target: VaultWritebackRow["target"];
  source: string;
  payload: Record<string, unknown>;
  state: VaultWritebackState;
  recorded_at: string;
  failure_code: string | null;
}

interface ReviewRpcRow {
  result: ReviewOutcomeResult["result"];
  review_state: OutcomeReview["state"];
  outbox_state: VaultWritebackState | null;
  notified: boolean;
}

function toApplication(row: ApplicationRow): Application {
  return {
    id: row.id,
    clientId: row.client_id,
    bankRef: row.bank_ref,
    operatorStatus: row.operator_status,
    consumerStatus: row.consumer_status,
    amountCents: row.amount_cents,
    visibility: row.visibility,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toNote(row: NoteRow): ApplicationNote {
  return {
    id: row.id,
    applicationId: row.application_id,
    authorProfileId: row.author_profile_id,
    authorKind: row.author_kind,
    body: row.body,
    attested: row.attested,
    createdAt: row.created_at,
  };
}

function toOutcome(row: OutcomeRow): Outcome {
  return {
    id: row.id,
    applicationId: row.application_id,
    bankRef: row.bank_ref,
    clientId: row.client_id,
    kind: row.kind,
    amountCents: row.amount_cents,
    state: row.state,
    recordedByKind: row.recorded_by_kind,
    decidedOn: row.decided_on,
    createdAt: row.created_at,
  };
}

function toReview(row: ReviewRow): OutcomeReview {
  return {
    id: row.id,
    outcomeId: row.outcome_id,
    state: row.state,
    reviewedAt: row.reviewed_at,
    reasonCode: row.reason_code,
    createdAt: row.created_at,
  };
}

function toStats(row: StatsRow): BankOutcomeStats {
  return {
    bankRef: row.bank_ref,
    statsVersion: Number(row.stats_version),
    heatLevel: row.heat_level,
    windows: row.windows,
    lastOutcomeAt: row.last_outcome_at,
    approvedAmountCentsTotal: Number(row.approved_amount_cents_total),
    outcomeCountTotal: Number(row.outcome_count_total),
    computedAt: row.computed_at,
  };
}

function toRetrievalDocument(row: RetrievalDocumentRow): BankRetrievalDocument {
  return {
    bankRef: row.bank_ref,
    statsVersion: Number(row.stats_version),
    document: row.document,
    documentFingerprint: row.document_fingerprint,
    rebuiltAt: row.rebuilt_at,
  };
}

export const bankRetrievalDocumentRepository: BankRetrievalDocumentRepository = {
  async listBankRetrievalDocuments(bankRefs) {
    if (bankRefs?.length === 0) return [];
    const db = await dataClient();
    let query = db
      .from<RetrievalDocumentRow>("bank_retrieval_index")
      .select(RETRIEVAL_DOCUMENT_COLUMNS);
    if (bankRefs !== undefined) query = query.in("bank_ref", bankRefs);
    const { data, error } = await query.order("bank_ref", { ascending: true });
    if (error) throw mapError(error);
    return (data ?? []).map(toRetrievalDocument);
  },
};

function toNotification(row: NotificationRow): OutcomeNotification {
  return {
    id: row.id,
    outcomeId: row.outcome_id,
    kind: row.kind,
    createdAt: row.created_at,
    readAt: row.read_at,
  };
}

function toJob(row: JobRow): OutcomeRefreshJob {
  return {
    id: row.id,
    bankRef: row.bank_ref,
    changeId: row.change_id,
    subject: row.subject,
    window: row.window,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    attemptCount: row.attempt_count,
    errorCode: row.error_code,
  };
}

function toOutbox(row: OutboxRow): VaultWritebackRow {
  return {
    id: row.id,
    outcomeId: row.outcome_id,
    bankRef: row.bank_ref,
    target: row.target,
    source: row.source,
    payload: row.payload,
    state: row.state,
    recordedAt: row.recorded_at,
    failureCode: row.failure_code,
  };
}

function rowsOf(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

export const supabaseApplicationsRepository: ApplicationsRepository = {
  async listApplications(clientId, limit) {
    const db = await dataClient();
    let query = db
      .from<ApplicationRow>("applications")
      .select(APPLICATION_COLUMNS)
      .eq("client_id", clientId)
      .order("created_at", { ascending: false });
    if (limit !== undefined) query = query.limit(limit);
    const { data, error } = await query;
    if (error) throw mapError(error);
    return (data ?? []).map(toApplication);
  },

  async readApplication(applicationId) {
    const db = await dataClient();
    const { data, error } = await db
      .from<ApplicationRow>("applications")
      .select(APPLICATION_COLUMNS)
      .eq("id", applicationId)
      .maybeSingle();
    if (error) throw mapError(error);
    return data ? toApplication(data) : null;
  },

  async createApplication(input) {
    const db = await dataClient();
    const { data, error } = await db
      .from<ApplicationRow>("applications")
      .insert({
        client_id: input.clientId,
        bank_ref: input.bankRef,
        amount_cents: input.amountCents ?? null,
        visibility: input.visibility ?? "inherit",
        created_by: input.createdBy,
        ...(input.operatorStatus === undefined
          ? {}
          : { operator_status: input.operatorStatus }),
        ...(input.consumerStatus === undefined
          ? {}
          : { consumer_status: input.consumerStatus }),
      })
      .select(APPLICATION_COLUMNS);
    if (error) throw mapError(error);
    const row = (data ?? [])[0];
    if (!row) throw new ApplicationsError("failed");
    return toApplication(row);
  },

  async updateApplication(input) {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.operatorStatus !== undefined) patch.operator_status = input.operatorStatus;
    if (input.consumerStatus !== undefined) patch.consumer_status = input.consumerStatus;
    if (input.amountCents !== undefined) patch.amount_cents = input.amountCents;
    if (input.visibility !== undefined) patch.visibility = input.visibility;

    const db = await dataClient();
    const { data, error } = await db
      .from<ApplicationRow>("applications")
      .update(patch)
      .eq("id", input.applicationId)
      .select(APPLICATION_COLUMNS);
    if (error) throw mapError(error);
    const row = (data ?? [])[0];
    if (!row) throw new ApplicationsError("not_found");
    return toApplication(row);
  },

  async listNotes(applicationId) {
    const db = await dataClient();
    const { data, error } = await db
      .from<NoteRow>("application_notes")
      .select(NOTE_COLUMNS)
      .eq("application_id", applicationId)
      .order("created_at", { ascending: true });
    if (error) throw mapError(error);
    return (data ?? []).map(toNote);
  },

  async addNote(input: AddNoteInput) {
    const db = await dataClient();
    const { data, error } = await db
      .from<NoteRow>("application_notes")
      .insert({
        application_id: input.applicationId,
        author_profile_id: input.authorProfileId,
        author_kind: input.authorKind,
        body: input.body,
        attested: input.attested,
      })
      .select(NOTE_COLUMNS);
    if (error) throw mapError(error);
    const row = (data ?? [])[0];
    if (!row) throw new ApplicationsError("failed");
    return toNote(row);
  },

  async recordOutcome(input: RecordOutcomeInput) {
    const db = await dataClient();
    const { data, error } = await db.rpc("record_outcome", {
      p_application_id: input.applicationId,
      p_kind: input.kind,
      p_amount_cents: input.amountCents,
      p_decided_on: input.decidedOn,
      p_actor: input.actorProfileId,
    });
    if (error) throw mapError(error);
    if (typeof data !== "string") throw new ApplicationsError("failed");
    return data;
  },

  async readOutcome(outcomeId) {
    const db = await dataClient();
    const { data, error } = await db
      .from<OutcomeRow>("outcomes")
      .select(OUTCOME_COLUMNS)
      .eq("id", outcomeId)
      .maybeSingle();
    if (error) throw mapError(error);
    return data ? toOutcome(data) : null;
  },

  async listOutcomes(clientId, limit) {
    const db = await dataClient();
    let query = db
      .from<OutcomeRow>("outcomes")
      .select(OUTCOME_COLUMNS)
      .eq("client_id", clientId)
      .order("created_at", { ascending: false });
    if (limit !== undefined) query = query.limit(limit);
    const { data, error } = await query;
    if (error) throw mapError(error);
    return (data ?? []).map(toOutcome);
  },

  async readReview(outcomeId) {
    const db = await dataClient();
    const { data, error } = await db
      .from<ReviewRow>("outcome_reviews")
      .select(REVIEW_COLUMNS)
      .eq("outcome_id", outcomeId)
      .maybeSingle();
    if (error) throw mapError(error);
    return data ? toReview(data) : null;
  },

  async listReviews(outcomeIds) {
    if (outcomeIds.length === 0) return [];
    const db = await dataClient();
    const { data, error } = await db
      .from<ReviewRow>("outcome_reviews")
      .select(REVIEW_COLUMNS)
      .in("outcome_id", outcomeIds);
    if (error) throw mapError(error);
    return (data ?? []).map(toReview);
  },

  async listPendingReviews() {
    const db = await dataClient();
    const { data, error } = await db
      .from<ReviewRow>("outcome_reviews")
      .select(REVIEW_COLUMNS)
      .eq("state", "pending")
      .order("created_at", { ascending: true });
    if (error) throw mapError(error);
    return (data ?? []).map(toReview);
  },

  async reviewOutcome(input: ReviewOutcomeInput) {
    const db = await dataClient();
    const { data, error } = await db.rpc("review_outcome", {
      p_outcome_id: input.outcomeId,
      p_decision: input.decision,
      p_actor: input.actorProfileId,
    });
    if (error) throw mapError(error);
    const row = rowsOf(data)[0] as unknown as ReviewRpcRow | undefined;
    if (!row) throw new ApplicationsError("failed");
    return {
      result: row.result,
      reviewState: row.review_state,
      outboxState: row.outbox_state,
      notified: Boolean(row.notified),
    };
  },

  async readBankStats(bankRef) {
    const db = await dataClient();
    const { data, error } = await db
      .from<StatsRow>("bank_outcome_stats")
      .select(STATS_COLUMNS)
      .eq("bank_ref", bankRef)
      .maybeSingle();
    if (error) throw mapError(error);
    return data ? toStats(data) : null;
  },

  async listBankStats(bankRefs) {
    if (bankRefs.length === 0) return [];
    const db = await dataClient();
    const { data, error } = await db
      .from<StatsRow>("bank_outcome_stats")
      .select(STATS_COLUMNS)
      .in("bank_ref", bankRefs);
    if (error) throw mapError(error);
    return (data ?? []).map(toStats);
  },

  async listNotifications(profileId) {
    const db = await dataClient();
    const { data, error } = await db
      .from<NotificationRow>("outcome_notifications")
      .select(NOTIFICATION_COLUMNS)
      .eq("recipient_profile_id", profileId)
      .order("created_at", { ascending: false });
    if (error) throw mapError(error);
    return (data ?? []).map(toNotification);
  },

  async enqueueRefreshJob(bankRef, changeId) {
    const db = await workerClient();
    const { data, error } = await db.rpc("enqueue_outcome_refresh_job", {
      p_bank_ref: bankRef,
      p_change_id: changeId,
    });
    if (error) throw mapError(error);
    const row = rowsOf(data)[0] as unknown as JobRow | undefined;
    if (!row) throw new ApplicationsError("failed");
    return toJob(row);
  },

  async claimRefreshJob(workerId, leaseSeconds, target) {
    const db = await workerClient();
    const { data, error } = await db.rpc("claim_outcome_refresh_job", {
      ...(target ? { p_bank_ref: target.bankRef, p_change_id: target.changeId } : {}),
      p_worker_id: workerId,
      p_lease_seconds: leaseSeconds,
    });
    if (error) throw mapError(error);
    const row = rowsOf(data)[0] as unknown as JobRow | undefined;
    // An empty result is an empty queue, which is the ordinary case, not a fault.
    return row ? toJob(row) : null;
  },

  async runRefreshJob(jobId, workerId) {
    const db = await workerClient();
    const { data, error } = await db.rpc("run_outcome_refresh_job", {
      p_job_id: jobId,
      p_worker_id: workerId,
    });
    if (error) throw mapError(error);
    const row = rowsOf(data)[0] as unknown as JobRow | undefined;
    if (!row) throw new ApplicationsError("failed");
    return toJob(row);
  },

  async failRefreshJob(input: FailRefreshJobInput) {
    const db = await workerClient();
    const { data, error } = await db.rpc("fail_outcome_refresh_job", {
      p_job_id: input.jobId,
      p_worker_id: input.workerId,
      p_error_code: input.errorCode,
      p_retry: input.retry,
      p_retry_after_seconds: input.retryAfterSeconds,
    });
    if (error) throw mapError(error);
    const row = rowsOf(data)[0] as unknown as JobRow | undefined;
    if (!row) throw new ApplicationsError("failed");
    return toJob(row);
  },

  async listWritebackOutbox(state) {
    const db = await workerClient();
    const { data, error } = await db
      .from<OutboxRow>("vault_writeback_outbox")
      .select(OUTBOX_COLUMNS)
      .eq("state", state)
      .order("recorded_at", { ascending: true });
    if (error) throw mapError(error);
    return (data ?? []).map(toOutbox);
  },

  async readWriteback(outcomeId) {
    const db = await workerClient();
    const { data, error } = await db
      .from<OutboxRow>("vault_writeback_outbox")
      .select(OUTBOX_COLUMNS)
      .eq("outcome_id", outcomeId)
      .maybeSingle();
    if (error) throw mapError(error);
    return data ? toOutbox(data) : null;
  },

  async markWriteback(id, state, failureCode) {
    const db = await workerClient();
    const { error } = await db
      .from<OutboxRow>("vault_writeback_outbox")
      .update({
        state,
        failure_code: failureCode,
        delivered_at: state === "delivered" ? new Date().toISOString() : null,
      })
      .eq("id", id)
      .select(OUTBOX_COLUMNS);
    if (error) throw mapError(error);
  },
};

/** Bounded, RLS-scoped reads used when an authorized surface filters its visible application book by lender. */
export async function listVisibleApplicationsByBank(bankRef: string, limit: number): Promise<Application[]> {
  const db = await dataClient();
  const { data, error } = await db
    .from<ApplicationRow>("applications")
    .select(APPLICATION_COLUMNS)
    .eq("bank_ref", bankRef)
    .order("created_at", { ascending: false })
    .limit(Math.min(APPLICATION_LIST_CEILING, Math.max(1, Math.trunc(limit))));
  if (error) throw mapError(error);
  return (data ?? []).map(toApplication);
}

export async function listVisibleOutcomesByBank(bankRef: string, limit: number): Promise<Outcome[]> {
  const db = await dataClient();
  const { data, error } = await db
    .from<OutcomeRow>("outcomes")
    .select(OUTCOME_COLUMNS)
    .eq("bank_ref", bankRef)
    .order("created_at", { ascending: false })
    .limit(Math.min(APPLICATION_LIST_CEILING, Math.max(1, Math.trunc(limit))));
  if (error) throw mapError(error);
  return (data ?? []).map(toOutcome);
}

export type { AdminClient };
