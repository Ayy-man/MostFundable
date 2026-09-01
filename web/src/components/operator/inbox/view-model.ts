// The Inbox's view model: everything it decides that is not a React tree.
//
// It is a separate module for one reason. The runner collects `src/**/*.test.ts` and Node strips
// types without transforming JSX, so nothing in a `.tsx` can be driven by a test — which means a
// decision left inside a component is a decision no test can watch fail. Filtering, selection,
// unread, the author a message is attributed to, and above all which of the four verdicts a held
// draft came back with are exactly the decisions worth watching, so they live here and the
// components render what this returns.
//
// Two rules run through the whole file.
//
// **Nothing is inferred that the server reports.** The unread count comes off the watermark row
// and is copied, never recomputed; a thread's status comes off the thread; a draft's verdict is
// derived from the fields the engine wrote and from the closed set of reasons the engine can have.
// Where the server says nothing — how many people are typing, whether a client has read a reply —
// this file says nothing either.
//
// **No runtime import from `@/components/chat`.** The barrel is `.tsx` all the way down and a
// `.test.ts` cannot load it, so a runtime dependency here would make this module untestable and
// quietly move the decisions back into the component. Types are imported `import type`, which
// Node erases, and every string that needs formatting for a person is formatted by the component
// with the foundation's own helpers.

import { canSendHeldDraft } from "@/lib/support/draft-send";
import { receiptFor } from "@/lib/support/read-receipt";

import type {
  ChatAuthorKind,
  ChatClientStage,
  ChatMessage,
  ChatThreadItem,
  ChatThreadStatus,
  ChatThreadSummary,
} from "@/components/chat/types";
import type {
  SupportInboxDraft,
  SupportInboxMessage,
  SupportInboxThread,
} from "@/lib/operator/support-inbox.client";
import { TRACKER_STAGE_LABELS, type TrackerStage } from "@/lib/tracker/types";

// ---------------------------------------------------------------------------------------------
// Stage
// ---------------------------------------------------------------------------------------------

/**
 * The one stage taxonomy, crossed from the tracker's tokens to the chat foundation's labels.
 *
 * `TRACKER_STAGE_LABELS` is the module that owns the mapping and this reads it rather than
 * repeating it, so a seventh stage is a type error here on the day it is added rather than a chip
 * that silently stops rendering. The fixture rows already carry the label form, which is why the
 * value is accepted in either shape.
 */
export function stageLabel(value: string | null | undefined): ChatClientStage | undefined {
  if (typeof value !== "string" || value === "") return undefined;
  const fromToken = TRACKER_STAGE_LABELS[value as TrackerStage] as ChatClientStage | undefined;
  if (fromToken !== undefined) return fromToken;
  const labels = Object.values(TRACKER_STAGE_LABELS) as ChatClientStage[];
  return labels.find((label) => label === value);
}

// ---------------------------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------------------------

/** What the Inbox knows about the client on the other end of a thread, from either source. */
export interface InboxThreadClient {
  readonly displayName: string;
  readonly businessName?: string | null;
  readonly stage?: string | null;
  readonly assignedToId?: string | null;
  readonly assignedToName?: string | null;
}

/**
 * One durable thread as a list row.
 *
 * The unread count is `thread.read.unreadCount` and nothing else. Contract §3.1 derives it in SQL
 * from the messages this profile has not seen and did not write; a browser recomputing it gets it
 * wrong the moment the operator has two tabs open, and a badge that is wrong about whether
 * somebody is waiting is worse than no badge at all.
 */
export function toThreadSummary(
  thread: SupportInboxThread,
  client: InboxThreadClient | undefined,
  mode: "participants" | "internal" = "participants",
): ChatThreadSummary {
  return {
    lastActivityAt: thread.lastActivityAt,
    ownerName: client?.assignedToName ?? undefined,
    preview: mode === "internal"
      ? thread.lastInternalMessagePreview
      : thread.lastParticipantMessagePreview,
    ref: thread.id,
    stage: stageLabel(client?.stage),
    status: thread.status,
    subtitle: client?.businessName ?? undefined,
    // A thread whose client the directory cannot name still renders, under its subject. A row
    // nobody can label is still a row somebody is waiting on.
    title: client?.displayName ?? thread.subject,
    unreadCount: thread.read.unreadCount,
  };
}

