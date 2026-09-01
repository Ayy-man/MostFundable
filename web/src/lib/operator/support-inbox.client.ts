"use client";

// The stage taxonomy, imported rather than restated. `tracker/types` is free of `server-only` and
// carries no runtime beyond the list and its guard, so a client module can hold the product's one
// stage vocabulary instead of a second copy that drifts from it.
import {
  isTrackerAssigneeOrgRole,
  isTrackerStage,
  isTrackerUuid,
  type TrackerAssigneeOrgRole,
  type TrackerStage,
} from "@/lib/tracker/types";
import type { TimelineEvent, TimelineRead } from "@/lib/timeline/types";

// The operator Inbox's durable rail (UI-WIRING-BACKLOG #9).
//
// The Inbox used to write a reply into a local `sentReplies` map and render it
// as "Sent just now". This module is the other half of removing that: it reads
// the real support threads, reads one thread's messages, and posts a reply
// through `/api/support/threads/[id]/messages`, which is the only HTTP path
// that can put a message in a thread.
//
// Three properties this file is required to hold:
//
//   1. It never calls anything itself. Every function takes the fetcher and is
//      invoked from an event handler or an effect in the surface, so the
//      no-auto-send property (SUPP-01, DEC-D10) is not weakened by a module
//      that could decide on its own to send. There is no timer, no retry loop
//      and no queue in here.
//   2. The POST body carries `body` and nothing else. The route refuses
//      `authorKind`, `authorProfileId`, `origin` and `sentAt` outright — they
//      are derived from the session and the draft — so sending one would be a
//      400, and believing we chose them would be a misreading of the model.
//   3. A failed read is its own state. `"failed"` never collapses into an empty
//      thread list, because an outage that renders as "no conversations" is the
//      G-HOST-14 class this repo has already paid for three times.

/** A row of `/api/support/threads`. Narrow on purpose: what the list renders. */
export interface SupportInboxThread {
  readonly id: string;
  readonly kind: "team_chat" | "platform_support";
  readonly subject: string;
  readonly status: "open" | "pending" | "resolved";
  readonly lastActivityAt: string;
  /**
   * The client a `team_chat` belongs to, as an id and never as a name.
   *
   * The consumer opens its thread with the literal subject "Team Chat", so the
   * subject alone identifies nobody. `support_list_threads` carries `client_id`
   * and no display name, which is why the Inbox resolves the name against the
   * client directory below rather than against the support payload.
   *
   * Absent rather than required: a payload that stopped carrying the id should
   * cost the list its labels, not collapse the whole read into `"failed"`.
   */
  readonly clientId: string | null;
  /**
   * Where this viewer's attention stopped, and how much has happened since.
   *
   * It rides on the thread row rather than arriving from a second call because
   * a badge that loaded separately would disagree with the list it sits in for
   * as long as that call took, and "briefly wrong" is a state an unread count
   * has no way to explain. The count is derived in SQL from the messages; the
   * browser never computes one and never sends one.
   */
  readonly read: SupportThreadWatermark;
  /**
   * The newest message this viewer may read, already truncated by the database.
   *
   * `null` when the thread holds nothing they can read — a thread opened but
   * never written into, or one whose only message is a note a client cannot
   * see. A list row renders its empty state from this rather than inventing a
   * line of text.
   */
  readonly lastMessagePreview: string | null;
  /** Message-class facts used to keep Client replies and Internal notes as distinct inboxes. */
  readonly participantMessageCount: number;
  readonly internalMessageCount: number;
  readonly lastParticipantMessagePreview: string | null;
  readonly lastInternalMessagePreview: string | null;
}

/**
 * Named `Watermark` rather than `Read` because this module already exports a
 * `SupportThreadRead` — the state of the pane's fetch — and `operator.tsx`
 * imports it. Two meanings of "read" in one file is confusing; two meanings
 * under one name would be a broken import in another lane's surface.
 */
export interface SupportThreadWatermark {
  readonly lastReadAt: string | null;
  readonly unreadCount: number;
  /**
   * The greatest watermark on the other side of the thread, or null for "cannot say".
   *
   * The one input to a read receipt. Migration 393 derives it in the digest; nothing in the
   * browser may compute it, and no request may assert it.
   */
  readonly counterpartReadAt: string | null;
}

