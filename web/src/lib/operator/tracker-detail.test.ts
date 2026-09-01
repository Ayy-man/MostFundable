import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatDemoMoney } from "@/lib/demo/feedback-fixtures";
import type { OrgReceivable } from "@/lib/fees/types";
import {
  TRACKER_CLIENT_KEYS,
  TRACKER_STAGE_LABELS,
  type TrackerClient,
} from "@/lib/tracker/types";

import {
  TRACKER_FEES_DISABLED_NOTE,
  trackerActivityEntries,
  trackerFeesFields,
  trackerFundingFields,
  trackerOverviewFields,
  trackerPlanFields,
  type TrackerDetailField,
  type TrackerFeesSource,
} from "./tracker-detail";

const NOW = new Date("2026-08-21T00:00:00Z");

const RECORDED: TrackerClient = {
  analysisAt: "2026-08-10T09:00:00Z",
  // Deliberately absent from the peek: a transient queued/running hint for
  // waiting surfaces, not a recorded value the operator detail should restate.
  analysisPending: null,
  archivedAt: null,
  archivedById: null,
  assignedToActive: true,
  assignedToId: "8f2b1c4e-0000-4000-8000-000000000001",
  assignedToName: "Dana Whitfield",
  assignedToOrgRole: "prep_specialist",
  businessName: "Derog Demo Logistics",
  consumerProfileId: "8f2b1c4e-0000-4000-8000-000000000002",
  displayName: "Devon Derog Demo",
  estimatedCompletionAt: "2026-10-01T00:00:00Z",
  fundingApprovedCents: 4_250_000,
  goalCents: 7_500_000,
  health: "amber",
  history: [
    { at: "2026-07-01T10:00:00Z", changedBy: null, from: null, to: "onboarding" },
    {
      at: "2026-08-02T10:00:00Z",
      changedBy: null,
      from: "onboarding",
      to: "optimization",
    },
  ],
  id: "8f2b1c4e-0000-4000-8000-000000000003",
  lastActivityAt: "2026-08-19T18:30:00Z",
  matchesUnlockedOverride: true,
  monitoring: "active",
  nextRefreshAt: "2026-09-01T00:00:00Z",
  openActionCount: 3,
  readiness: 62,
  stage: "optimization",
  stageEnteredAt: "2026-08-02T10:00:00Z",
  startedAt: "2026-07-01T10:00:00Z",
  status: "active",
};

/** The same client with every nullable source empty — a workspace that has
 * saved a name and nothing else. */
const BARE: TrackerClient = {
  ...RECORDED,
  analysisAt: null,
  analysisPending: null,
  assignedToActive: null,
  assignedToId: null,
  assignedToName: null,
  assignedToOrgRole: null,
  businessName: null,
  consumerProfileId: null,
  estimatedCompletionAt: null,
  fundingApprovedCents: null,
  goalCents: null,
  history: [],
  matchesUnlockedOverride: false,
  nextRefreshAt: null,
  openActionCount: null,
  readiness: null,
};

const RECEIVABLE: OrgReceivable = {
  balanceCents: 100_000,
  clientId: RECORDED.id,
  displayName: RECORDED.displayName,
  lastPaymentOn: "2026-08-15",
  model: "percentage",
  outcomeBasisCents: 4_250_000,
  paidCents: 325_000,
  status: "active",
  totalCents: 425_000,
};

function fieldNamed(fields: readonly TrackerDetailField[], label: string) {
  const field = fields.find((entry) => entry.label === label);
  assert.ok(field, `no field labelled ${label}`);
  return field;
}

function allFields(client: TrackerClient) {
  return [
    ...trackerOverviewFields(client, NOW),
    ...trackerPlanFields(client, { reason: "no_score", state: "unavailable" }),
    ...trackerFundingFields(client),
  ];
}

