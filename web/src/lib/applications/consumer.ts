import type {
  ApplicationConsumerStatus,
  ApplicationNoteAuthorKind,
  ApplicationOperatorStatus,
  OutcomeKind,
} from "./types.ts";

export interface ConsumerApplicationLender {
  readonly name: string;
  readonly products: readonly string[];
  readonly qualificationSummary: string | null;
  readonly sourceUpdatedAt: string | null;
}

export interface ConsumerApplicationNote {
  readonly authorKind: ApplicationNoteAuthorKind;
  readonly body: string;
  readonly createdAt: string;
  readonly id: string;
}

export interface ConsumerApplicationOutcome {
  readonly amountCents: number | null;
  readonly createdAt: string;
  readonly decidedOn: string;
  readonly kind: OutcomeKind;
  readonly recordedByKind: ApplicationNoteAuthorKind;
}

export interface ConsumerApplication {
  readonly consumerStatus: ApplicationConsumerStatus;
  readonly createdAt: string;
  readonly id: string;
  readonly lender: ConsumerApplicationLender | null;
  readonly notes: readonly ConsumerApplicationNote[];
  readonly operatorStatus: ApplicationOperatorStatus;
  readonly outcome: ConsumerApplicationOutcome | null;
  readonly presentation: "details" | "status-only";
  readonly requestedAmountCents: number | null;
  readonly sequence: number;
  readonly updatedAt: string;
}

export interface ConsumerApplicationOutcomeDraft {
  readonly approvedAmount: string;
  readonly kind: OutcomeKind;
}

export type ConsumerApprovedFunding =
  | { readonly amountCents: number; readonly status: "ready" }
  | { readonly status: "private" }
  | { readonly status: "unavailable" };

