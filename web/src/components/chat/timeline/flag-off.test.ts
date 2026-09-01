// With `FEATURE_TIMELINE` off, the shipped thread renders exactly as it did before this lane.
//
// "Exactly" needs a definition that can fail, and the definition is the render plan. `MessageThread`
// draws one of two plans: `groupThreadItems` for the shipped thread, `groupTimeline` for the
// timeline. So the flag-off guarantee is two claims, and both are checked here:
//
//   1. `groupThreadItems` produces the same blocks it produced before — pinned as a literal below,
//      which is the snapshot. It is a literal rather than a derivation on purpose: a snapshot that
//      recomputed the expected value from the code under test would agree with any change to it.
//   2. Nothing routes the flag-off path through the timeline. The switch is the `timeline` prop, both
//      surfaces build it only behind their flag, and no surface passes timeline rows without it.
//
// The second half is read out of the source, because it is a wiring claim and there is no plan to
// inspect for a component that was never handed the prop. Watched failing before it counted: deleting
// the `timelineOn &&` guard in the consumer's ready branch, and dropping the `timeline` prop's
// conditional in `renderTimelineBlocks`, each fail exactly one assertion here.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { stripComments } from "@/lib/testing/strip-comments";

import { groupThreadItems } from "../grouping";
import type { ChatMessage, ChatThreadItem } from "../types";

const CHAT = path.resolve(import.meta.dirname, "..");
const COMPONENTS = path.resolve(CHAT, "..");

const read = (file: string) => stripComments(readFileSync(file, "utf8"));

function message(ref: string, sentAt: string, name: string): ChatMessage {
  return {
    author: { kind: "operator", name },
    body: `body ${ref}`,
    delivery: "delivered",
    origin: "human",
    ref,
    sentAt,
    visibility: "participants",
  };
}

/** A thread of the shape every producer that existed before this lane builds. */
const SHIPPED: readonly ChatThreadItem[] = [
  { message: message("m1", "2026-08-20T09:00:00Z", "Priya"), type: "message" },
  { message: message("m2", "2026-08-20T09:02:00Z", "Priya"), type: "message" },
  {
    event: {
      kind: "stage_changed",
      occurredAt: "2026-08-20T10:00:00Z",
      ref: "e1",
      summary: "Devon moved to Optimization",
    },
    type: "event",
  },
  { message: message("m3", "2026-08-21T09:00:00Z", "Devon"), type: "message" },
];

describe("the shipped thread's plan is unchanged", () => {
  it("matches the snapshot, block for block", () => {
    const blocks = groupThreadItems(SHIPPED, (each) => each.author.name === "Devon");
    assert.deepEqual(
      blocks.map((block) =>
        block.type === "group"
          ? { own: block.own, refs: block.messages.map((each) => each.ref), type: block.type }
          : block.type === "divider"
            ? { at: block.at, type: block.type }
            : { ref: block.event.ref, type: block.type },
      ),
      [
        { at: "2026-08-20T09:00:00Z", type: "divider" },
        { own: false, refs: ["m1", "m2"], type: "group" },
        { ref: "e1", type: "event" },
        { at: "2026-08-21T09:00:00Z", type: "divider" },
        { own: true, refs: ["m3"], type: "group" },
      ],
      "the flag-off thread groups differently than it did before FEATURE_TIMELINE existed",
    );
  });

  it("skips a timeline-only row instead of rendering an empty block", () => {
    // The one behaviour `groupThreadItems` gained. Unreachable on the flag-off path, because no
    // surface builds such a row without the flag — and if one ever does, the row is dropped rather
    // than drawn as a gap where a summary should be.
    const withTimelineRow: ChatThreadItem[] = [
      ...SHIPPED,
      {
        timeline: {
          at: "2026-08-21T11:00:00Z",
          client: "Devon",
          kind: "thread_opened",
          ref: "timeline-only",
        },
        type: "event",
      },
    ];
    const before = groupThreadItems(SHIPPED, () => false);
    const after = groupThreadItems(withTimelineRow, () => false);
    assert.equal(after.length, before.length);
  });
});

describe("nothing reaches the timeline path without the flag", () => {
  const thread = read(path.join(CHAT, "message-thread.tsx"));
  const consumer = read(path.join(COMPONENTS, "consumer/team-chat/index.tsx"));
  const inbox = read(path.join(COMPONENTS, "operator/inbox/index.tsx"));

  it("switches on the prop, not on a flag read inside the component", () => {
    // A shared component reading the environment cannot be rendered in both states by a caller, and
    // both states are what has to be provable. So the switch is the prop.
    assert.doesNotMatch(thread, /featureFlag|FEATURE_/, "the thread reads a flag itself");
    assert.match(
      thread,
      /timeline\s*\?\s*renderTimelineBlocks/,
      "the timeline branch is no longer conditional on the prop",
    );
    assert.match(
      thread,
      /groupThreadItems\(items, isOwn\)/,
      "the flag-off branch no longer calls groupThreadItems",
    );
  });

  it("builds the consumer's options only behind the flag", () => {
    assert.match(
      consumer,
      /const timelineOn = timelineEnabled && navigate !== undefined/,
      "the consumer's timeline gate moved or changed shape",
    );
    assert.match(
      consumer,
      /timelineOptions: TimelineThreadOptions \| undefined = timelineOn/,
      "the consumer builds timeline options without consulting the gate",
    );
    // And the durable branch adds no event rows without it.
    assert.match(consumer, /if \(timelineOn && timeline !== undefined\)/);
  });

  it("builds the operator's options only behind the flag", () => {
    assert.match(inbox, /const timelineOn = timelineEnabled/, "the Inbox's gate moved");
    assert.match(
      inbox,
      /timelineOptions: TimelineThreadOptions \| undefined = timelineOn/,
      "the Inbox builds timeline options without consulting the gate",
    );
    assert.match(inbox, /if \(!timelineOn\) return \[\.\.\.stored, \.\.\.waiting\]/);
  });

  it("defaults both flags to off, so an unwired caller gets the shipped thread", () => {
    for (const [where, source] of [
      ["the consumer", consumer],
      ["the Inbox", inbox],
    ] as const) {
      assert.match(
        source,
        /timelineEnabled = false/,
        `${where} does not default the flag to off`,
      );
    }
  });
});