describe("durable client peek", () => {
  it("is written against the tracker row the API actually returns", () => {
    // The schema lock. Add a column to TrackerClient and this fails, which is
    // the prompt to decide whether the peek should show it — rather than the
    // peek silently continuing to describe an older row.
    assert.deepEqual(
      Object.keys(RECORDED).sort(),
      [...TRACKER_CLIENT_KEYS].sort(),
    );
  });

  it("renders the client's own recorded values", () => {
    const overview = trackerOverviewFields(RECORDED, NOW);
    assert.equal(fieldNamed(overview, "Business").value, RECORDED.businessName);
    assert.equal(
      fieldNamed(overview, "Stage").value,
      TRACKER_STAGE_LABELS[RECORDED.stage],
    );
    assert.equal(
      fieldNamed(overview, "Team member").value,
      RECORDED.assignedToName,
    );
    assert.equal(
      fieldNamed(overview, "Funding goal").value,
      formatDemoMoney((RECORDED.goalCents ?? 0) / 100),
    );

    const plan = trackerPlanFields(RECORDED, { reason: "no_score", state: "unavailable" });
    assert.equal(
      fieldNamed(plan, "Readiness score").value,
      `${RECORDED.readiness} of 100`,
    );
    assert.equal(
      fieldNamed(plan, "Remaining steps").value,
      String(RECORDED.openActionCount),
    );

    const funding = trackerFundingFields(RECORDED);
    assert.equal(
      fieldNamed(funding, "Funding approved").value,
      formatDemoMoney((RECORDED.fundingApprovedCents ?? 0) / 100),
    );
  });

  it("renders each observed bureau score without inventing an aggregate", () => {
    const plan = trackerPlanFields(RECORDED, {
      scores: [
        { bureau: "TUC", model: "VANTAGE", observedAt: "2026-08-30T00:00:00.000Z", score: 779 },
        { bureau: "EQF", model: "VANTAGE", observedAt: "2026-08-30T00:00:00.000Z", score: 825 },
        { bureau: "EXP", model: "VANTAGE", observedAt: "2026-08-30T00:00:00.000Z", score: 761 },
      ],
      state: "ready",
    });
    assert.equal(
      fieldNamed(plan, "Credit Score").value,
      "Equifax 825 · Experian 761 · TransUnion 779",
    );
  });

  it("renders the unavailable state if a malformed ready value reaches the view model", () => {
    for (const scores of [
      null,
      [{ bureau: "EFX", model: "VANTAGE", observedAt: null, score: 825 }],
      [{ bureau: "EQF", model: "VANTAGE", observedAt: null, score: 825.5 }],
    ]) {
      const plan = trackerPlanFields(RECORDED, {
        scores,
        state: "ready",
      } as unknown as Parameters<typeof trackerPlanFields>[1]);
      assert.deepEqual(fieldNamed(plan, "Credit Score"), {
        label: "Credit Score",
        note: "Current CRS scores are unavailable right now",
        value: null,
      });
    }
  });

  it("explains a missing CRS score instead of inventing one", () => {
    assert.deepEqual(allFields(RECORDED).filter((field) => field.value === null), [
      {
        label: "Credit Score",
        note: "CRS has no current score for this client",
        value: null,
      },
    ]);
  });

  it("says what is missing instead of showing a zero", () => {
    const missing = allFields(BARE).filter((field) => field.value === null);
    assert.ok(missing.length > 0);
    for (const field of missing) {
      assert.equal(typeof field.note, "string");
      assert.ok((field.note ?? "").length > 0, `${field.label} has no reason`);
    }
    // The failure this replaces is a fixture client's money under a real
    // client's name, so every field the model renders as an amount has to go
    // empty when the workspace recorded no amount. Which fields those are is
    // read off the populated model rather than listed here, so a new money
    // field is covered the day it is added.
    const moneyLabels = allFields(RECORDED)
      .filter((field) => field.value?.startsWith("$"))
      .map((field) => field.label);
    assert.ok(moneyLabels.length > 0);
    const bare = allFields(BARE);
    for (const label of moneyLabels) {
      assert.equal(
        fieldNamed(bare, label).value,
        null,
        `${label} showed an amount for a client with no record of one`,
      );
    }
  });

  it("keeps a client's own stage history, newest first", () => {
    const entries = trackerActivityEntries(RECORDED);
    assert.equal(entries.length, RECORDED.history.length);
    assert.deepEqual(
      entries.map((entry) => entry.at),
      [...RECORDED.history]
        .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
        .map((entry) => entry.at),
    );
    assert.equal(trackerActivityEntries(BARE).length, BARE.history.length);
  });

  it("reads fees from the org ledger and says so when there are none", () => {
    const ready = trackerFeesFields({ receivable: RECEIVABLE, state: "ready" });
    assert.equal(
      fieldNamed(ready, "Total").value,
      formatDemoMoney(RECEIVABLE.totalCents / 100),
    );
    assert.equal(
      fieldNamed(ready, "Balance").value,
      formatDemoMoney(RECEIVABLE.balanceCents / 100),
    );

    const empty: readonly {
      note?: string;
      source: TrackerFeesSource;
    }[] = [
      { note: TRACKER_FEES_DISABLED_NOTE, source: { state: "disabled" } },
      { source: { receivable: null, state: "ready" } },
      { source: { state: "failed" } },
    ];
    for (const { note, source } of empty) {
      const fields = trackerFeesFields(source);
      for (const field of fields) {
        assert.equal(field.value, null, `${field.label} showed a fee figure`);
        if (note !== undefined) assert.equal(field.note, note);
      }
    }
  });
});
