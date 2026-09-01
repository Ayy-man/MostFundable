import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { BANK_DETAILS } from "@/lib/demo/co-fixtures";
import { bankVaultSource } from "@/lib/vault/read-model";
import {
  momentumFor,
  momentumForWindow,
  toBankDetail,
  toHistoricalStat,
} from "@/lib/vault/read.client";
import type { BankDetailPayload, BankListRow, VaultReadState } from "@/lib/vault/types";

/**
 * The Bank Vault's durable swap (VAULT-02 / VAULT-04), and the property that
 * makes it safe under the 2026-08-18 frontend freeze: with `FEATURE_VAULT` off
 * the rendered path is the one that shipped, and with it on the same components
 * render the same shapes from `banks_cache`.
 *
 * The source assertions are positional rather than a DOM render, matching
 * `operator-dashboard-durable.test.ts`'s approach for the tracker swap — the
 * claim is about what the file does, and a render would prove it for one
 * viewport and one set of props.
 */

const OPERATOR_SOURCE = readFileSync(
  new URL("./operator.tsx", import.meta.url),
  "utf8",
);
const PAGE_SOURCE = readFileSync(
  new URL("../../app/(surfaces)/operator/page.tsx", import.meta.url),
  "utf8",
);
const CLIENT_SOURCE = readFileSync(
  new URL("../../app/(surfaces)/operator/surface-client.tsx", import.meta.url),
  "utf8",
);
const SHEET_SOURCE = readFileSync(
  new URL("../demo/bank-detail-sheet.tsx", import.meta.url),
  "utf8",
);
const ADMIN_SOURCE = readFileSync(new URL("./admin.tsx", import.meta.url), "utf8");

describe("the flag reaches the surface the only way it can", () => {
  it("is read on the server and threaded as a plain boolean", () => {
    // `featureFlag()` inside a client component returns false unconditionally
    // and a NEXT_PUBLIC_ twin would bake a runtime switch into the bundle, so
    // the server prop is the only mechanism that works.
    assert.ok(PAGE_SOURCE.includes('featureFlag("FEATURE_VAULT")'));
    assert.ok(PAGE_SOURCE.includes("vaultEnabled={vaultEnabled}"));
    assert.ok(CLIENT_SOURCE.includes("vaultEnabled={vaultEnabled}"));
    assert.ok(OPERATOR_SOURCE.includes("vaultEnabled = false"));
  });

  it("never calls the flag reader from the client component", () => {
    assert.ok(!OPERATOR_SOURCE.includes('featureFlag("FEATURE_VAULT")'));
    assert.ok(!OPERATOR_SOURCE.includes("NEXT_PUBLIC_FEATURE_VAULT"));
  });
});

describe("the swap is one substitution, not a second rendering path", () => {
  it("redefines the one name every Bank Vault view already reads", () => {
    // The fixture derivation is renamed and a flag-aware `bankStatsByPeriod`
    // takes its place, so the list, the Updates tab, the trend tiles and the
    // detail pin below all move at once.
    assert.ok(OPERATOR_SOURCE.includes("bankStatsByPeriod: fixtureBankStatsByPeriod"));
    assert.ok(OPERATOR_SOURCE.includes("const bankStatsByPeriod ="));
    assert.ok(OPERATOR_SOURCE.includes(": fixtureBankStatsByPeriod;"));
  });

  it("leaves every Bank Vault reader untouched", () => {
    // The four reads the Drop 7 build shipped are still spelled exactly as they
    // were; if a durable branch had been threaded through each of them instead,
    // these would have had to change.
    const vault = OPERATOR_SOURCE.slice(
      OPERATOR_SOURCE.indexOf("function renderBankVault"),
      OPERATOR_SOURCE.indexOf("function renderKnowledge"),
    );
    assert.ok(vault.includes("const stats = bankStatsByPeriod[period];"));
    assert.ok(vault.includes("bankStatsByPeriod[option.id].find("));
    assert.ok(vault.includes("bankStatsByPeriod[priorPeriod.id].find("));
    assert.ok(OPERATOR_SOURCE.includes('bankStatsByPeriod["30d"].find('));
  });
});

