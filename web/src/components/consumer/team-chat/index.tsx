"use client";

// The consumer's Team Chat.
//
// This is the client's lifeline and the one rule above every other is that a reader always knows
// who is speaking. The human thread is human-only; the assistant is a navy panel with its own
// composer, its own history and no path back into this thread. That is not a style note — it is
// why `support_author_kind` is a closed enum of three people and why nothing in this directory
// touches the send seam except `transport.ts`.
//
// **It paints with its messages.** The defect this view was rebuilt to fix (F-01) was measured
// signed-in against production: three chained requests, 3,536ms, and for all of it the sentence
// "Loading the conversation..." as unstyled text in a white void, resolving to a thread with no
// messages in it. Lane 1a moved the read onto the server and made the welcome a real
// `support_messages` row written by a trigger at enrollment activation; this file's part is that
// the first frame is the conversation. `initialStateFrom` returns `ready` before any effect runs,
// so on the ordinary path there is no loading state at all — and when there is one, it is a
// skeleton shaped like the conversation rather than a sentence.
//
// **There is no suggestion row.** There was one, twice: four fixture literals, then three rules
// derived from the client's durable snapshot. Both versions were the same mistake, which is that a
// chip row under a composer is what an assistant looks like. Every chip was a question, and every
// question went to a person whose reply arrives in hours, so the affordance promised seconds and
// the thread delivered an afternoon. What is under the composer now is one line that says which
// party answers quickly and opens the assistant panel to do it. `suggestions.ts` survives as what
// decides the question that line carries into that panel, which is the only job its rules were
// ever right for.
//
// **Layout.** The thread is a full-height pane divided by hairlines, not a card floating in dead
// space, and the message column caps where the foundation caps it. The context rail is 18rem at
// `xl`; below that it folds into a disclosure and moves, with the assistant entry, *under* the
// conversation — because on a phone the conversation is the page, and a stack that puts the
// workspace and the assistant above it is the desktop reading order wearing a single column. At
// 390px the thread is the screen and the assistant is a full-height sheet.

import { useState } from "react";
import { ArrowRight, ChevronDown } from "lucide-react";

import {
  Composer,
  EventCard,
  MessageThread,
  timelineFixture,
  timelineThreadItems,
  type TimelineThreadOptions,
  PaneSkeletonThread,
  ThinkingOrb,
  orbActivity,
  type ChatMessage,
  type ChatThreadItem,
  type PaneFallback,
} from "@/components/chat";
import { openGlobalAssistant } from "@/components/assistant/global-companion";
import { ConsumerPageHeader } from "@/components/consumer/consumer-kit";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useTrackerClients } from "@/lib/tracker/realtime.client";
import { cn } from "@/lib/utils";

import { WorkspaceSnapshot, WorkspaceSnapshotSkeleton } from "./context-rail";
import { fixtureConversation } from "./fixture";
import { railStatusFor } from "./rail-state";
import { snapshotFrom } from "./client-snapshot";
import { suggestionsFor } from "./suggestions";
import { threadItemsFrom } from "./thread-model";
import { useTeamChat } from "./use-team-chat";
import type { ConsumerClientSnapshot, ConsumerTeamChatProps } from "./types";

