import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deriveReadinessPlan } from "../llm/mock-driver.ts";
import {
  BUSINESS_ROLLUP_TEMPLATE_KEY_V1,
  CHECKLIST_TEMPLATE_KEY_BY_FACTOR_KEY,
  CONSUMER_PERSONAL_FACTOR_ORDER_V1,
  CONSUMER_PERSONAL_FACTOR_TITLES_V1,
  UTILIZATION_ACCOUNT_KEYS_V1,
  UTILIZATION_TARGET_PCT,
  buildConsumerOptimization,
  type ConsumerChecklistStateRow,
  type ConsumerOptimizationSourceV1,
} from "./map.ts";

import type { DerivedFeatures } from "../analysis/features.ts";

const CLIENT_ID = "a3000000-0000-0000-0000-000000000001";

/**
 * A derived-features fixture built the way the analysis pipeline builds one, so the
 * assertions below read the same object shape `analysis_runs.derived` actually stores.
 * Only the fields a test varies are ever passed; everything else stays at a clean-file
 * baseline so a state change in the output can only have come from the field that moved.
 */
function features(overrides: Partial<DerivedFeatures> = {}): DerivedFeatures {
  const base: DerivedFeatures = {
    schemaVersion: 1,
    bureausPulled: ["EQF", "EXP", "TUC"],
    accounts: [],
    overallUtilizationPct: 18.4,
    inquiriesByBureau: { EQF: 1, EXP: 0, TUC: 1 },
    negativesCount: 0,
    openRevolvingCount: 4,
    averageAgeMonths: 61.2,
    highestRevolvingLimitCents: 1_500_000,
    dti: { monthlyDebtPaymentsCents: 42_000, statedMonthlyIncomeCents: null, ratioPct: null },
    flags: {
      utilizationUnder30: true,
      fourOrMorePersonalAccountsOpen: true,
      averageAgeTwoYearsOrMore: true,
      noNegativeItemsReported: true,
      cardWithTenKLimit: true,
      twoOrFewerInquiriesEveryBureau: true,
      thinFile: false,
    },
    computedAt: "2026-08-15T09:00:00.000Z",
  };
  return { ...base, ...overrides, flags: { ...base.flags, ...(overrides.flags ?? {}) } };
}

/** A clean file, shaped like the Casey persona: nothing over target anywhere. */
function caseyFeatures(): DerivedFeatures {
  return features({
    accounts: [
      account({ accountRef: "account-1", balanceCents: 92_000, limitCents: 1_500_000, utilizationPct: 6.1 }),
      account({ accountRef: "account-2", balanceCents: 140_000, limitCents: 800_000, utilizationPct: 17.5 }),
      account({ accountRef: "account-3", balanceCents: 210_000, limitCents: 900_000, utilizationPct: 23.3 }),
      account({ accountRef: "account-4", balanceCents: 61_000, limitCents: 400_000, utilizationPct: 15.3 }),
    ],
  });
}

/** A derogatory file, shaped like the Devon persona: every flag false. */
function devonFeatures(): DerivedFeatures {
  return features({
    accounts: [
      account({ accountRef: "account-1", balanceCents: 640_000, limitCents: 800_000, utilizationPct: 80 }),
      account({ accountRef: "account-2", balanceCents: 285_000, limitCents: 500_000, utilizationPct: 57, isNegative: true }),
    ],
    overallUtilizationPct: 71.2,
    inquiriesByBureau: { EQF: 4, EXP: 3, TUC: 2 },
    negativesCount: 3,
    openRevolvingCount: 2,
    averageAgeMonths: 11.5,
    highestRevolvingLimitCents: 800_000,
    flags: {
      utilizationUnder30: false,
      fourOrMorePersonalAccountsOpen: false,
      averageAgeTwoYearsOrMore: false,
      noNegativeItemsReported: false,
      cardWithTenKLimit: false,
      twoOrFewerInquiriesEveryBureau: false,
      thinFile: true,
    },
  });
}