/** A row of the `messages` array `/api/support/threads/[id]` answers with. */
export interface SupportInboxMessage {
  readonly id: string;
  readonly authorKind: SupportInboxAuthorKind;
  readonly body: string;
  readonly origin: SupportInboxOrigin;
  readonly sentAt: string;
  /**
   * `internal` is an operator-only note living in the client's own thread.
   *
   * A value outside the closed set is a parse failure rather than a default,
   * because the safe-looking default is the dangerous one: an unrecognised
   * visibility rendered as `participants` would put a note in front of the
   * person it was written about. The database never sends one — RLS and the read
   * RPC both filter notes out for a consumer — so this is the second refusal
   * rather than the only one.
   */
  readonly visibility: SupportMessageVisibility;
}

export type SupportMessageVisibility = "participants" | "internal";

/**
 * Both closed sets, mirroring `src/lib/support/types.ts`.
 *
 * They are unions rather than `string` because the Inbox now renders on them:
 * `origin` decides whether a message carries the assisted badge, and a value
 * outside the set would render as an unbadged human message — the quiet wrong
 * answer rather than a visible failure.
 */
export type SupportInboxAuthorKind = "consumer" | "operator" | "admin";
export type SupportInboxOrigin = "human" | "ai_assisted";

/**
 * The suggestion held against one thread, as `/api/support/threads/[id]`
 * returns it. Only the fields the composer renders: the confidence pair and the
 * guardrail flags are what let an operator judge it, and `status` is what
 * decides whether it may be sent as written at all.
 */
export interface SupportInboxDraft {
  readonly id: string;
  readonly body: string;
  readonly confidence: number;
  readonly confidenceThreshold: number;
  readonly guardrailFlags: readonly string[];
  readonly status: "draft" | "approved" | "sent" | "discarded";
}

/**
 * One client the session can see, from `/api/clients`.
 *
 * This is the Inbox's only source for a thread's client name and its owner, and
 * it is the same durable rail the tracker reads. The alternative was to leave
 * the durable body without the team filter that `HANDOFF.md` records as shipped
 * for ask #65 — a filter cannot exist without an owner per thread, and no
 * support payload carries one.
 */
export interface SupportInboxClient {
  readonly id: string;
  readonly displayName: string;
  readonly assignedToId: string | null;
  readonly assignedToName: string | null;
  /** Stored role of the assigned operator; null means the API could not prove one. */
  readonly assignedToOrgRole: TrackerAssigneeOrgRole | null;
  /** True only when the assigned profile exists and is not disabled. */
  readonly assignedToActive: boolean | null;
  /** Derived from the response's currentProfileId, never from a display name. */
  readonly assignedToIsCurrentUser: boolean;
  /**
   * The client snapshot the Inbox's Details rail shows beside a conversation.
   *
   * `/api/clients` has always returned all six of these on every row and this parser narrowed
   * them away, which is why the rail could say more about a client on the demonstration body than
   * on a signed-in workspace — the durable half was the thinner one, for want of a parse.
   *
   * Every one is optional and every one degrades to `null`, because the route returning them
   * today is not a contract: a row that omits one, or carries it in the wrong shape, produces a
   * rail with one line missing rather than a rail that fails to render.
   */
  readonly stage: TrackerStage | null;
  readonly readiness: number | null;
  readonly analysisAt: string | null;
  readonly openActionCount: number | null;
  readonly nextRefreshAt: string | null;
  readonly businessName: string | null;
}

/**
 * What the bootstrap read can resolve to.
 *
 * `"disabled"` is `{ enabled: false }` — a known, deliberate state the route
 * answers with a 200 when FEATURE_SUPPORT is off. `"failed"` is everything
 * else that did not produce a payload anyone should present as real. They are
 * separate because the Inbox says something different about each.
 */
export type SupportInboxRead =
  | { readonly state: "loading" }
  | { readonly state: "disabled" }
  | { readonly state: "failed" }
  | { readonly state: "ready"; readonly threads: readonly SupportInboxThread[] };

