"use client";

// The operator Inbox: three panes and a rail, over two sources.
//
// **One shell, two sources.** The Inbox used to be two whole bodies — `renderDurableInbox` and
// `renderInbox` — that were supposed to look the same and drifted every time one of them was
// touched. There is one layout now, and what changes between a signed-in workspace and the
// fixture shell is a view model handed to it: the same three panes, the same keyboard, the same
// five states, different rows. A control the fixture shell offers and the durable body does not
// is now impossible to write rather than something a test has to go looking for.
//
// **The state lives in a hook the surface calls.** `useOperatorInbox` is invoked from
// `surfaces/operator.tsx` rather than from inside `<OperatorInbox>`, because the component
// unmounts on every view change and the open conversation, the search text and the half-written
// reply must survive a trip to Clients and back. That address is deliberate and predates this
// rebuild.
//
// **Nothing here defers.** No timer, no retry loop, no queue: every write below runs from one
// click, which is the no-auto-send property (SUPP-01, DEC-D10) as it applies to a surface. A
// reply reaches `/api/support/threads/[id]/messages` because a person pressed send, and the
// failure path hands the message back with a retry the person has to press again.
//
// **A send is optimistic and a failure is visible.** The message appears immediately as
// `sending`, and if the route refuses it becomes a `failed` bubble carrying its own retry and
// discard. The composer clears either way, because the text is now on the message and asking a
// person to work out which of two copies is real is worse than either.

import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import { Inbox as InboxIcon, PanelRightOpen } from "lucide-react";

import {
  EventCard,
  PaneSkeletonThread,
  ShortcutOverlay,
  clearDraft,
  groupTimeline,
  relativeTime,
  requestDocument,
  reviewDocument,
  timelineFixture,
  timelineThreadItems,
  useChatShortcuts,
  writeDraft,
  type ChatConnectionStatus,
  type ChatThreadItem,
  type ChatThreadStatus,
  type ChatThreadSummary,
  type ComposerCommand,
  type PaneFallback,
  type ThreadListEmptyProps,
  type TimelineFilter,
  type TimelineThreadOptions,
} from "@/components/chat";
import type { TimelineRead } from "@/lib/timeline/types";
import { CompactHeader, titleCase } from "@/components/operator/chrome";
import { INBOX_SEED, fixtureSentAt } from "@/components/operator/inbox/seeds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { subscribeToThread } from "@/lib/realtime/support.client";
import { pairingFor } from "@/lib/support/draft-send";
import {
  SUPPORT_THREAD_STATUSES,
  discardSupportDraft,
  inboxTeamOptions,
  patchSupportThreadStatus,
  postSupportReply,
  postSupportThreadRead,
  readSupportInbox,
  readSupportInboxDirectory,
  readSupportThread,
  requestSupportDraft,
  type SupportInboxClient,
  type SupportInboxDirectoryRead,
  type SupportInboxMessage,
  type SupportInboxRead,
  type SupportMessageVisibility,
  type SupportThreadRead,
  type SupportWriteResult,
} from "@/lib/operator/support-inbox.client";
import { cn } from "@/lib/utils";

import { ConversationPane, STATUS_CONTROL_ID, composerRef, type ComposerTab, type HeldDraft } from "./conversation-pane";
import { CopilotRail, RailSkeleton, type RailTab } from "./copilot-rail";
import { INBOX_FRAME_CLASS } from "./layout";
import { ThreadListPane } from "./thread-list-pane";
import {
  authorFor,
  autoSelect,
  composerLock,
  draftPresentation,
  filterThreads,
  isOwnMessage,
  snapshotRows,
  stageLabel,
  statusCounts,
  stepSelection,
  threadDigest,
  toSelectable,
  toThreadItems,
  toThreadSummary,
  type AuthorNames,
  type SnapshotInput,
} from "./view-model";

/**
 * The fields the Inbox reads off a client.
 *
 * `stage` is optional because the shell does not pass it yet: the mount in `surfaces/operator.tsx`
 * maps four fields onto this shape and adding a fifth is that file's edit, not this one's. Absent,
 * the fixture rows carry no stage chip and the Details tab is one row shorter — which is the
 * degradation this pane is built for anyway, since a durable directory can also fail to name one.
 *
 * Never rendered: `clientId`.
 */
export interface InboxClient {
  readonly business: string;
  readonly clientId: string;
  readonly name: string;
  readonly ownerId: string | undefined;
  readonly stage?: string;
}

export interface InboxTeamMember {
  readonly id: string;
  readonly name: string;
}

export type OperatorInboxState = ReturnType<typeof useOperatorInbox>;

export interface OperatorInboxProps {
  readonly clients: readonly InboxClient[];
  readonly inbox: OperatorInboxState;
  /**
   * Whether the surface is running against a signed-in workspace rather than fixtures.
   *
   * The surface derives it from nine signals ORed together and hands the answer down, rather than
   * the Inbox re-deriving it from one of them: an OR that stops arriving costs a panel its
   * fixtures, and a copy of the rule here could only ever fall out of step with the shell's.
   */
  readonly durableWorkspace: boolean;
  readonly onOpenClient: (clientId: string) => void;
  readonly teamMembers: readonly InboxTeamMember[];
  readonly teamSeesAllClients: boolean;
  /**
   * The name this Inbox writes under, in both composers.
   *
   * Already resolved by the shell, which is the point: the shell writes under it too, and three
   * copies of the same `??` chain disagreed the moment one of them was edited.
   */
  readonly workspaceBrandName: string;
  /** `FEATURE_TIMELINE`, resolved on the server and passed down. Off is the shipped thread. */
  readonly timelineEnabled?: boolean;
  /**
   * The selected thread's events, when the read path has them.
   *
   * Absent means the read has not returned them, not that the thread has none — a durable thread
   * renders its real messages and no event rows rather than borrowing the fixture's.
   */
  readonly timeline?: TimelineRead;
}

/**
 * What is being sent, in a shape that cannot express the thing the contract forbids.
 *
 * §3.2: an `internal` message may never carry an `origin_draft_id`. That is enforced in the
 * database, and this is the same rule made unwritable on the way there — a note has no `draftId`
 * field to set, so pairing one with a suggestion is a type error rather than something a test has
 * to go looking for. `visibility` is derived from the tag rather than passed alongside it, so the
 * two cannot disagree either.
 */
export type OutgoingMessage =
  | { readonly kind: "reply"; readonly body: string; readonly draftId?: string }
  | { readonly kind: "note"; readonly body: string };

function visibilityOf(outgoing: OutgoingMessage): SupportMessageVisibility {
  return outgoing.kind === "note" ? "internal" : "participants";
}

/** One message this browser has handed to the route and is still waiting on, or has lost. */
interface PendingSend {
  /** @opaque React identity for the optimistic bubble. Never rendered. */
  readonly ref: string;
  readonly threadRef: string;
  readonly body: string;
  readonly kind: OutgoingMessage["kind"];
  readonly visibility: SupportMessageVisibility;
  readonly sentAt: string;
  readonly state: "sending" | "failed";
  readonly reason?: string;
}

interface DurableThreadReadSnapshot {
  /** The selected thread this result was fetched for. */
  readonly threadRef: string | null;
  readonly read: SupportThreadRead;
}

const LOADING_DURABLE_THREAD_READ: SupportThreadRead = { state: "loading" };

function isCurrentDurableThread(threadRef: string, selectedThreadRef: string | null): boolean {
  return threadRef === selectedThreadRef;
}