export interface ThreadFilter {
  readonly status: ChatThreadStatus;
  readonly query: string;
  /** A team member's handle, or `"all"`. Matched against the row's owner, resolved by the caller. */
  readonly member: string;
  /** Each row's owner handle, keyed by thread. Absent means the row has no owner to filter on. */
  readonly ownerByThread?: ReadonlyMap<string, string | null>;
}

/**
 * Status, then team member, then text.
 *
 * Search reads the title, the subtitle and the preview, which is every string the row actually
 * shows. Searching a field the row does not display is how an operator ends up staring at a
 * result they cannot see the reason for.
 */
export function filterThreads(
  threads: readonly ChatThreadSummary[],
  filter: ThreadFilter,
): readonly ChatThreadSummary[] {
  const needle = filter.query.trim().toLowerCase();
  return threads.filter((thread) => {
    if (thread.status !== filter.status) return false;
    if (filter.member !== "all") {
      const owner = filter.ownerByThread?.get(thread.ref) ?? null;
      if (owner !== filter.member) return false;
    }
    if (needle === "") return true;
    return [thread.title, thread.subtitle, thread.preview].some(
      (field) => typeof field === "string" && field.toLowerCase().includes(needle),
    );
  });
}

/**
 * The fields a row has to carry to be worth opening. Both shapes the Inbox holds satisfy it:
 * `ChatThreadSummary` structurally, and a raw `SupportInboxThread` through `toSelectable` below.
 */
export interface SelectableThread {
  readonly ref: string;
  readonly status: ChatThreadStatus;
  readonly preview: string | null;
  readonly lastActivityAt: string;
}

/** A raw row in the shape the rule reads. The field names live here beside `toThreadSummary`. */
export function toSelectable(thread: SupportInboxThread): SelectableThread {
  return {
    lastActivityAt: thread.lastActivityAt,
    preview: thread.lastMessagePreview,
    ref: thread.id,
    status: thread.status,
  };
}