export type SupportThreadRead =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | {
      readonly state: "ready";
      readonly thread: SupportInboxThread | null;
      readonly messages: readonly SupportInboxMessage[];
      readonly draft: SupportInboxDraft | null;
      readonly read: SupportThreadWatermark;
      /** Present when `FEATURE_TIMELINE` is on server-side; absent is the shipped thread. */
      readonly timeline?: TimelineRead;
    };

/**
 * The directory read collapses "disabled" into "unavailable" on purpose, and it
 * is the one place in this file that collapses anything.
 *
 * The reason the distinction earns its keep elsewhere is that the Inbox says
 * something different about each. Here it cannot: with no directory the Inbox
 * hides the team filter and prints thread subjects unlabelled, and it does that
 * identically whether the tracker flag is off or the read fell over. What it
 * never does is show a filter that silently matches nothing.
 */
export type SupportInboxDirectoryRead =
  | { readonly state: "unavailable" }
  | {
      readonly state: "ready";
      readonly clients: readonly SupportInboxClient[];
      readonly currentProfileId: string;
    };

export type SupportSendResult =
  | { readonly ok: true; readonly message: SupportInboxMessage }
  | { readonly ok: false; readonly code: string | null };

/**
 * A write that returns nothing the caller renders directly.
 *
 * `code` is the route's own `error` identifier when it sent one, because the
 * Inbox has to tell `SUPPORT_THREAD_CLOSED` — a resolved thread refusing a
 * send, which the operator can fix by reopening it — apart from every other
 * refusal, which they cannot.
 */
export type SupportWriteResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: string | null };

const THREAD_KINDS = new Set(["team_chat", "platform_support"]);
const THREAD_STATUSES = new Set(["open", "pending", "resolved"]);
const AUTHOR_KINDS = new Set(["consumer", "operator", "admin"]);
const MESSAGE_ORIGINS = new Set(["human", "ai_assisted"]);
const DRAFT_STATUSES = new Set(["draft", "approved", "sent", "discarded"]);
const MESSAGE_VISIBILITIES = new Set(["participants", "internal"]);

/** The statuses a thread can be moved to, in the order the control offers them. */
export const SUPPORT_THREAD_STATUSES = [
  "open",
  "pending",
  "resolved",
] as const satisfies readonly SupportInboxThread["status"][];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function parseInboxThread(value: unknown): SupportInboxThread | null {
  const row = asRecord(value);
  if (row === null) return null;
  if (
    typeof row.id !== "string"
    || typeof row.subject !== "string"
    || typeof row.lastActivityAt !== "string"
    || typeof row.kind !== "string"
    || !THREAD_KINDS.has(row.kind)
    || typeof row.status !== "string"
    || !THREAD_STATUSES.has(row.status)
  ) return null;
  const participantCount = typeof row.participantMessageCount === "number" && Number.isFinite(row.participantMessageCount)
    ? Math.max(0, Math.trunc(row.participantMessageCount))
    : row.lastMessagePreview === null ? 0 : 1;
  const internalCount = typeof row.internalMessageCount === "number" && Number.isFinite(row.internalMessageCount)
    ? Math.max(0, Math.trunc(row.internalMessageCount))
    : 0;
  return {
    clientId: typeof row.clientId === "string" ? row.clientId : null,
    id: row.id,
    kind: row.kind as SupportInboxThread["kind"],
    lastActivityAt: row.lastActivityAt,
    lastMessagePreview: typeof row.lastMessagePreview === "string" ? row.lastMessagePreview : null,
    participantMessageCount: participantCount,
    internalMessageCount: internalCount,
    lastParticipantMessagePreview: typeof row.lastParticipantMessagePreview === "string"
      ? row.lastParticipantMessagePreview
      : typeof row.lastMessagePreview === "string" ? row.lastMessagePreview : null,
    lastInternalMessagePreview: typeof row.lastInternalMessagePreview === "string" ? row.lastInternalMessagePreview : null,
    read: parseThreadWatermark(row.read),
    status: row.status as SupportInboxThread["status"],
    subject: row.subject,
  };
}

