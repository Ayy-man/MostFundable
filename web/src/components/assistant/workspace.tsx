"use client";

// The assistant workspace: one shell, two scopes (design brief §3–4).
//
// What it replaces, on both surfaces, is a panel that told the reader the product did not work —
// F-08. The operator side had a dark hero and a "Visual shell only. No assistant service or chat
// logic runs in this demo" panel over a disabled input; the platform-admin side had an inert shell
// whose composer and suggested question stayed disabled with text typed into them, measured at both
// viewports. Neither is here. What is here is a conversation that persists, because
// `/api/assistant/conversations*` (lane 1a) and `lib/kb/admin-answer.ts` (lane 4a) exist to make
// that possible in both scopes.
//
// **There is no token streaming and there must not be** — contract §0 R1. The pipeline runs
// candidate → compliance scan → citation-belongs check → supervisor, and only then has an answer,
// so streaming would put un-supervised text on somebody's screen and then retract it. What arrives
// instead is the stage the server is genuinely in, and `<AssistantThinking>` renders it. Nothing in
// this file advances a stage, and the only timer here counts elapsed seconds, which is a
// measurement rather than a claim about progress.
//
// **Every result is applied under a token.** A question takes fourteen to sixteen seconds; in that
// time a person can pick a different conversation from the rail, and the answer that arrives after
// they did belongs to the conversation they left. `tokenRef` is bumped by both asking and
// selecting, and any resolved promise whose token is stale is dropped rather than applied — which
// is cheaper than blocking the rail during an answer and honest in a way a disabled rail is not.
//
// **The composer is mounted once and moves.** In the empty centre it sits under the greeting, per
// the brief; in a conversation it is the pinned footer. It is the foundation's `<Composer>` in both
// places, with `sendOn="enter"`: contract §4 rules the modifier for the operator's *reply*
// composer, because those replies go to somebody's client and a stray Enter is a real harm. Nothing
// typed here reaches a person, so the reference behaviour — Enter sends — is the right one, and the
// hint line under the field says so either way.

import { History, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Composer } from "@/components/chat/composer";
import { PaneSkeletonThread, PaneState } from "@/components/chat/pane-state";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

import { AssistantAnswerBlock, AssistantQuestion } from "./answer";
import { answerView, questionText } from "./answer-view";
import {
  askQuestion,
  readConversation,
  readConversationList,
  removeConversation,
  startConversation,
} from "./client";
import { assistantErrorIsRetryable, assistantErrorMessage } from "./errors";
import { assistantGreeting } from "./greeting";
import { HistoryRail } from "./history-rail";
import { ReasoningTrace } from "./reasoning-trace";
import { scopeProfile } from "./scope";
import { ScopedAssistantStart } from "./scoped-start";
import { AssistantStart } from "./start";

import type { GreetingRead } from "./greeting";
import type {
  AssistantConversation,
  AssistantErrorCode,
  AssistantProgressEvent,
  AssistantScope,
  AssistantSource,
  AssistantTurn,
} from "@/lib/assistant/types";

export interface AssistantWorkspaceProps {
  readonly compact?: boolean;
  readonly scope: AssistantScope;
  /** The signed-in person's display name, for the greeting. Absent greets without a name. */
  readonly viewerName?: string | null;
  /** The durable read behind the greeting's second sentence. */
  readonly greeting: GreetingRead;
  /**
   * Opens the record a source chip names, using the opaque handle the surface passes back.
   *
   * Absent means the chips are plain labels rather than dead buttons: a control that cannot act is
   * absent, not disabled with a tooltip (contract §7). Wiring it is one prop at each mount.
   */
  readonly onOpenSource?: (source: AssistantSource) => void;
}

type ListState = "loading" | "ready" | "failed" | "disabled";
type DetailState = "idle" | "loading" | "ready" | "failed";

/**
 * A question turn built locally, standing in for the row the server wrote before it answered.
 *
 * `answerTurn` stores the question first, on purpose, so a question that produced no answer still
 * appears in the history with nothing under it. That row is not returned by the stream — only the
 * assistant turn is — and re-reading the whole conversation to collect it would put a second round
 * trip between the answer arriving and the answer appearing, after a wait that was already fifteen
 * seconds. So it is reconstructed from the text that was typed, which is exactly what was stored,
 * and the next durable read of this conversation replaces it with the row itself.
 */