const REPLY_COMMANDS = (handlers: {
  note: () => void;
  draft: () => void;
  close: () => void;
}): readonly ComposerCommand[] => [
  { hint: "Write something only your team can read", name: "note", onRun: handlers.note },
  { hint: "Ask for a suggested reply", name: "draft", onRun: handlers.draft },
  { hint: "Resolve this conversation", name: "close", onRun: handlers.close },
];

// ---------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------

export function useOperatorInbox({ active }: { active: boolean }) {
  // Fixture selection and the durable one are separate, and deliberately so: they name rows in
  // different lists, and one selection shared between them points at nothing half the time.
  const [inboxSelected, setInboxSelected] = useState<string>(INBOX_SEED[0]?.id ?? "");
  const [inboxMemberFilter, setInboxMemberFilter] = useState("all");
  /**
   * The Inbox's own team filter, deliberately not the fixture body's `inboxMemberFilter`.
   *
   * One filter shared between the two sources would hold a durable member id while the fixture
   * rows are on screen, and every seeded thread would be filtered away with the access scope
   * taking the blame for it.
   */
  const [durableMemberFilter, setDurableMemberFilter] = useState("all");
  // #9. The Inbox's own read, separate from the support bubble's: the bubble only needs to know
  // whether to render, this needs the threads.
  const [inboxRead, setInboxRead] = useState<SupportInboxRead>({ state: "loading" });
  const [durableThreadId, setDurableThreadIdState] = useState<string | null>(null);
  const selectedDurableThreadRef = useRef<string | null>(null);
  const setDurableThreadId = useCallback((next: SetStateAction<string | null>) => {
    const selected = typeof next === "function" ? next(selectedDurableThreadRef.current) : next;
    selectedDurableThreadRef.current = selected;
    setDurableThreadIdState(selected);
  }, []);
  const [durableThreadRead, setDurableThreadRead] = useState<DurableThreadReadSnapshot>({
    read: LOADING_DURABLE_THREAD_READ,
    threadRef: null,
  });
  const [threadReadGeneration, setThreadReadGeneration] = useState(0);
  const [inboxPending, setInboxPending] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [inboxProblem, setInboxProblem] = useState<string | null>(null);
  /**
   * The client directory, which is where a thread's client name, stage and owner come from.
   * `support_list_threads` carries a `client_id` and no name, so without this the durable list can
   * only print the subject — and the subject a consumer opens with is the literal "Team Chat".
   */
  const [inboxDirectory, setInboxDirectory] = useState<SupportInboxDirectoryRead>({
    state: "unavailable",
  });
  const [connection, setConnection] = useState<ChatConnectionStatus | null>(null);
  const [pending, setPending] = useState<readonly PendingSend[]>([]);
  const [fixtureDiscarded, setFixtureDiscarded] = useState<readonly string[]>([]);

  // Presentation state. It lives here rather than in the component for the same reason the
  // selection does: leaving the Inbox and coming back must not throw away a search or a tab.
  const [statusTab, setStatusTab] = useState<ChatThreadStatus>("open");
  const [query, setQuery] = useState("");
  const [railTab, setRailTab] = useState<RailTab>("copilot");
  const [railOpen, setRailOpen] = useState(false);
  const [composerTab, setComposerTab] = useState<ComposerTab>("reply");
  const [composerEpoch, setComposerEpoch] = useState(0);
  const [threadOpen, setThreadOpen] = useState(false);

  const inboxActive = active;
  useEffect(() => {
    if (!inboxActive) return undefined;
    let cancelled = false;
    void readSupportInbox().then((result) => {
      if (cancelled) return;
      setInboxRead(result);
      if (result.state === "ready") {
        // `result.threads[0]` here was the other half of W-9: the first row is the newest by
        // activity, which is the row most likely to have had nothing said in it.
        setDurableThreadId((current) => current ?? autoSelect(result.threads.map(toSelectable)));
      }
    });
    void readSupportInboxDirectory().then((result) => {
      if (!cancelled) setInboxDirectory(result);
    });
    return () => {
      cancelled = true;
    };
  }, [inboxActive, setDurableThreadId]);

  // Reset presentation state during render when the selected thread changes (the adjust-state-on-
  // prop-change pattern). The read itself is keyed by thread below, so a previous thread's result
  // renders as loading without a state write here.
  const [threadReadFor, setThreadReadFor] = useState(durableThreadId);
  if (threadReadFor !== durableThreadId) {
    setThreadReadFor(durableThreadId);
    setInboxProblem(null);
    setComposerTab("reply");
  }

  useEffect(() => {
    if (durableThreadId === null) return undefined;
    const threadId = durableThreadId;
    let cancelled = false;
    void readSupportThread(threadId).then(async (result) => {
      if (cancelled || !isCurrentDurableThread(threadId, selectedDurableThreadRef.current)) return;
      setDurableThreadRead({ read: result, threadRef: threadId });
      // Opening a thread is what "read" means, so the watermark is written here and only after a
      // successful read: a read that failed has shown the operator nothing, and marking it read
      // anyway would clear the unread count for a conversation nobody has actually seen. The
      // inbox is re-read afterwards for the same reason every other write in this view re-reads
      // rather than patching local state, so the counts on the list come from the server.
      if (result.state !== "ready") return;
      const marked = await postSupportThreadRead(threadId);
      if (
        cancelled
        || !marked.ok
        || !isCurrentDurableThread(threadId, selectedDurableThreadRef.current)
      ) return;
      const refreshedInbox = await readSupportInbox();
      if (cancelled || !isCurrentDurableThread(threadId, selectedDurableThreadRef.current)) return;
      setInboxRead(refreshedInbox);
    });
    return () => {
      cancelled = true;
    };
  }, [durableThreadId, threadReadGeneration]);

  /**
   * The open thread, live.
   *
   * An arriving message re-reads the thread rather than being appended from the payload, which
   * looks like extra work and is not: the row Realtime hands over has no visibility filtering
   * applied by this surface, no ordering guarantee against a message the operator sent a moment
   * ago, and no effect on the unread counts sitting in the list beside it. The read is the same
   * one every write in this file already performs, and it is what keeps the database the thing
   * that decides what the thread contains.
   *
   * The indicator is bound to `onStatus` and never to the fact that `subscribeToThread` returned,
   * which contract §3.3 rules out in as many words.
   */
  useEffect(() => {
    if (!inboxActive || durableThreadId === null) return undefined;
    const threadId = durableThreadId;
    let cancelled = false;
    const refresh = () => {
      void readSupportThread(threadId).then((result) => {
        if (
          !cancelled
          && isCurrentDurableThread(threadId, selectedDurableThreadRef.current)
        ) setDurableThreadRead({ read: result, threadRef: threadId });
      });
      void readSupportInbox().then((result) => {
        if (
          !cancelled
          && isCurrentDurableThread(threadId, selectedDurableThreadRef.current)
        ) setInboxRead(result);
      });
    };
    const stop = subscribeToThread(threadId, {
      onMessage: () => {
        if (!cancelled) refresh();
      },
      onStatus: (status) => {
        if (
          !cancelled
          && isCurrentDurableThread(threadId, selectedDurableThreadRef.current)
        ) setConnection(status);
      },
      onThreadChange: () => {
        if (!cancelled) refresh();
      },
    });
    return () => {
      cancelled = true;
      stop();
      // In the cleanup rather than the body: leaving a thread ends the subscription, so the
      // indicator has nothing to report and must stop reporting the last thing it saw.
      setConnection(null);
    };
  }, [durableThreadId, inboxActive]);

  /**
   * Every Inbox write goes out through here and the thread comes back.
   *
   * Re-reading rather than patching local state is the same choice the support bubble made: the
   * thread's status, its messages, and whether a suggestion is open at all are decided by the
   * database, and a local guess about any of them eventually disagrees with what the RPC did.
   *
   * There is no timer, no retry and no queue in here. Each of these runs from one click.
   */
  async function runInboxWrite(
    threadId: string,
    write: () => Promise<SupportWriteResult>,
    failure: (code: string | null) => string,
  ) {
    if (inboxPending) return;
    setInboxPending(true);
    setInboxProblem(null);
    const result = await write();
    // The thread is re-read either way. A refusal still moves the world — a send refused as closed
    // means somebody else resolved the thread — and showing the stale copy is how the operator
    // ends up arguing with it.
    const [threadRead, refreshedInbox] = await Promise.all([
      readSupportThread(threadId),
      readSupportInbox(),
    ]);
    if (!isCurrentDurableThread(threadId, selectedDurableThreadRef.current)) {
      setInboxPending(false);
      return;
    }
    if (!result.ok) setInboxProblem(failure(result.code));
    setDurableThreadRead({ read: threadRead, threadRef: threadId });
    setInboxRead(refreshedInbox);
    setInboxPending(false);
  }

  /**
   * One message, from one person pressing one button.
   *
   * `draftId` travels only when the person pressed send on the suggestion exactly as written; an
   * edited draft goes without it and is a human message, which is what `held_drafts.body` being
   * the audited record of the model's output requires. A note never carries one at all, because
   * contract §3.2 forbids an internal row having an `origin_draft_id`.
   */
  async function sendDurableMessage(
    threadId: string,
    outgoing: OutgoingMessage,
  ): Promise<void> {
    const ref = crypto.randomUUID();
    const sentAt = new Date().toISOString();
    const body = outgoing.body;
    const visibility = visibilityOf(outgoing);
    setPending((current) => [
      ...current,
      { body, kind: outgoing.kind, ref, sentAt, state: "sending", threadRef: threadId, visibility },
    ]);
    setInboxProblem(null);
    const result = await postSupportReply(
      threadId,
      body,
      outgoing.kind === "reply" ? outgoing.draftId ?? null : null,
      fetch,
      visibility,
    );
    if (result.ok) {
      setPending((current) => current.filter((each) => each.ref !== ref));
      const [threadRead, refreshedInbox] = await Promise.all([
        readSupportThread(threadId),
        readSupportInbox(),
      ]);
      if (!isCurrentDurableThread(threadId, selectedDurableThreadRef.current)) return;
      setDurableThreadRead({ read: threadRead, threadRef: threadId });
      setInboxRead(refreshedInbox);
      return;
    }
    const reason =
      result.code === "SUPPORT_THREAD_CLOSED"
        ? "This conversation is resolved, so nothing was sent. Reopen it to send this."
        : result.code === "SUPPORT_MESSAGE_LANGUAGE"
          ? "This message contains wording the platform cannot send. Remove the flagged phrase and try again."
          : "This was not delivered. Nothing reached the client.";
    setPending((current) =>
      current.map((each) => (each.ref === ref ? { ...each, reason, state: "failed" } : each)),
    );
    // A refusal still moves the world, so the thread is re-read even on the failure path.
    const threadRead = await readSupportThread(threadId);
    if (!isCurrentDurableThread(threadId, selectedDurableThreadRef.current)) return;
    setDurableThreadRead({ read: threadRead, threadRef: threadId });
  }

  function retryDurableThreadRead(threadId: string) {
    if (!isCurrentDurableThread(threadId, selectedDurableThreadRef.current)) return;
    setDurableThreadRead({ read: LOADING_DURABLE_THREAD_READ, threadRef: threadId });
    setInboxProblem(null);
    setThreadReadGeneration((generation) => generation + 1);
  }

  /**
   * A retry is the person pressing the same button again.
   *
   * The pairing is deliberately not carried across: a suggestion that was sent once and refused is
   * re-sent as the operator's own message, because `held_drafts` has already moved on and a second
   * attempt against a spent draft is a refusal the person cannot do anything about.
   */
  function retryPendingSend(ref: string) {
    const found = pending.find((each) => each.ref === ref);
    if (found === undefined) return;
    setPending((current) => current.filter((each) => each.ref !== ref));
    void sendDurableMessage(
      found.threadRef,
      found.kind === "note"
        ? { body: found.body, kind: "note" }
        : { body: found.body, kind: "reply" },
    );
  }

  function discardPendingSend(ref: string) {
    setPending((current) => current.filter((each) => each.ref !== ref));
  }

  async function moveDurableThreadStatus(threadId: string, status: ChatThreadStatus) {
    await runInboxWrite(
      threadId,
      () => patchSupportThreadStatus(threadId, status),
      () => "That conversation's status could not be changed.",
    );
  }

  async function askForDurableDraft(threadId: string) {
    setDrafting(true);
    await runInboxWrite(
      threadId,
      () => requestSupportDraft(threadId),
      (code) =>
        code === "SUPPORT_THREAD_CLOSED"
          ? "This conversation is resolved, so no suggestion was prepared."
          : "No suggestion could be prepared just now.",
    );
    setDrafting(false);
  }

  async function discardDurableDraft(threadId: string) {
    await runInboxWrite(
      threadId,
      () => discardSupportDraft(threadId),
      () => "That suggestion could not be discarded.",
    );
  }

  /**
   * Kept under its old name because `surfaces/operator.tsx` calls it, once, when the team access
   * scope changes: the toggle can filter away the conversation a half-written reply belongs to,
   * so the reply goes with it. The composer's own drafts live in `localStorage` now rather than
   * in a `useState` here, so what this clears is the stored draft for whatever is selected. It
   * takes a value only so the call site does not have to move.
   */
  function setReplyDraft(value: string) {
    if (value !== "") return;
    const refs = [durableThreadId, inboxSelected].filter(
      (each): each is string => typeof each === "string" && each !== "",
    );
    for (const ref of refs) {
      clearDraft(ref);
      clearDraft(`${ref}::note`);
    }
    setComposerEpoch((epoch) => epoch + 1);
  }

  return {
    askForDurableDraft,
    composerEpoch,
    composerTab,
    connection,
    discardDurableDraft,
    discardPendingSend,
    drafting,
    durableMemberFilter,
    durableThreadId,
    durableThreadRead: durableThreadRead.read,
    durableThreadReadFor: durableThreadRead.threadRef,
    fixtureDiscarded,
    inboxDirectory,
    inboxMemberFilter,
    inboxPending,
    inboxProblem,
    inboxRead,
    inboxSelected,
    moveDurableThreadStatus,
    pending,
    query,
    railOpen,
    railTab,
    retryDurableThreadRead,
    retryPendingSend,
    sendDurableMessage,
    setComposerEpoch,
    setComposerTab,
    setDurableMemberFilter,
    setDurableThreadId,
    setFixtureDiscarded,
    setInboxMemberFilter,
    setInboxProblem,
    setInboxSelected,
    setQuery,
    setRailOpen,
    setRailTab,
    setReplyDraft,
    setStatusTab,
    setThreadOpen,
    statusTab,
    threadOpen,
  };
}

