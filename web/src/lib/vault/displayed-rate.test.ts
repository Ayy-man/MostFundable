import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { deriveBankHistoricalStats } from "@/lib/demo/feedback-fixtures";

import { summariseWindows } from "./read-model.ts";
import { BANK_WINDOW_KEYS, type BankWindowCounts, type BankWindowKey } from "./types.ts";

/**
 * VAULT-01 above the jsonb layer.
 *
 * `384_bank_read_model_reconciliation.test.sql` proves the view's windows equal
 * the seeded outcomes. It stops there, because SQL is where it lives. What the
 * operator actually reads is the output of `summariseWindows`, and between the
 * two sat an arithmetic decision nobody had asserted: which outcomes belong in
 * the approval-rate denominator.
 *
 * So this file reads that pgTAP file's own seed at test time and derives the
 * expected displayed rate from it. Editing the SQL seed moves this expectation
 * with it; transcribing the numbers here would have let the two drift, which is
 * the failure mode round 5 named.
 */

const RECONCILIATION_SQL = readFileSync(
  new URL("../../../../supabase/tests/384_bank_read_model_reconciliation.test.sql", import.meta.url),
  "utf8",
);

/** Days behind `current_date` that each window reaches back. */
const WINDOW_DAYS: Readonly<Record<BankWindowKey, number>> = {
  d30: 30,
  d60: 60,
  d90: 90,
  d183: 183,
  d365: 365,
};

interface SeededOutcome {
  bankRef: string;
  kind: "approved" | "denied" | "withdrawn";
  amountCents: number;
  daysAgo: number;
}

function seededOutcomes(): SeededOutcome[] {
  const block = RECONCILIATION_SQL.slice(
    RECONCILIATION_SQL.indexOf("insert into public.outcomes("),
    RECONCILIATION_SQL.indexOf("-- The queue is drained"),
  );
  const rows = [
    ...block.matchAll(
      /'[0-9a-f-]+',\s*'([a-z0-9-]+)',\s*'[0-9a-f-]+',\s*'(approved|denied|withdrawn)',\s*(\d+|null),\s*current_date - (\d+)/g,
    ),
  ];
  return rows.map((row) => ({
    bankRef: row[1],
    kind: row[2] as SeededOutcome["kind"],
    amountCents: row[3] === "null" ? 0 : Number(row[3]),
    daysAgo: Number(row[4]),
  }));
}

/** The seed's rows counted into windows, exactly as `bank_outcome_stats` counts them. */
function windowsFor(outcomes: readonly SeededOutcome[]): Record<BankWindowKey, BankWindowCounts> {
  const windows = {} as Record<BankWindowKey, BankWindowCounts>;
  for (const key of BANK_WINDOW_KEYS) {
    const inWindow = outcomes.filter((outcome) => outcome.daysAgo <= WINDOW_DAYS[key]);
    windows[key] = {
      approved: inWindow.filter((outcome) => outcome.kind === "approved").length,
      denied: inWindow.filter((outcome) => outcome.kind === "denied").length,
      withdrawn: inWindow.filter((outcome) => outcome.kind === "withdrawn").length,
      approved_amount_cents: inWindow
        .filter((outcome) => outcome.kind === "approved")
        .reduce((total, outcome) => total + outcome.amountCents, 0),
    };
  }
  return windows;
}

describe("the seed the pgTAP reconciliation uses is readable from here", () => {
  it("finds the rows rather than assuming them", () => {
    const outcomes = seededOutcomes();
    assert.ok(outcomes.length >= 5, `parsed ${outcomes.length} seeded outcome(s)`);
    assert.ok(outcomes.some((outcome) => outcome.kind === "withdrawn"), "no withdrawn row to reason about");
    assert.ok(outcomes.some((outcome) => outcome.kind === "denied"));
    assert.ok(outcomes.some((outcome) => outcome.kind === "approved"));
  });

  it("keeps every seeded row clear of a window boundary", () => {
    // The parse above decides window membership itself, so a row sitting on a
    // boundary would make this file's arithmetic a guess about migration 081's.
    for (const outcome of seededOutcomes()) {
      for (const days of Object.values(WINDOW_DAYS)) {
        assert.notEqual(outcome.daysAgo, days, `${outcome.bankRef} sits on the ${days}-day boundary`);
      }
    }
  });
});

describe("the displayed approval rate counts decisions, not abandoned files", () => {
  it("matches the rate derived from the seed itself", () => {
    const outcomes = seededOutcomes();
    for (const bankRef of [...new Set(outcomes.map((outcome) => outcome.bankRef))]) {
      const mine = outcomes.filter((outcome) => outcome.bankRef === bankRef);
      const summary = summariseWindows(windowsFor(mine));

      for (const key of BANK_WINDOW_KEYS) {
        const inWindow = mine.filter((outcome) => outcome.daysAgo <= WINDOW_DAYS[key]);
        const approved = inWindow.filter((outcome) => outcome.kind === "approved").length;
        const denied = inWindow.filter((outcome) => outcome.kind === "denied").length;
        const decided = approved + denied;

        assert.equal(summary[key].outcomes, decided, `${bankRef} ${key} outcomes`);
        assert.equal(
          summary[key].approvalRate,
          decided === 0 ? 0 : Math.round((approved / decided) * 10_000) / 100,
          `${bankRef} ${key} rate`,
        );
      }
    }
  });

  it("a withdrawn application does not lower the rate", () => {
    // The concrete case the seed carries: recon-alpha's year window holds two
    // approvals, one denial and one withdrawal. Counting the withdrawal would
    // read 50%, and would have meant the same column changed meaning the moment
    // FEATURE_VAULT flipped.
    const alpha = seededOutcomes().filter((outcome) => outcome.bankRef === "recon-alpha");
    assert.ok(alpha.some((outcome) => outcome.kind === "withdrawn"), "the seed no longer carries the case");

    const withWithdrawn = summariseWindows(windowsFor(alpha)).d365;
    const withoutWithdrawn = summariseWindows(
      windowsFor(alpha.filter((outcome) => outcome.kind !== "withdrawn")),
    ).d365;
    assert.equal(withWithdrawn.approvalRate, withoutWithdrawn.approvalRate);
    assert.equal(withWithdrawn.outcomes, withoutWithdrawn.outcomes);
  });

  it("agrees with the fixture derivation it replaces, on the fixtures' own numbers", () => {
    // The other half of the same claim: the durable rate has to mean what the
    // shipped column already means. `deriveBankHistoricalStats` is the frozen
    // derivation, read here rather than restated, and its `outcomes` are
    // approvals plus denials — no third kind.
    for (const stat of deriveBankHistoricalStats("12mo")) {
      const summary = summariseWindows({
        d30: { approved: 0, denied: 0, withdrawn: 0, approved_amount_cents: 0 },
        d60: { approved: 0, denied: 0, withdrawn: 0, approved_amount_cents: 0 },
        d90: { approved: 0, denied: 0, withdrawn: 0, approved_amount_cents: 0 },
        d183: { approved: 0, denied: 0, withdrawn: 0, approved_amount_cents: 0 },
        d365: {
          approved: stat.approvals,
          denied: stat.outcomes - stat.approvals,
          // Whatever the durable side is handed here must not move the rate.
          withdrawn: 9,
          approved_amount_cents: Math.round(stat.fundedAmount * 100),
        },
      }).d365;

      assert.equal(summary.outcomes, stat.outcomes, stat.bankName);
      assert.equal(summary.approvalRate, stat.approvalRate, stat.bankName);
    }
  });
});
