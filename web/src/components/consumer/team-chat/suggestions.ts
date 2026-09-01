/**
 * The suggested questions, derived from the client's own durable snapshot.
 *
 * This module exists because of a specific shipped defect. The old chip row was a literal array of
 * four strings, one of which read "What should I finish before the Aug 13 refresh?" — a date that
 * came from a fixture and rendered on the live path as well, so a signed-in client with no
 * scheduled refresh was handed a deadline nothing in the database held. The fix that shipped at the
 * time deleted that one chip and left the other three as literals, which closes the symptom and
 * leaves the shape: a row of suggestions that cannot be wrong because it cannot change.
 *
 * So the rules below are the whole of it, and three properties hold by construction rather than by
 * review:
 *
 *   **Every rule states which field it read.** `basis` is a key of `ConsumerClientSnapshot`, and
 *   `suggestions.test.ts` checks that against the type's own keys rather than a list, so a rule
 *   whose basis stops existing fails rather than quietly grounding itself on nothing.
 *
 *   **No chip can carry a figure.** The text is a constant per rule and the snapshot values are
 *   never interpolated into it — there is no template anywhere in this file. The test asserts no
 *   rule's text contains a digit, which is the mechanical form of "no chip may contain a date or a
 *   figure that did not come from a durable read": if it can't contain one at all, it can't contain
 *   a wrong one.
 *
 *   **No snapshot means no chips.** `suggestionsFor(null)` is empty. A suggestion is an offer made
 *   on the strength of what we know about somebody's account, and when the read has not answered we
 *   do not know anything — offering the row anyway is how the fixture leaked into the live path in
 *   the first place.
 *
 * The three questions Drop 7 shipped are kept where the state that justifies them holds, because
 * they are client-facing copy from a frozen contract and rewording one is a change order. What
 * changed is that each now has a reason to be on screen.
 */

import type { ConsumerClientSnapshot } from "./types";

/** How many fit the row without wrapping into a second line at 390px. */
export const MAX_SUGGESTIONS = 3;

export interface SuggestionRule {
  /** Which snapshot field justifies the offer. Checked against the type's keys by the test. */
  readonly basis: keyof ConsumerClientSnapshot;
  /** The question, as it goes into the composer. A constant — never built from a value. */
  readonly text: string;
  readonly when: (snapshot: ConsumerClientSnapshot) => boolean;
}

/**
 * In priority order, most urgent state first, capped at `MAX_SUGGESTIONS`.
 *
 * Ordering is the only place a judgement lives here. A client with a run in flight is asking a
 * different question from a client sitting on four open actions, and putting the pending-run chip
 * first is the same call the Today view makes about which state dominates.
 */
export const SUGGESTION_RULES: readonly SuggestionRule[] = [
  {
    basis: "analysisPending",
    text: "When will my first review be ready?",
    when: (snapshot) => snapshot.analysisPending !== null && snapshot.analysisAt === null,
  },
  {
    basis: "analysisPending",
    text: "What happens while my report is being reviewed?",
    when: (snapshot) => snapshot.analysisPending !== null && snapshot.analysisAt !== null,
  },
  {
    basis: "monitoring",
    text: "Why is my credit monitoring paused?",
    when: (snapshot) => snapshot.monitoring === "paused",
  },
  {
    basis: "analysisAt",
    text: "What happens after my first review?",
    when: (snapshot) => snapshot.analysisAt === null && snapshot.analysisPending === null,
  },
  {
    // Drop 7's own wording, now offered only where a snapshot exists to have changed.
    basis: "analysisAt",
    text: "What changed in my last snapshot?",
    when: (snapshot) => snapshot.analysisAt !== null,
  },
  {
    // Drop 7's own wording, now offered only where something is actually open.
    basis: "openActionCount",
    text: "How does a reported action get verified?",
    when: (snapshot) => snapshot.openActionCount !== null && snapshot.openActionCount > 0,
  },
  {
    // The chip that replaces the one that named a date. The refresh is named, the date is not:
    // the date lives in the context rail beside its own provenance, where it is a fact rather than
    // a deadline pressed into a question.
    basis: "nextRefreshAt",
    text: "What should I finish before my next credit refresh?",
    when: (snapshot) => snapshot.nextRefreshAt !== null,
  },
  {
    // Drop 7's own wording. Its basis is the stage, which is the field that says this client has a
    // workspace with a document vault behind it at all.
    basis: "stageLabel",
    text: "Which documents are still missing?",
    when: (snapshot) => snapshot.stageLabel.length > 0,
  },
];

/**
 * The questions to offer, or none.
 *
 * `null` is the read that has not answered — loading, failed, or a workspace with no client row.
 * All three mean the same thing to this function: nothing is known, so nothing is suggested.
 */
export function suggestionsFor(snapshot: ConsumerClientSnapshot | null): readonly string[] {
  if (snapshot === null) return [];
  const offered: string[] = [];
  for (const rule of SUGGESTION_RULES) {
    if (offered.length === MAX_SUGGESTIONS) break;
    if (rule.when(snapshot) && !offered.includes(rule.text)) offered.push(rule.text);
  }
  return offered;
}
