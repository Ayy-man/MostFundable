import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BANK_DETAILS } from "@/lib/demo/co-fixtures";
import { BANK_FIXTURES } from "@/lib/demo/feedback-fixtures";

import { FIXTURE_BANK_RECORDS } from "./fixture-driver.ts";
import { STANDING_APPLICATION_QUESTIONS, withStandingQuestions } from "./standing-questions.ts";
import { planSync } from "./sync.ts";

/**
 * The durable path and the fixture path must show a reader the same thing.
 *
 * The frontend froze on 2026-08-18 at `4bb5232`, so flipping `FEATURE_VAULT` is
 * meant to change where the Bank Vault's data comes from and nothing else. That
 * only holds while `fixture-driver.ts` and migration 382 agree with the frozen
 * fixtures, and agreement is the kind of thing that rots quietly — so every
 * assertion below is *derived* from the fixture modules at test time rather than
 * transcribed here. A fixture edit that the durable side does not follow fails
 * in this file instead of at a client review.
 */

const SYNCED = planSync(FIXTURE_BANK_RECORDS, {
  source: "fixture",
  syncedAt: "2026-08-19T00:00:00.000Z",
});

describe("the fixture driver reproduces the frozen Bank Vault", () => {
  it("rejects nothing: every frozen lender survives the sync core", () => {
    assert.deepEqual(SYNCED.rejected, []);
    assert.equal(SYNCED.rows.length, FIXTURE_BANK_RECORDS.length);
  });

  it("covers exactly the lenders the frozen list names", () => {
    assert.deepEqual(
      SYNCED.rows.map((row) => row.bank_ref).sort(),
      BANK_FIXTURES.map((bank) => bank.id).sort(),
    );
  });

  it("carries each lender's name, products and qualification summary unchanged", () => {
    for (const fixture of BANK_FIXTURES) {
      const row = SYNCED.rows.find((candidate) => candidate.bank_ref === fixture.id);
      assert.ok(row, `no durable row for ${fixture.id}`);
      assert.equal(row.name, fixture.name);
      assert.deepEqual(row.products, [...fixture.products]);
      assert.equal(row.qualification_summary, fixture.qualificationSummary);
      assert.equal(row.bureau_pulls, fixture.bureauPulls);
    }
  });

  it("reproduces every detail block the frozen page renders", () => {
    for (const [bankId, detail] of Object.entries(BANK_DETAILS)) {
      const row = SYNCED.rows.find((candidate) => candidate.bank_ref === bankId);
      assert.ok(row, `no durable row for ${bankId}`);

      assert.equal(row.channel_type, detail.applyChannel.type);
      assert.equal(row.channel_value, detail.applyChannel.value);

      assert.equal(row.checking_required, detail.checking.required);
      assert.equal(row.checking_deposit_cents, detail.checking.depositAmountCents);
      assert.equal(row.checking_seasoning, detail.checking.seasoning);

      assert.equal(row.rel_manager, detail.relationshipManager.required);
      assert.equal(row.rel_manager_tip, detail.relationshipManager.tip);

      assert.deepEqual(row.application_questions, detail.applicationQuestions);
    }
  });
});

describe("the four standing §6 questions", () => {
  // Derived from the frozen fixtures rather than pinned: every BANK_DETAILS
  // entry composes its questions as the standing four followed by its own, so
  // the first four of every entry are the referent.
  const frozenLeads = Object.values(BANK_DETAILS).map((detail) =>
    detail.applicationQuestions.slice(0, 4),
  );

  it("match the frozen wording character for character", () => {
    assert.ok(frozenLeads.length > 0);
    for (const lead of frozenLeads) {
      assert.deepEqual(lead, [...STANDING_APPLICATION_QUESTIONS]);
    }
  });

  it("lead every composed list, whatever a lender adds", () => {
    const composed = withStandingQuestions([
      { id: "extra", label: "Extra", responseBasis: "Use the current records." },
    ]);
    assert.deepEqual(composed.slice(0, 4), [...STANDING_APPLICATION_QUESTIONS]);
    assert.equal(composed.at(-1)?.id, "extra");
  });

  it("cannot be displaced by a lender reusing a standing id", () => {
    const composed = withStandingQuestions([
      { id: "projected-revenue", label: "Something else", responseBasis: "Different." },
    ]);
    assert.deepEqual(composed, [...STANDING_APPLICATION_QUESTIONS]);
  });
});