/**
 * The watermark, or the state a thread is in before one exists.
 *
 * An unreadable `read` block degrades to "nothing unread" rather than failing
 * the whole row: a thread with a wrong badge is worth showing, and a thread
 * that disappeared because its badge was malformed is not. The count is floored
 * and truncated here as well as in SQL because this is the last place before it
 * becomes text on a screen.
 */
export function parseThreadWatermark(value: unknown): SupportThreadWatermark {
  const row = asRecord(value);
  if (row === null) return { counterpartReadAt: null, lastReadAt: null, unreadCount: 0 };
  const count = typeof row.unreadCount === "number" && Number.isFinite(row.unreadCount)
    ? Math.max(0, Math.trunc(row.unreadCount))
    : 0;
  return {
    // Anything that is not a string is "cannot say". A receipt is a claim about another person,
    // so the unparseable case degrades to Delivered rather than to a guess.
    counterpartReadAt: typeof row.counterpartReadAt === "string" ? row.counterpartReadAt : null,
    lastReadAt: typeof row.lastReadAt === "string" ? row.lastReadAt : null,
    unreadCount: count,
  };
}

export function parseInboxMessage(value: unknown): SupportInboxMessage | null {
  const row = asRecord(value);
  if (row === null) return null;
  if (
    typeof row.id !== "string"
    || typeof row.authorKind !== "string"
    || !AUTHOR_KINDS.has(row.authorKind)
    || typeof row.body !== "string"
    || typeof row.origin !== "string"
    || !MESSAGE_ORIGINS.has(row.origin)
    || typeof row.sentAt !== "string"
    || typeof row.visibility !== "string"
    || !MESSAGE_VISIBILITIES.has(row.visibility)
  ) return null;
  return {
    authorKind: row.authorKind as SupportInboxAuthorKind,
    body: row.body,
    id: row.id,
    origin: row.origin as SupportInboxOrigin,
    sentAt: row.sentAt,
    visibility: row.visibility as SupportMessageVisibility,
  };
}

/**
 * The held draft, or `null`.
 *
 * `null` is the ordinary answer — most threads have no open suggestion, and a
 * consumer never sees one at all — so an absent `draft` key is not a failure.
 * A `draft` that is present and unreadable is, because rendering half a
 * suggestion is how a confidence figure ends up beside the wrong body.
 */
export function parseInboxDraft(value: unknown): SupportInboxDraft | null | undefined {
  if (value === null || value === undefined) return null;
  const row = asRecord(value);
  if (row === null) return undefined;
  if (
    typeof row.id !== "string"
    || typeof row.body !== "string"
    || typeof row.confidence !== "number"
    || !Number.isFinite(row.confidence)
    || typeof row.confidenceThreshold !== "number"
    || !Number.isFinite(row.confidenceThreshold)
    || typeof row.status !== "string"
    || !DRAFT_STATUSES.has(row.status)
    || !Array.isArray(row.guardrailFlags)
    || !row.guardrailFlags.every((flag) => typeof flag === "string")
  ) return undefined;
  return {
    body: row.body,
    confidence: row.confidence,
    confidenceThreshold: row.confidenceThreshold,
    guardrailFlags: row.guardrailFlags as readonly string[],
    id: row.id,
    status: row.status as SupportInboxDraft["status"],
  };
}

/**
 * The bootstrap. The route answers 200 in every reachable case and carries
 * `enabled`, so a non-200, an unreadable body and a missing `enabled` are all
 * failures rather than an empty inbox.
 */
export function parseInboxBootstrap(value: unknown): SupportInboxRead | null {
  const body = asRecord(value);
  if (body === null) return null;
  if (body.enabled === false) return { state: "disabled" };
  if (body.enabled !== true || !Array.isArray(body.threads)) return null;
  const threads: SupportInboxThread[] = [];
  for (const entry of body.threads) {
    const thread = parseInboxThread(entry);
    if (thread === null) return null;
    threads.push(thread);
  }
  return { state: "ready", threads };
}

