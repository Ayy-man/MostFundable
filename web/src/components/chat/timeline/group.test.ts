// The render plan: transitions, day boundaries, runs, folds and the hoisted primary.
//
// Every expectation is derived from the catalog or the fixture at test time. In particular the sticky
// set is read off `TIMELINE_CATALOG`, never listed here — the specific regression this guards is the
// one round 5 named, where a fix was correct and the enumeration standing in for it rotted.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { TimelineAudience, TimelineEvent } from "@/lib/timeline/types";

import type { ChatMessage, ChatThreadItem } from "../types";
import { specFor, type TimelineRow } from "./catalog";
import { expandTransitions } from "./expand-transitions";
import {
  FIXTURE_EVENTS,
  FIXTURE_NEW_SINCE,
  timelineDenseFixture,
  timelineFixture,
} from "./fixture";
import { groupTimeline, type TimelineBlock } from "./group";
import { primaryTarget } from "./primary-target";
import { timelineThreadItems } from "./items";

const isOwn = (message: ChatMessage) => message.author.name === "You";

/** Every row a plan renders, however deeply a run or a fold holds it. */
function rowsOf(blocks: readonly TimelineBlock[]): TimelineRow[] {
  return blocks.flatMap((block) => {
    if (block.type === "line" || block.type === "band") return [block.row];
    if (block.type === "run") return block.lines.map((entry) => entry.row);
    if (block.type === "fold") return block.bands.map((entry) => entry.row);
    return [];
  });
}

/** Every row that is inside a disclosure — a run, or a fold's collapsed list. */
function collapsedRows(blocks: readonly TimelineBlock[]): TimelineRow[] {
  return blocks.flatMap((block) =>
    block.type === "run"
      ? block.lines.map((entry) => entry.row)
      : block.type === "fold"
        ? block.bands.map((entry) => entry.row)
        : [],
  );
}

function bandsOf(blocks: readonly TimelineBlock[]) {
  return blocks.flatMap((block) =>
    block.type === "band"
      ? [block.view]
      : block.type === "fold"
        ? block.bands.map((entry) => entry.view)
        : [],
  );
}

function plan(
  items: readonly ChatThreadItem[],
  audience: TimelineAudience,
  options: Parameters<typeof groupTimeline>[3] = {},
) {
  return groupTimeline(items, audience, isOwn, options);
}

describe("a state change is two rows", () => {
  it("adds a transition at the instant the change happened, not at the origin's", () => {
    const rows = expandTransitions(FIXTURE_EVENTS, "operator");
    const added = rows.filter((row) => row.kind === "transition");
    // Three status fields carry a change in this fixture: a fulfilled request and a verified action.
    assert.ok(added.length >= 2, `only ${added.length} transitions`);
    for (const transition of added) {
      assert.ok(
        !FIXTURE_EVENTS.some((event) => event.at === transition.at && event.ref === transition.ref),
        "a transition reused its origin's identity",
      );
    }
    const request = FIXTURE_EVENTS.find((event) => event.kind === "document_requested");
    assert.ok(request && request.kind === "document_requested" && request.fulfilledAt);
    assert.ok(
      added.some((row) => row.at === request.fulfilledAt),
      "the fulfilled request produced no row at the instant it was fulfilled",
    );
  });

  it("leaves the origin band's opening title alone", () => {
    // The band still says what it said on the day it appeared; only its status chip moved.
    const items = timelineFixture({ audience: "operator" });
    const blocks = plan(items, "operator").blocks;
    const action = bandsOf(blocks).find((view) => view.noun === "Action");
    assert.ok(action, "the verified action band is not in the plan");
    assert.match(action.title.map((part) => (typeof part === "string" ? part : part.strong)).join(""), /^New action for /);
    assert.equal(action.status?.marker, "verified");
  });

  it("writes a transition as a reference, in the audience's voice", () => {
    const consumer = expandTransitions(FIXTURE_EVENTS, "consumer").filter(
      (row) => row.kind === "transition",
    );
    const operator = expandTransitions(FIXTURE_EVENTS, "operator").filter(
      (row) => row.kind === "transition",
    );
    const consumerSent = consumer.find((row) => row.kind === "transition" && row.noun === "Document");
    const operatorSent = operator.find((row) => row.kind === "transition" && row.noun === "Document");
    assert.ok(consumerSent?.kind === "transition" && operatorSent?.kind === "transition");
    assert.match(consumerSent.title, /^You sent /);
    assert.match(operatorSent.title, /^Devon sent /);
  });
});

