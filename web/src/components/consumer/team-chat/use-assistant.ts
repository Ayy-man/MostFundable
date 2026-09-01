"use client";

/**
 * The consumer assistant's state: whether it exists, what has been asked, and what came back.
 *
 * Two things about this are worth stating up front, because both are places where the brief
 * describes a capability the tree does not have and pretending otherwise would be the interface
 * lying.
 *
 * **The consumer route streams observations, not answer tokens.** `/api/kb/consumer` remains the
 * one supervised answer path, but its response is NDJSON: retrieval starts, selected article
 * titles, candidate composition, and supervisor review are emitted by the work itself. The final
 * answer still arrives only after every existing gate has passed.
 *
 * That wait is long and the design has to hold it: measured on production, the consumer POST took
 * 14,071ms, and the range across samples is roughly 5-17 seconds. It is inherent — candidate,
 * compliance scan, citation-belongs check, supervisor review, two model round trips before a word
 * is allowed on screen — and R1 rules out streaming precisely so nothing unsupervised is shown.
 *
 * **History is this visit's, and the panel says so.** There is no durable store for a consumer's
 * assistant turns for the same reason there is no consumer scope. Rather than invent one in
 * `localStorage` — where an answer about somebody's funding would outlive their session on a shared
 * machine — the turns live in this hook and the panel states plainly that they are not kept.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { assistantContextPayload, type AssistantPageContext } from "@/components/assistant/page-context";
import { readKbStreamLines } from "@/lib/kb/stream";

import type { KbProgressEvent } from "@/lib/kb/progress";

/** What a citation may show. `label` is the only field ever printed; the rest are grounding keys. */
/**
 * A source, as this panel is allowed to hold it.
 *
 * One field, and that is the point rather than an omission. The route's citation carries an id, a
 * title and a url as well; keeping them here would mean rail 3 is held by remembering not to print
 * them, and F-06 by remembering not to link them. Narrowing the object makes both unrepresentable —
 * the same argument `ConsumerClientSnapshot` makes about the context rail.
 */
export interface AssistantCitation {
  readonly label: string;
}

/** `ConsumerKbResult`'s three statuses, mirrored so the panel can branch on them exhaustively. */
export type AssistantAnswerStatus = "answered" | "insufficient_grounding" | "unavailable" | "no_matching_records" | "out_of_scope" | "provider_unreachable" | "answer_malformed" | "data_unreachable" | "result_too_large" | "refused_by_policy";

/**
 * `answer_malformed` is retryable and `result_too_large` is not, and the two used to be the same
 * status. A candidate the parser refused for its shape can come back well formed on the next
 * attempt, so offering the retry is honest; a read that overflowed will overflow again, so offering
 * it would be advice that cannot work.
 */
export function consumerAssistantStatusIsRetryable(status: AssistantAnswerStatus): boolean {
  return status === "provider_unreachable" || status === "answer_malformed" || status === "data_unreachable" || status === "unavailable";
}

export type AssistantTurn =
  | { readonly ref: string; readonly role: "reader"; readonly body: string }
  | {
      readonly ref: string;
      readonly role: "assistant";
      readonly body: string;
      readonly status: AssistantAnswerStatus;
      readonly citations: readonly AssistantCitation[];
      readonly reasoning: { readonly seconds: number; readonly steps: readonly KbProgressEvent[] };
    };

/**
 * What the server has said about the assistant, and whether it was asked at all.
 *
 * `unasked` and `disabled` are different facts and the difference decides whether a control is
 * offered. `disabled` is the server answering no — the flag is off for this workspace — and the way
 * into the assistant is not rendered at all, because a control the server has refused is a dead
 * control and contract §7 says an absent one is better. `unasked` is the demo shell, where nothing
 * was asked because there is no session to resolve; the way in stays, and the panel says plainly
 * that nothing here is connected. Collapsing the two either hides the assistant from the client
 * demo or offers a signed-in client a door that opens onto nothing.
 */
export type AssistantBootstrap = "unasked" | "loading" | "enabled" | "disabled";

export interface ConsumerAssistant {
  readonly bootstrap: AssistantBootstrap;
  readonly turns: readonly AssistantTurn[];
  /** True while the answer request is genuinely out. The only thing the orb may be bound to. */
  readonly asking: boolean;
  readonly progress: readonly KbProgressEvent[];
  readonly startedAt: number | null;
  readonly ask: (question: string, context?: AssistantPageContext) => Promise<boolean>;
}

const IDENTITY = "AI assistant";

/**
 * The one route this assistant speaks to.
 *
 * A constant rather than two string literals, because the fact worth holding is that the route
 * which said the assistant was enabled is the route it then asks — an assistant bootstrapped
 * against one scope and asking another is enabled by a check that does not cover it. Written once,
 * that is true by construction rather than by remembering.
 */
export const CONSUMER_KB_ROUTE = "/api/kb/consumer";

/**
 * The body of a question, as JSON.
 *
 * Separate from the hook so it can be driven: the route resolves the client, the org and the
 * enrollment from the signed-in session, so anything this side asserted about who is asking would
 * be either ignored or a claim the browser is not entitled to make.
 */