export function parseThreadPayload(value: unknown): SupportThreadRead | null {
  const body = asRecord(value);
  if (body === null || !Array.isArray(body.messages)) return null;
  const messages: SupportInboxMessage[] = [];
  for (const entry of body.messages) {
    const message = parseInboxMessage(entry);
    if (message === null) return null;
    messages.push(message);
  }
  const draft = parseInboxDraft(body.draft);
  if (draft === undefined) return null;
  const timeline = parseTimelineRead(body.timeline);
  return {
    draft,
    messages,
    read: parseThreadWatermark(body.read),
    state: "ready",
    thread: parseInboxThread(body.thread),
    ...(timeline === undefined ? {} : { timeline }),
  };
}

type TimelineEventValidator = (row: Readonly<Record<string, unknown>>) => boolean;

function hasStrings(
  row: Readonly<Record<string, unknown>>,
  fields: readonly string[],
): boolean {
  return fields.every((field) => typeof row[field] === "string");
}

function hasOptionalStrings(
  row: Readonly<Record<string, unknown>>,
  fields: readonly string[],
): boolean {
  return fields.every((field) => row[field] === undefined || typeof row[field] === "string");
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function hasOptionalFiniteNumbers(
  row: Readonly<Record<string, unknown>>,
  fields: readonly string[],
): boolean {
  return fields.every((field) => row[field] === undefined || isFiniteNumber(row[field]));
}

function hasOptionalBooleans(
  row: Readonly<Record<string, unknown>>,
  fields: readonly string[],
): boolean {
  return fields.every((field) => row[field] === undefined || typeof row[field] === "boolean");
}

/**
 * The payload fields each catalog formatter reads.
 *
 * A map keyed by the event union makes the accepted kind set closed at compile time: adding a
 * kind to `TimelineEvent` without teaching this boundary its payload is a type error. Each value
 * validates the fields that kind's formatter dereferences before the row can reach the catalog.
 */
const TIMELINE_EVENT_VALIDATORS: Readonly<
  Record<TimelineEvent["kind"], TimelineEventValidator>
> = {
  action: (row) =>
    hasStrings(row, ["title"])
    && (row.state === "todo" || row.state === "reported" || row.state === "verified")
    && typeof row.blocking === "boolean"
    && hasOptionalStrings(row, ["reportedAt", "verifiedAt"]),
  analysis_completed: (row) =>
    isFiniteNumber(row.readiness)
    && (row.trigger === "scheduled" || row.trigger === "refresh" || row.trigger === "manual")
    && hasOptionalFiniteNumbers(row, ["prev", "open"])
    && hasOptionalStrings(row, ["prevAt"])
    && hasOptionalBooleans(row, ["superseded"]),
  application_outcome: (row) =>
    hasStrings(row, ["bank", "decidedOn"])
    && (row.kindWord === "funded" || row.kindWord === "declined" || row.kindWord === "withdrawn")
    && hasOptionalFiniteNumbers(row, ["amountCents"])
    && hasOptionalStrings(row, ["releasedOn"])
    && (row.kindWord === "funded" || row.amountCents === undefined),
  assignment: (row) =>
    row.operatorOnly === true
    && hasStrings(row, ["to"])
    && hasOptionalStrings(row, ["from"]),
  consent_revoked: (row) => row.which === "monitoring" || row.which === "analysis",
  document_filed: (row) =>
    hasStrings(row, ["name", "named", "section", "uploadId"])
    && hasOptionalStrings(row, ["reviewedBy"]),
  document_requested: (row) =>
    hasStrings(row, ["name", "named", "why", "requestId"])
    && hasOptionalStrings(row, ["fulfilledAt", "uploadId", "reviewedBy"]),
  enrollment_milestone: (row) =>
    (row.milestone === "consents"
      || row.milestone === "esign"
      || row.milestone === "idv"
      || row.milestone === "active")
    && hasOptionalStrings(row, ["firstChargeOn"]),
  fee_payment: (row) =>
    isFiniteNumber(row.amountCents)
    && hasStrings(row, ["method", "receivedOn"])
    && hasOptionalFiniteNumbers(row, ["balanceCents"]),
  refresh: (row) =>
    isFiniteNumber(row.amountCents)
    && hasOptionalStrings(row, ["completedAt"])
    && hasOptionalFiniteNumbers(row, ["readiness"]),
  refresh_blocked: (row) =>
    row.operatorOnly === true
    && isFiniteNumber(row.lastReadiness)
    && hasStrings(row, ["resetsOn", "lastRunAt"]),
  stage_changed: (row) =>
    hasStrings(row, ["to"])
    && hasOptionalStrings(row, ["from"]),
  subscription: (row) =>
    (row.state === "active" || row.state === "cancelled")
    && hasOptionalStrings(row, ["endsOn"]),
  thread_opened: () => true,
  thread_status: (row) => row.to === "resolved" || row.to === "open",
};

function isTimelineKind(value: unknown): value is TimelineEvent["kind"] {
  return typeof value === "string" && Object.hasOwn(TIMELINE_EVENT_VALIDATORS, value);
}

function parseTimelineEvent(value: unknown): TimelineEvent | null {
  const row = asRecord(value);
  if (
    row === null
    || typeof row.ref !== "string"
    || typeof row.at !== "string"
    || !isTimelineKind(row.kind)
    || !hasOptionalStrings(row, ["client", "actor"])
    || !hasOptionalBooleans(row, ["operatorOnly"])
    || !TIMELINE_EVENT_VALIDATORS[row.kind](row)
  ) return null;
  return row as unknown as TimelineEvent;
}

/**
 * The server's `TimelineRead`, filtered at the client boundary so a new or malformed server event
 * cannot reach a catalog formatter that has no specification or whose required payload is absent.
 */
function parseTimelineRead(value: unknown): TimelineRead | undefined {
  const body = asRecord(value);
  if (body === null || !Array.isArray(body.events)) return undefined;
  const events: TimelineEvent[] = [];
  for (const entry of body.events) {
    const event = parseTimelineEvent(entry);
    if (event !== null) events.push(event);
  }
  return { events, ...(body.readFailed === true ? { readFailed: true } : {}) };
}

export function parseInboxClient(
  value: unknown,
  currentProfileId: string | null = null,
): SupportInboxClient | null {
  const row = asRecord(value);
  if (row === null) return null;
  if (typeof row.id !== "string" || typeof row.displayName !== "string") return null;
  const assignedToId = typeof row.assignedToId === "string" ? row.assignedToId : null;
  return {
    analysisAt: typeof row.analysisAt === "string" ? row.analysisAt : null,
    assignedToActive: typeof row.assignedToActive === "boolean"
      ? row.assignedToActive
      : null,
    assignedToId,
    assignedToIsCurrentUser:
      assignedToId !== null && currentProfileId !== null && assignedToId === currentProfileId,
    assignedToName: typeof row.assignedToName === "string" ? row.assignedToName : null,
    assignedToOrgRole: isTrackerAssigneeOrgRole(row.assignedToOrgRole)
      ? row.assignedToOrgRole
      : null,
    businessName: typeof row.businessName === "string" ? row.businessName : null,
    displayName: row.displayName,
    id: row.id,
    nextRefreshAt: typeof row.nextRefreshAt === "string" ? row.nextRefreshAt : null,
    openActionCount: typeof row.openActionCount === "number" ? row.openActionCount : null,
    readiness: typeof row.readiness === "number" ? row.readiness : null,
    // The stage is checked against the taxonomy rather than accepted as a string, because it
    // reaches a chip that colours itself by stage and an unknown value would render as a chip
    // for a stage this product does not have.
    stage: typeof row.stage === "string" && isTrackerStage(row.stage) ? row.stage : null,
  };
}

export async function readSupportInbox(
  fetcher: typeof fetch = fetch,
): Promise<SupportInboxRead> {
  try {
    const response = await fetcher("/api/support/threads", {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) return { state: "failed" };
    return parseInboxBootstrap(await response.json()) ?? { state: "failed" };
  } catch {
    return { state: "failed" };
  }
}

export async function readSupportThread(
  threadId: string,
  fetcher: typeof fetch = fetch,
): Promise<SupportThreadRead> {
  try {
    const response = await fetcher(
      `/api/support/threads/${encodeURIComponent(threadId)}`,
      { cache: "no-store", credentials: "same-origin" },
    );
    if (!response.ok) return { state: "failed" };
    return parseThreadPayload(await response.json()) ?? { state: "failed" };
  } catch {
    return { state: "failed" };
  }
}

/**
 * The `error` identifier a support route sent, or `null`.
 *
 * Every refusal in this phase is `{ error: "SUPPORT_..." }` with the code as
 * the whole of the message, so reading it costs one lookup and leaks nothing:
 * `src/lib/support/errors.ts` exists precisely so that no table name, no
 * constraint name and no row value can ride out on a failure.
 */
async function readFailureCode(response: Response): Promise<string | null> {
  try {
    const payload = asRecord(await response.json());
    return payload !== null && typeof payload.error === "string" ? payload.error : null;
  } catch {
    return null;
  }
}

/**
 * One reply, from one person pressing one button.
 *
 * The body is `{ body }`, plus `draftId` when — and only when — the person
 * pressed send on the suggestion as written. Every other column on a support
 * message is derived: the author kind from the session's role, the actor from
 * the session profile, the origin from whether a draft was cited, the sent
 * timestamp from the database clock. The route rejects a request that names any
 * of them rather than dropping it quietly.
 *
 * `draftId` is not an exception to that. Citing a draft does not let the caller
 * choose `origin`; it lets migration 101 decide, and it refuses the pairing
 * outright unless the body matches the stored draft byte for byte and the draft
 * is `approved`. Which is why the composer never sends an edited draft with an
 * id attached — an edited draft is the person's own message.
 */
export async function postSupportReply(
  threadId: string,
  body: string,
  draftId: string | null = null,
  fetcher: typeof fetch = fetch,
  visibility: SupportMessageVisibility = "participants",
): Promise<SupportSendResult> {
  try {
    const response = await fetcher(
      `/api/support/threads/${encodeURIComponent(threadId)}/messages`,
      {
        // `visibility` is sent only when it is not the client-facing default, so
        // the ordinary reply's payload is byte-for-byte what it was before this
        // feature existed. A note is the request that looks different, which is
        // the right way round for the thing that needs reviewing.
        body: JSON.stringify({
          body,
          ...(draftId === null ? {} : { draftId }),
          ...(visibility === "participants" ? {} : { visibility }),
        }),
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      },
    );
    if (!response.ok) return { code: await readFailureCode(response), ok: false };
    const payload = asRecord(await response.json());
    const message = payload === null ? null : parseInboxMessage(payload.message);
    return message === null ? { code: null, ok: false } : { message, ok: true };
  } catch {
    return { code: null, ok: false };
  }
}

/**
 * Record that this person has seen the thread up to now.
 *
 * The count that comes back is the database's — derived from the messages by
 * `support_list_thread_digest` — so a caller that dropped this response and
 * assumed zero would be right by luck rather than by construction. Called from
 * an event handler or an effect in the surface, never from a timer in here:
 * this module has no timer, and the no-auto-send property is why.
 */
export async function postSupportThreadRead(
  threadId: string,
  lastReadAt: string | null = null,
  fetcher: typeof fetch = fetch,
): Promise<
  | { readonly ok: true; readonly read: SupportThreadWatermark }
  | { readonly ok: false; readonly code: string | null }
> {
  try {
    const response = await fetcher(
      `/api/support/threads/${encodeURIComponent(threadId)}/read`,
      {
        body: JSON.stringify(lastReadAt === null ? {} : { lastReadAt }),
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      },
    );
    if (!response.ok) return { code: await readFailureCode(response), ok: false };
    const payload = asRecord(await response.json());
    return payload === null
      ? { code: null, ok: false }
      : { ok: true, read: parseThreadWatermark(payload.read) };
  } catch {
    return { code: null, ok: false };
  }
}

/**
 * Move a thread between `open`, `pending` and `resolved`.
 *
 * The Inbox printed the status as text and had no setter, so a thread could be
 * opened and answered and never closed. The RPC underneath writes a from/to
 * audit row and treats a no-op as a no-op, so a repeated press is silent rather
 * than a second audit event.
 */
export async function patchSupportThreadStatus(
  threadId: string,
  status: SupportInboxThread["status"],
  fetcher: typeof fetch = fetch,
): Promise<SupportWriteResult> {
  try {
    const response = await fetcher(
      `/api/support/threads/${encodeURIComponent(threadId)}`,
      {
        body: JSON.stringify({ status }),
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      },
    );
    return response.ok ? { ok: true } : { code: await readFailureCode(response), ok: false };
  } catch {
    return { code: null, ok: false };
  }
}

/**
 * Ask for a suggestion, or throw the current one away.
 *
 * Neither verb sends anything, and neither is called by anything but a click
 * handler. There is no timer and no retry here for the same reason the rest of
 * this file has none: a module that could decide on its own to act is the shape
 * the no-auto-send property (SUPP-01, DEC-D10) rules out.
 */
export async function requestSupportDraft(
  threadId: string,
  fetcher: typeof fetch = fetch,
): Promise<SupportWriteResult> {
  return draftVerb(threadId, "POST", fetcher);
}

export async function discardSupportDraft(
  threadId: string,
  fetcher: typeof fetch = fetch,
): Promise<SupportWriteResult> {
  return draftVerb(threadId, "DELETE", fetcher);
}

async function draftVerb(
  threadId: string,
  method: "POST" | "DELETE",
  fetcher: typeof fetch,
): Promise<SupportWriteResult> {
  try {
    const response = await fetcher(
      `/api/support/threads/${encodeURIComponent(threadId)}/draft`,
      { cache: "no-store", credentials: "same-origin", method },
    );
    return response.ok ? { ok: true } : { code: await readFailureCode(response), ok: false };
  } catch {
    return { code: null, ok: false };
  }
}

/**
 * The clients this session can see, for the Inbox's labels and its team filter.
 *
 * `/api/clients` answers `{ enabled: false, clients: [] }` when the tracker
 * flag is off, and that is indistinguishable to the Inbox from a read that
 * fell over: either way there is no directory, so the filter is not offered and
 * the rows carry no client name. Nothing here decides which threads exist —
 * a thread the directory cannot name still renders.
 */
export async function readSupportInboxDirectory(
  fetcher: typeof fetch = fetch,
): Promise<SupportInboxDirectoryRead> {
  try {
    const response = await fetcher("/api/clients?scope=all", {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) return { state: "unavailable" };
    const body = asRecord(await response.json());
    if (body === null || body.enabled !== true || !Array.isArray(body.clients)) {
      return { state: "unavailable" };
    }
    const currentProfileId = isTrackerUuid(body.currentProfileId)
      ? body.currentProfileId
      : null;
    if (currentProfileId === null) return { state: "unavailable" };
    const clients: SupportInboxClient[] = [];
    for (const entry of body.clients) {
      const client = parseInboxClient(entry, currentProfileId);
      if (client === null) return { state: "unavailable" };
      clients.push(client);
    }
    return { clients, currentProfileId, state: "ready" };
  } catch {
    return { state: "unavailable" };
  }
}

/**
 * The team members the directory actually names, sorted by name.
 *
 * Derived from the threads' own clients rather than from the workspace's seat
 * list: a filter option that can never match anything is the fixture body's
 * failure mode, not one worth reproducing.
 */
export function inboxTeamOptions(
  clients: readonly SupportInboxClient[],
): readonly {
  readonly active: boolean;
  readonly id: string;
  readonly isCurrentUser: boolean;
  readonly name: string;
  readonly orgRole: TrackerAssigneeOrgRole | null;
}[] {
  const byId = new Map<string, {
    active: boolean;
    id: string;
    isCurrentUser: boolean;
    name: string;
    orgRole: TrackerAssigneeOrgRole | null;
  }>();
  for (const client of clients) {
    if (client.assignedToId === null) continue;
    byId.set(client.assignedToId, {
      active: client.assignedToActive === true,
      id: client.assignedToId,
      isCurrentUser: client.assignedToIsCurrentUser,
      name: client.assignedToName ?? "Unnamed team member",
      orgRole: client.assignedToOrgRole,
    });
  }
  return [...byId.values()]
    .sort((left, right) => left.name.localeCompare(right.name));
}