describe("day boundaries and the new-since marker", () => {
  it("opens with a divider and draws one on every day change", () => {
    const blocks = plan(timelineFixture({ audience: "operator" }), "operator").blocks;
    assert.equal(blocks[0]?.type, "divider", "the plan does not open with a day divider");
    const dividers = blocks.filter((block) => block.type === "divider");
    const days = new Set(
      rowsOf(blocks)
        .map((row) => new Date(row.at).toDateString())
        .values(),
    );
    assert.ok(dividers.length >= days.size - 1, "fewer dividers than the thread has days");
  });

  it("marks the first row after the watermark, once", () => {
    const blocks = plan(timelineFixture({ audience: "operator" }), "operator", {
      newSince: FIXTURE_NEW_SINCE,
    }).blocks;
    const marked = blocks.filter((block) => block.type === "divider" && block.newSince);
    assert.equal(marked.length, 1, `${marked.length} new-since dividers`);
    const index = blocks.findIndex((block) => block.type === "divider" && block.newSince);
    const after = rowsOf(blocks.slice(index));
    for (const row of after) {
      assert.ok(
        new Date(row.at) > new Date(FIXTURE_NEW_SINCE),
        `${row.kind} sits under the marker but happened before it`,
      );
    }
  });

  it("draws no marker when there is no watermark to draw it from", () => {
    const blocks = plan(timelineFixture({ audience: "operator" }), "operator").blocks;
    assert.deepEqual(
      blocks.filter((block) => block.type === "divider" && block.newSince),
      [],
    );
  });
});

describe("runs and folds", () => {
  it("collapses adjacent low-weight lines from two, and says what it holds", () => {
    const blocks = plan(timelineDenseFixture({ audience: "operator" }), "operator").blocks;
    const runs = blocks.filter((block) => block.type === "run");
    assert.ok(runs.length > 0, "ten days of line noise produced no run");
    for (const run of runs) {
      if (run.type !== "run") continue;
      assert.ok(run.lines.length >= 2, "a run collapsed a single row");
      assert.match(run.label, /^\d+ updates · /, `run label is not a summary: ${run.label}`);
      assert.match(run.label, / to /, "a run label carries no time range");
      for (const noun of new Set(run.lines.map((entry) => entry.view.noun))) {
        assert.ok(run.label.includes(noun), `the run does not say it holds a ${noun}`);
      }
    }
  });

  it("never collapses anything sticky", () => {
    // The sticky set comes off the catalog. A kind that becomes sticky is covered here the day its
    // entry says so, and a kind that stops being sticky stops being asserted about — which is the
    // difference between deriving the rule and transcribing it.
    for (const audience of ["consumer", "operator"] as const) {
      const blocks = plan(timelineDenseFixture({ audience }), audience).blocks;
      // Non-vacuous: the dense thread does hold sticky rows, and they are all at the top level.
      const stickyRows = rowsOf(blocks).filter((row) => specFor(row.kind).sticky === true);
      assert.ok(stickyRows.length >= 4, `${audience}: only ${stickyRows.length} sticky rows`);
      for (const row of collapsedRows(blocks)) {
        const spec = specFor(row.kind);
        assert.notEqual(
          spec.sticky,
          true,
          `${row.kind} is sticky and was collapsed into a disclosure`,
        );
        assert.notEqual(
          spec.operatorOnly,
          true,
          `${row.kind} is operator-only and was collapsed into a disclosure`,
        );
      }
    }
  });

  it("folds adjacent same-kind bands with a count, operator-side only", () => {
    const blocks = plan(timelineDenseFixture({ audience: "operator" }), "operator").blocks;
    const folds = blocks.filter((block) => block.type === "fold");
    assert.ok(folds.length > 0, "eighteen filed documents produced no fold");
    for (const fold of folds) {
      if (fold.type !== "fold") continue;
      assert.ok(fold.bands.length >= 2);
      assert.match(fold.title, /^\d+ documents filed$/);
      assert.match(fold.body, /not yet reviewed\.$/);
      assert.equal(
        new Set(fold.bands.map((entry) => entry.row.kind)).size,
        1,
        "a fold mixed two kinds",
      );
    }
    // The consumer reads a filed document as a line, so there is nothing of that kind to fold.
    const consumer = plan(timelineDenseFixture({ audience: "consumer" }), "consumer").blocks;
    assert.deepEqual(consumer.filter((block) => block.type === "fold"), []);
  });

  it("hoists the primary band out of a fold rather than refusing to fold", () => {
    // Round 4's fix, and the reason it is worth a test: the alternative was folding disabling itself
    // whenever the group held the primary, which is the dense thread's most common case.
    const filed = (day: number, reviewed: boolean): TimelineEvent => ({
      at: new Date(Date.UTC(2026, 7, 20, day)).toISOString(),
      client: "Casey",
      kind: "document_filed",
      name: "Bank statement",
      named: "a bank statement",
      ref: `fold-${day}`,
      section: "Business profile",
      uploadId: `fold-upload-${day}`,
      ...(reviewed ? { reviewedBy: "Priya" } : {}),
    });
    const items = timelineThreadItems([filed(9, false), filed(10, false), filed(11, false)]);
    const blocks = plan(items, "operator").blocks;
    const fold = blocks.find((block) => block.type === "fold");
    assert.ok(fold?.type === "fold", "three same-kind bands did not fold");
    const filledBands = bandsOf(blocks).filter((view) => view.primary);
    assert.equal(filledBands.length, 1, "the fold lost or duplicated the filled band");
    assert.deepEqual(
      fold.bands.filter((entry) => entry.view.primary),
      [],
      "the one filled action is inside a collapsed disclosure",
    );
    const outside = blocks.filter((block) => block.type === "band" && block.view.primary);
    assert.equal(outside.length, 1, "the primary band was not hoisted out beside the fold");
  });
});

