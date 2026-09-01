"use client";

import { FileText, Sparkles } from "lucide-react";

import { Composer } from "@/components/chat/composer";
import { PaneSkeletonBar, PaneState } from "@/components/chat/pane-state";
import { assistantAnswerView } from "@/components/consumer/team-chat/answer-view";
import { consumerAssistantStatusIsRetryable, useConsumerAssistant, type AssistantTurn } from "@/components/consumer/team-chat/use-assistant";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { GlobalAssistantCompanion, useAssistantOpenSeed } from "./global-companion";
import { ReasoningTrace } from "./reasoning-trace";

import type { AssistantPageContext } from "./page-context";

function ConsumerTurn({ onRetry, turn }: { readonly onRetry?: () => void; readonly turn: AssistantTurn }) {
  if (turn.role === "reader") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[88%] rounded-xl border border-[var(--surface-border)] bg-[var(--surface-raised)] px-4 py-3 text-sm leading-6 text-foreground">
          {turn.body}
        </p>
      </div>
    );
  }
  const { headline, bullets } = assistantAnswerView(turn);
  return (
    <article className="space-y-3">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <span className="grid size-6 place-items-center rounded-md bg-[var(--assistant-ground)]">
          <Sparkles aria-hidden className="size-3.5 text-[var(--accent-on-dark)]" />
        </span>
        AI assistant
      </div>
      <p className={cn("text-sm leading-6", turn.status === "unavailable" ? "text-muted-foreground" : "text-foreground")}>{headline}</p>
      {bullets.length ? (
        <ul className="space-y-2 pl-1">
          {bullets.map((bullet, index) => (
            <li className="flex gap-2.5 text-sm leading-6 text-foreground" key={`${index}-${bullet}`}>
              <span aria-hidden className="mt-2.5 size-1.5 shrink-0 rounded-full bg-[var(--success)]" />
              <span>{bullet}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {turn.citations.length ? (
        <div className="border-t border-[var(--border)] pt-3">
          <p className="mb-2 text-[0.65rem] font-medium uppercase tracking-[0.12em] text-muted-foreground">Sources</p>
          <div className="flex flex-wrap gap-1.5">
            {turn.citations.map((citation, index) => (
              <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-raised)] px-2.5 py-1 text-xs text-[var(--secondary-foreground)]" key={`${citation.label}-${index}`}>
                <FileText aria-hidden className="size-3 text-[var(--success)]" />
                <span className="truncate">{citation.label}</span>
              </span>
            ))}
          </div>
        </div>
      ) : null}
      <ReasoningTrace active={false} ground="light" seconds={turn.reasoning.seconds} steps={turn.reasoning.steps} />
      {consumerAssistantStatusIsRetryable(turn.status) && onRetry ? (
        <Button onClick={onRetry} size="sm" type="button" variant="outline">Try again</Button>
      ) : null}
    </article>
  );
}

export function ConsumerAssistantCompanion({ context }: { readonly context: AssistantPageContext }) {
  const assistant = useConsumerAssistant(true);
  const empty = assistant.bootstrap === "enabled" && assistant.turns.length === 0 && !assistant.asking;
  // A question carried in by whoever opened the panel — today the Team Chat's assistant line. It
  // fills the box and focuses it; `<Composer>` has never sent on an insert, so nothing here can.
  const seed = useAssistantOpenSeed("consumer");
  const composer = (
    <Composer
      busy={assistant.asking}
      ground="light"
      insert={seed}
      label="Ask the AI assistant"
      lockedReason={assistant.bootstrap === "enabled" || assistant.bootstrap === "loading" ? null : "The assistant is not available yet."}
      onSend={(body) => assistant.ask(body, context)}
      placeholder={`Ask about ${context.label.toLowerCase()}`}
      sendOn="enter"
      threadRef="global-consumer-assistant"
    />
  );

  return (
    <GlobalAssistantCompanion
      composer={composer}
      context={context}
      empty={empty}
      onSuggestion={(question) => void assistant.ask(question, context)}
      scope="consumer"
    >
      <div className="space-y-6">
        {assistant.bootstrap === "loading" ? (
          <PaneState
            className="border-[var(--border)] bg-[var(--surface-raised)]"
            label="Opening the assistant"
            skeleton={<div className="space-y-3">{["w-2/3", "w-full", "w-4/5"].map((width) => <PaneSkeletonBar className={width} key={width} />)}</div>}
            status="loading"
          />
        ) : assistant.bootstrap === "disabled" || assistant.bootstrap === "unasked" ? (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4 text-sm leading-6 text-muted-foreground" role="status">
            The assistant is not available yet. Team Chat is still open.
          </div>
        ) : null}
        {assistant.turns.map((turn, index) => {
          const prior = index > 0 ? assistant.turns[index - 1] : undefined;
          const onRetry = turn.role === "assistant" && prior?.role === "reader"
            ? () => void assistant.ask(prior.body, context)
            : undefined;
          return <ConsumerTurn key={turn.ref} onRetry={onRetry} turn={turn} />;
        })}
        {assistant.asking ? (
          <ReasoningTrace active ground="light" startedAt={assistant.startedAt} steps={assistant.progress} />
        ) : null}
      </div>
    </GlobalAssistantCompanion>
  );
}