describe("which source the surface renders, over every input", () => {
  // The decision is a function rather than an expression inlined in the
  // component precisely so this can be exhaustive. A source assertion can only
  // check that a condition mentions its inputs, which stays true if someone
  // negates it; every row below fails the moment the mapping changes.
  const STATES: VaultReadState[] = ["idle", "loading", "ready", "failed"];

  it("answers `fixtures` for the flag being off, and for nothing else", () => {
    const fixtureInputs = STATES.flatMap((state) =>
      [true, false].map((enabled) => ({ enabled, source: bankVaultSource(enabled, state), state })),
    ).filter(({ source }) => source === "fixtures");

    assert.deepEqual(
      [...new Set(fixtureInputs.map(({ enabled }) => enabled))],
      [false],
      "a flag-on state resolved to the illustrative fixtures",
    );
    assert.equal(fixtureInputs.length, STATES.length, "the flag-off path stopped being unconditional");
  });

  it("covers every state with the flag on, and never with fixtures", () => {
    assert.deepEqual(
      STATES.map((state) => bankVaultSource(true, state)),
      ["loading", "loading", "durable", "failed"],
    );
  });

  it("renders durable data only once the read has actually landed", () => {
    assert.equal(bankVaultSource(true, "ready"), "durable");
    for (const state of ["idle", "loading", "failed"] as const) {
      assert.notEqual(bankVaultSource(true, state), "durable", state);
    }
  });
});

describe("an unreadable catalog is reported, not papered over with fixtures", () => {
  it("gives the section its own branch before any fixture reader runs", () => {
    // The guard is an early return at the top of `renderBankVault`, so none of
    // the four `bankStatsByPeriod` readers below it can execute while the read
    // is loading or refused. Position is the property here: a notice rendered
    // *after* the list would still have shown the list.
    const guard = OPERATOR_SOURCE.indexOf("if (bankVaultUnreadable)");
    const firstReader = OPERATOR_SOURCE.indexOf("const stats = bankStatsByPeriod[period];");
    assert.ok(guard > 0, "the unreadable branch is gone");
    assert.ok(guard < firstReader, "the fixture readers run before the unreadable branch");
  });

  it("distinguishes a refused read from a slow one", () => {
    assert.ok(OPERATOR_SOURCE.includes("Unable to load lender records."));
    assert.ok(OPERATOR_SOURCE.includes("Loading lender records…"));
    assert.ok(OPERATOR_SOURCE.includes('role={failed ? "alert" : "status"}'));
  });

  it("points the trend tiles and the comment box at a lender that exists", () => {
    // `selectedBankId` initialises to a fixture handle the durable catalog need
    // not contain, and every trend tile, the comment box and the two selects
    // read it. Resolving it against whichever catalog is rendering is what
    // keeps them from pointing at nothing.
    assert.ok(OPERATOR_SOURCE.includes("const activeBankId ="));
    assert.ok(OPERATOR_SOURCE.includes('bankStatsByPeriod["30d"].some((bank) => bank.bankId === selectedBankId)'));
    const vault = OPERATOR_SOURCE.slice(
      OPERATOR_SOURCE.indexOf("function renderBankVault"),
      OPERATOR_SOURCE.indexOf("function renderKnowledge"),
    );
    assert.equal(
      vault.includes("=== selectedBankId"),
      false,
      "a Bank Vault reader still compares against the unresolved handle",
    );
    // The operator's own choice is still what is stored; only the read resolves.
    assert.ok(vault.includes("setSelectedBankId(bank.bankId)"));
  });

  it("asks for the catalog only when the section is open", () => {
    // With the flag on, firing on mount would put a request — and a console 4xx
    // for anyone the route refuses — behind a section most operator sessions
    // never open. `210132d` established this on the other rails.
    assert.ok(OPERATOR_SOURCE.includes('useVaultBanks(vaultEnabled, view === "bank-vault")'));
  });
});

