// What an assistant turn is, as parts the panel can lay out (F-09, the render half).
//
// The schema half of F-09 shipped: `KB_CANDIDATE_SCHEMA` has asked for a
// headline, bullets and citations separately since lane 4a, and
// `encodeAnswerBody` carries those parts through the single `body text` column
// `assistant_turns` gives a stored turn. The panel then rendered the encoded
// string into one `<p>`, so the parts arrived correctly and were flattened at
// the last step: HTML collapses the newlines, and a headline plus six bullets
// came out as one unbroken run of text with stray hyphens in it. The design
// brief specifies a headline, a supporting list and a sources row, so this is
// the specified behaviour being finished rather than a new treatment.
//
// The split lives here rather than in the panel because `.tsx` files are not
// collected by the test glob and Node strips types without transforming JSX —
// the same constraint `surface-contract.test.ts` documents. Anything with a
// decision in it goes in a plain module and gets driven properly; the panel is
// left with markup.

import { decodeAnswerBody } from "@/lib/kb/answer-body";

import type { AssistantTurn } from "./use-assistant.ts";

export interface AssistantAnswerView {
  /** Always present, always the whole first line. Never empty for a turn with any text at all. */
  readonly headline: string;
  /** The supporting points. Empty means "render the headline as an ordinary paragraph". */
  readonly bullets: readonly string[];
}

/**
 * Split an assistant turn for rendering.
 *
 * **Only an answered turn is structured.** A decline and an `unavailable`
 * message are prose this codebase wrote, not an encoded body, and running the
 * decode over them would turn a sentence that happens to contain a line opening
 * with a dash into a bullet list — inventing structure the server never sent.
 * The status is the honest discriminator, because it is the same field that
 * decides whether `body` came out of `encodeAnswerBody` at all.
 *
 * Nothing here can lose an answer. `decodeAnswerBody` is total by construction —
 * text with no bullet lines decodes to a headline and nothing else — so the
 * worst case for an answer this module does not understand is exactly the flat
 * paragraph the panel rendered before.
 */
export function assistantAnswerView(turn: Extract<AssistantTurn, { role: "assistant" }>): AssistantAnswerView {
  if (turn.status !== "answered") return { headline: turn.body, bullets: [] };
  const body = decodeAnswerBody(turn.body);
  return { headline: body.headline, bullets: body.bullets };
}
