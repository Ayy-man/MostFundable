// The read receipt's rule, and the two surfaces that render it.
//
// Nothing below writes down "read" or "delivered" next to a case and calls that an expectation.
// Every assertion either states a property the rule must hold whatever it decides, or compares a
// surface's output against `receiptFor` itself. A transcription would go green against a rule
// that had rotted into always returning "delivered", which is precisely the failure this feature
// can have without anybody noticing: a receipt that never appears looks like a quiet product,
// and a receipt that appears wrongly is a claim about another person's attention.
//
// Watched failing on the pre-change tree, where `toThreadItems` and `messageFrom` hard-coded
// `delivery: "delivered"` and `receiptFor` did not exist: the module import fails outright, and
// with the rule stubbed to return "delivered" the two surface suites below fail on every case
// where the counterpart watermark covers the message.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { messageFrom, threadItemsFrom } from "@/components/consumer/team-chat/thread-model";
import { toThreadItems, type AuthorNames } from "@/components/operator/inbox/view-model";
import type { SupportInboxMessage } from "@/lib/operator/support-inbox.client";
import type { SupportMessageRow } from "@/lib/support";

import { receiptFor } from "./read-receipt";

const SENT_AT = "2026-08-24T09:00:00.000Z";
const SENT_MS = Date.parse(SENT_AT);

/** The same instant, written five ways a JSON payload could plausibly carry it. */
const SAME_INSTANT = [
  "2026-08-24T09:00:00.000Z",
  "2026-08-24T09:00:00Z",
  "2026-08-24T09:00:00.000+00:00",
  "2026-08-24T14:30:00.000+05:30",
  "2026-08-24T05:00:00.000-04:00",
] as const;

/** Instants around the message, named by their relation to it rather than by an expected answer. */
const BEFORE = new Date(SENT_MS - 1).toISOString();
const AFTER = new Date(SENT_MS + 1).toISOString();

describe("what a delivery mark may claim", () => {
  it("says nothing beyond delivered without a counterpart instant", () => {
    for (const own of [false, true]) {
      assert.equal(receiptFor({ counterpartReadAt: null, own, sentAt: SENT_AT }), "delivered");
    }
  });

  /**
   * The receipt belongs to the sender's own messages. A message the reader received is already on
   * screen in front of them, so a mark on it would be telling them they have read it.
   */
  it("never marks a message the reader did not write", () => {
    for (const counterpartReadAt of [null, BEFORE, SENT_AT, AFTER]) {
      assert.equal(
        receiptFor({ counterpartReadAt, own: false, sentAt: SENT_AT }),
        "delivered",
        `a received message carried a receipt from ${String(counterpartReadAt)}`,
      );
    }
  });

  /**
   * The boundary is stated as a transition rather than as two literals: whatever the rule decides
   * at each side, it must decide the same thing everywhere before the message was sent and the
   * same thing everywhere at or after it, and the two answers must differ. That holds a rule that
   * flipped its comparison, a rule that made the boundary exclusive, and a rule that stopped
   * deciding at all, without this test knowing which word goes on which side.
   */
  it("changes its answer exactly once, at the instant the message was sent", () => {
    const at = (offsetMs: number) =>
      receiptFor({
        counterpartReadAt: new Date(SENT_MS + offsetMs).toISOString(),
        own: true,
        sentAt: SENT_AT,
      });

    const unseen = at(-60_000);
    const seen = at(0);
    assert.notEqual(unseen, seen, "the rule gives the same answer either side of the message");

    for (const offset of [-86_400_000, -60_000, -1_000, -1]) {
      assert.equal(at(offset), unseen, `a watermark ${offset}ms before the message read differently`);
    }
    for (const offset of [0, 1, 1_000, 60_000, 86_400_000]) {
      assert.equal(at(offset), seen, `a watermark ${offset}ms after the message read differently`);
    }
  });

  /**
   * `2026-08-24T09:00:00Z` sorts after `2026-08-24T09:00:00.000Z` as text and is the same moment,
   * and the payload carries whichever form Postgres and PostgREST rendered. A lexical comparison
   * passes the first case in this list and fails the offset ones.
   */
  it("reads an instant, not a string", () => {
    const answers = new Set(
      SAME_INSTANT.map((counterpartReadAt) =>
        receiptFor({ counterpartReadAt, own: true, sentAt: SENT_AT }),
      ),
    );
    assert.equal(answers.size, 1, "five spellings of one instant produced more than one answer");

    const spelled = new Set(
      SAME_INSTANT.map((sentAt) =>
        receiptFor({ counterpartReadAt: SENT_AT, own: true, sentAt }),
      ),
    );
    assert.equal(spelled.size, 1, "five spellings of one send time produced more than one answer");
  });

  it("falls back to delivered when either instant cannot be parsed", () => {
    for (const bad of ["", "yesterday", "2026-13-45T99:99:99Z", "null"]) {
      assert.equal(receiptFor({ counterpartReadAt: bad, own: true, sentAt: SENT_AT }), "delivered");
      assert.equal(receiptFor({ counterpartReadAt: SENT_AT, own: true, sentAt: bad }), "delivered");
    }
  });
});