export type ConsumerApplicationsRead =
  | { readonly applications: readonly ConsumerApplication[]; readonly status: "ready" }
  | { readonly status: "unavailable" };

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function instant(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function cents(value: unknown): value is number | null {
  return value === null || (Number.isSafeInteger(value) && (value as number) >= 0);
}

function parseLender(value: unknown): ConsumerApplicationLender | null {
  const row = record(value);
  if (row === null
      || typeof row.name !== "string" || !row.name.trim()
      || !Array.isArray(row.products) || !row.products.every((product) => typeof product === "string")
      || !(row.qualificationSummary === null || typeof row.qualificationSummary === "string")
      || !(row.sourceUpdatedAt === null || typeof row.sourceUpdatedAt === "string")) return null;
  return {
    name: row.name,
    products: row.products as string[],
    qualificationSummary: row.qualificationSummary as string | null,
    sourceUpdatedAt: row.sourceUpdatedAt as string | null,
  };
}

function parseNote(value: unknown): ConsumerApplicationNote | null {
  const row = record(value);
  if (row === null
      || typeof row.id !== "string" || !row.id
      || (row.authorKind !== "consumer" && row.authorKind !== "operator")
      || typeof row.body !== "string" || !row.body.trim()
      || !instant(row.createdAt)) return null;
  return {
    authorKind: row.authorKind,
    body: row.body,
    createdAt: row.createdAt,
    id: row.id,
  };
}

function parseOutcome(
  value: unknown,
  presentation: ConsumerApplication["presentation"],
): ConsumerApplicationOutcome | null {
  const row = record(value);
  if (row === null
      || (row.kind !== "approved" && row.kind !== "denied" && row.kind !== "withdrawn")
      || !cents(row.amountCents)
      || typeof row.decidedOn !== "string"
      || (row.recordedByKind !== "consumer" && row.recordedByKind !== "operator")
      || !instant(row.createdAt)) return null;
  if (presentation === "status-only") {
    if (row.amountCents !== null) return null;
  } else if ((row.kind === "approved") !== (typeof row.amountCents === "number" && row.amountCents > 0)) {
    return null;
  }
  return {
    amountCents: row.amountCents as number | null,
    createdAt: row.createdAt,
    decidedOn: row.decidedOn,
    kind: row.kind,
    recordedByKind: row.recordedByKind,
  };
}

export function parseConsumerApplications(value: unknown): readonly ConsumerApplication[] | null {
  const body = record(value);
  if (body === null || !Array.isArray(body.applications)) return null;
  const applications: ConsumerApplication[] = [];
  for (const value of body.applications) {
    const row = record(value);
    if (row === null
        || typeof row.id !== "string" || !row.id
        || !Number.isSafeInteger(row.sequence) || row.sequence !== applications.length + 1
        || (row.operatorStatus !== "wait" && row.operatorStatus !== "todo")
        || (row.consumerStatus !== "approved" && row.consumerStatus !== "pending" && row.consumerStatus !== "denied")
        || !cents(row.requestedAmountCents)
        || (row.presentation !== "details" && row.presentation !== "status-only")
        || !(row.lender === null || record(row.lender) !== null)
        || !(row.outcome === null || record(row.outcome) !== null)
        || !Array.isArray(row.notes)
        || !instant(row.createdAt) || !instant(row.updatedAt)) return null;
    const lender = row.lender === null ? null : parseLender(row.lender);
    const outcome = row.outcome === null ? null : parseOutcome(row.outcome, row.presentation);
    const notes = row.notes.map(parseNote);
    if ((row.lender !== null && lender === null) || (row.outcome !== null && outcome === null)
        || notes.some((note) => note === null)) return null;
    if (row.presentation === "status-only" && (lender !== null || row.requestedAmountCents !== null)) return null;
    applications.push({
      consumerStatus: row.consumerStatus,
      createdAt: row.createdAt,
      id: row.id,
      lender,
      notes: notes as ConsumerApplicationNote[],
      operatorStatus: row.operatorStatus,
      outcome,
      presentation: row.presentation,
      requestedAmountCents: row.requestedAmountCents as number | null,
      sequence: row.sequence as number,
      updatedAt: row.updatedAt,
    });
  }
  return applications;
}

export function deriveConsumerApprovedFunding(
  applications: readonly ConsumerApplication[] | null,
): ConsumerApprovedFunding {
  if (applications === null) return { status: "unavailable" };
  let amountCents = 0;
  for (const application of applications) {
    if (application.outcome?.kind !== "approved") continue;
    if (application.outcome.amountCents === null) return { status: "private" };
    amountCents += application.outcome.amountCents;
    if (!Number.isSafeInteger(amountCents)) return { status: "unavailable" };
  }
  return { amountCents, status: "ready" };
}

export function clearSubmittedConsumerNoteDraft(
  drafts: Record<string, string>,
  applicationId: string,
  submittedDraft: string,
): Record<string, string> {
  if ((drafts[applicationId] ?? "") !== submittedDraft) return drafts;
  const next = { ...drafts };
  delete next[applicationId];
  return next;
}

export function clearSubmittedConsumerOutcomeDraft(
  drafts: Record<string, ConsumerApplicationOutcomeDraft>,
  applicationId: string,
  submittedDraft: ConsumerApplicationOutcomeDraft,
): Record<string, ConsumerApplicationOutcomeDraft> {
  const current = drafts[applicationId];
  if (current === undefined
      || current.kind !== submittedDraft.kind
      || current.approvedAmount !== submittedDraft.approvedAmount) return drafts;
  const next = { ...drafts };
  delete next[applicationId];
  return next;
}

export async function readConsumerApplications(fetcher: typeof fetch = fetch): Promise<ConsumerApplicationsRead> {
  try {
    const response = await fetcher("/api/consumer/applications", {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) return { status: "unavailable" };
    const applications = parseConsumerApplications(await response.json());
    return applications === null ? { status: "unavailable" } : { applications, status: "ready" };
  } catch {
    return { status: "unavailable" };
  }
}

export async function addConsumerApplicationNote(
  applicationId: string,
  body: string,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetcher(`/api/applications/${encodeURIComponent(applicationId)}/notes`, {
      body: JSON.stringify({ attested: false, body }),
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function recordConsumerApplicationOutcome(
  applicationId: string,
  input: { readonly amountCents: number | null; readonly kind: OutcomeKind },
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetcher(`/api/applications/${encodeURIComponent(applicationId)}/outcomes`, {
      body: JSON.stringify({ amountCents: input.kind === "approved" ? input.amountCents : null, kind: input.kind }),
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    return response.ok;
  } catch {
    return false;
  }
}
