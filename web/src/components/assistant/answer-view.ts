// Everything an answer renders, decided in one place.
//
// The component below this takes an `AssistantAnswerView` and prints its fields. It computes
// nothing — no splitting a body into a headline and bullets, no deciding whether a footer applies,
// no reaching past a source's stamped label for a "better" field. That is the point of the type
// existing at all, and it closes two findings at once.
//
// **F-09.** The parts arrive as parts. `AssistantTurn` already carries `headline` and `bullets`,
// decoded at the repository's row boundary from the canonical encoding `lib/kb/answer-body.ts`
// writes, so nothing here parses prose. A view built from `body` would be guessing, and a guess
// renders wrong the first time a model writes a paragraph where bullets were expected.
//
// **The not-advice line.** `assistantFooterForScope` is a constant per scope, deliberately not
// stored on the turn — it is product copy, and a copy of it in every row would be a literal
// duplicated into the database as well as the one thing `decodeAnswerBody` cannot separate back out
// of a body whose answer had no bullets. The consequence is that it appears **only if a render site
// asks for it**, and nothing fails if one forgets: the compliance line silently stops appearing.
// So it is a required field on this view rather than an optional call at the render site, and
// `answer-view.test.ts` asserts that every field of a built view reaches the component's source.

import { assistantFooterForScope } from "@/lib/assistant/types";

import type { AssistantScope, AssistantSource, AssistantTurn } from "@/lib/assistant/types";

export interface AssistantAnswerView {
  /** The answer's opening sentence. Always present on an assistant turn. */
  readonly headline: string;
  /** The supporting points. May be empty — plenty of answers are one sentence. */
  readonly bullets: readonly string[];
  /** Source chips, human labels only. May be empty; a chip that could not be named was dropped. */
  readonly sources: readonly AssistantSource[];
  /** The standing line for this scope, or null where the scope has none. */
  readonly footer: string | null;
}

export function answerView(turn: AssistantTurn, scope: AssistantScope): AssistantAnswerView {
  return {
    bullets: turn.bullets,
    footer: assistantFooterForScope(scope),
    headline: turn.headline,
    sources: turn.sources,
  };
}

/**
 * A question, as it is shown back to the person who asked it.
 *
 * A user turn's `headline` is the question and its `bullets` are empty — that is what
 * `decodeAnswerBody` produces for a body with no bullet lines — so this reads `headline` rather
 * than `body` for the same reason the answer does: one field, decided by the repository, not two
 * render sites disagreeing about which one is the text.
 */
export function questionText(turn: AssistantTurn): string {
  return turn.headline.trim().length > 0 ? turn.headline : turn.body;
}
