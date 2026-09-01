import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ROUND_4_ADVERSARIAL_CASES,
  ROUND_5_ADVERSARIAL_CASES,
} from "@/lib/compliance/__fixtures__/adversarial-language.mjs";
import { complianceLanguageCodes } from "@/lib/compliance/language-rules.mjs";

import {
  normalizeChannel,
  planSync,
  surfacePlainText,
  toCacheRow,
  VaultSyncRejection,
  vettedText,
} from "./sync.ts";
import { STANDING_APPLICATION_QUESTIONS } from "./standing-questions.ts";
import type { VaultBankRecord } from "./types.ts";

const OPTIONS = { source: "vault", syncedAt: "2026-08-19T00:00:00.000Z" } as const;

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

describe("the sync core normalizes what VAULT hands over", () => {
  it("turns knowledge-base markdown into surface-safe plain text", () => {
    assert.equal(
      surfacePlainText("- **3-day rule (HowToCredit `fBqsFVBezyw`):** applying ≤3 days after opening"),
      "3-day rule: applying ≤3 days after opening",
    );
    assert.equal(surfacePlainText("Read [the application guide](https://example.com/guide)."), "Read the application guide.");
  });

  it("always composes the four standing questions, whatever the driver returned", () => {
    const row = toCacheRow(record({ applicationQuestions: [] }), OPTIONS);
    assert.deepEqual(row.application_questions, [...STANDING_APPLICATION_QUESTIONS]);
  });

  it("keeps a lender question that carries all three of its own fields", () => {
    const row = toCacheRow(
      record({
        applicationQuestions: [
          { id: "annual-sales", label: "Annual sales", responseBasis: "Use current records." },
        ],
      }),
      OPTIONS,
    );
    assert.equal(row.application_questions.length, STANDING_APPLICATION_QUESTIONS.length + 1);
    assert.equal(row.application_questions.at(-1)?.id, "annual-sales");
  });

  it("drops a lender question that asks something and explains nothing", () => {
    const row = toCacheRow(
      record({
        applicationQuestions: [
          { id: "half", label: "Half a question", responseBasis: "   " },
        ],
      }),
      OPTIONS,
    );
    assert.deepEqual(row.application_questions, [...STANDING_APPLICATION_QUESTIONS]);
  });

  it("refuses a lender with no usable handle or no usable name", () => {
    assert.throws(() => toCacheRow(record({ bankRef: "Not A Slug" }), OPTIONS), VaultSyncRejection);
    assert.throws(() => toCacheRow(record({ name: "  " }), OPTIONS), VaultSyncRejection);
  });

  it("unpublishes rather than dropping a lender VAULT has stopped publishing", () => {
    assert.equal(toCacheRow(record({ isActive: false }), OPTIONS).is_active, false);
    assert.equal(toCacheRow(record({ isActive: true }), OPTIONS).is_active, true);
  });

  it("reports a broken lender instead of failing the whole run", () => {
    const plan = planSync(
      [record({ bankRef: "good-bank" }), record({ bankRef: "Bad Ref" }), record({ bankRef: "other-bank" })],
      OPTIONS,
    );
    assert.deepEqual(plan.rows.map((row) => row.bank_ref), ["good-bank", "other-bank"]);
    assert.equal(plan.rejected.length, 1);
  });

  it("keeps the first of a duplicated handle and reports the second", () => {
    const plan = planSync([record({ name: "First" }), record({ name: "Second" })], OPTIONS);
    assert.equal(plan.rows.length, 1);
    assert.equal(plan.rows[0].name, "First");
    assert.deepEqual(plan.rejected, [
      { bankRef: "example-bank", reason: "duplicate lender handle in one run" },
    ]);
  });
});

describe("the channel normalizer holds §6's three arms", () => {
  it("keeps an https application link", () => {
    assert.deepEqual(normalizeChannel({ type: "online", value: "https://example.com/a" }), {
      type: "online",
      value: "https://example.com/a",
    });
  });

  it("drops an online channel whose value is not a link the page can open", () => {
    // The detail page renders this value as an anchor href, so a scheme that is
    // not https is either inert or an injection dressed as data.
    assert.equal(normalizeChannel({ type: "online", value: "javascript:alert(1)" }), null);
    assert.equal(normalizeChannel({ type: "online", value: "call the branch" }), null);
  });

  it("drops a phone channel that is not a number", () => {
    assert.equal(normalizeChannel({ type: "phone", value: "ask reception" }), null);
    assert.deepEqual(normalizeChannel({ type: "phone", value: "+1-800-555-0148" }), {
      type: "phone",
      value: "+1-800-555-0148",
    });
  });

  it("keeps in-person valueless, which is what the page's branch copy expects", () => {
    assert.deepEqual(normalizeChannel({ type: "in-person", value: null }), {
      type: "in-person",
      value: null,
    });
  });
});

