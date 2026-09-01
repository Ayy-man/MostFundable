import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyBankTrend, deriveBankHistoricalStats } from "@/lib/demo/feedback-fixtures";

import { summariseWindow, summariseWindows, toDetailPayload, toListRow } from "./read-model.ts";
import { BANK_WINDOW_KEYS, type BankReadModelRow, type BankWindowCounts } from "./types.ts";

/**
 * The arithmetic between `bank_outcome_stats.windows` and what the Bank Vault
 * renders. Every expectation is computed from the input in the test rather than
 * transcribed from a run, so a change to the conversion has to be wrong in both
 * places at once to stay green.
 */

function counts(overrides: Partial<BankWindowCounts> = {}): BankWindowCounts {
  return { approved: 0, denied: 0, withdrawn: 0, approved_amount_cents: 0, ...overrides };
}

function row(overrides: Partial<BankReadModelRow> = {}): BankReadModelRow {
  return {
    bank_ref: "example-bank",
    name: "Example Bank",
    products: ["Term loan"],
    bureau_pulls: "Experian business",
    qualification_summary: "Current business records",
    channel_type: "online",
    channel_value: "https://example.com/apply",
    checking_required: true,
    checking_deposit_cents: 100_000,
    checking_seasoning: "90 days",
    rel_manager: false,
    rel_manager_tip: "Expect a call.",
    application_questions: [],
    source_updated_at: "2026-07-20",
    synced_at: "2026-08-19T00:00:00.000Z",
    heat_level: "warm",
    windows: null,
    last_outcome_at: null,
    approved_amount_cents_total: null,
    outcome_count_total: null,
    ...overrides,
  };
}

describe("one window becomes the numbers the surface renders", () => {
  const CASES: BankWindowCounts[] = [
    counts(),
    counts({ approved: 3, denied: 1, withdrawn: 1, approved_amount_cents: 1_050_000 }),
    counts({ approved: 1, denied: 0, withdrawn: 0, approved_amount_cents: 33_333 }),
    counts({ approved: 0, denied: 7, withdrawn: 2 }),
    counts({ approved: 12, denied: 5, withdrawn: 0, approved_amount_cents: 4_000_000 }),
  ];

  for (const input of CASES) {
    it(`reconciles ${JSON.stringify(input)}`, () => {
      const summary = summariseWindow(input);
      // Decided outcomes only. The frozen `deriveBankHistoricalStats` counts
      // approvals and denials, so a withdrawn application moves neither the
      // count nor the rate — see `displayed-rate.test.ts` for the reconciliation
      // that pins both sides of that to the same seed.
      const total = input.approved + input.denied;

      assert.equal(summary.outcomes, total);
      assert.equal(summary.approvals, input.approved);
      // The rate is derived from the same two numbers the surface would have to
      // divide itself, at the 0–100 scale and two-place rounding the frozen
      // fixture derivation uses.
      assert.equal(
        summary.approvalRate,
        total === 0 ? 0 : Math.round((input.approved / total) * 100 * 100) / 100,
      );
      // Migration 080's `outcomes_amount_shape` makes an approved outcome carry
      // a positive amount and no other kind carry one, so the funded count is
      // the approved count by construction rather than by assumption.
      assert.equal(summary.fundedCount, input.approved);
      assert.equal(summary.fundedAmount, Math.round(input.approved_amount_cents / 100 * 100) / 100);
      assert.equal(
        summary.averageFundedAmount,
        input.approved === 0
          ? 0
          : Math.round((summary.fundedAmount / input.approved) * 100) / 100,
      );
    });
  }

  it("never divides by zero and never reports a rate for nothing", () => {
    const summary = summariseWindow(counts());
    assert.equal(summary.approvalRate, 0);
    assert.equal(summary.averageFundedAmount, 0);
  });

  it("treats a missing or malformed count as zero rather than NaN", () => {
    const summary = summariseWindow({ approved: -1, denied: Number.NaN } as unknown as BankWindowCounts);
    assert.equal(summary.outcomes, 0);
    assert.equal(summary.approvalRate, 0);
  });
});

describe("a lender with no counted outcome", () => {
  it("serves five zeroed windows rather than an absent shape the surface must guard", () => {
    const summary = summariseWindows(null);
    assert.deepEqual(Object.keys(summary).sort(), [...BANK_WINDOW_KEYS].sort());
    for (const key of BANK_WINDOW_KEYS) {
      assert.equal(summary[key].outcomes, 0);
    }
  });

  it("keeps its heat level null, which is a different fact from cold", () => {
    // 081 writes 'cold' when a lender has history but none of it recent. Null
    // here means the refresh has never produced a row at all, and collapsing the
    // two would make "nothing happened" and "nothing was computed" the same.
    assert.equal(toListRow(row({ heat_level: null })).heatLevel, null);
  });
});

