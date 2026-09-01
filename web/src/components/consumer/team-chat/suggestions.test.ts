// The suggested questions, and the defect they exist to close.
//
// The defect: a chip reading "What should I finish before the Aug 13 refresh?" that came from a
// fixture and rendered on the live path too, so a signed-in client with no scheduled refresh was
// handed a deadline nothing in the database held. It was closed once by deleting that one string,
// which fixed the symptom and left the shape — a row of literals that could not be wrong only
// because it could not change.
//
// So these assertions are about the shape rather than about those four strings.
//
// Every `basis` is checked against the keys of a snapshot **built from a real `TrackerClient`**
// through the same adapter the view uses, not against a list written here. A field that leaves
// `ConsumerClientSnapshot` therefore fails this file instead of quietly grounding a chip on
// nothing.
//
// And the "no figure" rule is asserted as "no rule's text can contain a digit at all", which is
// the mechanical form of "no chip may carry a date or a figure that did not come from a durable
// read": a string with no digits in it cannot carry a wrong one, and a rule that starts
// interpolating a snapshot value fails the moment its output has a number in it.
//
// Watched failing on the pre-fix tree: pointed at the four literals `consumer.tsx` shipped —
// including the deleted "Aug 13" one — "no suggestion can carry a date or a figure" reports the
// offending chip by name, and "the row is empty when nothing is known" fails outright, because
// the old row rendered unconditionally.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { TrackerClient } from "@/lib/tracker/types";

import { snapshotFrom, snapshotFields } from "./client-snapshot";
import { MAX_SUGGESTIONS, SUGGESTION_RULES, suggestionsFor } from "./suggestions";
import type { ConsumerClientSnapshot } from "./types";

function client(over: Partial<TrackerClient> = {}): TrackerClient {
  return {
    analysisAt: null,
    analysisPending: null,
    archivedAt: null,
    archivedById: null,
    assignedToId: null,
    assignedToName: null,
    businessName: null,
    consumerProfileId: null,
    displayName: "Casey Clean Demo",
    estimatedCompletionAt: null,
    fundingApprovedCents: null,
    goalCents: null,
    health: "green",
    history: [],
    id: "a3000000-0000-0000-0000-000000000001",
    lastActivityAt: "2026-08-20T09:00:00.000Z",
    matchesUnlockedOverride: false,
    monitoring: "active",
    nextRefreshAt: null,
    openActionCount: null,
    readiness: null,
    stage: "optimization",
    stageEnteredAt: "2026-08-01T00:00:00.000Z",
    startedAt: "2026-07-20T00:00:00.000Z",
    status: "active",
    ...over,
  };
}

function snapshot(over: Partial<TrackerClient> = {}): ConsumerClientSnapshot {
  return snapshotFrom(client(over));
}

/** Any digit at all. A chip with no digits cannot carry a date or a figure that came from nowhere. */
const DIGIT = /\d/;

