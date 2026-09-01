import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { complianceLanguageCodes } from "@/lib/compliance/language-rules.mjs";

import { toCacheRow } from "./sync.ts";
import type { VaultBankRecord } from "./types.ts";
import { mentionsExcludedCriteria } from "./vault05-text.ts";

/**
 * VAULT-05, at the level that actually protects the page.
 *
 * The exclusion was enforced on column names only: `banks_cache` has no
 * `fico_*` or `tib_*` column, and a pgTAP test reads the live catalog to prove
 * it. That says nothing about values. VAULT's free-text fields — `brm_notes`,
 * `how_to_get_handoff`, the two requirement strategies, `timing_notes` — are
 * written by the client's team and routinely state score floors and
 * time-in-business minimums in prose, and every one of them lands in a column
 * the operator detail page renders.
 *
 * The platform copy rules do not catch that prose; the first assertion here
 * proves it against the shared rule module rather than asserting it in a
 * comment. So the exclusion needs its own filter, and this file is where it is
 * enforced end to end: through `toCacheRow`, on every free-text field, for both
 * drivers, since they share that one path.
 */

const OPTIONS = { source: "vault", syncedAt: "2026-08-19T00:00:00.000Z" } as const;

/** Verbatim from the review, plus the shapes the same fields are written in. */
const EXCLUDED_PROSE = [
  "Minimum FICO 680 and 2 years in business.",
  "Requires a 700 credit score floor.",
  "Time in business: 24 months minimum.",
  "Banker wants 24 months TIB and a 680 score.",
  "TIB 2 yrs in biz, no exceptions.",
  "Wants two years of operating history before they will look at it.",
  "Fico score must clear the mid six hundreds.",
  "Needs eighteen months in business at the same entity.",
  "Personal credit floor applies; ask the banker for the current number.",
  "Their vantage cutoff moved last quarter.",
  "Months in business is the first thing they check.",
  "Business must be trading 3+ years.",
];

/** Real lender copy that says nothing excluded and must survive the filter. */
const CLEAN_PROSE = [
  "Expect a call from the branch manager.",
  "Bring the current business records the banker asks for.",
  "Experian business",
  "90 days",
  "Applications are reviewed by a regional team, so expect two touchpoints.",
  "The banker will explain the document request before the file is opened.",
];

function record(overrides: Partial<VaultBankRecord> = {}): VaultBankRecord {
  return {
    bankRef: "example-bank",
    name: "Example Bank",
    products: ["Term loan"],
    bureauPulls: "Experian business",
    qualificationSummary: "Current business records",
    channel: { type: "online", value: "https://example.com/apply" },
    checking: { required: true, depositAmountCents: 100_000, seasoning: "90 days" },
    relationshipManager: { required: false, tip: "Expect a call." },
    applicationQuestions: [],
    sourceUpdatedAt: "2026-07-20",
    isActive: true,
    ...overrides,
  };
}

describe("the platform copy rules do not cover VAULT-05", () => {
  it("passes score-floor and time-in-business prose, which is why this filter exists", () => {
    // Derived from the shared rule module at test time. If the copy rules are
    // ever widened to cover this class, this assertion fails and says so —
    // which is the moment to reconsider whether the filter is still separate.
    const caught = EXCLUDED_PROSE.filter((text) => complianceLanguageCodes(text).length > 0);
    assert.deepEqual(caught, [], "the copy rules now catch these; VAULT-05's filter may be redundant");
  });
});

describe("the predicate itself", () => {
  it("refuses every excluded sentence", () => {
    const missed = EXCLUDED_PROSE.filter((text) => !mentionsExcludedCriteria(text));
    assert.deepEqual(missed, []);
  });

  it("passes ordinary lender copy", () => {
    const refused = CLEAN_PROSE.filter((text) => mentionsExcludedCriteria(text));
    assert.deepEqual(refused, []);
  });

  it("treats an absent string as nothing to refuse", () => {
    assert.equal(mentionsExcludedCriteria(null), false);
    assert.equal(mentionsExcludedCriteria(undefined), false);
    assert.equal(mentionsExcludedCriteria(""), false);
  });
});

describe("every free-text field that crosses into the cache is filtered", () => {
  // The field list is derived from the row rather than transcribed: a new
  // free-text column added to `BankCacheRow` and fed by `toCacheRow` shows up
  // here as an unfiltered survivor instead of quietly escaping the exclusion.
  const TEXT_COLUMNS = [
    "bureau_pulls",
    "qualification_summary",
    "checking_seasoning",
    "rel_manager_tip",
  ] as const;

  it("covers the free-text columns the row actually has", () => {
    const clean = toCacheRow(record(), OPTIONS);
    const stringColumns = Object.entries(clean)
      .filter(([key, value]) => typeof value === "string" && key !== "bank_ref" && key !== "name"
        && key !== "channel_type" && key !== "channel_value" && key !== "source"
        && key !== "synced_at" && key !== "source_updated_at")
      .map(([key]) => key)
      .sort();
    assert.deepEqual(stringColumns, [...TEXT_COLUMNS].sort());
  });

  it("nulls each one when VAULT states a floor in it", () => {
    for (const text of EXCLUDED_PROSE) {
      const row = toCacheRow(
        record({
          bureauPulls: text,
          qualificationSummary: text,
          checking: { required: true, depositAmountCents: null, seasoning: text },
          relationshipManager: { required: true, tip: text },
        }),
        OPTIONS,
      );
      for (const column of TEXT_COLUMNS) {
        assert.equal(row[column], null, `${column} kept: ${text}`);
      }
    }
  });

  it("drops a product name and a lender question that state one", () => {
    for (const text of EXCLUDED_PROSE.slice(0, 4)) {
      const row = toCacheRow(
        record({
          products: [text, "Term loan"],
          applicationQuestions: [
            { id: "lender-1", label: text, responseBasis: "Use the current records." },
            { id: "lender-2", label: "How long have you banked here?", responseBasis: text },
          ],
        }),
        OPTIONS,
      );
      assert.deepEqual(row.products, ["Term loan"], text);
      assert.deepEqual(
        row.application_questions.filter((question) => question.id.startsWith("lender-")),
        [],
        text,
      );
    }
  });

  it("refuses the lender outright when its name states one", () => {
    assert.throws(() => toCacheRow(record({ name: "FICO 680 Bank" }), OPTIONS));
  });

  it("leaves a clean record completely intact", () => {
    const row = toCacheRow(record(), OPTIONS);
    assert.equal(row.bureau_pulls, "Experian business");
    assert.equal(row.qualification_summary, "Current business records");
    assert.equal(row.checking_seasoning, "90 days");
    assert.equal(row.rel_manager_tip, "Expect a call.");
    assert.deepEqual(row.products, ["Term loan"]);
  });
});
