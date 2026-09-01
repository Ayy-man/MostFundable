/**
 * The two rules about sending a held draft, in the one place every composer path calls.
 *
 * They used to live inside `components/support/support-thread-view.tsx`, whose own header said out
 * loud why: "a second copy of those rules is a second place to lose one of them". When the
 * operator Inbox stopped rendering that component, keeping the rules there would have meant either
 * a dead guard or a second implementation, and the second implementation is the failure the
 * comment predicted. So they moved here, to a module with no React in it, which both composer
 * paths import and a test can drive directly.
 *
 * **Rule 1 — a draft that is not approved is never sent.** `held_drafts_send_requires_human` and
 * the send guard in migration 101 are the enforcement; this is the interface agreeing with them,
 * because a button that always fails is worse than no button.
 *
 * **Rule 2 — an edited draft is a human message.** The pairing exists to record that a specific
 * stored suggestion went out verbatim. The moment a person changes a word that is no longer true,
 * and migration 101 refuses the pair anyway because it compares the body byte for byte. Attaching
 * `origin_draft_id` to anything but an untouched body is therefore both a lie and a 422.
 *
 * Neither function knows anything about a surface. What a held draft looks like, what it says
 * about why it was held, and where its buttons sit are all presentation, and stay in the lanes.
 */

/** The part of a held draft these rules read. Both the Inbox's row shape and the older one satisfy it. */
export interface SendableDraft {
  readonly id: string;
  readonly body: string;
  readonly status: "draft" | "approved" | "sent" | "discarded";
}

/**
 * Whether this draft may be sent as it stands.
 *
 * `locked` is the composer's own lock — a resolved conversation, a demonstration workspace — and
 * it is a separate reason from the draft's status, which is why it is a parameter rather than
 * folded into the status check. A locked thread holding an approved draft is a real state: nothing
 * discards a held draft when a conversation is resolved, so the draft stays, is worth reading, and
 * cannot be sent.
 */
export function canSendHeldDraft(
  draft: SendableDraft | null,
  { locked }: { locked: boolean },
): boolean {
  if (draft === null) return false;
  if (locked) return false;
  return draft.status === "approved";
}

/**
 * The `origin_draft_id` this outgoing body may carry, or `null` for a message of the person's own.
 *
 * `null` is the safe answer and every uncertain case returns it: no draft, an unapproved one, a
 * locked thread, or a body that differs from the stored one by so much as a space. There is no
 * argument that makes this return an id for an edited body, which is what makes rule 2 a property
 * of the module rather than a discipline at each call site.
 */
export function pairingFor(
  body: string,
  draft: SendableDraft | null,
  { locked }: { locked: boolean },
): string | null {
  if (draft === null) return null;
  if (!canSendHeldDraft(draft, { locked })) return null;
  return body === draft.body ? draft.id : null;
}