describe("consumer team chat · suggested questions", () => {
  it("grounds every rule in a field the snapshot actually carries", () => {
    // Derived from a snapshot built through the real adapter, so a field dropped from
    // `ConsumerClientSnapshot` fails here rather than leaving a rule grounded on nothing.
    const fields = new Set(snapshotFields(client()));
    assert.ok(fields.size >= 5, `the snapshot narrowed to ${[...fields].join(", ")}`);
    for (const rule of SUGGESTION_RULES) {
      assert.ok(
        fields.has(rule.basis),
        `"${rule.text}" claims to read ${rule.basis}, which the snapshot does not carry`,
      );
    }
  });

  it("cannot carry a date or a figure", () => {
    for (const rule of SUGGESTION_RULES) {
      assert.equal(
        DIGIT.test(rule.text),
        false,
        `"${rule.text}" contains a figure, which no chip may do — that is the shipped defect`,
      );
    }
  });

  it("offers nothing when nothing is known", () => {
    // `null` is a read that has not answered: loading, failed, or a workspace with no client row.
    // All three mean the same thing here, and offering the row anyway is how a fixture reaches a
    // live path.
    assert.deepEqual(suggestionsFor(null), []);
  });

  it("changes with the state it derives from", () => {
    const waiting = suggestionsFor(snapshot({ analysisPending: "running" }));
    const reviewed = suggestionsFor(
      snapshot({ analysisAt: "2026-08-18T00:00:00.000Z", readiness: 71 }),
    );
    assert.notDeepEqual(waiting, reviewed, "the row is the same whatever the client's state");
    assert.ok(waiting.length > 0 && reviewed.length > 0);
  });

  it("offers the refresh question only where a refresh is scheduled", () => {
    // The chip that replaces the one which named a date. The refresh is named; the date is not,
    // and it appears at all only because `nextRefreshAt` holds something.
    const refresh = SUGGESTION_RULES.find((rule) => rule.basis === "nextRefreshAt");
    assert.ok(refresh, "no rule reads nextRefreshAt any more");
    assert.equal(refresh.when(snapshot({ nextRefreshAt: null })), false);
    assert.equal(refresh.when(snapshot({ nextRefreshAt: "2026-09-13T00:00:00.000Z" })), true);
  });

  it("has no rule that can never fire", () => {
    // A rule nobody can reach is a suggestion that was written and then quietly lost, which is
    // indistinguishable from one that was never written.
    //
    // Driven against a matrix rather than a basis-to-driver table. The table version was written
    // first and was wrong in an instructive way: two rules read `analysisAt` with opposite
    // predicates, so one driver per basis could only ever reach one of them and the check reported
    // a live rule as dead. The matrix asks the real question — is there any state at all in which
    // this rule fires — without a second opinion about which state that is.
    const states = [
      snapshot(),
      snapshot({ analysisPending: "queued" }),
      snapshot({ analysisAt: "2026-08-18T00:00:00.000Z", analysisPending: "running" }),
      snapshot({ analysisAt: "2026-08-18T00:00:00.000Z", readiness: 71 }),
      snapshot({ monitoring: "paused" }),
      snapshot({ monitoring: "pending" }),
      snapshot({ openActionCount: 0 }),
      snapshot({ openActionCount: 3 }),
      snapshot({ nextRefreshAt: "2026-09-13T00:00:00.000Z" }),
    ];
    for (const rule of SUGGESTION_RULES) {
      assert.ok(
        states.some((state) => rule.when(state)),
        `"${rule.text}" can never be offered`,
      );
    }
    // And every rule reaches the row in at least one of those states, so a rule that fires but is
    // always crowded out past `MAX_SUGGESTIONS` is caught too.
    const offered = new Set(states.flatMap((state) => suggestionsFor(state)));
    for (const rule of SUGGESTION_RULES) {
      assert.ok(offered.has(rule.text), `"${rule.text}" fires but never reaches the row`);
    }
  });

  it("never offers more than the row holds, and never the same question twice", () => {
    const busiest = suggestionsFor(
      snapshot({
        analysisAt: "2026-08-18T00:00:00.000Z",
        analysisPending: "running",
        monitoring: "paused",
        nextRefreshAt: "2026-09-13T00:00:00.000Z",
        openActionCount: 4,
        readiness: 71,
      }),
    );
    assert.ok(busiest.length <= MAX_SUGGESTIONS, `${busiest.length} chips offered at once`);
    assert.equal(new Set(busiest).size, busiest.length, "the same question is offered twice");
  });

  it("puts nothing on screen that the rules did not produce", () => {
    // Both directions: everything offered is a rule's own text, and no offered chip has a figure
    // in it either — the second half is what would catch a caller interpolating a value on the
    // way out.
    const texts = new Set(SUGGESTION_RULES.map((rule) => rule.text));
    for (const state of [
      snapshot(),
      snapshot({ analysisPending: "queued" }),
      snapshot({ analysisAt: "2026-08-18T00:00:00.000Z", openActionCount: 2, readiness: 88 }),
      snapshot({ monitoring: "pending", nextRefreshAt: "2026-09-13T00:00:00.000Z" }),
    ]) {
      for (const offered of suggestionsFor(state)) {
        assert.ok(texts.has(offered), `"${offered}" is not one of the rules`);
        assert.equal(DIGIT.test(offered), false, `"${offered}" reached the row carrying a figure`);
      }
    }
  });
});
