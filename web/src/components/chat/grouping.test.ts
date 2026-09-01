// The one algorithmic part of the thread, driven against real runs of items.
//
// Every fact here is derived from the module that owns it rather than transcribed: the window
// comes from `GROUPING_WINDOW_MS`, the day boundary from `crossesDay`, and the "is this the same
// person" rule is checked by changing the thing it is supposed to key on rather than by asserting
// a count that a rewrite could satisfy by accident.
//
// Watched failing before it counted, one change at a time against this tree:
//   * dropping `withinGroupingWindow` from the continuation test — the four-hour case merged into
//     one group and `splits a long gap` failed;
//   * dropping the `visibility` comparison — the note joined the message above it and
//     `never groups an internal note with a public message` failed;
//   * dropping the `author.name` comparison — two people merged and `splits on the speaker`
//     failed;
//   * removing the leading `divider` push — `opens with a divider` failed.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { groupThreadItems } from "./grouping.ts";
import { GROUPING_WINDOW_MS } from "./time.ts";
import type { ChatMessage, ChatThreadItem } from "./types.ts";

let counter = 0;
/** The narrow member, not the union: these helpers exist so a case can reach `.message`. */
type MessageItem = Extract<ChatThreadItem, { type: "message" }>;
type EventItem = Extract<ChatThreadItem, { type: "event" }>;

function message(overrides: Partial<ChatMessage> & { sentAt: string }): MessageItem {
  counter += 1;
  return {
    message: {
      author: { kind: "operator", name: "Avery Blake" },
      body: "Body",
      delivery: "delivered",
      origin: "human",
      ref: `m${counter}`,
      visibility: "participants",
      ...overrides,
    },
    type: "message",
  };
}

function event(occurredAt: string): EventItem {
  counter += 1;
  return {
    event: { kind: "stage_changed", occurredAt, ref: `e${counter}`, summary: "Stage moved" },
    type: "event",
  };
}

const at = (iso: string) => new Date(iso).toISOString();
const plus = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();

const NEVER_OWN = () => false;

describe("thread grouping", () => {
  it("opens with a divider, so the first day is named like every other one", () => {
    const blocks = groupThreadItems([message({ sentAt: at("2026-08-22T09:00:00") })], NEVER_OWN);
    assert.equal(blocks[0]?.type, "divider");
  });

  it("keeps one person's run together inside the window", () => {
    const first = at("2026-08-22T09:00:00");
    const blocks = groupThreadItems(
      [
        message({ sentAt: first }),
        message({ sentAt: plus(first, GROUPING_WINDOW_MS - 1_000) }),
        message({ sentAt: plus(first, 2 * (GROUPING_WINDOW_MS - 1_000)) }),
      ],
      NEVER_OWN,
    );
    const groups = blocks.filter((block) => block.type === "group");
    assert.equal(groups.length, 1, "a continuous run split into more than one group");
    assert.equal(groups[0].messages.length, 3);
  });

  it("splits a long gap, because the gap is the information", () => {
    const first = at("2026-08-22T09:00:00");
    const blocks = groupThreadItems(
      [message({ sentAt: first }), message({ sentAt: plus(first, 4 * 3_600_000) })],
      NEVER_OWN,
    );
    assert.equal(blocks.filter((block) => block.type === "group").length, 2);
  });

  it("splits on the speaker even when the messages are seconds apart", () => {
    const first = at("2026-08-22T09:00:00");
    const blocks = groupThreadItems(
      [
        message({ sentAt: first }),
        message({
          author: { kind: "consumer", name: "Priya Raman" },
          sentAt: plus(first, 5_000),
        }),
      ],
      NEVER_OWN,
    );
    assert.equal(blocks.filter((block) => block.type === "group").length, 2);
  });

  it("never groups an internal note with a public message", () => {
    // The two render completely differently — warning tint, a stated label, a different rule about
    // who can see them. A group is one visual object, so a group containing both would have to
    // pick one treatment and be wrong about the other half.
    const first = at("2026-08-22T09:00:00");
    const blocks = groupThreadItems(
      [
        message({ sentAt: first }),
        message({ sentAt: plus(first, 5_000), visibility: "internal" }),
      ],
      NEVER_OWN,
    );
    const groups = blocks.filter((block) => block.type === "group");
    assert.equal(groups.length, 2);
    assert.equal(groups[1].messages[0].visibility, "internal");
  });

  it("puts a divider between two days and not inside one", () => {
    const blocks = groupThreadItems(
      [
        message({ sentAt: at("2026-08-21T23:50:00") }),
        message({ sentAt: at("2026-08-22T00:10:00") }),
        message({ sentAt: at("2026-08-22T09:00:00") }),
      ],
      NEVER_OWN,
    );
    assert.equal(blocks.filter((block) => block.type === "divider").length, 2);
  });

  it("breaks a run with an event, because something happened in the middle of it", () => {
    const first = at("2026-08-22T09:00:00");
    const blocks = groupThreadItems(
      [
        message({ sentAt: first }),
        event(plus(first, 10_000)),
        message({ sentAt: plus(first, 20_000) }),
      ],
      NEVER_OWN,
    );
    assert.deepEqual(
      blocks.map((block) => block.type),
      ["divider", "group", "event", "group"],
    );
  });

  it("splits the reader's own messages from everybody else's", () => {
    const first = at("2026-08-22T09:00:00");
    const items = [message({ sentAt: first }), message({ sentAt: plus(first, 5_000) })];
    const blocks = groupThreadItems(items, (candidate) => candidate.ref === items[1].message.ref);
    const groups = blocks.filter((block) => block.type === "group");
    assert.equal(groups.length, 2, "one side's message joined the other side's group");
    assert.deepEqual(groups.map((group) => group.own), [false, true]);
  });

  it("returns nothing at all for an empty thread rather than a stray divider", () => {
    assert.deepEqual(groupThreadItems([], NEVER_OWN), []);
  });
});