/** An unparseable instant sorts last rather than turning the whole comparison into `NaN`. */
function instant(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * The conversation to open when the operator has not chosen one.
 *
 * Not the first row. The list is ordered by last activity, and in a workspace that opens a thread
 * for every client at enrolment the most recently touched row is routinely one nobody has written
 * in — so the Inbox opened on "Nothing here yet" while three clients with unread messages sat
 * underneath it, and the rail beside it offered to draft a reply to a conversation with nothing to
 * reply to.
 *
 * `preview` is what decides it, and it decides it exactly. Migration 386 builds
 * `last_message_preview` as a single-row subselect over the messages this reader is allowed to
 * see, so it is null when and only when there is nothing in the thread for this person to read —
 * which is the same thing the empty thread pane says. A row with no preview is never opened for
 * somebody; it is only ever opened because they asked for it.
 *
 * Resolved loses to open at equal footing, because Open is the tab the Inbox starts on and
 * pre-selecting a row that tab does not show is the same as selecting nothing.
 */
export function autoSelect(threads: readonly SelectableThread[]): string | null {
  // A scan rather than a filter-and-sort. `sort` mutates its receiver, and the React Compiler
  // cannot see that the receiver here is a copy the filter just made — it reads the whole list as
  // something this function might modify and stops optimising the Inbox that passes it in.
  let best: SelectableThread | null = null;
  for (const thread of threads) {
    if (thread.preview === null) continue;
    if (best === null) {
      best = thread;
      continue;
    }
    const showing = thread.status !== "resolved";
    if (showing !== (best.status !== "resolved")) {
      if (showing) best = thread;
      continue;
    }
    if (instant(thread.lastActivityAt) > instant(best.lastActivityAt)) best = thread;
  }
  return best?.ref ?? null;
}

/** Per-status totals for the tab row, over the unfiltered list. */
export function statusCounts(
  threads: readonly ChatThreadSummary[],
): Record<ChatThreadStatus, number> {
  const counts: Record<ChatThreadStatus, number> = { open: 0, pending: 0, resolved: 0 };
  for (const thread of threads) counts[thread.status] += 1;
  return counts;
}

/**
 * Where `j` and `k` land.
 *
 * Clamped rather than wrapped: an operator holding `j` at the bottom of the list expects to stay
 * at the bottom, and a list that silently jumps back to the top loses their place in a way they
 * only notice after replying to the wrong conversation. A selection that is no longer in the
 * filtered list starts from the first row, which is where the pane is already pointing.
 */
export function stepSelection(
  refs: readonly string[],
  current: string | null,
  delta: 1 | -1,
): string | null {
  if (refs.length === 0) return null;
  const index = current === null ? -1 : refs.indexOf(current);
  if (index === -1) return refs[0];
  const next = Math.min(refs.length - 1, Math.max(0, index + delta));
  return refs[next];
}

// ---------------------------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------------------------

const ROLE_LABEL: Readonly<Record<ChatAuthorKind, string>> = {
  admin: "Platform team",
  consumer: "Client",
  operator: "Your team",
};

export interface AuthorNames {
  /** The client's own name, when the directory could resolve it. */
  readonly consumer: string;
  /** What this workspace writes under. Already resolved by the shell. */
  readonly operator: string;
  readonly admin: string;
}

/**
 * Who a stored message is attributed to.
 *
 * `support_list_thread` carries an author *kind* and no name, so the name has to come from
 * somewhere the surface already knows: the directory for the client, the shell's own brand for
 * the workspace. This is the whole of the attribution, and it is deliberately not a lookup of the
 * individual operator who typed — the payload does not carry one, and inventing a colleague's
 * name on a message they may not have written is the kind of small lie that costs a support tool
 * its credibility.
 */
export function authorFor(kind: ChatAuthorKind, names: AuthorNames) {
  return { kind, name: names[kind], roleLabel: ROLE_LABEL[kind] } as const;
}

/** Operator and platform messages sit on the reader's side; the client's sit opposite. */
export function isOwnMessage(message: ChatMessage): boolean {
  return message.author.kind !== "consumer";
}

/**
 * Stored messages as thread rows.
 *
 * Everything the database has already accepted is `delivered` until a watermark says otherwise,
 * and the watermark that may say so is the client's, never this operator's. `counterpartReadAt`
 * is migration 393's derivation: the greatest mark held on the other side of the thread, an
 * instant that names nobody. Passing the operator's own `lastReadAt` here would put a receipt on
 * every reply the moment its author scrolled past it, which is why the rule takes only the
 * counterpart's instant and lives in one module both surfaces call.
 *
 * A note is not exempt and does not need to be: an `internal` message never reaches the client,
 * so no consumer watermark can be a claim about having read one. The receipt on a note therefore
 * says what it says about the thread, and the thread is where the client's attention stopped.
 */
export function toThreadItems(
  messages: readonly SupportInboxMessage[],
  names: AuthorNames,
  counterpartReadAt: string | null = null,
): readonly ChatThreadItem[] {
  return messages.map((message) => ({
    message: {
      author: authorFor(message.authorKind, names),
      body: message.body,
      delivery: receiptFor({
        counterpartReadAt,
        own: message.authorKind !== "consumer",
        sentAt: message.sentAt,
      }),
      origin: message.origin,
      ref: message.id,
      sentAt: message.sentAt,
      visibility: message.visibility,
    },
    type: "message" as const,
  }));
}

// ---------------------------------------------------------------------------------------------
// The held draft
// ---------------------------------------------------------------------------------------------

/**
 * What the surface can honestly say about why a draft is held.
 *
 * This is deliberately **not** the engine's `reasonCode`, and the difference is worth stating
 * because the first version of this function claimed to be an exact inversion and was not.
 * `runDraftEngine`'s `reasonFor` resolves in precedence order with the supervisor first, so a
 * draft the supervisor rejected *and* the language gate flagged is recorded as
 * `supervisor_rejected`. The payload the browser receives carries the flags and the confidence
 * pair but not the supervisor's own answer, so the two cases are indistinguishable here. A
 * surface that named the reason anyway would be guessing on a draft about somebody's funding.
 *
 * So each value below is a statement the payload actually supports:
 *
 * - `cleared` — the RPC wrote `approved`, which `runDraftEngine` does if and only if every gate
 *   passed. This is the only value that may offer a send.
 * - `language` — the compliance gate flagged the body. True whether or not the supervisor also
 *   held it, which is why it is safe to say ahead of `review`.
 * - `thin` — no flags and under its own bar. The brief's "not enough context to draft".
 * - `review` — held, with neither of the two visible reasons standing, which leaves the reviewer.
 */
/**
 * Which of the three bodies the Inbox is running as.
 *
 * `durable` is a signed-in workspace with stored conversations, `empty` the same workspace with
 * none yet, and `fixture` the demonstration shell. They are named here rather than inline in the
 * component so the two decisions that turn on them — whether the composer is locked, and what it
 * says — can be driven in a test instead of read out of JSX.
 */
export const INBOX_SOURCES = ["durable", "empty", "fixture"] as const;
export type InboxSource = (typeof INBOX_SOURCES)[number];

/**
 * Why this conversation cannot be replied to, or `null` when it can.
 *
 * The shared composer takes exactly this: a reason locks it, and the reason is what renders in
 * place of the field. So a lock that cannot say why is unreachable by construction, which is the
 * property worth having — a Send that is merely disabled teaches an operator to keep clicking it.
 *
 * The fixture body is locked because it has nowhere to send to. That is a truthful sentence about
 * a demonstration workspace and it is deliberately not phrased as a failure.
 */
export function composerLock(source: InboxSource, status: ChatThreadStatus | null): string | null {
  if (source === "fixture") {
    return "This demonstration workspace has no stored conversations, so nothing can be sent from here.";
  }
  if (source === "empty" || status === null) return null;
  return status === "resolved"
    ? "This conversation is resolved. Set it back to Open to reply."
    : null;
}

export type DraftHold = "cleared" | "language" | "thin" | "review";

export function draftHold(draft: SupportInboxDraft): DraftHold {
  // "Cleared" is not a second opinion about the status — it asks the module that owns rule 1,
  // with the composer's own lock left out, because a resolved conversation does not turn a draft
  // that passed its checks into one that was held.
  if (canSendHeldDraft(draft, { locked: false })) return "cleared";
  if (draft.guardrailFlags.length > 0) return "language";
  if (draft.confidence < draft.confidenceThreshold) return "thin";
  return "review";
}

export interface DraftPresentation {
  readonly hold: DraftHold;
  /** `false` for every hold but `cleared`: migration 101 refuses the rest outright. */
  readonly sendable: boolean;
  /**
   * Confidence in words with its basis, never a bare figure.
   *
   * A percentage sitting beside a reply about somebody's funding reads as a promise about their
   * outcome, which is the one thing this product may never make.
   */
  readonly confidence: string;
  /** Why it was held, in plain words. Absent when nothing held it. */
  readonly holdReason?: string;
  /** The brief's "not enough context to draft": there is nothing here worth framing. */
  readonly thin: boolean;
}

const ABOVE_BAR = "Confidence above the review bar";
const BELOW_BAR = "Confidence below the review bar";

/**
 * How a held draft reads, and whether it may be sent.
 *
 * The *whether* is not decided here — `canSendHeldDraft` owns it, along with the sibling rule that
 * an edited body loses its pairing, and both composer paths call the same module. Everything else
 * below is presentation: which of the four holds this is, and how to say so without printing a
 * figure. `locked` is the composer's own lock, so a resolved conversation's draft still reads as a
 * draft and simply cannot be sent.
 */
/**
 * Where a held draft is shown. Never nowhere.
 *
 * Two separate conditions decided this in JSX and there was a combination both of them refused —
 * an approved suggestion on a conversation with no send wired at all — so the rail said "a
 * suggestion is waiting in your composer" and the composer showed nothing. Total by construction:
 * the frame's condition is stated, and everything else is the notice.
 *
 * The frame is the shared composer's, which draws the send controls, so it may only be used where
 * there is a send to make or where the composer is locked and draws none.
 */
export type DraftPlacement = "frame" | "notice" | "hidden";

/** @see DraftPlacement */
export function draftPlacement({
  canSend,
  hold,
  locked,
  note,
}: {
  readonly hold: DraftHold;
  readonly canSend: boolean;
  readonly locked: boolean;
  readonly note: boolean;
}): DraftPlacement {
  // A suggestion drafted for the client has no business sitting above a note to the team, and the
  // pairing could not survive the visibility anyway: the send guard refuses an `origin_draft_id`
  // on an internal message. So it is neither framed nor described: it is put away, and comes back
  // the moment the tab does.
  if (note) return "hidden";
  return hold === "cleared" && (canSend || locked) ? "frame" : "notice";
}

export function draftPresentation(
  draft: SupportInboxDraft,
  { locked = false }: { locked?: boolean } = {},
): DraftPresentation {
  const hold = draftHold(draft);
  const sendable = canSendHeldDraft(draft, { locked });
  const above = draft.confidence >= draft.confidenceThreshold;
  if (hold === "cleared") {
    return {
      confidence: `${ABOVE_BAR} · cleared the language and reviewer checks`,
      hold,
      sendable,
      thin: false,
    };
  }
  if (hold === "language") {
    return {
      confidence: above ? ABOVE_BAR : BELOW_BAR,
      hold,
      holdReason: "Held: compliance language",
      sendable,
      thin: false,
    };
  }
  if (hold === "thin") {
    return {
      confidence: BELOW_BAR,
      hold,
      holdReason: "Not enough context to draft",
      sendable,
      thin: true,
    };
  }
  return {
    confidence: above ? ABOVE_BAR : BELOW_BAR,
    hold,
    holdReason: "Held: a reviewer check did not clear",
    sendable,
    thin: false,
  };
}

// ---------------------------------------------------------------------------------------------
// The rail's digest
// ---------------------------------------------------------------------------------------------

export interface ThreadDigest {
  /** One sentence. The time it refers to is `at`, formatted by the caller. */
  readonly lead: string;
  readonly at: string | null;
  /** At most three, in the order an operator needs them. */
  readonly bullets: readonly string[];
  /**
   * The caption under the figures, saying where they came from and what did not write them — and
   * null when there are no figures, because then it captions nothing.
   *
   * It travels with the bullets rather than sitting in the rail as a fixed line for the reason
   * W-11 gives: on a conversation nobody has written in, the lead already says there is nothing
   * here, and two further sentences about the provenance of an absent count are the pane talking
   * about itself. Where there are figures the sentence is load-bearing: an operator reading a
   * summary in a product with an assistant in it needs to know a model did not write this one.
   */
  readonly provenance: string | null;
}

export interface DigestInput {
  readonly status: ChatThreadStatus;
  readonly messages: readonly SupportInboxMessage[];
  readonly unreadCount: number;
  readonly hasDraft: boolean;
  readonly clientName: string;
}

/**
 * What this conversation is, computed from the conversation.
 *
 * Deliberately not a model. There is no summarise endpoint in this product and inventing one on
 * the client would mean an orb over a computation, which contract §6 calls the interface lying
 * about what the machine is doing. Everything below is a fact already on screen somewhere,
 * gathered into the one place an operator looks before they answer.
 */
export function threadDigest({
  clientName,
  hasDraft,
  messages,
  status,
  unreadCount,
}: DigestInput): ThreadDigest {
  const last = messages.length === 0 ? null : messages[messages.length - 1];
  const waiting = last?.authorKind === "consumer" && status !== "resolved";
  const lead =
    last === null
      ? "Nothing has been said in this conversation yet."
      : last.authorKind === "consumer"
        ? `${clientName} wrote last.`
        : "Your team wrote last.";

  // Every candidate is collected in the order an operator needs them and the cut happens once, at
  // the end. Guarding each push with "only if there is room" would put the bound in five places
  // and make the last two lines unreachable in a way nothing could see; here the priority and the
  // limit are both one readable thing.
  const notes = messages.filter((each) => each.visibility === "internal").length;
  const bullets = [
    unreadCount === 0
      ? null
      : unreadCount === 1
        ? "1 message since you last opened this."
        : `${unreadCount} messages since you last opened this.`,
    waiting ? `${clientName} is waiting on a reply.` : null,
    hasDraft ? "A suggested reply is held for your review." : null,
    status === "resolved" ? "Resolved. Set it back to Open to reply." : null,
    notes === 0
      ? null
      : notes === 1
        ? "1 internal note, which the client cannot see."
        : `${notes} internal notes, which the client cannot see.`,
    messages.length === 0
      ? null
      : messages.length === 1
        ? "1 message in this conversation."
        : `${messages.length} messages in this conversation.`,
  ].filter((bullet): bullet is string => bullet !== null);

  const shown = bullets.slice(0, 3);
  return {
    at: last?.sentAt ?? null,
    bullets: shown,
    lead,
    provenance:
      shown.length === 0
        ? null
        : "Counted from the messages in this thread. Nothing here was written by a model.",
  };
}

// ---------------------------------------------------------------------------------------------
// The client snapshot
// ---------------------------------------------------------------------------------------------

/**
 * One line of the Details tab: a figure and where it came from.
 *
 * Provenance travels with the figure rather than being implied by the pane, which is DESIGN.md's
 * product-state rule and not a nicety — a readiness number with no snapshot date is a number an
 * operator will quote to a client as if it were true today.
 */
export interface SnapshotRow {
  readonly label: string;
  readonly value: string;
  readonly provenance?: string;
}

export interface SnapshotInput extends InboxThreadClient {
  readonly readiness?: number | null;
  readonly readinessAt?: string | null;
  readonly openActionCount?: number | null;
  readonly nextRefreshAt?: string | null;
}

/**
 * The rows the Details tab has, and only those.
 *
 * A field the directory did not send is absent rather than rendered as a dash: an em dash beside
 * "Verified readiness" reads as "this client has none", and the truthful statement is that this
 * pane was not told. The pane says that once, underneath, rather than five times in a column.
 */
export function snapshotRows(
  client: SnapshotInput,
  format: { readonly date: (iso: string) => string },
): readonly SnapshotRow[] {
  const rows: SnapshotRow[] = [];
  const stage = stageLabel(client.stage);
  if (stage !== undefined) rows.push({ label: "Stage", value: stage });
  if (typeof client.readiness === "number" && Number.isFinite(client.readiness)) {
    rows.push({
      label: "Verified readiness",
      // Not "awaiting its first source review". A missing date has two possible causes — the
      // review has not happened, or nobody threaded the field through — and only one of them is a
      // statement about the client. Saying which one it is would be a guess an operator repeats to
      // somebody as fact, so this says what is actually known: the figure is real, its date is not
      // to hand. The figure is never shown bare, because a readiness score with no date beside it
      // is read as today's.
      provenance:
        typeof client.readinessAt === "string" && client.readinessAt !== ""
          ? `Source review of ${format.date(client.readinessAt)}`
          : "Source date not available",
      value: String(Math.round(client.readiness)),
    });
  }
  if (typeof client.openActionCount === "number" && Number.isFinite(client.openActionCount)) {
    rows.push({
      label: "Open actions",
      value: String(Math.max(0, Math.trunc(client.openActionCount))),
    });
  }
  if (typeof client.nextRefreshAt === "string" && client.nextRefreshAt !== "") {
    rows.push({ label: "Next scheduled update", value: format.date(client.nextRefreshAt) });
  }
  if (typeof client.assignedToName === "string" && client.assignedToName !== "") {
    rows.push({ label: "Assigned to", value: client.assignedToName });
  }
  return rows;
}
