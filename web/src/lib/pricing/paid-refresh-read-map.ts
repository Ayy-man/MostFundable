import type { ConsumerPaidRefreshRecord, ConsumerPaidRefreshStatus } from "./paid-refresh-read.ts";

export interface PaidRefreshRequestReadRow {
  readonly amount_cents: number;
  readonly analysis_run_id: string | null;
  readonly created_at: string;
  readonly currency: string;
  readonly id: string;
  readonly payment_attempt_state: string;
  readonly state: string;
}

export interface PaidRefreshPaymentEventReadRow {
  readonly amount_cents: number;
  readonly currency: string;
  readonly occurred_at: string;
  readonly outcome: string;
  readonly request_id: string;
}

export interface PaidRefreshAnalysisJobReadRow {
  readonly analysis_run_id: string;
  readonly client_id: string;
  readonly source_id: string;
  readonly source_kind: string;
  readonly status: string;
  readonly trigger: string;
  readonly updated_at: string;
}

export interface PaidRefreshAnalysisRunReadRow {
  readonly client_id: string;
  readonly id: string;
  readonly ran_at: string;
  readonly trigger: string;
}

export interface PaidRefreshRemediationReadRow {
  readonly request_id: string;
  readonly state: string;
}

export interface PaidRefreshReadSource {
  readonly clientId: string;
  readonly events: readonly PaidRefreshPaymentEventReadRow[];
  readonly jobs: readonly PaidRefreshAnalysisJobReadRow[];
  readonly remediations: readonly PaidRefreshRemediationReadRow[];
  readonly requests: readonly PaidRefreshRequestReadRow[];
  readonly runs: readonly PaidRefreshAnalysisRunReadRow[];
}

const REQUEST_STATES = new Set([
  "initiated", "payment_failed", "requires_action", "paid", "queued", "cancelled", "unfulfillable",
]);
const ATTEMPT_STATES = new Set(["none", "dispatching", "provider_returned", "recorded", "needs_review"]);
const JOB_STATES = new Set(["queued", "running", "persisted", "succeeded", "failed", "cancelled"]);

function validInstant(value: string): boolean {
  return value.length > 0 && Number.isFinite(Date.parse(value));
}

function invalid(): never {
  throw new Error("PAID_REFRESH_HISTORY_INVALID");
}

function requestStatus(
  request: PaidRefreshRequestReadRow,
  paidAt: string | null,
  job: PaidRefreshAnalysisJobReadRow | undefined,
  run: PaidRefreshAnalysisRunReadRow | undefined,
  remediation: PaidRefreshRemediationReadRow | undefined,
): { completedAt: string | null; status: ConsumerPaidRefreshStatus } {
  if (request.state === "unfulfillable") {
    return {
      completedAt: null,
      status: remediation?.state === "resolved" ? "remediated" : "unfulfillable",
    };
  }
  if (request.state === "cancelled") return { completedAt: null, status: "cancelled" };

  // The immutable succeeded event wins over an older request/attempt label, but a successful
  // completion still needs the linked job and persisted run below.
  if (paidAt === null) {
    if (request.payment_attempt_state === "needs_review") return { completedAt: null, status: "payment_review" };
    if (request.state === "requires_action") return { completedAt: null, status: "payment_action_required" };
    if (request.state === "payment_failed") return { completedAt: null, status: "payment_failed" };
    return { completedAt: null, status: "payment_pending" };
  }

  if (request.state === "paid") return { completedAt: null, status: "paid" };
  if (request.state !== "queued") return { completedAt: null, status: "paid" };
  if (!job) return { completedAt: null, status: "queued" };
  if (job.status === "queued") return { completedAt: null, status: "queued" };
  if (job.status === "running" || job.status === "persisted") {
    return { completedAt: null, status: "running" };
  }
  if (job.status === "failed") return { completedAt: null, status: "failed" };
  if (job.status === "cancelled") return { completedAt: null, status: "cancelled" };

  // `succeeded` says the worker finished. Requiring the matching persisted analysis row as well
  // prevents a corrupt or prematurely advanced job from being presented as a completed purchase.
  if (job.status === "succeeded" && run) return { completedAt: run.ran_at, status: "completed" };
  return { completedAt: null, status: "running" };
}

export function mapConsumerPaidRefreshHistory(source: PaidRefreshReadSource): ConsumerPaidRefreshRecord[] {
  const requestsById = new Map<string, PaidRefreshRequestReadRow>();
  for (const request of source.requests) {
    if (
      request.id.length === 0
      || !Number.isSafeInteger(request.amount_cents) || request.amount_cents <= 0
      || request.currency !== "usd"
      || !validInstant(request.created_at)
      || !REQUEST_STATES.has(request.state)
      || !ATTEMPT_STATES.has(request.payment_attempt_state)
      || requestsById.has(request.id)
    ) invalid();
    requestsById.set(request.id, request);
  }

  const succeededByRequest = new Map<string, PaidRefreshPaymentEventReadRow>();
  for (const event of source.events) {
    const request = requestsById.get(event.request_id);
    if (!request || !validInstant(event.occurred_at)) invalid();
    if (event.outcome !== "succeeded") continue;
    if (
      succeededByRequest.has(event.request_id)
      || event.amount_cents !== request.amount_cents
      || event.currency !== request.currency
    ) invalid();
    succeededByRequest.set(event.request_id, event);
  }

  const jobByRequest = new Map<string, PaidRefreshAnalysisJobReadRow>();
  for (const job of source.jobs) {
    if (
      !requestsById.has(job.source_id)
      || job.client_id !== source.clientId
      || job.source_kind !== "force_pull"
      || job.trigger !== "force_pull"
      || !JOB_STATES.has(job.status)
      || !validInstant(job.updated_at)
    ) invalid();
    const existing = jobByRequest.get(job.source_id);
    if (!existing || Date.parse(job.updated_at) > Date.parse(existing.updated_at)) {
      jobByRequest.set(job.source_id, job);
    }
  }

  const runById = new Map<string, PaidRefreshAnalysisRunReadRow>();
  for (const run of source.runs) {
    if (run.client_id !== source.clientId || run.trigger !== "force_pull" || !validInstant(run.ran_at)) invalid();
    runById.set(run.id, run);
  }

  const remediationByRequest = new Map<string, PaidRefreshRemediationReadRow>();
  for (const remediation of source.remediations) {
    if (
      !requestsById.has(remediation.request_id)
      || (remediation.state !== "open" && remediation.state !== "resolved")
      || remediationByRequest.has(remediation.request_id)
    ) invalid();
    remediationByRequest.set(remediation.request_id, remediation);
  }

  return source.requests.map((request) => {
    const payment = succeededByRequest.get(request.id);
    const job = jobByRequest.get(request.id);
    if (job && request.analysis_run_id !== null && job.analysis_run_id !== request.analysis_run_id) invalid();
    const run = job ? runById.get(job.analysis_run_id) : undefined;
    const { completedAt, status } = requestStatus(
      request,
      payment?.occurred_at ?? null,
      job,
      run,
      remediationByRequest.get(request.id),
    );
    return {
      amountCents: request.amount_cents,
      completedAt,
      currency: "usd",
      paidAt: payment?.occurred_at ?? null,
      requestId: request.id,
      requestedAt: request.created_at,
      status,
    };
  });
}