describe("the detail panel", () => {
  it("uses the fixture map only in the mode where the flag is off", () => {
    // `durableMode` is the gate. Once the operator is looking at their own
    // lender record, a failed read may not be answered with BANK_DETAILS: the
    // fixture entries carry invented deposit minimums and example.com links,
    // and nothing on the rendered panel would tell the operator which they
    // were seeing.
    assert.ok(SHEET_SOURCE.includes("durableState?: VaultReadState | null;"));
    assert.ok(SHEET_SOURCE.includes('const durableMode = durableState != null && durableState !== "idle";'));
    const lookup = SHEET_SOURCE.indexOf("BANK_DETAILS[bank.bankId]");
    const gate = SHEET_SOURCE.indexOf("const durableMode =");
    assert.ok(gate > 0 && gate < lookup, "the fixture lookup is no longer behind the durable gate");
    assert.ok(OPERATOR_SOURCE.includes("durableDetail={durableBankDetail}"));
    assert.ok(OPERATOR_SOURCE.includes("durableState={vaultEnabled ? vaultBankDetail.state : null}"));
  });

  it("opens on an unreadable record rather than silently doing nothing", () => {
    // The sheet's `open` used to require a `detail`, so with the fixture
    // fallback removed a failed read would have made clicking a lender name do
    // nothing at all — a second silent failure in place of the first.
    //
    // Re-pinned 2026-08-22 (fixture eviction, LANE D): the open condition moved
    // into a named `canOpen` because it grew a third arm — a caller that has
    // opted out of the fixture map (`fixtureDetailAllowed={false}`) also opens
    // on `bank` alone, since the 30-day outcome block stands without the four
    // §6 detail sections. The property under test is unchanged and still
    // derived from the source: `open` must not depend on `detail` alone.
    const openExpression = /open=\{([^}]+)\}/.exec(SHEET_SOURCE);
    assert.ok(openExpression, "the sheet no longer has an open condition");
    const openCondition = SHEET_SOURCE.includes(`const ${openExpression[1]} =`)
      ? /const canOpen = ([^;]+);/.exec(SHEET_SOURCE)?.[1] ?? ""
      : openExpression[1];
    assert.ok(openCondition.includes("bank"), "the sheet can open without a selected lender");
    assert.ok(
      openCondition.includes("unreadable") || openCondition.includes("fixtureDetailAllowed"),
      "the sheet opens only on a readable detail again, so an unreadable record does nothing",
    );
    assert.ok(SHEET_SOURCE.includes("Unable to load this lender record."));
    assert.ok(SHEET_SOURCE.includes("Loading this lender record…"));
  });

  it("still renders the educational-purposes warning (#198) on both paths", () => {
    // The warning is unconditional markup rather than something the data path
    // could drop, which is the property worth pinning: it is the one line on
    // this page that has to survive every future change to where the data comes
    // from.
    const warning =
      "For educational purposes only. This page does not provide an offer or decision.";
    assert.ok(SHEET_SOURCE.includes(warning));
    const warningIndex = SHEET_SOURCE.indexOf(warning);
    const channelIndex = SHEET_SOURCE.indexOf('title="Channel"');
    assert.ok(warningIndex > 0 && warningIndex < channelIndex, "the warning precedes the blocks");
    assert.ok(!SHEET_SOURCE.slice(warningIndex - 400, warningIndex).includes("durableDetail"));
    // And it precedes the branch that may replace the four blocks with a
    // notice, so an unreadable record still carries the warning.
    assert.ok(warningIndex < SHEET_SOURCE.indexOf("{detail ? ("));
  });

  it("renders all four §6 blocks from whichever detail it was given", () => {
    for (const title of ["Channel", "Checking account", "Relationship manager", "Application questions"]) {
      assert.ok(SHEET_SOURCE.includes(`title="${title}"`), title);
    }
  });

  // Re-pinned 2026-08-22 (fixture eviction, LANE B). Phase 8 wired only the
  // operator caller, so the admin sheet fell through to `BANK_DETAILS` for
  // every lender — an invented deposit minimum and an example.com application
  // link under a synced lender's name. The admin caller now passes the same two
  // overrides, so the assertion inverts: it is the absence that would be the
  // defect.
  it("gives the admin surface the same durable override", () => {
    assert.ok(ADMIN_SOURCE.includes("<BankDetailSheet"));
    const call = ADMIN_SOURCE.slice(
      ADMIN_SOURCE.lastIndexOf("<BankDetailSheet"),
      ADMIN_SOURCE.indexOf("/>", ADMIN_SOURCE.lastIndexOf("<BankDetailSheet")),
    );
    assert.ok(call.includes("durableDetail={durableBankDetail}"));
    assert.ok(call.includes("durableState={vaultEnabled ? vaultBankDetail.state : null}"));
  });
});