function localQuestionTurn(question: string, at: string, sequence: number): AssistantTurn {
  return {
    body: question,
    bullets: [],
    createdAt: at,
    headline: question,
    id: `local-question-${sequence}`,
    role: "user",
    sources: [],
  };
}

function upsertConversation(
  rows: readonly AssistantConversation[],
  updated: AssistantConversation,
): readonly AssistantConversation[] {
  const without = rows.filter((row) => row.id !== updated.id);
  return [updated, ...without];
}

export function AssistantWorkspace({
  compact = false,
  greeting,
  onOpenSource,
  scope,
  viewerName,
}: AssistantWorkspaceProps) {
  const profile = scopeProfile(scope);

  const [listState, setListState] = useState<ListState>("loading");
  const [listGeneration, setListGeneration] = useState(0);
  const [conversations, setConversations] = useState<readonly AssistantConversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [turns, setTurns] = useState<readonly AssistantTurn[]>([]);
  const [detailState, setDetailState] = useState<DetailState>("idle");
  const [asking, setAsking] = useState<{ question: string; startedAt: number } | null>(null);
  const [steps, setSteps] = useState<readonly AssistantProgressEvent[]>([]);
  const [reasoningByTurn, setReasoningByTurn] = useState<Readonly<Record<string, { readonly seconds: number; readonly steps: readonly AssistantProgressEvent[] }>>>({});
  const [failure, setFailure] = useState<{ code: AssistantErrorCode; question: string } | null>(null);
  const [search, setSearch] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Bumped by anything that changes which conversation the pane is showing. A promise that
  // resolves against a stale token is dropped.
  const tokenRef = useRef(0);
  const sequenceRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);

  // The read is the only thing this effect does. `listState` is moved to `loading` by whoever asks
  // for the read — the initial state, or the retry control — because a `setState` in an effect body
  // is a cascading render and the lint rule that says so is right.
  useEffect(() => {
    let active = true;
    void readConversationList(scope).then((read) => {
      if (!active) return;
      if (read.status === "ready") {
        setConversations(read.conversations);
        setListState("ready");
        return;
      }
      setListState(read.status);
    });
    return () => {
      active = false;
    };
  }, [scope, listGeneration]);

  // New content arrives at the bottom of a pane that is already scrolled there most of the time.
  //
  // Only once there is content, though. Scrolling an empty pane to its own bottom is what it looks
  // like when a phone opens this view already past the greeting: at 390px the start screen is
  // taller than the pane, so "scroll to the end" put the reader below the sentence saying what the
  // assistant reads. Measured at 390x844 before this guard, not reasoned about.
  useEffect(() => {
    const node = scrollRef.current;
    if (node === null) return;
    if (turns.length === 0 && asking === null && failure === null) return;
    node.scrollTop = node.scrollHeight;
  }, [turns.length, asking, failure]);

  const startNew = useCallback(() => {
    tokenRef.current += 1;
    setActiveId(null);
    setTurns([]);
    setDetailState("idle");
    setAsking(null);
    setSteps([]);
    setReasoningByTurn({});
    setFailure(null);
    setHistoryOpen(false);
  }, []);

  const select = useCallback(async (conversationId: string) => {
    tokenRef.current += 1;
    const token = tokenRef.current;
    setActiveId(conversationId);
    setTurns([]);
    setAsking(null);
    setSteps([]);
    setReasoningByTurn({});
    setFailure(null);
    setDetailState("loading");
    setHistoryOpen(false);

    const read = await readConversation(conversationId);
    if (tokenRef.current !== token) return;
    if (read.status === "ready") {
      setTurns(read.turns);
      setConversations((rows) => upsertConversation(rows, read.conversation));
      setDetailState("ready");
      return;
    }
    if (read.status === "missing") {
      // Gone, or never this profile's — the route answers those identically so the response cannot
      // be used to probe. Either way the rail should stop offering it.
      setConversations((rows) => rows.filter((row) => row.id !== conversationId));
      setActiveId(null);
      setDetailState("idle");
      return;
    }
    setDetailState("failed");
  }, []);

  const ask = useCallback(
    async (raw: string) => {
      const question = raw.trim();
      if (question.length === 0 || asking !== null) return;

      tokenRef.current += 1;
      const token = tokenRef.current;
      setFailure(null);
      setSteps([]);
      const startedAt = Date.now();
      const observed: AssistantProgressEvent[] = [];
      setAsking({ question, startedAt });

      let conversationId = activeId;
      if (conversationId === null) {
        const opened = await startConversation(scope);
        if (tokenRef.current !== token) return;
        if (opened.status === "failed") {
          // The server's own code, not a generic one: a signed-out session and an unreachable
          // server both fail here and they do not deserve the same sentence.
          setAsking(null);
          setFailure({ code: opened.code, question });
          return;
        }
        conversationId = opened.conversation.id;
        setActiveId(opened.conversation.id);
        setConversations((rows) => upsertConversation(rows, opened.conversation));
        setDetailState("ready");
      }

      const outcome = await askQuestion(conversationId, question, (next) => {
        if (tokenRef.current !== token) return;
        observed.push(next);
        setSteps([...observed]);
      });
      if (tokenRef.current !== token) return;

      setAsking(null);
      setSteps([]);
      if (outcome.status === "failed") {
        setFailure({ code: outcome.code, question });
        return;
      }
      sequenceRef.current += 1;
      setReasoningByTurn((current) => ({
        ...current,
        [outcome.turn.id]: {
          seconds: Math.max(1, Math.round((Date.now() - startedAt) / 1000)),
          steps: [...observed],
        },
      }));
      setTurns((rows) => [
        ...rows,
        localQuestionTurn(question, outcome.turn.createdAt, sequenceRef.current),
        outcome.turn,
      ]);
      setConversations((rows) => upsertConversation(rows, outcome.conversation));
    },
    [activeId, asking, scope],
  );

  const remove = useCallback(
    async (conversationId: string) => {
      setDeletingId(conversationId);
      const removed = await removeConversation(conversationId);
      setDeletingId(null);
      if (!removed) {
        setListState("failed");
        return;
      }
      setConversations((rows) => rows.filter((row) => row.id !== conversationId));
      setActiveId((current) => {
        if (current !== conversationId) return current;
        tokenRef.current += 1;
        setTurns([]);
        setDetailState("idle");
        setAsking(null);
        setSteps([]);
        setReasoningByTurn({});
        setFailure(null);
        return null;
      });
    },
    [],
  );

  const composer = (
    <div ref={composerRef}>
      <Composer
        busy={asking !== null}
        label={profile.composerLabel}
        onSend={(body) => {
          void ask(body);
          // Accepted: the question moves out of the field and into the conversation, where a
          // failure is reported against it with a retry. Returning `false` would leave it in the
          // box and put the same words on screen twice.
          return true;
        }}
        placeholder={profile.placeholder}
        sendOn="enter"
        threadRef={`assistant:${scope}:${activeId ?? "new"}`}
      />
    </div>
  );

  const rail = (
    <HistoryRail
      activeId={activeId}
      conversations={conversations}
      deletingId={deletingId}
      failed={listState === "failed"}
      loading={listState === "loading"}
      now={new Date()}
      onDelete={(id) => void remove(id)}
      onNew={startNew}
      onRetry={() => {
        setListState("loading");
        setListGeneration((generation) => generation + 1);
      }}
      onSearch={setSearch}
      onSelect={(id) => void select(id)}
      search={search}
    />
  );

  // Deliberately not "a conversation is selected". A selected conversation with nothing in it —
  // one whose only question never produced a turn — would otherwise render as a pane holding a
  // composer and nothing else, which is the blank card contract §4 forbids. Falling back to the
  // start screen keeps the conversation active underneath: the next question lands in it.
  const started =
    turns.length > 0
    || asking !== null
    || failure !== null
    || detailState === "loading"
    || detailState === "failed";

  // W-11: an empty rail was a 15rem column holding one small card, a quarter of the width at 1440
  // doing nothing with it. The rail itself is right — questions grouped by day is the model — but
  // it earns the column only once it has rows to put in it. Until then the centre takes the width.
  //
  // It is also present the moment a conversation is open, which is what stops the column arriving
  // underneath a reader mid-answer: the transition happens when somebody presses send, alongside
  // the start screen giving way to the transcript, rather than a second later when the row lands.
  const hasHistoryAccess = conversations.length > 0 || listState === "failed" || started;
  const showRail = !compact && hasHistoryAccess;

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col overflow-hidden bg-[var(--card)]",
        compact
          ? "h-full rounded-none border-0 shadow-none"
          : "h-[calc(100dvh-var(--demo-banner-height,2.75rem)-15rem)] min-h-[30rem] rounded-xl border border-[var(--border)] shadow-[var(--surface-shadow)] lg:h-[calc(100dvh-var(--demo-banner-height,2.75rem)-12rem)] lg:min-h-[34rem] lg:flex-row",
      )}
    >
      {listState === "disabled" ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <PaneState
            description={profile.disabled.description}
            status="disabled"
            title={profile.disabled.title}
          />
        </div>
      ) : (
        <>
          {showRail ? (
            <aside className="hidden w-[15rem] shrink-0 border-r border-[var(--border)] bg-[var(--sidebar)] p-3 lg:flex lg:flex-col xl:w-[16.25rem]">
              {rail}
            </aside>
          ) : null}

          <section className="flex min-h-0 min-w-0 flex-1 flex-col">
            {/* The rail is a screen of its own at 390px, reached from here, so nothing has to
                scroll sideways to find it. Absent for the same reason the column is: with nothing
                stored and nothing open there is no history to reach and no chat to start away
                from, and two controls that do nothing are worse than no strip at all. */}
            {hasHistoryAccess ? (
              <div className={cn("flex items-center gap-2 border-b border-[var(--border)] px-3 py-2", compact ? undefined : "lg:hidden")}>
                <Button
                  className="min-h-11"
                  onClick={() => setHistoryOpen(true)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <History aria-hidden className="size-3.5" />
                  History
                </Button>
                <Button className="ml-auto min-h-11" onClick={startNew} size="sm" type="button">
                  <Plus aria-hidden className="size-3.5" />
                  New chat
                </Button>
              </div>
            ) : null}

            {/* The empty centre sits in the middle of the space it has rather than at the top of
                it: with the rail gone until there is history, a block pinned to the top of a
                1440-wide pane reads as a page that has not finished loading. `m-auto` centres it
                when it fits and computes to nothing when it does not, so the phone still scrolls
                from the top. */}
            <div
              className={cn(
                "min-h-0 flex-1 overflow-y-auto px-3 sm:px-5",
                started ? undefined : "flex flex-col",
              )}
              ref={scrollRef}
            >
              {started ? (
                <div className="mx-auto w-full max-w-[44rem] space-y-6 py-5">
                  {detailState === "loading" ? (
                    <PaneState
                      label="Loading this conversation"
                      skeleton={<PaneSkeletonThread messages={3} />}
                      status="loading"
                    />
                  ) : detailState === "failed" ? (
                    <PaneState
                      action={{
                        label: "Try again",
                        onAct: () => {
                          if (activeId !== null) void select(activeId);
                        },
                      }}
                      description="The questions and answers in it are still stored."
                      status="error"
                      title="This conversation could not be opened"
                    />
                  ) : null}

                  {turns.map((turn, index) => (
                    <div
                      className={cn(
                        turn.role === "user" && index > 0
                          ? "border-t border-[var(--border)] pt-6"
                          : undefined,
                      )}
                      key={turn.id}
                    >
                      {turn.role === "user" ? (
                        <AssistantQuestion text={questionText(turn)} />
                      ) : (
                        <div className="space-y-3">
                          <AssistantAnswerBlock
                            answer={answerView(turn, scope)}
                            onOpenSource={onOpenSource}
                          />
                          {reasoningByTurn[turn.id] ? (
                            <ReasoningTrace
                              active={false}
                              ground="light"
                              seconds={reasoningByTurn[turn.id].seconds}
                              steps={reasoningByTurn[turn.id].steps}
                            />
                          ) : null}
                        </div>
                      )}
                    </div>
                  ))}

                  {asking === null ? null : (
                    <div className={cn(turns.length > 0 ? "space-y-6 border-t border-[var(--border)] pt-6" : "space-y-6")}>
                      <AssistantQuestion text={asking.question} />
                      <ReasoningTrace active ground="light" startedAt={asking.startedAt} steps={steps} />
                    </div>
                  )}

                  {/* Announced once per answer, because the orb's own `role="status"` disappears
                      with the last stage and a screen-reader user would otherwise be told the
                      machine was working and never told it had finished. Keyed on the turn, so it
                      mounts once rather than repeating on every render. */}
                  {asking === null && failure === null && turns.at(-1)?.role === "assistant" ? (
                    <span className="sr-only" key={`arrived-${turns.at(-1)?.id}`} role="status">
                      The answer is ready.
                    </span>
                  ) : null}

                  {failure === null ? null : (
                    <div className={cn(turns.length > 0 ? "space-y-4 border-t border-[var(--border)] pt-6" : "space-y-4")}>
                      <AssistantQuestion text={failure.question} />
                      {assistantErrorIsRetryable(failure.code) ? (
                        <PaneState
                          action={{ label: "Ask again", onAct: () => void ask(failure.question) }}
                          description={assistantErrorMessage(failure.code, scope)}
                          status="error"
                          title="No answer came back"
                        />
                      ) : (
                        <PaneState
                          description={assistantErrorMessage(failure.code, scope)}
                          status="disabled"
                          title="No answer came back"
                        />
                      )}
                    </div>
                  )}
                </div>
              ) : (
                compact ? (
                  <ScopedAssistantStart
                    busy={asking !== null}
                    greeting={assistantGreeting({ now: new Date(), read: greeting, viewerName })}
                    greetingState={
                      greeting.status === "loading"
                        ? "loading"
                        : greeting.status === "unavailable"
                          ? "unavailable"
                          : "ready"
                    }
                    onAsk={(question) => void ask(question)}
                    profile={profile}
                  />
                ) : (
                  <AssistantStart
                    busy={asking !== null}
                    composer={composer}
                    greeting={assistantGreeting({ now: new Date(), read: greeting, viewerName })}
                    greetingState={
                      greeting.status === "loading"
                        ? "loading"
                        : greeting.status === "unavailable"
                          ? "unavailable"
                          : "ready"
                    }
                    onAsk={(question) => void ask(question)}
                    profile={profile}
                  />
                )
              )}
            </div>

            {/*
              The bottom padding reserves a strip for the console's own support launcher, which is
              fixed to the bottom-right of the viewport and lands on whatever this footer puts
              there — here the send control and the hint line under it. Reserving the strip is the
              only fix available from inside the panel, and it is the same one the Inbox's
              conversation footer takes; the launcher belongs to the surface.

              It is reserved at every width rather than below `xl` alone, which is where that other
              footer stops. Measured at 1440x900 with the strip released above `xl`: the launcher
              occupies 1256-1424 x 836-884 and the hint line ends at 1322 x 891, so it is covered
              on the widest viewport too. This footer's content runs to the right edge of a
              44rem column at every size, so the collision does not stop when the screen gets big.
            */}
            {started || compact ? (
              <div className={cn("border-t border-[var(--border)] bg-[var(--card)] px-3 py-3 sm:px-5", compact ? "pb-3" : "pb-20")}>
                <div className="mx-auto w-full max-w-[44rem]">{composer}</div>
              </div>
            ) : null}
          </section>

          <Sheet onOpenChange={setHistoryOpen} open={historyOpen}>
            <SheetContent className="w-[19rem] p-3 lg:hidden" side="left">
              <SheetHeader className="p-0">
                <SheetTitle className="text-sm font-semibold">Your conversations</SheetTitle>
              </SheetHeader>
              {/* Built only while the sheet is open: the desktop rail is in the tree too, and two
                  live copies would put two controls with the same accessible name on the page. */}
              <div className="min-h-0 flex-1">{historyOpen ? rail : null}</div>
            </SheetContent>
          </Sheet>
        </>
      )}
    </div>
  );
}
