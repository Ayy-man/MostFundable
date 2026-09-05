import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { factorAnchorId, narrativeNoteFor, planNarrativeProps } from "./narrative-view.ts";

import type { NarrativeV1 } from "../llm/narrative/contract.ts";
import type { ConsumerOptimizationV1, FactorV1 } from "./types.ts";

/**
 * The "Your plan" card's decisions, tested where they live.
 *
 * `npm test` runs under `node --test` with no DOM, so the card cannot be rendered and asserted
 * against. Every branch it has therefore lives in this module and the component is a transcription
 * of what these functions return — which is a better arrangement than a render test anyway,
 * because "no card at all" is asserted here as a value rather than as an absence in a tree.
 */
const NARRATIVE: NarrativeV1 = {
  businessSide: "Your business identifier is still missing; your funding team collects it.",
  generation: { driver: "mock", model: "mock-1", promptVersion: 1 },
  itemNotes: { credit_score_700: "Your middle score is 664, and the target is 700." },
  nextSteps: [
    {
      detail: "Pay the balance down to $1,500 so it reports under 30% of its limit.",
      itemKey: "utilization_under_30",
      title: "Pay the revolving card down",
    },
    { detail: "Keep every account open while the file ages.", itemKey: null, title: "Change nothing else" },
  ],
  schemaVersion: 1,
  timeline: { band: "30-60 days", reason: "New balances take one statement cycle to report." },
  verdict: "Not ready yet. 4 items to fix.",
  whereYouStand: "Six of ten personal items are verified.",
};

function view(overrides: Partial<ConsumerOptimizationV1> = {}): ConsumerOptimizationV1 {
  return {
    analysis: { bureausPulled: ["EQF"], ranAt: "2026-08-15T09:00:00.000Z", trigger: "enrollment" },
    clientId: "a3000000-0000-0000-0000-000000000002",
    estimatedCompletion: { days: null, label: "TBD" },
    narrative: NARRATIVE,
    provenance: "plan",
    readiness: 58,
    readinessLabel: "Optimization",
    reporting: { enabled: true },
    schemaVersion: 1,
    tracks: {
      business: { factors: [], kind: "business_setup", rollup: null, total: 0, verifiedCount: 0 },
      personal: { factors: [], kind: "personal_credit", rollup: null, total: 0, verifiedCount: 0 },
    },
    utilization: null,
    ...overrides,
  };
}

function factor(key: string): FactorV1 {
  return { blocking: true, children: [], key, reported: null, signal: "template copy", state: "action-needed", title: key };
}

describe("the plan narrative card's props", () => {
  it("renders nothing at all when there is no narrative", () => {
    assert.equal(planNarrativeProps(view({ narrative: null })), null);
  });

  it("carries the verdict, the standing, the timeline and the business side through unchanged", () => {
    const props = planNarrativeProps(view());

    assert.ok(props);
    assert.equal(props.verdict, NARRATIVE.verdict);
    assert.equal(props.whereYouStand, NARRATIVE.whereYouStand);
    assert.equal(props.timelineBand, "30-60 days");
    assert.equal(props.timelineReason, NARRATIVE.timeline.reason);
    assert.equal(props.businessSide, NARRATIVE.businessSide);
  });

  it("links a step to its factor row, and leaves a step that names no item unlinked", () => {
    const props = planNarrativeProps(view());

    assert.ok(props);
    assert.equal(props.steps[0].href, "#factor-utilization_under_30");
    assert.equal(props.steps[1].href, null);
    assert.equal(props.steps[0].title, "Pay the revolving card down");
    assert.equal(props.steps[0].detail, NARRATIVE.nextSteps[0].detail);
  });

  it("names the analysis the plan was written from, and says nothing when there is no date", () => {
    const dated = planNarrativeProps(view());
    assert.ok(dated?.writtenFrom);
    assert.match(dated.writtenFrom, /^Written from your latest analysis on .+\.$/);

    // A run with no timestamp gets no line rather than a line with a hole in it.
    for (const analysis of [null, { bureausPulled: [], ranAt: null, trigger: null }] as const) {
      assert.equal(planNarrativeProps(view({ analysis }))?.writtenFrom, null);
    }
  });

  it("builds the anchor a factor row carries from the item key alone", () => {
    assert.equal(factorAnchorId("credit_score_700"), "factor-credit_score_700");
  });
});

describe("the per-factor note substitution", () => {
  it("uses the narrative's note for the item it wrote one for", () => {
    assert.equal(
      narrativeNoteFor(NARRATIVE, factor("credit_score_700")),
      NARRATIVE.itemNotes.credit_score_700,
    );
  });

  it("leaves the template copy alone for an item the narrative skipped", () => {
    assert.equal(narrativeNoteFor(NARRATIVE, factor("no_late_payments")), null);
  });

  it("leaves every factor alone when there is no narrative", () => {
    assert.equal(narrativeNoteFor(null, factor("credit_score_700")), null);
  });
});