export function askBody(question: string, context?: AssistantPageContext): string {
  return JSON.stringify(context ? { context: assistantContextPayload(context), question } : { question });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Exported for the wire-shape regression. A status this parser does not know
 * becomes `unavailable`, so a status added to the union and forgotten here is
 * silently downgraded to a generic failure on the consumer panel — invisible
 * from the type checker and invisible from the surface.
 */
export function parseStatus(value: unknown): AssistantAnswerStatus {
  return value === "answered"
    || value === "insufficient_grounding"
    || value === "no_matching_records"
    || value === "out_of_scope"
    || value === "provider_unreachable"
    || value === "answer_malformed"
    || value === "data_unreachable"
    || value === "result_too_large"
    || value === "refused_by_policy"
    ? value
    : "unavailable";
}

/**
 * Citations, taken only where every field the render path needs is present.
 *
 * `label` is required rather than defaulted from `title`. `lib/kb/chat-driver.ts` stamps the human
 * label where the citation is built, matching each model citation back to its grounding document
 * and refusing anything uuid-shaped, so a label that is missing means the match failed — and the
 * fallback that looks helpful, printing `title` instead, would print the field that guard exists to
 * keep off the screen.
 */
export function parseCitations(value: unknown): AssistantCitation[] {
  if (!Array.isArray(value)) return [];
  const citations: AssistantCitation[] = [];
  for (const row of value) {
    const citation = asRecord(row);
    if (citation === null) continue;
    const { label } = citation;
    if (typeof label !== "string" || label.trim().length === 0) continue;
    citations.push({ label });
  }
  return citations;
}

/**
 * What the panel is told, given whether anything asked and what came back.
 *
 * A read that never happened is not a read in flight. `active` is false in the demo shell, where
 * there is no session for the route to resolve, and reporting `loading` there leaves a skeleton
 * spinning for as long as the panel is open — the same defect the context rail had, arriving
 * through an effect that returns early rather than through a chain that misses a case.
 *
 * Derived rather than assigned, so nothing sets state from a value it was handed, and separate from
 * the hook so it can be driven.
 */
export function bootstrapFor(active: boolean, read: AssistantBootstrap): AssistantBootstrap {
  return active ? read : "unasked";
}

export function useConsumerAssistant(active: boolean): ConsumerAssistant {
  const [read, setRead] = useState<AssistantBootstrap>("loading");
  const bootstrap = bootstrapFor(active, read);
  const [turns, setTurns] = useState<readonly AssistantTurn[]>([]);
  const [asking, setAsking] = useState(false);
  const [progress, setProgress] = useState<readonly KbProgressEvent[]>([]);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    let live = true;
    void fetch(CONSUMER_KB_ROUTE, { cache: "no-store", credentials: "same-origin" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: unknown) => {
        if (!live) return;
        setRead(asRecord(body)?.enabled === true ? "enabled" : "disabled");
      })
      .catch(() => {
        // A failed bootstrap is `disabled`, not `enabled`. The alternative offers a control that
        // can only answer 404, and a dead control is worse than an absent one (contract §7).
        if (live) setRead("disabled");
      });
    return () => {
      live = false;
    };
  }, [active]);

  const ask = useCallback(async (question: string, context?: AssistantPageContext): Promise<boolean> => {
    const value = question.trim();
    if (value.length === 0) return false;
    const started = Date.now();
    const observed: KbProgressEvent[] = [];
    setTurns((current) => [
      ...current,
      { body: value, ref: `ask-${current.length}`, role: "reader" },
    ]);
    setAsking(true);
    setProgress([]);
    setStartedAt(started);
    try {
      const response = await fetch(CONSUMER_KB_ROUTE, {
        body: askBody(value, context),
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      let payload: unknown = null;
      if (response.ok && response.body !== null) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let carry = "";
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          const read = readKbStreamLines(decoder.decode(next.value, { stream: true }), carry);
          carry = read.carry;
          for (const event of read.events) {
            if ("progress" in event) {
              observed.push(event.progress);
              setProgress([...observed]);
            } else {
              payload = event.result;
            }
          }
        }
      } else {
        payload = await response.json().catch(() => null);
      }
      const body = asRecord(payload);
      if (!mounted.current) return true;
      // The answer text is the server's, on every branch including the failures. Writing our own
      // sentence for an unavailable answer would put a second vocabulary in front of the person
      // for the same condition the route already has words for.
      setTurns((current) => [
        ...current,
        {
          body: typeof body?.answer === "string" ? body.answer : UNAVAILABLE_BODY,
          citations: parseCitations(body?.citations),
          ref: `answer-${current.length}`,
          role: "assistant",
          status: parseStatus(body?.status),
          reasoning: {
            seconds: Math.max(1, Math.round((Date.now() - started) / 1000)),
            steps: observed,
          },
        },
      ]);
    } catch {
      if (!mounted.current) return true;
      setTurns((current) => [
        ...current,
        {
          body: UNAVAILABLE_BODY,
          citations: [],
          ref: `answer-${current.length}`,
          role: "assistant",
          status: "unavailable",
          reasoning: {
            seconds: Math.max(1, Math.round((Date.now() - started) / 1000)),
            steps: observed,
          },
        },
      ]);
    } finally {
      if (mounted.current) {
        setAsking(false);
        setStartedAt(null);
      }
    }
    return true;
  }, []);

  return { ask, asking, bootstrap, progress, startedAt, turns };
}

/** The one sentence written here rather than by the route: what a dead transport looks like. */
const UNAVAILABLE_BODY = "A grounded answer is unavailable right now.";

export { IDENTITY as ASSISTANT_IDENTITY };