describe("the copy rules stop at the sync, and VAULT-05 has no column to hide in", () => {
  // This block covers the copy rules and VAULT-05's *column* half only. The
  // value half — prose that states a score floor or a time-in-business minimum
  // without ever naming an excluded column — is not caught by the shared copy
  // rules at all, and lives in `vault05-text.test.ts`. Naming both here once
  // read as full VAULT-05 coverage, which it never was.
  it("has no field anywhere for a score floor or for time in business", () => {
    // Derived from the produced row rather than from a list of column names
    // this test keeps by hand: a field added later under any of these spellings
    // fails here without anyone remembering to extend an enumeration.
    const row = toCacheRow(record(), OPTIONS);
    const offending = Object.keys(row).filter((key) =>
      /fico|score|(^|_)tib($|_)|time_in_business|months_in_business/.test(key),
    );
    assert.deepEqual(offending, []);
  });

  // The corpus is the shared one round 4 and round 5 built, imported rather than
  // restated, so a case added there widens this test on its own. VAULT is the
  // client's own database and its free text has never been through this
  // platform's copy rules — this is the boundary where that is enforced.
  const CORPUS = [...ROUND_4_ADVERSARIAL_CASES, ...ROUND_5_ADVERSARIAL_CASES] as {
    expectedCode: string;
    text: string;
  }[];

  it("carries a corpus worth running", () => {
    assert.ok(CORPUS.length >= 20, `the shared corpus holds ${CORPUS.length} case(s)`);
  });

  it("drops every field of refused prose rather than storing it", () => {
    const survivors: string[] = [];
    for (const { text } of CORPUS) {
      // Sanity: the shared rules do refuse this string, so a null below is the
      // filter working rather than the corpus being clean.
      assert.ok(complianceLanguageCodes(text).length > 0, text);

      const row = toCacheRow(
        record({
          relationshipManager: { required: true, tip: text },
          qualificationSummary: text,
          bureauPulls: text,
          checking: { required: true, depositAmountCents: null, seasoning: text },
          products: [text],
          applicationQuestions: [{ id: "q", label: text, responseBasis: text }],
        }),
        OPTIONS,
      );

      if (row.rel_manager_tip !== null) survivors.push(`rel_manager_tip: ${text}`);
      if (row.qualification_summary !== null) survivors.push(`qualification_summary: ${text}`);
      if (row.bureau_pulls !== null) survivors.push(`bureau_pulls: ${text}`);
      if (row.checking_seasoning !== null) survivors.push(`checking_seasoning: ${text}`);
      if (row.products.length > 0) survivors.push(`products: ${text}`);
      if (row.application_questions.length !== STANDING_APPLICATION_QUESTIONS.length) {
        survivors.push(`application_questions: ${text}`);
      }
    }
    assert.deepEqual(survivors, [], `${survivors.length} refused string(s) reached a cache row`);
  });

  it("refuses a lender whose name itself is refused prose", () => {
    for (const { text } of CORPUS.slice(0, 5)) {
      assert.throws(() => toCacheRow(record({ name: text }), OPTIONS), VaultSyncRejection);
    }
  });

  it("leaves ordinary lender copy alone", () => {
    assert.equal(vettedText("Business banking history and current revenue evidence", 200),
      "Business banking history and current revenue evidence");
    assert.equal(vettedText("Expect the assigned banker to explain the document request.", 200),
      "Expect the assigned banker to explain the document request.");
  });

  it("bounds the one-line tip §6 asks for", () => {
    const row = toCacheRow(
      record({ relationshipManager: { required: true, tip: "a".repeat(400) } }),
      OPTIONS,
    );
    assert.ok((row.rel_manager_tip ?? "").length <= 240);
  });
});