// ---------------------------------------------------------------------------------------------
// The shell
// ---------------------------------------------------------------------------------------------

/** The fixture suggestion, described the only way a fixture can honestly describe one. */
const FIXTURE_DRAFT_SHOWN = {
  confidence: "Prepared for a person to read",
  hold: "review",
  holdReason: "Suggested reply",
  sendable: false,
  thin: false,
} as const;

export function OperatorInbox({
  clients,
  durableWorkspace,
  inbox,
  onOpenClient,
  teamMembers,
  teamSeesAllClients,
  timeline: timelineProp,
  timelineEnabled = false,
  workspaceBrandName,
}: OperatorInboxProps) {
  const listHost = useRef<HTMLDivElement>(null);
  const composerHost = useRef<HTMLDivElement>(null);

  // The timeline's own state: which chip is pressed, and the in-thread document request.
  const [timelineFilter, setTimelineFilter] = useState<TimelineFilter>("all");
  const [inboxMode, setInboxMode] = useState<"clients" | "team">("clients");
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestName, setRequestName] = useState("");
  const [requestWhy, setRequestWhy] = useState("");
  const [requestBusy, setRequestBusy] = useState(false);
  const [requestProblem, setRequestProblem] = useState<string | null>(null);
  /**
   * Uploads this session has recorded a review for.
   *
   * Set only from a route that answered `ok`, which is what keeps it a reported state rather than an
   * inferred one — the chip is not flipped because a button was pressed, it is flipped because the
   * review was written. The durable `reviewedBy` arrives with the next read and takes over; until
   * then the operator does not press the same control twice wondering whether it took.
   */
  const [reviewedUploads, setReviewedUploads] = useState<readonly string[]>([]);
  /**
   * What "your last visit" means, captured once per thread.
   *
   * Read from the watermark the digest derived, and frozen: opening a thread writes a new watermark,
   * so a divider bound to the live value would move to the bottom of the thread the moment the
   * operator arrived and mark nothing. This is the visit, and it keeps the instant the visit started.
   */
  const visitStartedAt = useRef<Map<string, string | null>>(new Map());

  const durableThreads = useMemo(
    () => (inbox.inboxRead.state === "ready" ? inbox.inboxRead.threads : []),
    [inbox.inboxRead],
  );
  const durable = durableThreads.length > 0;
  // A signed-in workspace with nothing stored gets the empty treatment, never four seeded clients
  // to reply to: every one of those rows opened a fixture drawer behind it.
  const source: "durable" | "empty" | "fixture" = durable
    ? "durable"
    : durableWorkspace
      ? "empty"
      : "fixture";

  const directory: readonly SupportInboxClient[] = useMemo(
    () => (inbox.inboxDirectory.state === "ready" ? inbox.inboxDirectory.clients : []),
    [inbox.inboxDirectory],
  );
  const clientById = useMemo(
    () => new Map(directory.map((client) => [client.id, client])),
    [directory],
  );
  const fixtureClientById = useMemo(
    () => new Map(clients.map((client) => [client.clientId, client])),
    [clients],
  );
  const teamMemberById = useMemo(
    () => new Map(teamMembers.map((member) => [member.id, member.name])),
    [teamMembers],
  );

  // -------------------------------------------------------------------------------------------
  // Rows
  // -------------------------------------------------------------------------------------------

  const allThreads: readonly ChatThreadSummary[] = useMemo(() => {
    if (source === "empty") return [];
    if (source === "durable") {
      return durableThreads
        .filter((thread) => inboxMode === "team"
          ? thread.internalMessageCount > 0
          : thread.participantMessageCount > 0)
        .map((thread) =>
          toThreadSummary(
            thread,
            thread.clientId === null ? undefined : clientById.get(thread.clientId),
            inboxMode === "team" ? "internal" : "participants",
          ),
        );
    }
    if (inboxMode === "team") return [];
    return INBOX_SEED.map((row) => {
      const client = fixtureClientById.get(row.clientId);
      return {
        lastActivityAt: fixtureSentAt(row.dayOffset, row.minuteOfDay),
        ownerName:
          client?.ownerId === undefined ? undefined : teamMemberById.get(client.ownerId),
        preview: row.message,
        ref: row.id,
        stage: stageLabel(client?.stage),
        status: "open" as const,
        subtitle: client?.business,
        title: client?.name ?? "Client",
        // Fixture rows carry their own unread flag. Nothing here computes one: the durable rows
        // above take it off the watermark, and this is the demo shell saying what the demo shows.
        unreadCount: row.unread ? 1 : 0,
      };
    });
  }, [clientById, durableThreads, fixtureClientById, inboxMode, source, teamMemberById]);

  const ownerByThread = useMemo(() => {
    const owners = new Map<string, string | null>();
    if (source === "durable") {
      for (const thread of durableThreads) {
        const client = thread.clientId === null ? undefined : clientById.get(thread.clientId);
        owners.set(thread.id, client?.assignedToId ?? null);
      }
    } else {
      for (const row of INBOX_SEED) {
        owners.set(row.id, fixtureClientById.get(row.clientId)?.ownerId ?? null);
      }
    }
    return owners;
  }, [clientById, durableThreads, fixtureClientById, source]);

  // The fixture shell honours the workspace's access scope the way it always did: with the team
  // limited to assigned clients, only the signed-in member's rows are offered.
  const scoped = useMemo(
    () =>
      source === "fixture" && !teamSeesAllClients
        ? allThreads.filter((thread) => ownerByThread.get(thread.ref) === "tm-alec")
        : allThreads,
    [allThreads, ownerByThread, source, teamSeesAllClients],
  );

  // Deliberately not persisted and deliberately not in the state hook. It is a view preference for
  // this sitting, it has no meaning below the three-pane layout where the rail is a sheet, and a
  // remembered collapse is how an operator loses a panel they cannot remember closing.
  const [railCollapsed, setRailCollapsed] = useState(false);

  const memberFilter = source === "durable" ? inbox.durableMemberFilter : inbox.inboxMemberFilter;
  const setMemberFilter =
    source === "durable" ? inbox.setDurableMemberFilter : inbox.setInboxMemberFilter;
  const memberOptions = useMemo(() => {
    if (source === "durable") {
      return inboxTeamOptions(directory).map((member) => ({
        label: member.name,
        value: member.id,
      }));
    }
    return teamMembers.map((member) => ({ label: member.name, value: member.id }));
  }, [directory, source, teamMembers]);

  const counts = useMemo(() => statusCounts(scoped), [scoped]);
  const visible = useMemo(
    () =>
      filterThreads(scoped, {
        member: memberOptions.length > 0 ? memberFilter : "all",
        ownerByThread,
        query: inbox.query,
        status: inbox.statusTab,
      }),
    [inbox.query, inbox.statusTab, memberFilter, memberOptions.length, ownerByThread, scoped],
  );

  const selectedRef = source === "durable" ? inbox.durableThreadId : inbox.inboxSelected;

  // Two rules, and what separates them is where the messages on screen come from.
  //
  // A durable row is only ever the one `durableThreadId` names, because that is the id the thread
  // read is keyed to. The `?? visible[0]` that used to sit here swapped in another row the moment
  // a filter hid the chosen one, and the messages below kept belonging to the thread that was
  // fetched — one client's conversation under another client's name. Nothing chosen and nothing
  // fetched is a real state, and the pane says so rather than inventing a selection.
  //
  // A fixture row carries its own body, so any visible row is consistent with what renders. Its
  // fallback is `autoSelect` rather than the first row, for the reason W-9 names: the first row is
  // the most recently touched conversation, which is routinely one nobody has written in.
  //
  // Both are memoized, and not for speed. `visible` is a memoized value; a plain `const` derived
  // from it through a call the compiler cannot see into reads as a value that call might mutate,
  // and everything downstream that lists it as a dependency stops being optimised.
  const openable = useMemo(() => autoSelect(visible), [visible]);
  const selected = useMemo(
    () =>
      visible.find((thread) => thread.ref === selectedRef) ??
      (source === "durable" ? null : visible.find((each) => each.ref === openable)) ??
      null,
    [openable, selectedRef, source, visible],
  );

  const select = (ref: string) => {
    if (source === "durable") inbox.setDurableThreadId(ref);
    else inbox.setInboxSelected(ref);
    inbox.setInboxProblem(null);
    inbox.setThreadOpen(true);
  };

  // -------------------------------------------------------------------------------------------
  // The open conversation
  // -------------------------------------------------------------------------------------------

  const durableRead =
    source === "durable" && inbox.durableThreadReadFor === selected?.ref
      ? inbox.durableThreadRead
      : LOADING_DURABLE_THREAD_READ;
  const durableThread =
    source === "durable" ? durableThreads.find((each) => each.id === selected?.ref) ?? null : null;
  const durableClient =
    durableThread?.clientId == null ? undefined : clientById.get(durableThread.clientId);
  const fixtureRow =
    source === "fixture" ? INBOX_SEED.find((row) => row.id === selected?.ref) ?? null : null;
  const fixtureClient =
    fixtureRow === null ? undefined : fixtureClientById.get(fixtureRow.clientId);

  const names: AuthorNames = {
    admin: "Platform team",
    consumer: selected?.title ?? "Client",
    operator: workspaceBrandName,
  };

  const timelineOn = timelineEnabled;

  // The instant this visit started, for the new-since divider. Recorded the first time a thread is
  // seen in this session and never revised, for the reason `visitStartedAt` gives.
  if (selected !== null && !visitStartedAt.current.has(selected.ref)) {
    visitStartedAt.current.set(
      selected.ref,
      source === "durable" && durableRead.state === "ready" ? durableRead.read.lastReadAt : null,
    );
  }
  const newSince = selected === null ? null : visitStartedAt.current.get(selected.ref) ?? null;
  // The selected thread's events come with its durable read; a host may still hand them in.
  const timeline: TimelineRead | undefined =
    timelineProp ?? (source === "durable" && durableRead.state === "ready" ? durableRead.timeline : undefined);

  const storedMessages: readonly SupportInboxMessage[] = useMemo(() => {
    if (source === "durable") return durableRead.state === "ready" ? durableRead.messages : [];
    if (fixtureRow === null) return [];
    return [
      {
        authorKind: "consumer" as const,
        body: fixtureRow.message,
        id: fixtureRow.id,
        origin: "human" as const,
        sentAt: fixtureSentAt(fixtureRow.dayOffset, fixtureRow.minuteOfDay),
        visibility: "participants" as const,
      },
    ];
  }, [durableRead, fixtureRow, source]);

  // Not memoised: it is a map over at most a few dozen rows, and the alternative is a dependency
  // list containing an object literal rebuilt on every render, which is a memo that never hits.
  const allItems: readonly ChatThreadItem[] = (() => {
    // The fixture body has no watermark of any kind, so it passes null and every seeded message
    // stays Delivered. Only a durable thread can produce a receipt, because only a durable thread
    // has somebody on the other side of it.
    const stored = toThreadItems(
      storedMessages,
      names,
      source === "durable" && durableRead.state === "ready"
        ? durableRead.read.counterpartReadAt
        : null,
    );
    const waiting = inbox.pending
      .filter((each) => each.threadRef === selected?.ref)
      .map<ChatThreadItem>((each) => ({
        message: {
          author: authorFor("operator", names),
          body: each.body,
          delivery: each.state,
          ...(each.state === "failed"
            ? {
                failure: {
                  onDiscard: () => inbox.discardPendingSend(each.ref),
                  onRetry: () => inbox.retryPendingSend(each.ref),
                  reason: each.reason ?? "This was not delivered.",
                },
              }
            : {}),
          origin: "human" as const,
          ref: each.ref,
          sentAt: each.sentAt,
          visibility: each.visibility,
        },
        type: "message" as const,
      }));
    if (!timelineOn) return [...stored, ...waiting];
    // The fixture source is the demo shell, and it is the only branch that may render a written
    // conversation nobody sent — so with the timeline on it renders the approved mockup's thread.
    if (source !== "durable") {
      return timelineFixture({ audience: "operator", brandName: workspaceBrandName });
    }
    return [...stored, ...waiting, ...timelineThreadItems(timeline?.events ?? [])];
  })();
  const items = allItems.filter((item) => {
    if (item.type !== "message") return false;
    return inboxMode === "team"
      ? item.message.visibility === "internal"
      : item.message.visibility !== "internal";
  });

  const resolved = selected?.status === "resolved";
  const lockedReason = composerLock(source, selected?.status ?? null);

  // The lock feeds the draft rather than the other way round: whether a suggestion may be sent is
  // `canSendHeldDraft`'s call and it needs both facts, so the lock is resolved first.
  const heldDraft: HeldDraft | null = useMemo(() => {
    const locked = lockedReason !== null;
    if (source === "durable") {
      const draft = durableRead.state === "ready" ? durableRead.draft : null;
      if (draft === null) return null;
      return { body: draft.body, shown: draftPresentation(draft, { locked }) };
    }
    if (fixtureRow === null || inbox.fixtureDiscarded.includes(fixtureRow.id)) return null;
    return { body: fixtureRow.suggestion, shown: FIXTURE_DRAFT_SHOWN };
  }, [durableRead, fixtureRow, inbox.fixtureDiscarded, lockedReason, source]);

  const threadState: PaneFallback | undefined = (() => {
    if (source === "empty") {
      if (inbox.inboxRead.state === "disabled") {
        return {
          description:
            "Client messaging is switched off for this workspace, so there is nothing to read here yet.",
          status: "disabled",
          title: "Client messaging is not connected",
        };
      }
      if (inbox.inboxRead.state === "failed") {
        return {
          action: { label: "Try again", onAct: () => window.location.reload() },
          description: "Nothing was lost. The conversations could not be read just now.",
          status: "error",
          title: "Conversations could not be loaded",
        };
      }
      if (inbox.inboxRead.state === "loading") {
        return { label: "Loading conversations", skeleton: <PaneSkeletonThread />, status: "loading" };
      }
      return {
        action: { label: "Check again", onAct: () => window.location.reload() },
        description:
          "Your clients start these from their own Team Chat. The first one to write lands here, and you answer from this pane.",
        status: "empty",
        title: "No client conversations yet",
      };
    }
    if (selected === null) {
      // Three different absences, and the old branch offered "Clear the filters" for all of them —
      // a control that cannot work in two. What separates them is the same fact the selection
      // rule reads: whether anything in view has been written in.
      if (openable !== null) {
        return {
          action: { label: "Open the newest conversation", onAct: () => select(openable) },
          description: "Choose a conversation on the left to read it and answer.",
          status: "empty",
          title: "No conversation open",
        };
      }
      if (visible.length > 0) {
        return {
          action: {
            emphasis: "secondary",
            label: "Check again",
            onAct: () => window.location.reload(),
          },
          description:
            "Nothing has been written in these conversations yet. Your clients start them from their own Team Chat, and the first one to write lands here.",
          status: "empty",
          title: "No conversation open",
        };
      }
      if (inboxMode === "team") {
        return {
          action: { label: "Open client inbox", onAct: () => setInboxMode("clients") },
          description: "Internal notes appear here after a team member adds one to a client conversation.",
          status: "empty",
          title: "No internal notes yet",
        };
      }
      return {
        action: { label: "Clear the filters", onAct: clearFilters },
        description:
          "Choose a conversation on the left to read it and answer. Nothing matches the current filter.",
        status: "empty",
        title: "No conversation open",
      };
    }
    if (source === "durable" && durableRead.state === "loading") {
      return { label: "Loading this conversation", skeleton: <PaneSkeletonThread />, status: "loading" };
    }
    if (source === "durable" && durableRead.state === "failed") {
      return {
        action: {
          label: "Try again",
          onAct: () => inbox.retryDurableThreadRead(selected.ref),
        },
        description: "Nothing was lost. This conversation could not be read just now.",
        status: "error",
        title: "This conversation could not be loaded",
      };
    }
    return undefined;
  })();

  function clearFilters() {
    inbox.setQuery("");
    setMemberFilter("all");
    inbox.setStatusTab("open");
  }

  // -------------------------------------------------------------------------------------------
  // Writes the panes call
  // -------------------------------------------------------------------------------------------

  async function send(body: string, tab: ComposerTab): Promise<boolean> {
    if (source !== "durable" || selected === null) return false;
    await inbox.sendDurableMessage(
      selected.ref,
      tab === "note" ? { body, kind: "note" } : { body, kind: "reply" },
    );
    // Always true: the message is on screen now, carrying its own state. Handing the text back to
    // the composer as well would leave two copies and no way to tell which one is real.
    return true;
  }

  function sendHeldDraft() {
    if (source !== "durable" || selected === null || durableRead.state !== "ready") return;
    const draft = durableRead.draft;
    // Both rules, from the one module that owns them, rather than a status check written out here
    // and a body comparison nobody remembered to write. `pairingFor` returns an id only for an
    // approved draft on an unlocked conversation whose body is untouched, which is the same
    // comparison migration 101 makes — so this cannot construct a send the database would refuse.
    const draftId = pairingFor(draft?.body ?? "", draft, { locked: lockedReason !== null });
    if (draft === null || draftId === null) return;
    void inbox.sendDurableMessage(selected.ref, { body: draft.body, draftId, kind: "reply" });
  }

  function discardHeldDraft() {
    if (selected === null) return;
    if (source === "durable") void inbox.discardDurableDraft(selected.ref);
    else inbox.setFixtureDiscarded((current) => [...current, selected.ref]);
  }

  function generateDraft() {
    if (selected === null) return;
    if (source === "durable") void inbox.askForDurableDraft(selected.ref);
    else inbox.setFixtureDiscarded((current) => current.filter((ref) => ref !== selected.ref));
  }

  function changeStatus(status: ChatThreadStatus) {
    if (source !== "durable" || selected === null) return;
    void inbox.moveDurableThreadStatus(selected.ref, status);
  }

  // -------------------------------------------------------------------------------------------
  // Keyboard
  // -------------------------------------------------------------------------------------------

  // The focus is asked for here and taken in an effect, rather than reached for through the ref in
  // a `requestAnimationFrame` from render. Two reasons, and the second is the one that matters: a
  // frame is a guess at when the tab has actually switched, where an effect runs when it has; and
  // a closure that reads a ref is a closure that cannot be handed to anything called during
  // render, which is where the composer's own command table is built.
  const [focusRequest, setFocusRequest] = useState(0);
  const focusComposer = (tab: ComposerTab) => {
    inbox.setComposerTab(tab);
    inbox.setThreadOpen(true);
    setFocusRequest((count) => count + 1);
  };
  useEffect(() => {
    if (focusRequest === 0) return;
    composerHost.current?.querySelector("textarea")?.focus();
  }, [focusRequest]);

  const { closeHelp, helpOpen, setHelpOpen } = useChatShortcuts(
    {
      back: () => {
        if (inbox.railOpen) inbox.setRailOpen(false);
        else if (inbox.threadOpen) inbox.setThreadOpen(false);
        else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      },
      next: () => {
        const next = stepSelection(visible.map((thread) => thread.ref), selected?.ref ?? null, 1);
        if (next !== null) select(next);
      },
      note: () => focusComposer("note"),
      open: () => inbox.setThreadOpen(true),
      previous: () => {
        const next = stepSelection(visible.map((thread) => thread.ref), selected?.ref ?? null, -1);
        if (next !== null) select(next);
      },
      reply: () => focusComposer("reply"),
      resolve: () => changeStatus(resolved ? "open" : "resolved"),
      search: () => {
        const field = listHost.current?.querySelector<HTMLInputElement>('input[type="search"]');
        field?.focus();
        field?.select();
      },
      status: () => {
        // Opening the control the way a pointer would. There is no imperative open on
        // `BrandSelect`, and reaching into base-ui's internals to add one would tie this surface
        // to a version of somebody else's component.
        document.getElementById(STATUS_CONTROL_ID)?.click();
      },
    },
    { enabled: !inbox.railOpen },
  );

  // -------------------------------------------------------------------------------------------
  // Panes
  // -------------------------------------------------------------------------------------------

  const listEmpty: ThreadListEmptyProps =
    scoped.length === 0
      ? inboxMode === "team"
        ? {
            action: { label: "Open client inbox", onAct: () => setInboxMode("clients") },
            description: "Internal notes appear here after a team member adds one to a client conversation.",
            title: "No internal notes yet",
          }
        : source === "empty" && inbox.inboxRead.state === "disabled"
          ? {
              action: { label: "Check again", onAct: () => window.location.reload() },
              description:
                "Client messaging is switched off for this workspace. Turning it on brings your clients' conversations here.",
              title: "Client messaging is not connected",
            }
          : {
              action: { label: "Check again", onAct: () => window.location.reload() },
              description:
                "Your clients start these from their own Team Chat. The first one to write lands here.",
              title: "No client conversations yet",
            }
      : {
          action: { label: "Clear the filters", onAct: clearFilters },
          description:
            "Nothing in this workspace matches the current status, team member and search together.",
          title: "Nothing matches this filter",
        };

  const digest = useMemo(
    () =>
      selected === null
        ? null
        : threadDigest({
            clientName: selected.title,
            hasDraft: heldDraft !== null,
            messages: storedMessages,
            status: selected.status,
            unreadCount: selected.unreadCount,
          }),
    [heldDraft, selected, storedMessages],
  );

  /**
   * The latest analysis this thread carries, and the rail's readiness.
   *
   * The rail used to read readiness from the directory row while the band beside it read it from the
   * run — two expressions for one dated observation, which is how a rail and a card come to disagree
   * about the same client in the same pane. With the timeline on there is one source: the newest
   * `analysis_completed` event.
   */
  const latestAnalysis = timelineOn
    ? (timeline?.events ?? [])
        .filter((event) => event.kind === "analysis_completed")
        .sort((left, right) => new Date(left.at).getTime() - new Date(right.at).getTime())
        .at(-1)
    : undefined;

  // The one green control, the chips, and the counts. Computed here rather than in the pane, because
  // the count line sits beside the chips and both are this surface's.
  const timelinePlan = timelineOn
    ? groupTimeline(items, "operator", isOwnMessage, { filter: timelineFilter, newSince })
    : null;

  const timelineOptions: TimelineThreadOptions | undefined = timelineOn
    ? {
        audience: "operator",
        reviewedUploadIds: reviewedUploads,
        filter: timelineFilter,
        handlers: {
          onOpen: () => {
            // Every operator deep link is about this thread's client, and opening the client is the
            // navigation this surface owns. The section a band names is not reachable from here yet;
            // opening the client is where all five of them start.
            const clientId = durableThread?.clientId ?? null;
            if (clientId !== null) onOpenClient(clientId);
          },
          onDraftReminder: (body) => {
            // Into the composer, for the operator to read and send. Nothing sends from here.
            writeDraft(composerRef(selected?.ref ?? "none", "reply"), body);
            inbox.setComposerTab("reply");
            // Remounts the composer so the stored draft is what the field shows, which is the same
            // seam Edit uses to hand a held suggestion to the text field.
            inbox.setComposerEpoch((epoch) => epoch + 1);
          },
          ...(source === "durable" && selected !== null
            ? {
                onRequestDocument: () => setRequestOpen(true),
                onReview: (uploadId: string) => {
                  void reviewDocument(uploadId).then((result) => {
                    if (result.ok) setReviewedUploads((current) => [...current, uploadId]);
                  });
                },
              }
            : {}),
        },
        newSince,
        onRetry: () => window.location.reload(),
        ...(timeline?.readFailed === true ? { readFailed: true } : {}),
      }
    : undefined;

  const snapshot = useMemo(() => {
    // Read through a widened view of the directory row. `parseInboxClient` narrows
    // `/api/clients` to four fields today, so `readiness`, its snapshot date, the open-action
    // count and the next scheduled update all arrive as `undefined` and the rows for them are
    // simply absent — which is the same degradation a directory that failed to load produces.
    // Widening the parser is `lib/operator/support-inbox.client.ts`'s edit and is requested; when
    // it lands this pane fills in with no change here.
    const wide = durableClient as (SupportInboxClient & Partial<SnapshotInput>) | undefined;
    const client: SnapshotInput | null =
      source === "durable"
        ? wide === undefined
          ? null
          : {
              assignedToName: wide.assignedToName,
              businessName: wide.businessName ?? null,
              displayName: wide.displayName,
              nextRefreshAt: wide.nextRefreshAt ?? null,
              // One dated observation, not two: with the timeline on, the run the thread shows is
              // the run the rail states.
              openActionCount: latestAnalysis?.open ?? wide.openActionCount ?? null,
              readiness: latestAnalysis?.readiness ?? wide.readiness ?? null,
              readinessAt: latestAnalysis?.at ?? wide.readinessAt ?? null,
              stage: wide.stage ?? null,
            }
        : fixtureClient === undefined
          ? null
          : {
              assignedToName:
                fixtureClient.ownerId === undefined
                  ? null
                  : teamMemberById.get(fixtureClient.ownerId) ?? null,
              businessName: fixtureClient.business,
              displayName: fixtureClient.name,
              stage: fixtureClient.stage ?? null,
            };
    return client === null ? [] : snapshotRows(client, { date: formatDay });
  }, [durableClient, fixtureClient, latestAnalysis, source, teamMemberById]);

  /** The chips, in the order the design fixed them. `all` is not a filter, it is the absence of one. */
  const TIMELINE_CHIPS: readonly { readonly label: string; readonly value: TimelineFilter }[] = [
    { label: "All", value: "all" },
    { label: "Messages", value: "messages" },
    { label: "Analysis", value: "analysis" },
    { label: "Documents", value: "documents" },
    { label: "Stage", value: "stage" },
    { label: "Billing", value: "billing" },
  ];

  const timelineChips =
    timelinePlan === null ? null : (
      <div
        aria-label="Show in thread"
        className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-[var(--border)] bg-card px-3 py-2 sm:px-4"
        role="group"
      >
        {TIMELINE_CHIPS.map((chip) => {
          const pressed = timelineFilter === chip.value;
          return (
            <button
              aria-pressed={pressed}
              className={cn(
                "inline-flex min-h-11 items-center rounded-full border border-[var(--surface-border)] px-3 text-xs font-medium",
                "transition-colors duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)]",
                "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                pressed
                  ? "border-[var(--success)] bg-[var(--accent)] font-semibold text-[var(--success)]"
                  : "text-muted-foreground hover:text-foreground",
              )}
              key={chip.value}
              onClick={() => setTimelineFilter(chip.value)}
              type="button"
            >
              {chip.label}
            </button>
          );
        })}
        {/*
          Counts what actually renders, not what the thread holds: a chip that says six updates and
          shows two is a chip nobody trusts a second time. `aria-live`, because pressing a chip
          changes the thread below rather than anything the focus is on.
        */}
        <span aria-live="polite" className="ml-auto text-xs text-muted-foreground">
          {`Showing ${timelinePlan.messageCount} message${timelinePlan.messageCount === 1 ? "" : "s"} · ${timelinePlan.eventCount} update${timelinePlan.eventCount === 1 ? "" : "s"}`}
        </span>
      </div>
    );

  /**
   * The in-thread document request.
   *
   * Above the composer rather than in a dialog, because what it produces is a row in this
   * conversation and the operator is reading the conversation to decide what to ask for. `why` is a
   * field and not an optional one: the band prints it to the client, and a request with no reason on
   * it is the one that reads as an unexplained demand.
   */
  const requestPanel =
    !requestOpen || selected === null ? null : (
      <div
        aria-label="Ask this client for a document"
        className="mb-2 grid gap-2 rounded-[10px] border border-[var(--surface-border)] bg-card px-3 py-2.5"
        role="region"
      >
        <p className="text-xs font-semibold text-foreground">Ask for a document</p>
        <Input
          aria-label="What to ask for"
          onChange={(event) => setRequestName(event.target.value)}
          placeholder="Bank statement"
          value={requestName}
        />
        <Input
          aria-label="Why it is needed"
          onChange={(event) => setRequestWhy(event.target.value)}
          placeholder="The last three months, so the business profile item can be verified."
          value={requestWhy}
        />
        {requestProblem === null ? null : (
          <p className="text-xs text-destructive" role="alert">
            {requestProblem}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            className="min-h-11"
            disabled={requestBusy || requestName.trim() === "" || requestWhy.trim() === ""}
            onClick={async () => {
              setRequestBusy(true);
              setRequestProblem(null);
              const result = await requestDocument({
                name: requestName.trim(),
                threadId: selected.ref,
                why: requestWhy.trim(),
              });
              setRequestBusy(false);
              if (!result.ok) {
                setRequestProblem(
                  "That request was not sent. Nothing was added to the conversation.",
                );
                return;
              }
              setRequestOpen(false);
              setRequestName("");
              setRequestWhy("");
            }}
            size="sm"
            type="button"
            // Outlined, like every control this directory draws: the filled brand weight in the
            // Inbox is the composer's send, and this panel sits above it rather than replacing it.
            variant="outline"
          >
            {requestBusy ? "Sending" : "Send request"}
          </Button>
          <Button
            className="min-h-11"
            onClick={() => {
              setRequestOpen(false);
              setRequestProblem(null);
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            Cancel
          </Button>
        </div>
      </div>
    );

  // `onClose` is one control with two meanings, decided by where this copy of the rail is being
  // rendered. The sheet is the only thing open below the three-pane layout, so while it is open the
  // close is the sheet's; above it, the same control is the collapse the design brief asks for.
  const rail = (
    <CopilotRail
      className="min-h-0 flex-1"
      digest={digest}
      digestAt={digest?.at ? relativeTime(digest.at) : null}
      draftBlockedReason={
        selected === null
          ? "Open a conversation to ask for a suggestion."
          : resolved
            ? "This conversation is resolved, so no suggestion can be prepared."
            : heldDraft !== null
              ? "A suggestion is already waiting in your composer."
              : null
      }
      drafting={inbox.drafting}
      onClose={inbox.railOpen ? () => inbox.setRailOpen(false) : () => setRailCollapsed(true)}
      onGenerateDraft={
        selected === null || resolved || heldDraft !== null || source === "empty"
          ? undefined
          : generateDraft
      }
      onTabChange={inbox.setRailTab}
      snapshot={snapshot}
      snapshotAction={
        source === "fixture" && fixtureClient !== undefined
          ? { label: "Open client", onAct: () => onOpenClient(fixtureClient.clientId) }
          : undefined
      }
      snapshotNote={
        selected === null
          ? null
          : snapshot.length === 0
            ? "This workspace has not told the Inbox anything else about this client yet."
            : source === "durable" && durableClient !== undefined
              ? "Open the client to see the whole record."
              : null
      }
      state={
        source === "empty" && inbox.inboxRead.state === "loading"
          ? { label: "Loading", skeleton: <RailSkeleton />, status: "loading" }
          : selected === null
            ? {
                description:
                  "This panel carries the conversation's state and the client's own snapshot. Choose a conversation to fill it.",
                status: "disabled",
                title: "Nothing open",
              }
            : undefined
      }
      tab={inbox.railTab}
    />
  );

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <CompactHeader
        description={`Client conversations and internal team messages. ${
          teamSeesAllClients
            ? "Team access is set to all clients."
            : "Team access is limited to assigned clients."
        } A suggested reply never sends on its own.`}
        icon={InboxIcon}
        title="Inbox"
      />

      <div className="inline-flex w-fit rounded-lg border border-border bg-muted/40 p-1" role="tablist" aria-label="Inbox audience">
        {([
          { label: "Client inbox", value: "clients" },
          { label: "Internal notes", value: "team" },
        ] as const).map((option) => (
          <button
            aria-selected={inboxMode === option.value}
            className={cn(
              "min-h-10 rounded-md px-4 text-sm font-medium transition-colors",
              inboxMode === option.value
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
            key={option.value}
            onClick={() => {
              setInboxMode(option.value);
              inbox.setComposerTab(option.value === "team" ? "note" : "reply");
            }}
            role="tab"
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>

      {/*
        18rem flanks rather than the brief's 20rem, and the brief's own diagram is why. It draws
        three panes with nothing to their left; the product draws them inside a console with a 15rem
        navigation column, and at the width the three-pane layout first appears two 20rem flanks
        leave the conversation 320px — the same as the list, narrower than the nav, and the smallest
        region on a screen whose whole job is the conversation. At 18rem it is the widest band on
        the page at every width the layout appears at, which is what the rank should have been.

        The rail also collapses to an edge, which the brief asks for and this had not built. It is
        the one control an operator has over the split, and it is worth more here than a drag handle
        would be: the answer is almost always "all of it to the conversation" or "show me the
        client", not a preference to be remembered in pixels.
      */}
      <div
        className={cn(
          "grid rounded-[10px] border border-[var(--border)] bg-card",
          INBOX_FRAME_CLASS,
          railCollapsed
            ? "xl:grid-cols-[18rem_minmax(0,1fr)_3.25rem]"
            : "xl:grid-cols-[18rem_minmax(0,1fr)_18rem]",
        )}
      >
        <ThreadListPane
          className={cn("min-h-0", inbox.threadOpen ? "hidden xl:flex" : "flex")}
          counts={counts}
          empty={listEmpty}
          listRef={listHost}
          member={memberFilter}
          members={memberOptions}
          onMemberChange={setMemberFilter}
          onQueryChange={inbox.setQuery}
          onRetry={() => window.location.reload()}
          onSelect={select}
          onShowShortcuts={() => setHelpOpen(true)}
          onStatusTabChange={inbox.setStatusTab}
          query={inbox.query}
          selectedRef={selected?.ref ?? null}
          status={
            source === "empty" && inbox.inboxRead.state === "loading"
              ? "loading"
              : source === "empty" && inbox.inboxRead.state === "failed"
                ? "error"
                : "ready"
          }
          statusTab={inbox.statusTab}
          threads={visible}
        />

        <ConversationPane
          beforeThread={timelineChips}
          brandName={workspaceBrandName}
          busy={inbox.inboxPending}
          composerKind={inboxMode === "team" ? "note" : "reply"}
          className={cn("min-h-0", inbox.threadOpen ? "flex" : "hidden xl:flex")}
          commands={
            source === "durable"
              ? REPLY_COMMANDS({
                  close: () => changeStatus("resolved"),
                  draft: generateDraft,
                  note: () => focusComposer("note"),
                })
              : undefined
          }
          composerEpoch={inbox.composerEpoch}
          composerHost={composerHost}
          composerNotice={requestPanel}
          connection={source === "durable" ? inbox.connection : null}
          draft={heldDraft}
          isOwn={isOwnMessage}
          items={items}
          lockedReason={lockedReason}
          onBack={() => inbox.setThreadOpen(false)}
          onDiscardDraft={heldDraft === null ? undefined : discardHeldDraft}
          onOpenRail={() => inbox.setRailOpen(true)}
          onOpenSnapshot={() => {
            inbox.setRailTab("details");
            inbox.setRailOpen(true);
          }}
          onSend={send}
          onSendDraft={source === "durable" ? sendHeldDraft : undefined}
          onStatusChange={source === "durable" && selected !== null ? changeStatus : undefined}
          onTabChange={inbox.setComposerTab}
          problem={inbox.inboxProblem}
          renderEvent={(event) => <EventCard event={event} />}
          stage={selected?.stage}
          status={selected?.status ?? "open"}
          statusLabel={titleCase}
          statuses={SUPPORT_THREAD_STATUSES}
          subtitle={
            selected?.subtitle ??
            (durableClient === undefined ? null : durableClient.assignedToName)
          }
          tab={inbox.composerTab}
          threadRef={selected?.ref ?? "none"}
          threadState={threadState}
          timeline={timelineOptions}
          title={
            selected?.title ??
            (source === "empty" ? "No conversations yet" : "Nothing open")
          }
        />

        <div className="hidden min-h-0 border-l border-[var(--border)] xl:flex xl:flex-col">
          {railCollapsed ? (
            <div className="flex justify-center p-2">
              <Button
                aria-label="Open the client panel"
                onClick={() => setRailCollapsed(false)}
                size="icon-lg"
                title="Open the client panel"
                type="button"
                variant="ghost"
              >
                <PanelRightOpen aria-hidden className="size-4" />
              </Button>
            </div>
          ) : (
            rail
          )}
        </div>
      </div>

      {/*
        At every width below the three-pane layout the rail is a sheet reached from the
        conversation header, which is the only place it is wanted from.
      */}
      <Sheet onOpenChange={inbox.setRailOpen} open={inbox.railOpen}>
        {/*
          A bottom sheet, not a side one. The opener only exists below the three-pane layout, so
          this is always a phone-shaped screen: a panel arriving from the right on a 390px display
          is a drawer that covers the conversation edge-to-edge and reads as a navigation, while
          one rising from the bottom keeps the thread visible above it and is dismissed by the
          gesture people already use. The 85dvh cap is what leaves that strip of thread showing.
        */}
        <SheetContent
          className="flex h-[85dvh] max-h-[85dvh] w-full max-w-none flex-col rounded-t-2xl p-0"
          side="bottom"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Client panel</SheetTitle>
          </SheetHeader>
          {rail}
        </SheetContent>
      </Sheet>

      <ShortcutOverlay
        onOpenChange={(open) => (open ? setHelpOpen(true) : closeHelp())}
        open={helpOpen}
      />

      {/* The Inbox's writes go to `/api/support/threads/[id]/messages`, and nothing else here
          reaches the network. Named so the support-surface sweeps keep covering this file. */}
    </div>
  );
}

/** A date in the format the durable rows already use elsewhere in this console: UTC, day and month. */
function formatDay(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(parsed);
}