describe("the source disclosure says which source is actually rendering (P1-7)", () => {
  // The frozen strings name the data source. Left unconditional they become
  // false at the flip — a page telling the operator it has "no external data
  // connections" while rendering a synced catalog is worse than saying nothing,
  // because it invites them to discount what they are looking at.
  const OFF_STRINGS = [
    "Bank detail pages are illustrative CCA VAULT fixtures with no external data connections.",
    "Bank detail pages use illustrative local fixtures with no external data connections. Historical outcomes are records, not offers.",
    "Open illustrative online application",
  ];
  const ON_STRINGS = [
    "Bank detail pages read a lender catalog synced nightly from CCA VAULT.",
    "Bank detail pages read a lender catalog synced nightly from CCA VAULT. Historical outcomes are records, not offers.",
    "Open online application",
  ];

  it("still carries every frozen string for the flag-off path", () => {
    for (const copy of OFF_STRINGS) {
      assert.ok(
        OPERATOR_SOURCE.includes(copy) || SHEET_SOURCE.includes(copy),
        `the shipped string is gone: ${copy}`,
      );
    }
  });

  it("carries an accurate counterpart for the flag-on path", () => {
    for (const copy of ON_STRINGS) {
      assert.ok(
        OPERATOR_SOURCE.includes(copy) || SHEET_SOURCE.includes(copy),
        `no flag-on counterpart for: ${copy}`,
      );
    }
  });

  it("chooses between them on the flag, never on the read result", () => {
    // Keying the disclosure off whether the fetch succeeded would make the page
    // claim to be fixtures during an outage while the surrounding notice says
    // the records could not be loaded.
    assert.ok(OPERATOR_SOURCE.includes("const bankVaultHeaderCopy ="));
    assert.ok(OPERATOR_SOURCE.includes("const bankVaultSourceCopy = vaultEnabled"));
    const block = OPERATOR_SOURCE.slice(
      OPERATOR_SOURCE.indexOf("const bankVaultHeaderCopy ="),
      OPERATOR_SOURCE.indexOf("const activeBankId ="),
    );
    assert.equal(block.includes("vaultBanks.state"), false, "the disclosure keys off the read result");
    assert.ok(SHEET_SOURCE.includes('durableMode ? "Open online application"'));
  });

  // Re-pinned 2026-08-22 with the admin caller's Phase-8 adoption: the notice
  // now has to say which source is rendering, on the same rule the operator
  // page follows — keyed off the flag, never off whether the read succeeded.
  it("gives the admin notice both source variants, chosen on the flag", () => {
    assert.ok(ADMIN_SOURCE.includes("Bank details use illustrative local fixtures."));
    assert.ok(ADMIN_SOURCE.includes("Bank details read a lender catalog synced nightly from CCA VAULT."));
    const notice = ADMIN_SOURCE.slice(
      ADMIN_SOURCE.indexOf("<div className=\"mb-4\"><Notice>{vaultEnabled"),
      ADMIN_SOURCE.indexOf("Bank details use illustrative local fixtures."),
    );
    assert.equal(notice.includes("vaultBanks.state"), false, "the disclosure keys off the read result");
  });
});

describe("the durable payload becomes exactly what the frozen page renders", () => {
  const payload: BankDetailPayload = {
    bankRef: "example-bank",
    name: "Example Bank",
    products: ["Term loan"],
    bureauPulls: "Experian business",
    qualificationSummary: "Current business records",
    heatLevel: "warm",
    lastOutcomeAt: null,
    windows: payloadWindows(),
    channel: { type: "phone", value: "+1-800-555-0148" },
    checking: { required: true, depositAmountCents: 100_000, seasoning: "90 days" },
    relationshipManager: { required: false, tip: "Expect a call." },
    applicationQuestions: [{ id: "q", label: "Q", responseBasis: "Use the current records." }],
    sourceUpdatedAt: "2026-07-20",
  };

  it("produces the same field set the fixture map does", () => {
    // Derived from a frozen fixture entry rather than transcribed, so a field
    // added to `BankDetail` fails here until the durable mapper carries it.
    assert.deepEqual(
      Object.keys(toBankDetail(payload)).sort(),
      Object.keys(BANK_DETAILS.bluevine).sort(),
    );
  });

  it("carries the four blocks through unchanged", () => {
    const detail = toBankDetail(payload);
    assert.deepEqual(detail.applyChannel, { type: "phone", value: "+1-800-555-0148" });
    assert.equal(detail.checking.required, true);
    assert.equal(detail.checking.depositAmountCents, 100_000);
    assert.equal(detail.checking.seasoning, "90 days");
    assert.equal(detail.relationshipManager.tip, "Expect a call.");
    assert.equal(detail.applicationQuestions.length, 1);
  });

  it("answers an unrecorded channel with the branch arm the page already has", () => {
    const detail = toBankDetail({ ...payload, channel: null });
    assert.deepEqual(detail.applyChannel, { type: "in-person", value: null });
  });

  it("uses only strings the frozen fixtures already contain when nothing is recorded", () => {
    const detail = toBankDetail({
      ...payload,
      checking: { required: null, depositAmountCents: null, seasoning: null },
      relationshipManager: { required: null, tip: null },
    });
    const frozenValues = new Set(
      Object.values(BANK_DETAILS).flatMap((entry) => [
        entry.checking.seasoning,
        entry.relationshipManager.tip,
      ]),
    );
    assert.ok(frozenValues.has(detail.checking.seasoning), detail.checking.seasoning);
    assert.equal(detail.relationshipManager.tip, "Not specified");
  });
});