describe("the read-model row becomes the surface's shapes", () => {
  it("cleans legacy cached markdown and internal source handles at read time", () => {
    const payload = toDetailPayload(row({
      application_questions: [{
        id: "timing",
        label: "**Application timing**",
        responseBasis: "- **3-day rule (HowToCredit `fBqsFVBezyw`):** applying ≤3 days after opening",
      }],
    }));

    assert.deepEqual(payload.applicationQuestions, [{
      id: "timing",
      label: "Application timing",
      responseBasis: "3-day rule: applying ≤3 days after opening",
    }]);
  });

  it("maps identity and stats onto the list row", () => {
    const source = row({
      windows: {
        d30: counts({ approved: 2, denied: 1, approved_amount_cents: 600_000 }),
        d60: counts({ approved: 2, denied: 1, approved_amount_cents: 600_000 }),
        d90: counts({ approved: 3, denied: 2, approved_amount_cents: 900_000 }),
        d183: counts({ approved: 3, denied: 2, approved_amount_cents: 900_000 }),
        d365: counts({ approved: 4, denied: 2, approved_amount_cents: 1_200_000 }),
      },
      last_outcome_at: "2026-08-18T00:00:00.000Z",
    });
    const list = toListRow(source);

    assert.equal(list.bankRef, source.bank_ref);
    assert.equal(list.name, source.name);
    assert.deepEqual(list.products, source.products);
    assert.equal(list.bureauPulls, source.bureau_pulls);
    assert.equal(list.heatLevel, source.heat_level);
    assert.equal(list.lastOutcomeAt, source.last_outcome_at);
    assert.equal(list.windows.d365.approvals, 4);
    assert.equal(list.windows.d30.fundedAmount, 6000);
  });

  it("maps §6's four detail blocks", () => {
    const detail = toDetailPayload(
      row({
        application_questions: [
          { id: "q", label: "Question", responseBasis: "Use the current records." },
        ],
      }),
    );
    assert.deepEqual(detail.channel, { type: "online", value: "https://example.com/apply" });
    assert.deepEqual(detail.checking, {
      required: true,
      depositAmountCents: 100_000,
      seasoning: "90 days",
    });
    assert.deepEqual(detail.relationshipManager, { required: false, tip: "Expect a call." });
    assert.equal(detail.applicationQuestions.length, 1);
    assert.equal(detail.sourceUpdatedAt, "2026-07-20");
  });

  it("gives the in-person channel no value, so the branch copy is what renders", () => {
    const detail = toDetailPayload(row({ channel_type: "in-person", channel_value: null }));
    assert.deepEqual(detail.channel, { type: "in-person", value: null });
  });

  it("serves a null channel when nobody recorded how to apply", () => {
    assert.equal(toDetailPayload(row({ channel_type: null, channel_value: null })).channel, null);
  });
});

describe("the durable numbers feed the frozen surface's own helpers", () => {
  // The trend tiles (#205) call `classifyBankTrend` on two period rows. It reads
  // `approvalRate` and `outcomes` — the two fields this module computes — so the
  // five trend states have to be reachable from durable rows, not only from the
  // fixture derivation the helper was written against.
  it("reaches every trend state the frozen tiles render", () => {
    const at = (approved: number, denied: number) =>
      summariseWindow(counts({ approved, denied }));

    const seen = new Set([
      classifyBankTrend(at(9, 1), at(1, 9)),
      classifyBankTrend(at(11, 9), at(5, 5)),
      classifyBankTrend(at(5, 5), at(5, 5)),
      classifyBankTrend(at(5, 5), at(11, 9)),
      classifyBankTrend(at(1, 9), at(9, 1)),
    ]);
    assert.deepEqual(
      [...seen].sort(),
      ["Down", "Neutral", "Trending down", "Trending up", "Up"],
    );
  });

  it("produces the same shape the fixture derivation does", () => {
    // Not the same numbers — different data — but the same field set, which is
    // what lets `operator.tsx` swap one for the other without touching a
    // rendered line.
    const fixture = deriveBankHistoricalStats("30d")[0];
    const durable = toListRow(row({ windows: null }));
    for (const field of ["outcomes", "approvals", "approvalRate", "fundedCount", "fundedAmount", "averageFundedAmount"] as const) {
      assert.equal(typeof durable.windows.d30[field], typeof fixture[field], field);
    }
  });
});