/** Two letters from a name, for the header avatars. Never from an id. */
function initialsOf(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function Avatar({ name, tone }: { name: string; tone: "brand" | "member" }) {
  return (
    <span
      className={cn(
        "grid size-7 shrink-0 place-items-center rounded-lg text-xs font-semibold",
        tone === "brand"
          ? "bg-[var(--consumer-brand-tile)] text-[var(--consumer-canvas)]"
          : "bg-[var(--secondary)] text-[var(--secondary-foreground)]",
      )}
      title={name}
    >
      {initialsOf(name)}
    </span>
  );
}

/**
 * The channel's own report, and only where it is worth a person's attention.
 *
 * `connecting` renders nothing: it is true for a fraction of a second on every mount and a status
 * that flashes on load teaches people to ignore the status. `live` is a quiet confirmation; the
 * two failure states are the ones that change what a person should expect, so they are the ones
 * that get words.
 */
function LiveMark({ connection }: { connection: string | null }) {
  if (connection === null || connection === "connecting") return null;
  const failing = connection === "reconnecting" || connection === "offline";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium",
        failing ? "text-[var(--warning-ink)]" : "text-muted-foreground",
      )}
      role="status"
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          failing ? "bg-[var(--warning)]" : "bg-[var(--success)]",
        )}
      />
      {connection === "live"
        ? "Live"
        : connection === "reconnecting"
          ? "Reconnecting"
          : "Not connected"}
    </span>
  );
}

