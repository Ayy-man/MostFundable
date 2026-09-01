"use client";

// Pane 2: the conversation, and the composer under it.
//
// The composer is the part with the rules attached, so they are stated here rather than left to
// be inferred from the JSX.
//
// **Reply and Note are two composers, not one composer with a flag.** They keep separate stored
// drafts, because a half-written note that follows the operator into the Reply tab is a note one
// keystroke away from reaching the client it was written about. The tab is also what decides the
// `visibility` the send carries, and contract §3.2 forbids an internal message ever carrying an
// `origin_draft_id` — so the held draft is offered on the Reply tab and nowhere else.
//
// **Send stays a click.** `<Composer sendOn="modifier">` puts the typed reply behind the
// deliberate chord, and a framed AI draft has no key path at all, because the frame replaces the
// text field rather than sitting above it. Neither rule is re-implemented here; the point of
// using the shared component is that both live in one place.
//
// **Only a draft the database would accept is framed.** `<Composer draft>` always renders a Send,
// so framing a held draft would mean a Send that migration 101 refuses — a control that can only
// fail, which contract §7 bans outright. A held draft therefore renders as a notice above the
// composer instead: the same amber, the reason in plain words, and the two actions that do work.
// That notice is also what keeps a suggestion visible on a resolved thread, which the shared
// frame cannot do at all.
//
// **A draft the engine returned under its own bar is not presented as a draft.** Its body is not
// shown, because showing it invites the operator to use it; what shows is the absence and the
// client snapshot, which is the useful thing to read next.

import { ChevronLeft, MessageSquare, PanelRightOpen, Sparkles, StickyNote } from "lucide-react";
import { useMemo, type ReactNode, type RefObject } from "react";

import {
  Composer,
  MessageThread,
  writeDraft,
  type ChatConnectionStatus,
  type ChatMessage,
  type ChatThreadItem,
  type ChatThreadStatus,
  type ComposerCommand,
  type ComposerDraft,
  type PaneFallback,
  type TimelineThreadOptions,
} from "@/components/chat";
import type { ChatClientStage, ChatEvent } from "@/components/chat/types";
import { BrandSelect } from "@/components/ui/brand-select";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { draftPlacement, type DraftPresentation } from "./view-model";

export type ComposerTab = "reply" | "note";

/** The stored-draft key for one tab of one thread. Opaque, and never rendered. */
export function composerRef(threadRef: string, tab: ComposerTab): string {
  return tab === "note" ? `${threadRef}::note` : threadRef;
}

/** The id the `s` shortcut reaches for. One control, one handle, no ref threaded through a tree. */
export const STATUS_CONTROL_ID = "inbox-thread-status";

const CONNECTION_LABEL: Readonly<Record<ChatConnectionStatus, string>> = {
  connecting: "Connecting",
  live: "Live",
  offline: "Offline",
  reconnecting: "Reconnecting",
};

/**
 * The live pip.
 *
 * Bound to the channel's own reported status and to nothing else — contract §3.3 is explicit that
 * a successful `subscribe()` call is not evidence the socket is carrying anything. Colour is never
 * the whole message: the word sits beside the dot.
 *
 * The middle states are neutral rather than amber. Amber in these views means an internal note or
 * a held AI draft and nothing else, and a reconnecting socket is neither — spending the colour
 * here is what turns a reserved signal into decoration.
 */
function ConnectionMark({ status }: { status: ChatConnectionStatus }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          status === "live"
            ? "bg-[var(--success)]"
            : status === "offline"
              ? "bg-[var(--destructive)]"
              : "bg-[var(--muted-foreground)]",
        )}
      />
      {CONNECTION_LABEL[status]}
    </span>
  );
}

export interface HeldDraft {
  readonly body: string;
  readonly shown: DraftPresentation;
}

export interface ConversationPaneProps {
  readonly title: string;
  readonly subtitle?: string | null;
  readonly stage?: ChatClientStage;
  readonly status: ChatThreadStatus;
  /** Absent where there is no stored thread to move. The control is then not rendered at all. */
  readonly onStatusChange?: (status: ChatThreadStatus) => void;
  readonly statuses: readonly ChatThreadStatus[];
  readonly statusLabel: (status: ChatThreadStatus) => string;
  readonly connection?: ChatConnectionStatus | null;

