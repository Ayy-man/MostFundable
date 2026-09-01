// The five states, both audiences, every filter.
//
// This is the file the mockup's roast standard turns into code. It renders the plan — not the DOM —
// because everything that could be wrong about one of these states is a decision the plan already
// made: which rows this reader sees, what folds, which single band is filled, what a date says. A
// browser adds pixels to that and nothing else, and the states gallery in the mockup is what was
// walked by eye.
//
// The five states are the mockup's own: a fresh thread, one card between messages, ten dense days,
// the same thread updated in place, and the event read failing without taking the messages with it.

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import type { TimelineAudience } from "@/lib/timeline/types";

import type { ChatMessage, ChatThreadItem } from "../types";
import { isPrimaryEligible, specFor, titleText, type TimelineRow } from "./catalog";
import {
  timelineDenseFixture,
  timelineFixture,
  timelineFreshFixture,
  timelineSparseFixture,
  timelineUpdatedFixture,
} from "./fixture";
import { groupTimeline, type TimelineBlock } from "./group";
import { timelineThreadItems } from "./items";

const AUDIENCES: readonly TimelineAudience[] = ["consumer", "operator"];
const FILTERS = ["all", "messages", "analysis", "documents", "stage", "billing"] as const;

const isOwn = (message: ChatMessage) => message.author.name === "You";

const ORIGINAL_TZ = process.env.TZ;
after(() => {
  process.env.TZ = ORIGINAL_TZ;
});

const STATES: readonly {
  readonly name: string;
  readonly items: (audience: TimelineAudience) => ChatThreadItem[];
  readonly readFailed?: boolean;
}[] = [
  { items: (audience) => timelineFreshFixture({ audience }), name: "fresh" },
  { items: (audience) => timelineSparseFixture({ audience }), name: "sparse" },
  { items: (audience) => timelineUpdatedFixture({ audience }), name: "updated in place" },
  { items: (audience) => timelineDenseFixture({ audience }), name: "dense" },
  { items: (audience) => timelineFixture({ audience }), name: "the duo thread" },
  {
    items: (audience) =>
      timelineFixture({ audience }).filter((item) => item.type === "message"),
    name: "read failed",
    readFailed: true,
  },
];

function rowsOf(blocks: readonly TimelineBlock[]): TimelineRow[] {
  return blocks.flatMap((block) => {
    if (block.type === "line" || block.type === "band") return [block.row];
    if (block.type === "run") return block.lines.map((entry) => entry.row);
    if (block.type === "fold") return block.bands.map((entry) => entry.row);
    return [];
  });
}

function bandViews(blocks: readonly TimelineBlock[]) {
  return blocks.flatMap((block) =>
    block.type === "band"
      ? [block.view]
      : block.type === "fold"
        ? block.bands.map((entry) => entry.view)
        : [],
  );
}

/** Every string a plan renders, flattened. What the date and projection walks read. */
function textOf(blocks: readonly TimelineBlock[]): string[] {
  const out: string[] = [];
  for (const block of blocks) {
    if (block.type === "run") {
      out.push(block.label);
      for (const entry of block.lines) out.push(titleText(entry.view.title));
      continue;
    }
    if (block.type === "fold") {
      out.push(block.title, block.body);
      for (const entry of block.bands) out.push(titleText(entry.view.title));
      continue;
    }
    if (block.type === "line") {
      out.push(titleText(block.view.title));
      continue;
    }
    if (block.type === "band") {
      out.push(titleText(block.view.title));
      if (block.view.body !== undefined) out.push(block.view.body);
      for (const fact of block.view.facts) out.push(`${fact.label} ${fact.value}`);
      if (block.view.status) out.push(block.view.status.label);
      for (const action of block.view.actions) out.push(action.label);
      continue;
    }
    if (block.type === "group") {
      for (const message of block.messages) out.push(message.body);
    }
  }
  return out;
}

function plan(
  items: readonly ChatThreadItem[],
  audience: TimelineAudience,
  options: Parameters<typeof groupTimeline>[3] = {},
) {
  return groupTimeline(items, audience, isOwn, options);
}