export function ConsumerTeamChat({
  analysisActive,
  canceled,
  navigate,
  notify,
  operatorName,
  teamChat,
  timeline: timelineProp,
  timelineEnabled = false,
}: ConsumerTeamChatProps) {
  const chat = useTeamChat(teamChat);
  // The events ride on the snapshot the page read; a host may still hand them in directly.
  const timeline = timelineProp ?? (teamChat?.state === "ready" ? teamChat.timeline : undefined);
  // The one volume control a client gets. Not a filter row: an operator triages a book of clients
  // and needs to slice a thread by kind, and a client has one thread and either wants the updates in
  // it or does not. Default on, because the updates are the point.
  const [hideUpdates, setHideUpdates] = useState(false);
  // What an empty state or a rail action puts in the box. The token is what makes pressing the
  // same control twice work twice; `<Composer>` fills and focuses, and never sends.
  const [insert, setInsert] = useState<{ token: number; value: string } | null>(null);
  const suggest = (value: string) =>
    setInsert((current) => ({ token: (current?.token ?? 0) + 1, value }));

  // The durable client row, through the same hook every other consumer view that needs it uses —
  // one fetch, revalidated on a realtime change, with `loading` and `error` reported separately.
  // Inactive in the demo shell, where there is no session for it to resolve and the answer would
  // be a 401 dressed as an error state.
  const tracker = useTrackerClients({ active: teamChat !== undefined, audience: "consumer" });
  const client = tracker.clients[0];
  const snapshot: ConsumerClientSnapshot | null = client ? snapshotFrom(client) : null;

  // Which of the five the rail is in — decided in `rail-state.ts`, where the ordering can be
  // driven. What is here is only what each one says.
  const railStatus = railStatusFor({
    enabled: tracker.enabled,
    error: tracker.error,
    found: snapshot !== null,
    loading: tracker.loading,
  });

  let snapshotState: PaneFallback | undefined;
  switch (railStatus) {
    case "loading":
      snapshotState = { skeleton: <WorkspaceSnapshotSkeleton />, status: "loading" };
      break;
    case "error":
      snapshotState = {
        action: { label: "Try again", onAct: () => void tracker.refetch() },
        description: "Your workspace details could not be read just now. Your conversation is unaffected.",
        status: "error",
        title: "Workspace details unavailable",
      };
      break;
    case "disabled":
      snapshotState = {
        description: "Workspace details are not available here yet.",
        status: "disabled",
        title: "Workspace details",
      };
      break;
    case "empty":
      snapshotState = {
        action: { label: "Ask your team", onAct: () => suggest("How do I get my workspace set up?") },
        description:
          "Your workspace details appear here once your funding team has set up your record. Ask them here if you are not sure where you are.",
        status: "empty",
        title: "No workspace details yet",
      };
      break;
    case "ready":
      break;
  }

  // The one question the assistant line carries, or none. `suggestionsFor` returns nothing when
  // the snapshot has not answered, and `openGlobalAssistant` treats an absent seed as "just open
  // it" — so a client we know nothing about gets the panel with an empty box rather than a guess.
  const suggestions = suggestionsFor(snapshot);

  // What the thread renders, and the five states it can be in. Each `PaneFallback` below owes the
  // reader something the union will not let it skip: a skeleton, a way forward, or a retry.
  // The timeline needs the flag and a way to open what its bands link to. Without `navigate` a
  // band's one action would do nothing, so the thread stays as it is rather than growing a dead
  // control — see `ConsumerTeamChatProps`.
  const timelineOn = timelineEnabled && navigate !== undefined;

  let items: ChatThreadItem[] = [];
  let threadState: PaneFallback | undefined;
  let lockedReason: string | null = null;
  let threadRef = "consumer-team-chat";

  switch (chat.state.kind) {
    case "fixture":
      // The demo shell behind the environment bar, and the only branch that may render a written
      // conversation nobody sent. With the timeline on it renders the approved mockup's thread, so
      // the demo shows the real card system rather than the old log lines.
      items = timelineOn
        ? timelineFixture({ audience: "consumer", brandName: operatorName })
        : fixtureConversation({ analysisActive, canceled, operatorName });
      break;
    case "loading":
      threadState = {
        label: "Opening your conversation",
        skeleton: <PaneSkeletonThread />,
        status: "loading",
      };
      // Locked while it opens, because `send` has no thread to post to yet and would answer false —
      // a box that accepts a message and then says it did not go is worse than one that says so
      // first. This is the rule `support-bootstrap.test.ts` held before the rebuild as
      // `supportState !== "ready" && supportState !== "disabled"`.
      lockedReason = "Opening your conversation. Nothing can be sent until it is ready.";
      break;
    case "disabled":
      threadState = {
        description:
          "Messaging with your funding team is not connected in this environment, so nothing can be sent or received here yet.",
        status: "disabled",
        title: "Messaging is not connected",
      };
      lockedReason = "Messaging is not connected in this environment.";
      break;
    case "error":
      // Never a written conversation on this branch. A failed durable read that fell back to
      // fixture messages would show a signed-in client words nobody sent them (rail 5).
      threadState = {
        action: { label: "Try again", onAct: chat.retry },
        description:
          "Your conversation could not be opened. Nothing can be sent until it reconnects, and nothing you sent earlier has been lost.",
        status: "error",
        title: "Conversation unavailable",
      };
      lockedReason = "Your conversation is unavailable right now. Nothing can be sent until it reconnects.";
      break;
    case "ready":
      threadRef = chat.state.thread.id;
      items = threadItemsFrom(chat.state.messages, operatorName, chat.state.read.counterpartReadAt);
      // Real events, or none. A durable thread never borrows the fixture's rows: a system row saying
      // an analysis finished is a claim about this client's account, and inventing one is the same
      // rail-5 failure as showing them a message nobody sent.
      if (timelineOn && timeline !== undefined) {
        items = [...items, ...timelineThreadItems(timeline.events)];
      }
      if (items.length === 0) {
        threadState = {
          // `secondary`, because the primary action on this pane is the composer directly below
          // it. A filled button here outshouts the control it is pointing at — the empty state's
          // whole job is to get somebody typing in that box, and it was the loudest thing on the
          // screen while the box was quieter.
          action: {
            emphasis: "secondary",
            label: "Say hello",
            onAct: () => suggest("Hello — I have a question about my plan."),
          },
          description:
            "This is where you and your funding team talk. Anything you send here goes to a person, and a person replies.",
          status: "empty",
          title: "Start the conversation",
        };
      }
      if (chat.state.thread.status === "resolved") {
        // The one disabled state that carries product meaning rather than hiding a broken control:
        // a resolved thread refuses the write in the database, and letting that come back as a
        // generic failure would teach the client that messaging is broken.
        lockedReason = "This conversation has been marked resolved by your team. Reopen it by asking them for anything new.";
      }
      break;
  }

  // The reader is whoever the message's author kind says wrote it — see `thread-model.ts` for why
  // that is a safe question to ask without any profile id crossing into the view.
  const isOwn = (message: ChatMessage) => message.author.kind === "consumer";

  // What the thread is handed when the timeline is on. Absent is the shipped thread, and the switch
  // is this object rather than a flag read inside the component — see `MessageThreadProps.timeline`.
  const timelineOptions: TimelineThreadOptions | undefined = timelineOn
    ? {
        audience: "consumer",
        handlers: {
          onOpen: (target) => {
            if (target.kind === "consumer-view") navigate?.(target.view);
          },
        },
        hideEvents: hideUpdates,
        // A reload, because the events were read on the server with the page. There is no browser
        // path to re-read them on their own, and a Retry that silently did nothing would be worse
        // than the line saying what happened — the empty state above reloads for the same reason.
        onRetry: () => window.location.reload(),
        ...(timeline?.readFailed === true ? { readFailed: true } : {}),
      }
    : undefined;

  const analysisActivity = snapshot
    ? orbActivity({ kind: "analysis", status: snapshot.analysisPending ?? "complete" })
    : null;

  return (
    <div>
      <ConsumerPageHeader title="Team Chat" />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_18rem] xl:gap-6">
        {/* The conversation. A pane, not a card: one hairline frame, full height, and the message
            column caps itself inside the foundation's thread. */}
        <section
          aria-labelledby="team-chat-conversation-heading"
          className={cn(
            "flex min-w-0 flex-col rounded-[10px] border border-[var(--consumer-border)] bg-card",
            "h-[calc(100dvh-19rem)] min-h-[30rem]",
            "sm:h-[calc(100dvh-var(--demo-banner-height)-11rem)] sm:min-h-[32rem] sm:max-h-[48rem]",
            "lg:h-[calc(100dvh-var(--demo-banner-height)-9rem)] xl:min-h-[34rem]",
            // The pane owns the remaining viewport height at every breakpoint, so the message
            // history scrolls inside it and the composer remains visible. `dvh` follows mobile
            // browser chrome; the desktop cap keeps a short thread from becoming a wall of space.
          )}
        >
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--consumer-border)] px-4 py-3 sm:px-5">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex -space-x-2">
                <Avatar name={operatorName} tone="brand" />
                {snapshot?.assignedToName ? (
                  <Avatar name={snapshot.assignedToName} tone="member" />
                ) : null}
              </span>
              <div className="min-w-0">
                <h2
                  className="truncate text-sm font-semibold text-foreground"
                  id="team-chat-conversation-heading"
                >
                  Your funding team
                </h2>
                <p className="truncate text-xs text-muted-foreground">{operatorName}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {timelineOn ? (
                <button
                  aria-pressed={hideUpdates}
                  className={cn(
                    "inline-flex min-h-11 items-center gap-1.5 rounded-full border border-[var(--surface-border)] px-3 text-xs font-medium",
                    "transition-colors duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)]",
                    "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    hideUpdates
                      ? "border-[var(--consumer-accent-ink)] bg-[var(--consumer-accent-tint)] text-[var(--consumer-accent-ink)]"
                      : "text-muted-foreground",
                  )}
                  onClick={() => setHideUpdates((current) => !current)}
                  type="button"
                >
                  {hideUpdates ? "Show updates" : "Hide updates"}
                </button>
              ) : null}
              <LiveMark connection={chat.connection} />
            </div>
          </header>

          {/* The messages sit on a recessed ground rather than on the pane's own card colour.
              `<MessageBubble>` paints the other side `bg-card` with a shadow, which is the right
              treatment only when there is something behind it to be raised off — on a `bg-card`
              pane those bubbles read as faint boxes floating for no reason. */}
          <MessageThread
            className="min-h-0 flex-1 bg-[var(--consumer-canvas)]"
            footer={
              analysisActivity ? (
                <div className="pt-2">
                  <ThinkingOrb activity={analysisActivity} size="sm" />
                </div>
              ) : null
            }
            isOwn={isOwn}
            items={items}
            renderEvent={(event) => <EventCard event={event} />}
            state={threadState}
            timeline={timelineOptions}
          />

          <div className="px-4 py-3 sm:px-5">
            <Composer
              busy={chat.sending}
              insert={insert}
              label="Message your funding team"
              lockedReason={lockedReason}
              onSend={async (body) => {
                if (chat.state.kind === "fixture") {
                  // The demo shell, behind the environment bar. Nothing is stored and the bar
                  // already says so, so the honest thing is to say the message went nowhere
                  // durable rather than to mimic a send.
                  notify("This is a demo workspace, so messages are not delivered.");
                  return true;
                }
                const sent = await chat.send(body);
                notify(
                  sent
                    ? "Message sent to your funding team."
                    : "That message was not sent. Nothing was posted to the conversation.",
                );
                return sent;
              }}
              placeholder="Message your funding team"
              sendOn="enter"
              threadRef={threadRef}
            />

            {/* The one line that used to be a row of chips.
                Chips under a human composer are an AI affordance worn by a human thread: they are
                phrased as questions, they sit where an assistant's prompt row sits, and every one
                of them posted to a person who answers in hours. So the offer is stated once, in
                words that name who is answering, and it opens the assistant instead of filling the
                box beside it. `openGlobalAssistant` carries the question the top rule would have
                offered — the panel fills its own composer and waits, because the send belongs to
                the reader and not to the link they pressed. */}
            <button
              className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-1 text-left text-xs font-medium text-muted-foreground transition-colors duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)] hover:text-[var(--consumer-accent-ink)] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              onClick={() => openGlobalAssistant("consumer", suggestions[0])}
              type="button"
            >
              Quick questions about your plan? Ask the assistant
              <ArrowRight aria-hidden className="size-3.5 shrink-0" />
            </button>
          </div>
        </section>

        {/* Below xl, everything that is not the conversation sits under it.
            W-2: this block used to come first, which gave a phone the desktop reading order —
            title, badge, workspace, assistant, and the conversation fourth, with the composer off
            the bottom of the screen behind the tab bar. On a chat view the conversation is the
            page, so on a phone it is the first thing under the title and everything else is
            beneath it or behind a control. At `xl` this block is hidden and the real rail is the
            `<aside>` below, so the order here costs desktop nothing. */}
        <div className="flex flex-col gap-4 xl:hidden">
          <Collapsible>
            {/* W-1: no rule and no padding under the label while it is closed.
                The trigger carried `border-b pb-3`, so a closed disclosure drew a label, a band of
                empty space and then a line under it — which reads as a container whose contents
                failed to load rather than as a section that is shut. The rule separates the
                disclosure from its content, so it belongs to the content and appears with it. */}
            <CollapsibleTrigger className="w-full justify-between text-xs font-semibold uppercase tracking-[0.11em] text-muted-foreground">
              Your workspace
              <ChevronDown
                aria-hidden
                className="size-4 shrink-0 transition-transform duration-[var(--acc-expand)] ease-[var(--acc-ease)] group-data-[panel-open]/collapsible-trigger:rotate-180"
              />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="border-t border-[var(--consumer-border)] pt-3">
                <WorkspaceSnapshot snapshot={snapshot} state={snapshotState} />
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>

        <aside className="hidden min-w-0 xl:block xl:border-l xl:border-[var(--consumer-border)] xl:pl-6">
          <div className="flex flex-col gap-5">
            <section aria-labelledby="team-chat-snapshot-heading">
              <h2
                className="pb-1 text-xs font-semibold uppercase tracking-[0.11em] text-muted-foreground"
                id="team-chat-snapshot-heading"
              >
                Your workspace
              </h2>
              <WorkspaceSnapshot snapshot={snapshot} state={snapshotState} />
            </section>
          </div>
        </aside>
      </div>

    </div>
  );
}