function account(overrides: Partial<DerivedFeatures["accounts"][number]> & { accountRef: string }) {
  return {
    kind: "revolving" as const,
    balanceCents: 0,
    limitCents: 100_000,
    utilizationPct: 0,
    ageMonths: 48,
    isOpen: true,
    isNegative: false,
    ...overrides,
  };
}

function source(overrides: Partial<ConsumerOptimizationSourceV1> = {}): ConsumerOptimizationSourceV1 {
  return {
    checklistStates: [],
    clientId: CLIENT_ID,
    plan: null,
    run: null,
    ...overrides,
  };
}

function run(derived: DerivedFeatures, overrides: Partial<ConsumerOptimizationSourceV1["run"] & object> = {}) {
  return {
    derived: derived as unknown,
    ranAt: "2026-08-15T09:00:00.000Z",
    readinessScore: 71,
    trigger: "enrollment",
    ...overrides,
  };
}

function checklistState(overrides: Partial<ConsumerChecklistStateRow> = {}): ConsumerChecklistStateRow {
  return {
    reportedAt: null,
    state: "todo",
    templateKey: "utilization-under-thirty",
    verifiedAt: null,
    verifyingAt: null,
    ...overrides,
  };
}

function factor(result: NonNullable<ReturnType<typeof buildConsumerOptimization>>, key: string) {
  const found = [...result.tracks.personal.factors, ...result.tracks.business.factors].find(
    (entry) => entry.key === key,
  );
  assert.ok(found, `no factor named ${key}`);
  return found;
}