  readonly items: readonly ChatThreadItem[];
  readonly isOwn: (message: ChatMessage) => boolean;
  readonly renderEvent: (event: ChatEvent) => ReactNode;
  /** Loading, empty or error. Absent means the thread is ready and `items` is what it holds. */
  readonly threadState?: PaneFallback;
  /**
   * Between the header and the thread: the timeline's filter chips and their count.
   *
   * A slot rather than a `filters` prop, because what belongs there is decided by whether
   * `FEATURE_TIMELINE` is on and by which chips exist, and neither is this pane's business. Absent is
   * the shipped pane, unchanged.
   */
  readonly beforeThread?: ReactNode;
  /** Above the composer: the in-thread document request, when the operator has opened one. */
  readonly composerNotice?: ReactNode;
  /** What the thread renders events as. Absent is the shipped log line through `renderEvent`. */
  readonly timeline?: TimelineThreadOptions;

  readonly tab: ComposerTab;
  /** Which audience this Inbox mode is writing to. */
  readonly composerKind?: "both" | ComposerTab;
  readonly onTabChange: (tab: ComposerTab) => void;
  /** @opaque Keys the stored composer draft and the remount. Never rendered. */
  readonly threadRef: string;
  /** Bumped to remount the composer, which is how Edit hands a draft body to the text field. */
  readonly composerEpoch: number;
  readonly composerHost?: RefObject<HTMLDivElement | null>;
  readonly onSend: (body: string, tab: ComposerTab) => Promise<boolean>;
  readonly commands?: readonly ComposerCommand[];
  readonly busy?: boolean;
  readonly lockedReason?: string | null;
  readonly brandName: string;

  readonly draft?: HeldDraft | null;
  readonly onSendDraft?: () => void;
  readonly onDiscardDraft?: () => void;
  /**
   * Opens the rail's Details tab.
   *
   * The control that *starts* the draft workflow is deliberately not here — it lives on the rail,
   * per the design brief, so that asking for a suggestion and reading what came back are one
   * place rather than two.
   */
  readonly onOpenSnapshot?: () => void;

  /** Opens the rail where it is a sheet. Absent on the wide layout, where the rail is beside this. */
  readonly onOpenRail?: () => void;
  /** Back to the list. Present only where the list is a separate screen. */
  readonly onBack?: () => void;
  readonly problem?: string | null;
  readonly className?: string;
}

