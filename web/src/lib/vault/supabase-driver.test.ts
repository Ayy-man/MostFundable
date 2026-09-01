import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  channelFromMethods,
  questionsFromRequirements,
  seasoningFromDays,
  toVaultBankRecord,
} from "./supabase-driver.ts";

/**
 * The real-VAULT mapper. This lane holds no VAULT credential, so the driver
 * itself has never run against the live project and the integrator runs that
 * arm after merge (`.planning/lanes/D.md` → Key-arrival). What *is* testable
 * without a key is every decision the mapper makes about the shapes recorded
 * from the live schema, and that is what this file pins.
 */

const SOURCE = readFileSync(new URL("./supabase-driver.ts", import.meta.url), "utf8");

function bank(overrides: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    slug: "example-bank",
    name: "Example Bank",
    products: ["Term loan"],
    is_active: true,
    online_app_available: true,
    banker_required: false,
    brm_notes: null,
    biz_checking_required: true,
    primary_bureau: "Experian business",
    bureau_primary: null,
    pull_type: null,
    last_updated: "2026-07-20",
    ...overrides,
  } as Parameters<typeof toVaultBankRecord>[0];
}

describe("VAULT-05 is enforced at the select list, not downstream", () => {
  // Derived from the file's own select lists rather than from a description of
  // them: a column added to a select later is caught here even if nothing else
  // in the pipeline ever reads it.
  const selectLists = [...SOURCE.matchAll(/^const [A-Z_]+_COLUMNS =\s*([\s\S]*?);$/gm)].map(
    (match) => match[1],
  );

  it("finds the select lists it means to check", () => {
    assert.equal(selectLists.length, 4);
  });

  it("selects no credit-score floor and no time-in-business column", () => {
    for (const list of selectLists) {
      const columns = [...list.matchAll(/[a-z_]+/g)].map((match) => match[0]);
      const offending = columns.filter((column) =>
        /fico|score|(^|_)tib($|_)|time_in_business|months_in_business/.test(column),
      );
      assert.deepEqual(offending, [], `a forbidden column is selected: ${list}`);
    }
  });

  it("selects none of the unvetted free-text intel columns", () => {
    const forbidden = [
      "vault_full_text",
      "exact_script",
      "winning_patterns",
      "denial_patterns",
      "key_gotchas",
      "best_fit_profile",
    ];
    for (const list of selectLists) {
      for (const column of forbidden) {
        assert.ok(!list.includes(column), `${column} is selected`);
      }
    }
  });

  it("never reaches VAULT outside the sync job (VAULT-03)", () => {
    // The only export that opens a client is the driver, and the only caller of
    // the driver is `index.ts`'s sync. A request path reaching VAULT live is
    // the thing DEC-D8 exists to prevent.
    assert.ok(SOURCE.includes('import "server-only"'));
    assert.equal([...SOURCE.matchAll(/createClient\(/g)].length, 1);
  });
});

describe("the channel is read from the ranked application methods", () => {
  it("takes the top-ranked method that resolves to a §6 channel", () => {
    assert.deepEqual(
      channelFromMethods(
        [
          { method: "online", url: "https://bank.example/apply" },
          { method: "phone", number: "+1-800-555-0100" },
        ],
        true,
      ),
      { type: "online", value: "https://bank.example/apply" },
    );
  });

  it("falls through a method it cannot use rather than stopping at it", () => {
    // An online method recorded with no link cannot render §6's online arm, so
    // the phone entry behind it is the answer.
    assert.deepEqual(
      channelFromMethods([{ method: "online" }, { method: "phone", value: "+1-800-555-0100" }], true),
      { type: "phone", value: "+1-800-555-0100" },
    );
  });

  it("reads the bare-string form of the column as well as the object form", () => {
    assert.deepEqual(channelFromMethods(["branch visit"], true), {
      type: "in-person",
      value: null,
    });
  });

  it("says nothing when nobody recorded how to apply", () => {
    assert.equal(channelFromMethods(null, true), null);
    assert.equal(channelFromMethods([], null), null);
  });

  it("reads no-online-application as an in-person answer", () => {
    // `online_app_available` says an online application exists without saying
    // where, and §6's online arm renders a link — so only the false case is
    // informative on its own.
    assert.deepEqual(channelFromMethods([], false), { type: "in-person", value: null });
  });
});

describe("the checking block", () => {
  it("states the seasoning in the unit VAULT records it in", () => {
    assert.equal(seasoningFromDays(90), "90 days");
    assert.equal(seasoningFromDays(1), "1 day");
    assert.equal(seasoningFromDays(null), null);
    assert.equal(seasoningFromDays(-5), null);
  });

  it("converts the minimum balance from currency to cents exactly once", () => {
    const record = toVaultBankRecord(
      bank(),
      {
        bank_id: "00000000-0000-0000-0000-000000000001",
        biz_checking_balance_min: 1500,
        biz_checking_seasoning_days: 90,
        revenue_stated_strategy: null,
        personal_income_strategy: null,
      },
      undefined,
      undefined,
    );
    assert.equal(record?.checking.depositAmountCents, 150_000);
    assert.equal(record?.checking.seasoning, "90 days");
    assert.equal(record?.checking.required, true);
  });
});

describe("the relationship-manager block", () => {
  it("prefers the bank's own note and falls back to the banker intel", () => {
    const withNote = toVaultBankRecord(
      bank({ banker_required: true, brm_notes: "Expect a call." }),
      undefined,
      undefined,
      { bank_id: "x", how_to_get_handoff: "Ask at the branch." },
    );
    assert.equal(withNote?.relationshipManager.tip, "Expect a call.");

    const withoutNote = toVaultBankRecord(bank({ banker_required: true }), undefined, undefined, {
      bank_id: "x",
      how_to_get_handoff: "Ask at the branch.",
    });
    assert.equal(withoutNote?.relationshipManager.tip, "Ask at the branch.");
  });
});

describe("the lender's own application questions", () => {
  it("come from recorded fields and are never invented from prose", () => {
    const questions = questionsFromRequirements(
      {
        bank_id: "x",
        biz_checking_balance_min: null,
        biz_checking_seasoning_days: null,
        revenue_stated_strategy: "Use the current revenue records.",
        personal_income_strategy: null,
      },
      { bank_id: "x", methods_ranked: null, timing_notes: "Apply after the statement posts." },
    );
    assert.deepEqual(
      questions.map((question) => question.id),
      ["stated-business-revenue", "application-timing"],
    );
  });

  it("is empty when VAULT recorded nothing, leaving only the standing four", () => {
    assert.deepEqual(questionsFromRequirements(undefined, undefined), []);
  });
});

describe("identity", () => {
  it("uses the slug as the lender handle, lowercased", () => {
    assert.equal(toVaultBankRecord(bank({ slug: "US-Bank" }), undefined, undefined, undefined)?.bankRef, "us-bank");
  });

  it("skips a lender with no slug or no name rather than inventing one", () => {
    assert.equal(toVaultBankRecord(bank({ slug: null }), undefined, undefined, undefined), null);
    assert.equal(toVaultBankRecord(bank({ name: "  " }), undefined, undefined, undefined), null);
  });

  it("carries is_active through, so an unpublished lender unpublishes here", () => {
    assert.equal(
      toVaultBankRecord(bank({ is_active: false }), undefined, undefined, undefined)?.isActive,
      false,
    );
  });
});
