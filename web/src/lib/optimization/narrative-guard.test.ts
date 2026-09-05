import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseNarrativeV1 } from "./narrative-guard.ts";

/**
 * The guard is a refusal, so most of these cases are about what it will NOT let through.
 *
 * Each malformed case is one mutation of the same valid narrative rather than a bespoke object.
 * A hand-written broken fixture proves the guard rejected something; a mutation proves it rejected
 * the specific thing named, because the only difference between it and the passing case is the
 * mutation itself.
 */
const VALID = Object.freeze({
  businessSide: "Your business identifier and website are still missing; your funding team collects both.",
  generation: { driver: "openrouter", model: "openai/gpt-5.6-luna", promptVersion: 3 },
  itemNotes: {
    credit_score_700: "Your middle score is 664, and the target is 700.",
    utilization_under_30: "Two cards report above 30% of their limit.",
  },
  nextSteps: [
    {
      detail: "Pay the balance down to $1,500 so the card reports under 30% of its limit.",
      itemKey: "utilization_under_30",
      title: "Pay the revolving card down",
    },
  ],
  schemaVersion: 1,
  timeline: { band: "30-60 days", reason: "New balances take one statement cycle to report." },
  verdict: "Not ready yet. 4 items to fix.",
  whereYouStand: "Six of the ten personal items are verified. Utilization is the biggest thing holding the score back.",
});

function mutated(change: Record<string, unknown>): unknown {
  return { ...structuredClone(VALID), ...change };
}

describe("the stored narrative guard", () => {
  it("admits a well-formed narrative and returns it as its own object", () => {
    const parsed = parseNarrativeV1(structuredClone(VALID));

    assert.ok(parsed);
    assert.equal(parsed.verdict, VALID.verdict);
    assert.equal(parsed.timeline.band, "30-60 days");
    assert.equal(parsed.nextSteps.length, 1);
    assert.equal(parsed.nextSteps[0].itemKey, "utilization_under_30");
    assert.equal(parsed.itemNotes.credit_score_700, VALID.itemNotes.credit_score_700);
    assert.equal(parsed.generation.promptVersion, 3);
  });

  it("treats a missing column and an empty column as the same answer", () => {
    // `undefined` is the pre-435 database, `null` is the column with nothing in it. A consumer
    // cannot tell those apart and neither should the view.
    assert.equal(parseNarrativeV1(undefined), null);
    assert.equal(parseNarrativeV1(null), null);
  });

  it("refuses anything that is not an object", () => {
    for (const value of ["a narrative", 42, true, [], [VALID]]) {
      assert.equal(parseNarrativeV1(value), null, JSON.stringify(value));
    }
  });

  it("refuses an unknown top-level key, so a wider shape cannot ride along", () => {
    assert.equal(parseNarrativeV1(mutated({ estimatedFundingPotential: "$50,000" })), null);
  });

  it("refuses a missing top-level key rather than rendering the hole", () => {
    for (const key of Object.keys(VALID)) {
      const partial = structuredClone(VALID) as Record<string, unknown>;
      delete partial[key];
      assert.equal(parseNarrativeV1(partial), null, `missing ${key} was admitted`);
    }
  });

  it("refuses a schema version it was not written for", () => {
    assert.equal(parseNarrativeV1(mutated({ schemaVersion: 2 })), null);
    assert.equal(parseNarrativeV1(mutated({ schemaVersion: "1" })), null);
  });

  it("refuses empty and whitespace-only prose where a sentence belongs", () => {
    for (const key of ["verdict", "whereYouStand", "businessSide"]) {
      assert.equal(parseNarrativeV1(mutated({ [key]: "" })), null, `empty ${key}`);
      assert.equal(parseNarrativeV1(mutated({ [key]: "   " })), null, `blank ${key}`);
    }
  });

  it("refuses prose that ran past the cap the card is sized for", () => {
    assert.equal(parseNarrativeV1(mutated({ verdict: "x".repeat(241) })), null);
    assert.equal(parseNarrativeV1(mutated({ whereYouStand: "x".repeat(1401) })), null);
  });

  it("refuses a timeline band outside the fixed vocabulary", () => {
    assert.equal(parseNarrativeV1(mutated({ timeline: { band: "2 weeks", reason: "Soon." } })), null);
    assert.equal(parseNarrativeV1(mutated({ timeline: { band: "30-60 days", reason: "" } })), null);
    assert.equal(
      parseNarrativeV1(mutated({ timeline: { band: "30-60 days", extra: 1, reason: "Soon." } })),
      null,
    );
  });

  it("refuses a fourth step, and admits none at all", () => {
    const step = VALID.nextSteps[0];
    assert.equal(parseNarrativeV1(mutated({ nextSteps: [step, step, step, step] })), null);
    // Nothing left to do is a real state, and blanking the card for it would punish the consumer
    // who reached it.
    assert.ok(parseNarrativeV1(mutated({ nextSteps: [] })));
  });

  it("refuses a step whose itemKey names nothing on either checklist", () => {
    assert.equal(
      parseNarrativeV1(mutated({ nextSteps: [{ ...VALID.nextSteps[0], itemKey: "open_a_new_card" }] })),
      null,
    );
    // Business keys are admitted alongside personal ones; a step may be about the business side.
    assert.ok(
      parseNarrativeV1(
        mutated({ nextSteps: [{ ...VALID.nextSteps[0], itemKey: "business_website_present" }] }),
      ),
    );
    // A step about the file as a whole names no item, and that is not a defect.
    assert.ok(parseNarrativeV1(mutated({ nextSteps: [{ ...VALID.nextSteps[0], itemKey: null }] })));
  });

  it("refuses an item note keyed to something that is not a personal item", () => {
    assert.equal(parseNarrativeV1(mutated({ itemNotes: { business_email_present: "Missing." } })), null);
    assert.equal(parseNarrativeV1(mutated({ itemNotes: { credit_score_700: "" } })), null);
    assert.equal(parseNarrativeV1(mutated({ itemNotes: { credit_score_700: 664 } })), null);
    assert.ok(parseNarrativeV1(mutated({ itemNotes: {} })));
  });

  it("refuses a generation block that does not name a real driver and version", () => {
    for (const generation of [
      { driver: "anthropic", model: "m", promptVersion: 1 },
      { driver: "mock", model: "", promptVersion: 1 },
      { driver: "mock", model: "m", promptVersion: 0 },
      { driver: "mock", model: "m", promptVersion: 1.5 },
      { driver: "mock", model: "m" },
    ]) {
      assert.equal(parseNarrativeV1(mutated({ generation })), null, JSON.stringify(generation));
    }
  });

  it("returns only the validated properties, never the stored object itself", () => {
    const stored = structuredClone(VALID);
    const parsed = parseNarrativeV1(stored);

    assert.ok(parsed);
    assert.notEqual(parsed, stored);
    assert.notEqual(parsed.itemNotes, stored.itemNotes);
    assert.deepEqual(Object.keys(parsed).sort(), Object.keys(VALID).sort());
  });
});
