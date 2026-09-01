/**
 * Which keystroke sends, and what the field says about it.
 *
 * Pulled out of the component so it can be tested: the runner collects `.test.ts` only, and this
 * is the one decision in the composer where being wrong has a named cost — a stray Enter firing a
 * half-written reply at somebody's client.
 *
 * Both the handler and the hint call in here, which is what stops a surface advertising one key
 * and binding another. A hint that lies is worse than no hint, because the person trusts it.
 */

/**
 * `enter` for the consumer thread: it is a chat, the messages are short, and every chat product a
 * client has used behaves this way. `modifier` for the operator composer: those replies are long
 * and they go to a client, so the send is a deliberate chord — Plain and Superhuman both make the
 * same call for the same reason.
 */
export type SendOn = "enter" | "modifier";

/** What the matcher needs. A real `KeyboardEvent` satisfies it; so does a plain object. */
export interface SendKeyEvent {
  readonly key: string;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly shiftKey?: boolean;
}

/**
 * Whether this keystroke sends.
 *
 * `false` on touch whatever the setting: there is no Shift key and no modifier on a phone, so the
 * return key is the only way to write a paragraph and it writes one. The send button is right
 * there, and it is a bigger target than any key.
 */
export function sendsOnKey(event: SendKeyEvent, sendOn: SendOn, coarse: boolean): boolean {
  if (event.key !== "Enter" || coarse) return false;
  const chord = event.metaKey === true || event.ctrlKey === true;
  // `enter` refuses the chord as well: ⌘+Enter in a box that sends on Enter is a person reaching
  // for the other product's habit, and sending twice is not a kindness.
  return sendOn === "enter" ? event.shiftKey !== true && !chord : chord;
}

/**
 * The line under the field, worked out from the same two values the handler uses.
 *
 * Derived rather than passed, so the two cannot disagree.
 */
export function sendHint(sendOn: SendOn, coarse: boolean): string {
  if (coarse) return "Tap send to deliver this message.";
  return sendOn === "enter"
    ? "Enter sends · Shift + Enter starts a new line"
    : "⌘ or Ctrl + Enter sends · Enter starts a new line";
}