describe("every state renders, for both readers", () => {
  for (const state of STATES) {
    for (const audience of AUDIENCES) {
      it(`${state.name}, ${audience}`, () => {
        const items = state.items(audience);
        const { blocks, eventCount, messageCount } = plan(items, audience, {
          ...(state.readFailed ? { readFailed: true } : {}),
        });

        if (state.readFailed) {
          // The whole point of the events being a separate read: the messages are current, and the
          // failure is one row that says so.
          assert.ok(messageCount > 0, "the messages went with the failed event read");
          assert.equal(eventCount, 0);
          assert.equal(blocks.at(-1)?.type, "read-failed");
          return;
        }

        assert.ok(blocks.length > 0, "the state rendered nothing at all");
        // No state is a blank column, and no block is an empty one.
        for (const rendered of textOf(blocks)) {
          assert.notEqual(rendered.trim(), "", `${state.name}/${audience} rendered an empty string`);
        }
      });
    }
  }

  it("the dense thread is dense", () => {
    // Named so the number is checked rather than claimed. The mockup's dense frame was 48 events and
    // 10 messages over ten days; this is the same shape with the same job.
    const items = timelineDenseFixture({ audience: "operator" });
    const events = items.filter((item) => item.type === "event").length;
    const messages = items.filter((item) => item.type === "message").length;
    assert.ok(events >= 45, `the dense fixture holds only ${events} events`);
    assert.equal(messages, 10);
    const { blocks } = plan(items, "operator");
    // And the collapsing is doing something: the rows are carried by fewer event blocks than there
    // are rows, and both mechanisms are in use.
    const eventBlocks = blocks.filter(
      (block) => block.type === "line" || block.type === "band" || block.type === "run" || block.type === "fold",
    );
    assert.ok(
      eventBlocks.length < rowsOf(blocks).length,
      `${eventBlocks.length} blocks for ${rowsOf(blocks).length} rows: nothing collapsed`,
    );
    assert.ok(blocks.some((block) => block.type === "run"), "no run in the dense thread");
    assert.ok(blocks.some((block) => block.type === "fold"), "no fold in the dense thread");
  });
});

describe("one filled action, in every state and every filter", () => {
  it("never fills two bands", () => {
    for (const state of STATES) {
      for (const audience of AUDIENCES) {
        for (const filter of FILTERS) {
          const { blocks } = plan(state.items(audience), audience, {
            filter,
            ...(state.readFailed ? { readFailed: true } : {}),
          });
          const filled = bandViews(blocks).filter((view) => view.primary);
          assert.ok(
            filled.length <= 1,
            `${state.name}/${audience}/${filter} filled ${filled.length} bands`,
          );
        }
      }
    }
  });

  it("never leaves the filled band inside a disclosure", () => {
    for (const state of STATES) {
      for (const audience of AUDIENCES) {
        const { blocks } = plan(state.items(audience), audience);
        for (const block of blocks) {
          if (block.type !== "fold") continue;
          assert.deepEqual(
            block.bands.filter((entry) => entry.view.primary),
            [],
            `${state.name}/${audience} folded the one filled action out of sight`,
          );
        }
      }
    }
  });
});

describe("sticky rows stay findable", () => {
  it("keeps every sticky kind out of every run and fold, in every state", () => {
    for (const state of STATES) {
      for (const audience of AUDIENCES) {
        const { blocks } = plan(state.items(audience), audience);
        for (const block of blocks) {
          const inside =
            block.type === "run"
              ? block.lines.map((entry) => entry.row)
              : block.type === "fold"
                ? block.bands.map((entry) => entry.row)
                : [];
          for (const row of inside) {
            const spec = specFor(row.kind);
            assert.notEqual(
              spec.sticky,
              true,
              `${state.name}/${audience} collapsed ${row.kind}, which is sticky`,
            );
            assert.notEqual(
              spec.operatorOnly,
              true,
              `${state.name}/${audience} collapsed ${row.kind}, which is operator-only`,
            );
          }
        }
      }
    }
  });
});

describe("what a consumer never sees", () => {
  it("renders no operator-only row and no unreleased outcome, in any state or filter", () => {
    // Both of the leaks the deny-list names, checked by identity rather than by reading the copy: the
    // row is either in the plan or it is not.
    const operatorOnly = timelineThreadItems([
      {
        actor: "Avery",
        at: "2026-08-23T13:00:00Z",
        client: "Devon",
        from: "Avery",
        kind: "assignment",
        operatorOnly: true,
        ref: "leak-assignment",
        to: "Priya",
      },
      {
        at: "2026-08-23T13:20:00Z",
        client: "Devon",
        kind: "refresh_blocked",
        lastReadiness: 92,
        lastRunAt: "2026-08-22T09:01:00Z",
        operatorOnly: true,
        ref: "leak-blocked",
        resetsOn: "2026-09-01",
      },
      {
        amountCents: 4000000,
        at: "2026-08-23T17:30:00Z",
        bank: "Example Bank",
        client: "Devon",
        decidedOn: "2026-08-23",
        kind: "application_outcome",
        kindWord: "funded",
        ref: "leak-outcome",
      },
    ]);
    const items = [...timelineFixture({ audience: "consumer" }), ...operatorOnly];
    const forbidden = new Set(["leak-assignment", "leak-blocked", "leak-outcome"]);

    for (const filter of FILTERS) {
      const { blocks } = plan(items, "consumer", { filter });
      for (const row of rowsOf(blocks)) {
        assert.ok(!forbidden.has(row.ref), `the consumer's ${filter} view rendered ${row.ref}`);
      }
      // And nothing anywhere in the rendered strings names them either.
      for (const rendered of textOf(blocks)) {
        assert.doesNotMatch(rendered, /Assigned to|Refresh unavailable|Outcome recorded/);
      }
    }

    // Non-vacuous: the operator does see all three.
    const operator = plan([...timelineFixture({ audience: "operator" }), ...operatorOnly], "operator");
    const seen = new Set(rowsOf(operator.blocks).map((row) => row.ref));
    for (const ref of forbidden) assert.ok(seen.has(ref), `the operator lost ${ref} as well`);
  });

  it("shows the outcome once it is released", () => {
    const released = timelineThreadItems([
      {
        amountCents: 4000000,
        at: "2026-08-23T17:30:00Z",
        bank: "Example Bank",
        client: "Devon",
        decidedOn: "2026-08-23",
        kind: "application_outcome",
        kindWord: "funded",
        ref: "released-outcome",
        releasedOn: "2026-08-24",
      },
    ]);
    const { blocks } = plan(released, "consumer");
    assert.ok(rowsOf(blocks).some((row) => row.ref === "released-outcome"));
  });

  it("never shows a consumer an internal note", () => {
    const items = timelineFixture({ audience: "consumer" });
    for (const item of items) {
      if (item.type !== "message") continue;
      assert.notEqual(item.message.visibility, "internal");
    }
  });
});

