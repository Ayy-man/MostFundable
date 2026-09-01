// The NDJSON stage stream, as an encoder with no transport in it.
//
// Contract rule R1: there is no token streaming and there must not be. The
// pipeline runs candidate → compliance scan → citation check → supervisor and
// only then has an answer, so streaming tokens would put un-supervised text on
// somebody's screen and then retract it — which is the exact failure the
// supervisor gate exists to prevent.
//
// What streams instead is the stage the server is actually in. Each line is one
// complete JSON object followed by a newline, so a reader can split on `\n` and
// parse each piece without buffering the whole response. The last line is always
// `{"answer":…}` or `{"error":…}`: a stream that ends after a stage line ended
// because the connection died, and a reader can tell those apart.

import type { AssistantConversation, AssistantErrorCode, AssistantProgressEvent, AssistantStage, AssistantTurn } from './types.ts';

export type AssistantStreamEvent =
  | AssistantProgressEvent
  | { readonly answer: { readonly turn: AssistantTurn; readonly conversation: AssistantConversation } }
  | { readonly error: AssistantErrorCode };

/** The content type an NDJSON body is served with. */
export const NDJSON_CONTENT_TYPE = 'application/x-ndjson';

export function encodeStreamEvent(event: AssistantStreamEvent): string {
  return `${JSON.stringify(event)}\n`;
}

/**
 * Split an NDJSON chunk into whole lines, keeping whatever is left over.
 *
 * A chunk boundary can land in the middle of a line, so a reader that parsed
 * every chunk directly would throw on a half-object roughly whenever an answer
 * was long. The remainder is handed back rather than held in module state so
 * that two readers in one page cannot interfere with each other.
 */
export function readStreamLines(
  chunk: string,
  carry = '',
): { readonly events: readonly AssistantStreamEvent[]; readonly carry: string } {
  const combined = carry + chunk;
  const pieces = combined.split('\n');
  const remainder = pieces.pop() ?? '';
  const events: AssistantStreamEvent[] = [];

  for (const piece of pieces) {
    const trimmed = piece.trim();
    if (trimmed.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // A line that is not JSON is dropped rather than thrown on. The stream's
      // last line is what decides the outcome, and a reader that gave up on a
      // malformed stage line would lose the answer that follows it.
      continue;
    }
    if (parsed === null || typeof parsed !== 'object') continue;
    events.push(parsed as AssistantStreamEvent);
  }

  return { carry: remainder, events };
}

export interface StageStreamWriter {
  /** Report the stage the server has just entered. */
  stage(stage: AssistantStage, titles?: readonly string[]): void;
  /** Close the stream with an answer. */
  answer(turn: AssistantTurn, conversation: AssistantConversation): void;
  /** Close the stream with a refusal. */
  fail(code: AssistantErrorCode): void;
}

/**
 * Wrap a `ReadableStream` controller in the three things a pipeline may say.
 *
 * `closed` is the reason this is a class of its own rather than three inline
 * `enqueue` calls: the pipeline has several places it can fail, and enqueueing
 * onto a closed controller throws. A second terminal event is dropped, so a
 * failure path that runs after an answer has already been written cannot turn a
 * successful response into a broken one.
 */
export function createStageStreamWriter(
  write: (line: string) => void,
  close: () => void,
): StageStreamWriter {
  let closed = false;

  function terminal(event: AssistantStreamEvent) {
    if (closed) return;
    closed = true;
    write(encodeStreamEvent(event));
    close();
  }

  return {
    answer(turn, conversation) {
      terminal({ answer: { conversation, turn } });
    },
    fail(code) {
      terminal({ error: code });
    },
    stage(stage, titles) {
      if (closed) return;
      write(encodeStreamEvent(stage === 'reading' ? { stage, titles: titles ?? [] } : { stage }));
    },
  };
}