describe("the one filled action, in every filter state", () => {
  it("fills exactly one visible band, or none, for every chip", () => {
    const items = timelineFixture({ audience: "operator" });
    for (const filter of ["all", "messages", "analysis", "documents", "stage", "billing"] as const) {
      const { blocks } = plan(items, "operator", { filter });
      const filled = bandsOf(blocks).filter((view) => view.primary);
      assert.ok(filled.length <= 1, `${filter} filled ${filled.length} bands`);
      const visible = rowsOf(blocks);
      const expected = primaryTarget(visible, "operator");
      assert.equal(
        filled.length,
        expected === null ? 0 : 1,
        `${filter} disagrees with primaryTarget about whether anything is fillable`,
      );
    }
  });

  it("picks from the visible rows, so filtering cannot hide the filled control", () => {
    // Round 3's fix. Chosen over the whole thread, the primary for `documents` would be the analysis
    // band, which that filter removes — leaving a thread with no filled action while a band somewhere
    // claimed one.
    const items = timelineFixture({ audience: "operator" });
    const all = plan(items, "operator", { filter: "all" });
    const documents = plan(items, "operator", { filter: "documents" });
    const allPrimary = bandsOf(all.blocks).find((view) => view.primary);
    const docsPrimary = bandsOf(documents.blocks).find((view) => view.primary);
    assert.ok(allPrimary && docsPrimary);
    assert.notEqual(allPrimary.noun, "Document", "the fixture no longer exercises this");
    assert.equal(docsPrimary.noun, "Document");
  });
});

describe("messages", () => {
  it("groups consecutive messages from one person and breaks on an event between them", () => {
    const message = (index: number, minute: number, name: string): ChatThreadItem => ({
      message: {
        author: { kind: "operator", name },
        body: `line ${index}`,
        delivery: "delivered",
        origin: "human",
        ref: `m-${index}`,
        sentAt: new Date(Date.UTC(2026, 7, 20, 9, minute)).toISOString(),
        visibility: "participants",
      },
      type: "message",
    });
    const together = plan([message(1, 0, "Priya"), message(2, 1, "Priya")], "operator").blocks;
    const groups = together.filter((block) => block.type === "group");
    assert.equal(groups.length, 1, "two messages a minute apart did not group");

    const split = plan(
      [
        message(1, 0, "Priya"),
        {
          timeline: {
            actor: "Priya",
            at: new Date(Date.UTC(2026, 7, 20, 9, 0, 30)).toISOString(),
            client: "Devon",
            kind: "stage_changed",
            ref: "between",
            to: "Optimization",
          },
          type: "event",
        },
        message(2, 1, "Priya"),
      ],
      "operator",
    ).blocks;
    assert.equal(
      split.filter((block) => block.type === "group").length,
      2,
      "a stage move between two messages did not break the group",
    );
  });

  it("hides every event and no message when the consumer hides updates", () => {
    const items = timelineFixture({ audience: "consumer" });
    const shown = plan(items, "consumer");
    const hidden = plan(items, "consumer", { hideEvents: true });
    assert.equal(hidden.eventCount, 0);
    assert.equal(hidden.messageCount, shown.messageCount);
    assert.ok(shown.eventCount > 0, "the fixture shows the consumer no events at all");
  });
});
