// Whether a message the reader sent may say "Read".
//
// One rule, in one module, because two surfaces render the same claim: the operator Inbox's
// conversation pane and the consumer's Team Chat. A copy in each would drift, and the way it
// would drift is the dangerous one, since the two copies only disagree on messages near the
// watermark and both look right on everything else.
//
// The module is deliberately free of React and of `@/components/chat`: `view-model.ts` cannot
// take a runtime import from that barrel (it is `.tsx` all the way down and a `.test.ts` cannot
// load it), so this sits under `lib/support` beside `draft-send.ts` and is imported deeply by
// both callers.
//
// Three things this rule refuses to do, each of which the obvious version does:
//
//   It never says "Read" from the reader's OWN watermark. `SupportThreadRead.lastReadAt` is where
//   this person's attention stopped; using it here would put a receipt on every message the
//   moment the sender scrolled past their own text.
//
//   It never says "Read" without an instant to compare against. A null `counterpartReadAt` is
//   "we cannot say", and "we cannot say" renders as Delivered, which is a weaker claim and a true
//   one. The database produces that null for three different reasons and none of them is a
//   licence to guess.
//
//   It compares instants, never strings. `2026-08-24T09:00:00Z` and `2026-08-24T09:00:00.000Z`
//   are the same moment and sort differently as text, and the payload carries whichever form
//   Postgres and PostgREST happened to render, so a lexical compare would flip receipts on and
//   off with the serialisation.

/** What the delivery mark under an outbound message may say once the database has it. */
export type ChatReceiptState = "delivered" | "read";

export interface ReceiptInput {
  /** True when the signed-in side wrote the message. A receipt is only ever shown on these. */
  readonly own: boolean;
  /** The message's `sent_at`, as the payload carries it. */
  readonly sentAt: string;
  /**
   * The greatest watermark held by the OTHER side of this thread, or null.
   *
   * Derived by `support_list_thread_digest` (migration 393) inside a security definer function.
   * It names no person and cannot be resolved back to one.
   */
  readonly counterpartReadAt: string | null;
}

/**
 * "Read" when the other side's watermark covers this message, "Delivered" otherwise.
 *
 * The boundary is inclusive: a watermark written at exactly the instant a message was sent has
 * covered it, because `support_list_thread_digest` counts unread with a strict `sent_at >
 * last_read_at`, so the equal case is already "seen" on the other side of the same pair of
 * columns. Making it exclusive here would put a permanent Delivered on a message whose badge the
 * database says is cleared.
 *
 * An unparseable instant on either side falls back to "delivered" rather than throwing: a wrong
 * receipt is a claim about somebody else's attention, and a missing one is only a missing one.
 */
export function receiptFor(input: ReceiptInput): ChatReceiptState {
  if (!input.own) return "delivered";
  if (input.counterpartReadAt === null) return "delivered";
  const seenTo = Date.parse(input.counterpartReadAt);
  const sentAt = Date.parse(input.sentAt);
  if (!Number.isFinite(seenTo) || !Number.isFinite(sentAt)) return "delivered";
  return seenTo >= sentAt ? "read" : "delivered";
}