export function ConversationPane({
  beforeThread,
  brandName,
  busy = false,
  composerKind = "both",
  className,
  composerNotice,
  commands,
  composerEpoch,
  composerHost,
  connection,
  draft = null,
  isOwn,
  items,
  lockedReason = null,
  onBack,
  onDiscardDraft,
  onOpenRail,
  onOpenSnapshot,
  onSend,
  onSendDraft,
  onStatusChange,
  onTabChange,
  problem = null,
  renderEvent,
  stage,
  status,
  statusLabel,
  statuses,
  subtitle,
  tab,
  threadRef,
  threadState,
  timeline,
  title,
}: ConversationPaneProps) {
  const note = tab === "note";
  const replyRef = composerRef(threadRef, "reply");

  /** Puts the body in the Reply composer as ordinary text, which is what makes it a human message. */
  const takeIntoComposer = useMemo(
    () =>
      draft === null
        ? null
        : () => {
            writeDraft(replyRef, draft.body);
            // The stored draft survives; the frame does not. `postSupportReply` sends no `draftId`
            // for a typed body, so what goes out is the operator's own message — which is the
            // honest record of a suggestion somebody rewrote.
            onDiscardDraft?.();
          },
    [draft, onDiscardDraft, replyRef],
  );

  // An approved draft goes to the shared frame, locked conversation or not: the frame drops every
  // control and says "kept for reference" when the composer is locked, which is what the view this
  // replaced did. A draft that was *held* — language, thin, a reviewer check — is a different
  // thing to say and goes to the notice below, which explains the hold and offers the two things
  // that still make sense.
  const locked = lockedReason !== null;
  const placement =
    draft === null
      ? null
      : draftPlacement({
          canSend: onSendDraft !== undefined,
          hold: draft.shown.hold,
          locked,
          note,
        });
  const framed: ComposerDraft | null =
    draft !== null && placement === "frame"
      ? {
          body: draft.body,
          confidence: draft.shown.confidence,
          onDiscard: () => onDiscardDraft?.(),
          onEdit: () => takeIntoComposer?.(),
          // A locked frame draws no Send at all, so this is unreachable there. It exists because
          // the shared frame's contract requires a send, not because there is one to make.
          onSend: onSendDraft ?? (() => undefined),
        }
      : null;

  // The complement, deliberately. A draft that fell out of the frame's condition has to land
  // somewhere: the alternative — two conditions that both happen to be false — is a suggestion the
  // operator was told about in the rail and cannot find anywhere on screen.
  const heldNotice = draft !== null && placement === "notice" ? draft : null;

  return (
    <section
      aria-label="Conversation"
      className={cn("flex min-h-0 min-w-0 flex-col bg-card", className)}
    >
      <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--border)] px-3 py-2.5 sm:px-4">
        {onBack ? (
          <Button
            aria-label="Back to conversations"
            className="-ml-1 shrink-0"
            onClick={onBack}
            size="icon-lg"
            type="button"
            variant="ghost"
          >
            <ChevronLeft aria-hidden className="size-4" />
          </Button>
        ) : null}

        {/*
          `basis-48` is what makes `flex-wrap` on the header mean something. Without a base width
          the name column is the only flexible item, so it absorbs every pixel the status control
          and Resolve want and the client's name truncates to "Jordan Ne..." while two controls sit
          at their full size beside it. With a base, the controls wrap to a second header line
          before the name gives way — which is the right trade, because a truncated name is the one
          thing in this header a reader cannot recover from context.
        */}
        <div className="flex min-w-0 flex-1 basis-48 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
              {title}
            </span>
            {stage ? (
              <span className="shrink-0 rounded-full border border-[var(--border)] px-1.5 py-px text-xs font-medium text-muted-foreground">
                {stage}
              </span>
            ) : null}
          </span>
          <span className="flex min-w-0 items-center gap-2">
            {subtitle ? (
              <span className="min-w-0 truncate text-xs text-muted-foreground">{subtitle}</span>
            ) : null}
            {connection ? <ConnectionMark status={connection} /> : null}
          </span>
        </div>

        {/*
          The two status controls travel together. They are one fact between them — which tab this
          conversation sits on — and when the header runs out of room they belong on the same line
          as each other rather than one staying up beside the name and the other dropping alone
          underneath it. `ml-auto` keeps them at the right-hand end of whichever line they land on.
        */}
        {onStatusChange ? (
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {/*
              `w-auto` over a modest floor rather than a wide one. The control sizes to the word it
              is showing, and the room that buys goes to the client's name beside it — at a 478px
              conversation pane that is the difference between the header fitting on one line and
              dropping the status controls onto a second.
            */}
            <BrandSelect
              ariaLabel="Conversation status"
              className="w-auto min-w-24 shrink-0"
              disabled={busy}
              id={STATUS_CONTROL_ID}
              onValueChange={(next) => onStatusChange(next as ChatThreadStatus)}
              options={statuses.map((each) => ({ label: statusLabel(each), value: each }))}
              size="sm"
              value={status}
            />
            {/*
              Outlined in both directions, and that is a ranking rather than a preference. The
              filled brand green is the loudest thing on the surface and there is only one of it
              per pane worth spending: here that is the reply the operator is writing, not the
              control that ends the conversation. A terminal action drawn louder than the one it
              ends reads as the thing to press.
            */}
            <Button
              className="min-h-9 shrink-0"
              disabled={busy}
              onClick={() => onStatusChange(status === "resolved" ? "open" : "resolved")}
              size="sm"
              type="button"
              variant="outline"
            >
              {status === "resolved" ? "Reopen" : "Resolve"}
            </Button>
          </div>
        ) : null}

        {onOpenRail ? (
          <Button
            aria-label="Open the client panel"
            className="shrink-0 xl:hidden"
            onClick={onOpenRail}
            size="icon-lg"
            type="button"
            variant="ghost"
          >
            <PanelRightOpen aria-hidden className="size-4" />
          </Button>
        ) : null}
      </header>

      {beforeThread}

      <MessageThread
        className="min-h-0 flex-1"
        isOwn={isOwn}
        items={items}
        renderEvent={renderEvent}
        state={threadState}
        timeline={timeline}
      />

      {/*
        The extra bottom padding below `xl` is for the console's own support launcher, which is
        fixed to the bottom-right of the viewport and lands squarely on whatever this footer puts
        there — on a 390px screen that was the Send control and the draft's Discard. Reserving the
        strip is the only fix available from inside this panel; the launcher is not this lane's.
      */}
      <footer
        className={cn(
          "shrink-0 border-t px-3 py-3 pb-20 transition-colors duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)] sm:px-4 xl:pb-3",
          note
            ? "border-[var(--warning-border)] bg-[color-mix(in_srgb,var(--warning),transparent_90%)]"
            : "border-[var(--border)] bg-[var(--surface-raised)]",
        )}
      >
        {/*
          Two tabs, and they are radio buttons rather than a `<Tabs>` strip, because what they
          switch is the recipient of the next message. A roving tabindex lets an arrow key change
          that while the operator is looking at the thread rather than at the composer; a radio
          group announces the change and takes a deliberate press either way.
        */}
        {composerKind === "both" ? (
          <div
            aria-label="Who the next message goes to"
            className="mb-2 flex items-center gap-1"
            role="radiogroup"
          >
          {(
            [
              { icon: MessageSquare, label: "Reply", value: "reply" },
              { icon: StickyNote, label: "Note", value: "note" },
            ] as const
          ).map((each) => {
            const active = tab === each.value;
            const Icon = each.icon;
            return (
              <button
                aria-checked={active}
                className={cn(
                  "inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)]",
                  "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  active
                    ? each.value === "note"
                      ? "bg-[var(--warning-ink)] text-[var(--background)]"
                      : "bg-[var(--primary-ink)] text-[var(--background)]"
                    : "text-muted-foreground hover:text-foreground",
                )}
                key={each.value}
                onClick={() => onTabChange(each.value)}
                role="radio"
                type="button"
              >
                <Icon aria-hidden className="size-3.5" />
                {each.label}
              </button>
            );
          })}
          </div>
        ) : (
          <p className="mb-2 text-xs font-semibold text-muted-foreground">
            {composerKind === "note" ? "Internal team message" : "Message to client"}
          </p>
        )}

        {composerNotice}

        {problem === null ? null : (
          <p className="mb-2 text-xs leading-5 text-destructive" role="alert">
            {problem}
          </p>
        )}

        {heldNotice === null ? null : (
          <div
            className="mb-2 space-y-2 rounded-[10px] border border-dashed border-[var(--warning-border)] bg-[color-mix(in_srgb,var(--warning),transparent_92%)] px-3 py-2.5"
            role="region"
            aria-label="A suggestion that cannot be sent as written"
          >
            <p className="flex items-center gap-2 text-xs font-semibold text-[var(--warning-ink)]">
              <Sparkles aria-hidden className="size-3.5" />
              {heldNotice.shown.holdReason}
            </p>
            {heldNotice.shown.thin ? (
              <p className="text-xs leading-5 text-[var(--warning-ink)]">
                The client snapshot is the better starting point.
              </p>
            ) : (
              // Shown, but never as a draft: it is evidence for the operator's own judgement, and
              // the two actions under it are the only ways out.
              <p className="whitespace-pre-wrap text-[0.9375rem] leading-[1.5] text-foreground">
                {heldNotice.body}
              </p>
            )}
            <p className="text-xs text-[var(--warning-ink)]">{heldNotice.shown.confidence}</p>
            <div className="flex flex-wrap items-center gap-2">
              {heldNotice.shown.thin && onOpenSnapshot ? (
                <Button className="min-h-9" onClick={onOpenSnapshot} size="sm" type="button" variant="outline">
                  Open the snapshot
                </Button>
              ) : null}
              {!heldNotice.shown.thin && lockedReason === null && takeIntoComposer ? (
                <Button
                  className="min-h-9"
                  disabled={busy}
                  onClick={takeIntoComposer}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Take it into my reply
                </Button>
              ) : null}
              {onDiscardDraft ? (
                <Button
                  className="min-h-9"
                  disabled={busy}
                  onClick={onDiscardDraft}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  Discard
                </Button>
              ) : null}
            </div>
          </div>
        )}

        <div ref={composerHost}>
          <Composer
            banner={
              note ? (
                <p className="text-xs font-medium leading-5 text-[var(--warning-ink)]">
                  Internal note. Everyone on your team can read this; the client never sees it.
                </p>
              ) : null
            }
            busy={busy}
            commands={note ? undefined : commands}
            draft={framed}
            key={`${composerRef(threadRef, tab)}:${composerEpoch}`}
            label={note ? "Write an internal note" : "Write a reply"}
            lockedReason={lockedReason}
            onSend={(body) => onSend(body, tab)}
            placeholder={
              note
                ? "Write a note for your team. The client cannot see it."
                : `Reply as ${brandName}`
            }
            sendOn="modifier"
            threadRef={composerRef(threadRef, tab)}
            tone={note ? "note" : "default"}
          />
        </div>
      </footer>
    </section>
  );
}