describe("Heat Level keeps the frozen pill vocabulary (#205) and moves with the window", () => {
  it("maps §6's three levels onto the three the surface renders", () => {
    // The pill is `titleCase(bank.momentum)`, so a fourth value would print a
    // word the client never approved. `warm` becomes `fair` for that reason.
    assert.deepEqual(
      ["hot", "warm", "cold", null].map((level) =>
        momentumFor(level as Parameters<typeof momentumFor>[0]),
      ),
      ["hot", "fair", "cold", "cold"],
    );
  });

  it("uses the server's level for the window §6 derives it from", () => {
    const bank = listRow({ heatLevel: "hot", lastOutcomeAt: "2026-08-01" });
    assert.equal(toHistoricalStat(bank, "30d").momentum, "hot");
  });

  it("reads the other four periods off their own approval rate", () => {
    // The pill sits inside the "Historical window" selector. Pinning one value
    // across all five made the control visibly inert: every other number on the
    // row moved and Heat Level did not.
    const bank = listRow({
      heatLevel: "cold",
      lastOutcomeAt: "2026-08-01",
      windows: {
        d30: window_(0, 0),
        d60: window_(4, 80),
        d90: window_(4, 50),
        d183: window_(4, 10),
        d365: window_(0, 0),
      },
    });
    assert.deepEqual(
      (["60d", "90d", "6mo", "12mo"] as const).map((period) => toHistoricalStat(bank, period).momentum),
      ["hot", "fair", "cold", "cold"],
    );
  });

  it("uses the same thresholds the frozen derivation uses", () => {
    // 60 and 40 are `deriveBankHistoricalStats`'s boundaries, asserted at the
    // edges rather than in the middle of each band.
    assert.equal(momentumForWindow({ approvalRate: 60, outcomes: 1 }, "2026-08-01"), "hot");
    assert.equal(momentumForWindow({ approvalRate: 59.99, outcomes: 1 }, "2026-08-01"), "fair");
    assert.equal(momentumForWindow({ approvalRate: 40, outcomes: 1 }, "2026-08-01"), "fair");
    assert.equal(momentumForWindow({ approvalRate: 39.99, outcomes: 1 }, "2026-08-01"), "cold");
  });

  it("reads cold for a window with nothing in it, whatever the rate says", () => {
    assert.equal(momentumForWindow({ approvalRate: 100, outcomes: 0 }, "2026-08-01"), "cold");
    assert.equal(momentumForWindow({ approvalRate: 100, outcomes: 5 }, null), "cold");
  });
});

function window_(outcomes: number, approvalRate: number): BankListRow["windows"]["d30"] {
  return {
    outcomes,
    approvals: 0,
    approvalRate,
    fundedCount: 0,
    fundedAmount: 0,
    averageFundedAmount: 0,
  };
}

function listRow(overrides: Partial<BankListRow> = {}): BankListRow {
  return {
    bankRef: "example-bank",
    name: "Example Bank",
    products: [],
    bureauPulls: null,
    qualificationSummary: null,
    heatLevel: "hot",
    lastOutcomeAt: null,
    windows: payloadWindows(),
    ...overrides,
  };
}

function payloadWindows(): BankListRow["windows"] {
  const empty = {
    outcomes: 0,
    approvals: 0,
    approvalRate: 0,
    fundedCount: 0,
    fundedAmount: 0,
    averageFundedAmount: 0,
  };
  return { d30: empty, d60: empty, d90: empty, d183: empty, d365: empty };
}
