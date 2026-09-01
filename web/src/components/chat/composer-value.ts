/**
 * What is in the composer's box, as a function of everything that can put text there.
 *
 * Three sources compete: the saved draft for this thread, an insert the surface pushed in (a
 * suggestion chip, an example prompt), and whatever the person has typed since. Resolving that in
 * the component would mean an effect writing state on every insert, which races a keystroke and
 * makes "the chip cleared what I was typing" a real report. Resolving it here makes the answer
 * derived, so there is nothing to race.
 *
 * It lives in a plain module for the reason every other rule in this directory does: the runner
 * collects `.test.ts` and Node strips types without transforming JSX, so a claim about a `.tsx`
 * can only be asserted as source text. A claim about this can be driven.
 */

/** One session's typing, tagged with the thread and the insert it was made against. */
export interface ComposerEdit {
  readonly ref: string;
  /** The insert in force when this was typed; `null` when there had been no insert. */
  readonly token: number | null;
  readonly value: string;
}

/**
 * Text pushed in from outside.
 *
 * `token` is what makes a repeat work. Pressing the same chip twice after clearing the box is a
 * real thing people do, and comparing values would make the second press do nothing.
 */
export interface ComposerInsert {
  readonly value: string;
  readonly token: number;
}

/**
 * Whether an edit still speaks for the box.
 *
 * It stops speaking when the thread changes — that is what restores the right draft on a thread
 * switch without an effect resetting anything — and when an insert arrives after it, because an
 * edit made before the current insert is stale by definition.
 */
export function editIsCurrent(
  edited: ComposerEdit | null,
  threadRef: string,
  insert: ComposerInsert | null,
): boolean {
  if (edited === null) return false;
  if (edited.ref !== threadRef) return false;
  return edited.token === (insert?.token ?? null);
}

/** The text the field shows. Typing wins over an insert, an insert wins over the saved draft. */
export function composerValue(
  edited: ComposerEdit | null,
  threadRef: string,
  insert: ComposerInsert | null,
  saved: string,
): string {
  if (edited !== null && editIsCurrent(edited, threadRef, insert)) return edited.value;
  return insert?.value ?? saved;
}