// ---------------------------------------------------------------------------------------------
// The two surfaces, against the rule rather than against a word
// ---------------------------------------------------------------------------------------------

const NAMES: AuthorNames = { admin: "Platform team", consumer: "Dana Reyes", operator: "Acme" };

function inboxMessage(overrides: Partial<SupportInboxMessage> = {}): SupportInboxMessage {
  return {
    authorKind: "operator",
    body: "Start with the two documents listed on your plan.",
    id: "m1",
    origin: "human",
    sentAt: SENT_AT,
    visibility: "participants",
    ...overrides,
  };
}

function consumerRow(overrides: Partial<SupportMessageRow> = {}): SupportMessageRow {
  return {
    authorKind: "consumer",
    authorProfileId: "p1",
    body: "What should I work on first this week?",
    id: "m1",
    origin: "human",
    originDraftId: null,
    sentAt: SENT_AT,
    threadId: "t1",
    visibility: "participants",
    ...overrides,
  };
}

const WATERMARKS = [null, BEFORE, SENT_AT, AFTER] as const;

describe("the Inbox renders the rule and not a copy of it", () => {
  it("marks a stored message exactly as the rule says", () => {
    for (const counterpartReadAt of WATERMARKS) {
      for (const authorKind of ["consumer", "operator", "admin"] as const) {
        const [item] = toThreadItems([inboxMessage({ authorKind })], NAMES, counterpartReadAt);
        assert.equal(item?.type, "message");
        assert.equal(
          item?.type === "message" ? item.message.delivery : null,
          receiptFor({ counterpartReadAt, own: authorKind !== "consumer", sentAt: SENT_AT }),
          `a ${authorKind} message under watermark ${String(counterpartReadAt)}`,
        );
      }
    }
  });

  /**
   * The default matters because the fixture body of the Inbox calls this without a watermark, and
   * a default that leaked a truthy instant would put receipts on seeded conversations nobody has.
   */
  it("claims nothing when no watermark is passed at all", () => {
    const [item] = toThreadItems([inboxMessage()], NAMES);
    assert.equal(item?.type === "message" ? item.message.delivery : null, "delivered");
  });
});

describe("Team Chat renders the rule and not a copy of it", () => {
  it("marks the client's own message exactly as the rule says", () => {
    for (const counterpartReadAt of WATERMARKS) {
      for (const authorKind of ["consumer", "operator", "admin"] as const) {
        const message = messageFrom(consumerRow({ authorKind }), "Acme", counterpartReadAt);
        assert.equal(
          message.delivery,
          receiptFor({ counterpartReadAt, own: authorKind === "consumer", sentAt: SENT_AT }),
          `a ${authorKind} message under watermark ${String(counterpartReadAt)}`,
        );
      }
    }
  });

  it("carries the watermark through the whole thread, not only the newest row", () => {
    const rows = [
      consumerRow({ id: "old", sentAt: new Date(SENT_MS - 3_600_000).toISOString() }),
      consumerRow({ id: "new", sentAt: new Date(SENT_MS + 3_600_000).toISOString() }),
    ];
    const items = threadItemsFrom(rows, "Acme", SENT_AT);
    for (const [index, item] of items.entries()) {
      assert.equal(item.type, "message");
      assert.equal(
        item.type === "message" ? item.message.delivery : null,
        receiptFor({ counterpartReadAt: SENT_AT, own: true, sentAt: rows[index].sentAt }),
        `row ${rows[index].id} disagreed with the rule`,
      );
    }
  });

  it("claims nothing when no watermark is passed at all", () => {
    assert.equal(messageFrom(consumerRow(), "Acme").delivery, "delivered");
  });
});