describe("a calendar fact does not move between two readers' zones", () => {
  it("renders identical dates in Honolulu and Los Angeles, for every state", () => {
    // The pair the mockup was screenshotted in. What is compared is every rendered string that
    // contains a date-only fact — a first charge, a payment's received date, a cap reset, a decision.
    const render = (zone: string) => {
      process.env.TZ = zone;
      const out: Record<string, string[]> = {};
      for (const state of STATES) {
        for (const audience of AUDIENCES) {
          out[`${state.name}/${audience}`] = textOf(
            plan(state.items(audience), audience, {
              ...(state.readFailed ? { readFailed: true } : {}),
            }).blocks,
          ).filter((each) => /Received|first charge|resets|decided|access|Paused/.test(each));
        }
      }
      return out;
    };
    const honolulu = render("Pacific/Honolulu");
    const angeles = render("America/Los_Angeles");
    assert.deepEqual(angeles, honolulu);
    // Non-vacuous: there were dated strings to compare.
    assert.ok(
      Object.values(honolulu).some((each) => each.length > 0),
      "no dated string was compared, so this proves nothing",
    );
  });
});

describe("a review receipt", () => {
  /** Every review action a plan offers, paired with the upload it is about. */
  function reviews(blocks: readonly TimelineBlock[]) {
    return bandViews(blocks).flatMap((view) =>
      view.actions.flatMap((action) =>
        action.intent === "review" ? [{ done: action.done, upload: action.uploadId }] : [],
      ),
    );
  }

  it("is offered on a document the operator has not signed off, and never to the consumer", () => {
    const operator = reviews(plan(timelineDenseFixture({ audience: "operator" }), "operator").blocks);
    assert.ok(operator.length > 0, "no document band offered a review at all");
    assert.ok(
      operator.some((review) => !review.done),
      "every document in the dense fixture was already signed off, so the open case is untested",
    );
    assert.ok(
      operator.some((review) => review.done),
      "no document carried a durable receipt, so the settled case is untested",
    );
    assert.deepEqual(
      reviews(plan(timelineDenseFixture({ audience: "consumer" }), "consumer").blocks),
      [],
      "a consumer was offered operator bookkeeping",
    );
  });

  it("reads as done for the upload it was recorded against, and only that one", () => {
    const items = timelineDenseFixture({ audience: "operator" });
    const before = reviews(plan(items, "operator").blocks);
    const open = before.filter((review) => !review.done).map((review) => review.upload);
    assert.ok(open.length >= 2, `only ${open.length} open documents: the "only that one" half is vacuous`);

    const [recorded] = open;
    const after = reviews(plan(items, "operator", { reviewedUploadIds: [recorded!] }).blocks);
    assert.deepEqual(
      after.filter((review) => !review.done).map((review) => review.upload),
      open.slice(1),
      "recording one review moved a different document's state",
    );
  });

  it("stops being the thread's one filled action once it is recorded", () => {
    const items = timelineDenseFixture({ audience: "operator" });
    const every = reviews(plan(items, "operator").blocks).map((review) => review.upload);
    for (const recorded of [[] as readonly string[], every]) {
      const { blocks } = plan(items, "operator", { reviewedUploadIds: recorded });
      for (const view of bandViews(blocks)) {
        if (!view.primary) continue;
        assert.ok(
          view.actions.some(isPrimaryEligible),
          `the filled band offers no work left to do (${recorded.length} reviews recorded)`,
        );
      }
    }
  });
});