describe("consumer optimization mapping", () => {
  it("reads factor states out of a real plan body and reports provenance plan", () => {
    const plan = deriveReadinessPlan(caseyFeatures());

    const result = buildConsumerOptimization(
      source({ plan: { body: plan as unknown, readinessScore: plan.readinessScore }, run: run(caseyFeatures()) }),
    );

    assert.ok(result);
    assert.equal(result.provenance, "plan");
    assert.equal(result.readiness, plan.readinessScore);
    assert.equal(result.readinessLabel, plan.readinessLabel);
    assert.equal(factor(result, "utilization_under_30").state, "verified");
    assert.equal(factor(result, "no_negative_items_reported").state, "verified");
    assert.equal(result.tracks.personal.total, 8);
    assert.equal(result.tracks.business.total, 7);
  });

  it("falls back to the latest run flags when the stored plan body is the stub", () => {
    const result = buildConsumerOptimization(
      source({
        plan: { body: { summary: "Funding readiness plan pending." }, readinessScore: 44 },
        run: run(devonFeatures(), { readinessScore: 44 }),
      }),
    );

    assert.ok(result);
    assert.equal(result.provenance, "derived-flags");
    assert.equal(factor(result, "utilization_under_30").state, "action-needed");
    assert.equal(factor(result, "no_negative_items_reported").state, "action-needed");
  });

  it("reports provenance none with no utilization block when no run exists", () => {
    const result = buildConsumerOptimization(source());

    assert.ok(result);
    assert.equal(result.provenance, "none");
    assert.equal(result.analysis, null);
    assert.equal(result.utilization, null);
    assert.equal(result.readiness, null);
    assert.equal(result.readinessLabel, null);
    for (const entry of [...result.tracks.personal.factors, ...result.tracks.business.factors]) {
      assert.equal(entry.state, "not-yet-checked", `${entry.key} should be unchecked without a run`);
      assert.equal(entry.signal, null);
    }
  });

  it("renders a reported checklist row as checking rather than action-needed", () => {
    const withoutRow = buildConsumerOptimization(source({ run: run(devonFeatures()) }));
    const withRow = buildConsumerOptimization(
      source({
        checklistStates: [
          checklistState({ reportedAt: "2026-08-16T10:00:00.000Z", state: "reported" }),
        ],
        run: run(devonFeatures()),
      }),
    );

    assert.ok(withoutRow && withRow);
    assert.equal(factor(withoutRow, "utilization_under_30").state, "action-needed");
    assert.equal(factor(withRow, "utilization_under_30").state, "checking");
    assert.deepEqual(factor(withRow, "utilization_under_30").reported, {
      at: "2026-08-16T10:00:00.000Z",
      state: "reported",
    });
  });

  it("renders a verifying checklist row as checking and carries its timestamp", () => {
    const result = buildConsumerOptimization(
      source({
        checklistStates: [
          checklistState({
            reportedAt: "2026-08-16T10:00:00.000Z",
            state: "verifying",
            verifyingAt: "2026-08-16T11:00:00.000Z",
          }),
        ],
        run: run(devonFeatures()),
      }),
    );

    assert.ok(result);
    assert.equal(factor(result, "utilization_under_30").state, "checking");
    assert.equal(factor(result, "utilization_under_30").reported?.at, "2026-08-16T11:00:00.000Z");
  });

  it("keeps a derived verified factor verified even while a checklist row is mid-flight", () => {
    const result = buildConsumerOptimization(
      source({
        checklistStates: [
          checklistState({ reportedAt: "2026-08-16T10:00:00.000Z", state: "reported" }),
        ],
        run: run(caseyFeatures()),
      }),
    );

    assert.ok(result);
    assert.equal(factor(result, "utilization_under_30").state, "verified");
  });

  it("leaves a factor with no derived signal unchecked instead of action-needed", () => {
    const result = buildConsumerOptimization(source({ run: run(devonFeatures()) }));

    assert.ok(result);
    assert.equal(factor(result, "personal_information_confirmed").state, "not-yet-checked");
    assert.equal(factor(result, "personal_information_confirmed").signal, null);
    assert.equal(factor(result, "overall_report_ready").state, "not-yet-checked");
    for (const entry of result.tracks.business.factors) {
      assert.equal(entry.state, "not-yet-checked", `${entry.key} has no derived evidence`);
      assert.equal(entry.signal, null);
    }
  });

  it("keeps the business rollup out of the per-factor states and reports it separately", () => {
    const result = buildConsumerOptimization(
      source({
        checklistStates: [
          checklistState({
            reportedAt: "2026-08-16T10:00:00.000Z",
            state: "reported",
            templateKey: BUSINESS_ROLLUP_TEMPLATE_KEY_V1,
          }),
        ],
        run: run(devonFeatures()),
      }),
    );

    assert.ok(result);
    // One durable row covering the whole profile is not per-factor knowledge. Flipping seven
    // factors to "checking" off it would tell a consumer we are checking seven things we are not.
    for (const entry of result.tracks.business.factors) {
      assert.equal(entry.state, "not-yet-checked", `${entry.key} must not follow the rollup`);
      assert.equal(entry.reported, null, `${entry.key} must not carry the rollup row`);
    }
    assert.deepEqual(result.tracks.business.rollup, {
      at: "2026-08-16T10:00:00.000Z",
      state: "reported",
    });
    assert.equal(result.tracks.business.verifiedCount, 0);
  });

  it("reports no business rollup when the client has no such row", () => {
    const result = buildConsumerOptimization(
      source({
        checklistStates: [
          checklistState({ reportedAt: "2026-08-16T10:00:00.000Z", state: "reported" }),
        ],
        run: run(devonFeatures()),
      }),
    );

    assert.ok(result);
    assert.equal(result.tracks.business.rollup, null);
  });

  it("gives the personal track no rollup, because no template rolls it up", () => {
    const result = buildConsumerOptimization(
      source({
        checklistStates: [
          checklistState({
            reportedAt: "2026-08-16T10:00:00.000Z",
            state: "reported",
            templateKey: BUSINESS_ROLLUP_TEMPLATE_KEY_V1,
          }),
        ],
        run: run(devonFeatures()),
      }),
    );

    assert.ok(result);
    assert.equal(result.tracks.personal.rollup, null);
  });

  it("maps no factor at all to the business rollup template", () => {
    for (const [factorKey, templateKey] of Object.entries(CHECKLIST_TEMPLATE_KEY_BY_FACTOR_KEY)) {
      assert.notEqual(
        templateKey,
        BUSINESS_ROLLUP_TEMPLATE_KEY_V1,
        `${factorKey} must not overlay the track-level rollup`,
      );
    }
  });

  it("drops every source column outside the utilization whitelist", () => {
    const poisoned = features({
      accounts: [
        {
          ...account({ accountRef: "account-1", balanceCents: 640_000, limitCents: 800_000, utilizationPct: 80 }),
          // Columns the projection must never carry, plus one the source has no business sending.
          ...({ ssnLast4: "1234", statementBalanceCents: 12_345 } as Record<string, unknown>),
        },
      ],
      overallUtilizationPct: 80,
    });

    const result = buildConsumerOptimization(source({ run: run(poisoned) }));

    assert.ok(result?.utilization);
    for (const entry of result.utilization.accounts) {
      assert.deepEqual(Object.keys(entry).sort(), [...UTILIZATION_ACCOUNT_KEYS_V1].sort());
    }
    const serialized = JSON.stringify(result);
    for (const forbidden of ["balanceCents", "limitCents", "ageMonths", "ssnLast4", "statementBalanceCents"]) {
      assert.ok(!serialized.includes(forbidden), `${forbidden} survived the projection`);
    }
  });

  it("projects only open revolving accounts into the utilization block", () => {
    const mixed = features({
      accounts: [
        account({ accountRef: "account-1", utilizationPct: 62 }),
        account({ accountRef: "account-2", isOpen: false, utilizationPct: 91 }),
        account({ accountRef: "account-3", kind: "installment", utilizationPct: 88 }),
        account({ accountRef: "account-4", utilizationPct: 12 }),
      ],
      overallUtilizationPct: 44.5,
    });

    const result = buildConsumerOptimization(source({ run: run(mixed) }));

    assert.ok(result?.utilization);
    assert.deepEqual(
      result.utilization.accounts.map((entry) => entry.accountRef),
      ["account-1", "account-4"],
    );
    assert.equal(result.utilization.target, UTILIZATION_TARGET_PCT);
    assert.equal(result.utilization.overallPct, 44.5);
    assert.deepEqual(result.utilization.accounts[0], {
      accountRef: "account-1",
      overTarget: true,
      pointsOverTarget: 32,
      utilizationPct: 62,
    });
    assert.deepEqual(result.utilization.accounts[1], {
      accountRef: "account-4",
      overTarget: false,
      pointsOverTarget: null,
      utilizationPct: 12,
    });
  });

  it("carries the client-facing personal titles in the specified order", () => {
    const result = buildConsumerOptimization(source({ run: run(caseyFeatures()) }));

    assert.ok(result);
    assert.deepEqual(result.tracks.personal.factors.map((entry) => entry.key), [
      ...CONSUMER_PERSONAL_FACTOR_ORDER_V1,
    ]);
    assert.deepEqual(result.tracks.personal.factors.map((entry) => entry.title), [
      "Correct personal information",
      "Clean report",
      "Utilization under 30%",
      "Minimum 4 personal credit accounts open",
      "Average credit age across all accounts 2+ years",
      "No negative items",
      "Minimum 1 personal credit card with limit $10k+",
      "Max 2 inquiries on each bureau",
    ]);
    assert.equal(
      Object.keys(CONSUMER_PERSONAL_FACTOR_TITLES_V1).length,
      CONSUMER_PERSONAL_FACTOR_ORDER_V1.length,
    );
  });

  it("takes per-account children from the plan body when it carries them", () => {
    const plan = deriveReadinessPlan(devonFeatures());

    const result = buildConsumerOptimization(
      source({ plan: { body: plan as unknown, readinessScore: plan.readinessScore }, run: run(devonFeatures()) }),
    );

    assert.ok(result);
    const children = factor(result, "utilization_under_30").children;
    assert.deepEqual(children.map((child) => child.accountRef), ["account-1", "account-2"]);
    assert.equal(children[0].key, "utilization:account-1");
    assert.equal(children[0].observedUtilizationPct, 80);
    assert.equal(children[0].state, "action-needed");
    assert.deepEqual(Object.keys(children[0]).sort(), [
      "accountRef",
      "key",
      "observedUtilizationPct",
      "state",
      "title",
    ]);
  });

  it("derives per-account children from the run when the plan body is the stub", () => {
    const result = buildConsumerOptimization(
      source({
        plan: { body: { summary: "Funding readiness plan pending." }, readinessScore: 44 },
        run: run(devonFeatures()),
      }),
    );

    assert.ok(result);
    assert.deepEqual(
      factor(result, "utilization_under_30").children.map((child) => child.accountRef),
      ["account-1", "account-2"],
    );
    assert.deepEqual(factor(result, "no_negative_items_reported").children, []);
  });

  it("separates a clean file from a derogatory one on every evidence-backed factor", () => {
    const clean = buildConsumerOptimization(source({ run: run(caseyFeatures()) }));
    const derogatory = buildConsumerOptimization(source({ run: run(devonFeatures()) }));

    assert.ok(clean && derogatory);
    const evidenceBacked = [
      "utilization_under_30",
      "four_personal_accounts_open",
      "average_age_two_years",
      "no_negative_items_reported",
      "personal_card_ten_k_limit",
      "inquiries_within_bureau_limit",
    ];
    for (const key of evidenceBacked) {
      assert.equal(factor(clean, key).state, "verified", `${key} should be verified on a clean file`);
      assert.equal(factor(derogatory, key).state, "action-needed", `${key} should need action`);
      assert.notEqual(factor(derogatory, key).signal, null, `${key} should explain itself`);
    }
    assert.equal(clean.tracks.personal.verifiedCount, 6);
    assert.equal(derogatory.tracks.personal.verifiedCount, 0);
    assert.equal(clean.tracks.business.verifiedCount, 0);
  });

  it("explains utilization with a derived percentage and never a balance", () => {
    const result = buildConsumerOptimization(source({ run: run(devonFeatures()) }));

    assert.ok(result);
    const signal = factor(result, "utilization_under_30").signal;
    assert.ok(signal !== null, "utilization should explain itself on a derogatory file");
    assert.ok(signal.includes("71.2%"), `signal did not carry the observed number: ${signal}`);
    assert.ok(!/\$\s*\d/.test(signal), `signal leaked a dollar amount: ${signal}`);
  });

  it("opens the reporting seam for a client the read was allowed to resolve", () => {
    const result = buildConsumerOptimization(source({ run: run(caseyFeatures()) }));

    assert.ok(result);
    // Every client that reaches this projection is `status = 'active'` — `resolveConsumerClientIds`
    // returns no other kind — so there is no branch here to take. The closed variants stay in the
    // type for a ledger short of migration 391 and for a cancellation this schema does not record.
    assert.deepEqual(result.reporting, { enabled: true });
    assert.deepEqual(result.estimatedCompletion, { days: null, label: "TBD" });
    assert.equal(result.schemaVersion, 1);
    assert.equal(result.clientId, CLIENT_ID);
    assert.deepEqual(result.analysis, {
      bureausPulled: ["EQF", "EXP", "TUC"],
      ranAt: "2026-08-15T09:00:00.000Z",
      trigger: "enrollment",
    });
  });

  it("names a checklist template for every factor it can overlay", () => {
    const result = buildConsumerOptimization(source({ run: run(caseyFeatures()) }));

    assert.ok(result);
    const factorKeys = new Set(
      [...result.tracks.personal.factors, ...result.tracks.business.factors].map((entry) => entry.key),
    );
    for (const key of Object.keys(CHECKLIST_TEMPLATE_KEY_BY_FACTOR_KEY)) {
      assert.ok(factorKeys.has(key), `${key} is mapped to a template but is not a factor`);
    }
  });
});
