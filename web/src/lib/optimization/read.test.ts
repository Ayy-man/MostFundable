import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isMissingColumnError,
  OptimizationDataError,
  readConsumerOptimizationWith,
  type OptimizationGateway,
} from "./read.ts";

import type { SessionProfile } from "../auth/session.ts";

const CLIENT_ID = "a3000000-0000-0000-0000-000000000002";

function session(overrides: Partial<SessionProfile> = {}): SessionProfile {
  return {
    disabledAt: null,
    id: "a2000000-0000-0000-0000-000000000002",
    manages: [],
    orgId: "a0000000-0000-0000-0000-000000000001",
    orgMembership: null,
    orgRole: null,
    role: "consumer",
    ...overrides,
  };
}

const DERIVED = {
  accounts: [
    {
      accountRef: "account-1",
      ageMonths: 11,
      balanceCents: 640_000,
      isNegative: false,
      isOpen: true,
      kind: "revolving",
      limitCents: 800_000,
      utilizationPct: 80,
    },
  ],
  averageAgeMonths: 11,
  bureausPulled: ["EQF", "EXP", "TUC"],
  computedAt: "2026-08-15T09:00:00.000Z",
  flags: {
    averageAgeTwoYearsOrMore: false,
    cardWithTenKLimit: false,
    fourOrMorePersonalAccountsOpen: false,
    noNegativeItemsReported: false,
    thinFile: true,
    twoOrFewerInquiriesEveryBureau: false,
    utilizationUnder30: false,
  },
  inquiriesByBureau: { EQF: 4, EXP: 3, TUC: 2 },
  negativesCount: 3,
  openRevolvingCount: 1,
  overallUtilizationPct: 80,
  schemaVersion: 1,
};

interface GatewayCalls {
  readonly checklist: string[];
  readonly plan: string[];
  readonly run: string[];
}

function gateway(
  overrides: Partial<OptimizationGateway> = {},
): { gateway: OptimizationGateway; calls: GatewayCalls } {
  const calls: GatewayCalls = { checklist: [], plan: [], run: [] };
  const base: OptimizationGateway = {
    async readChecklistStates(clientId) {
      calls.checklist.push(clientId);
      return [];
    },
    async readLatestPlan(clientId) {
      calls.plan.push(clientId);
      return null;
    },
    async readLatestRun(clientId) {
      calls.run.push(clientId);
      return {
        derived: DERIVED as unknown,
        ranAt: "2026-08-15T09:00:00.000Z",
        readinessScore: 44,
        trigger: "enrollment",
      };
    },
    async resolveConsumerClientIds() {
      return [CLIENT_ID];
    },
    ...overrides,
  };
  return { calls, gateway: base };
}

describe("consumer optimization read", () => {
  it("refuses any role but consumer before it touches a row", async () => {
    for (const role of ["operator_member", "platform_admin", "affiliate"] as const) {
      const { calls, gateway: deps } = gateway();
      await assert.rejects(
        () => readConsumerOptimizationWith(session({ role }), deps),
        (error: unknown) =>
          error instanceof OptimizationDataError && error.code === "forbidden",
        `${role} should not reach the consumer optimization read`,
      );
      assert.deepEqual(calls, { checklist: [], plan: [], run: [] }, `${role} reached a table`);
    }
  });

  it("returns null when the session scopes to no client", async () => {
    const { calls, gateway: deps } = gateway({ async resolveConsumerClientIds() { return []; } });

    assert.equal(await readConsumerOptimizationWith(session(), deps), null);
    assert.deepEqual(calls, { checklist: [], plan: [], run: [] });
  });

  it("returns null rather than guessing when the session scopes to more than one client", async () => {
    const { calls, gateway: deps } = gateway({
      async resolveConsumerClientIds() {
        return [CLIENT_ID, "a3000000-0000-0000-0000-000000000009"];
      },
    });

    assert.equal(await readConsumerOptimizationWith(session(), deps), null);
    assert.deepEqual(calls, { checklist: [], plan: [], run: [] });
  });

  it("reads every table under the id it resolved from the session, and no other", async () => {
    const { calls, gateway: deps } = gateway();

    const result = await readConsumerOptimizationWith(session(), deps);

    assert.ok(result);
    assert.equal(result.clientId, CLIENT_ID);
    assert.deepEqual(calls.plan, [CLIENT_ID]);
    assert.deepEqual(calls.run, [CLIENT_ID]);
    assert.deepEqual(calls.checklist, [CLIENT_ID]);
  });

  it("builds the view from the rows the gateway returned", async () => {
    const { gateway: deps } = gateway({
      async readChecklistStates() {
        return [
          {
            reportedAt: "2026-08-16T10:00:00.000Z",
            state: "reported",
            templateKey: "utilization-under-thirty",
            verifiedAt: null,
            verifyingAt: null,
          },
        ];
      },
    });

    const result = await readConsumerOptimizationWith(session(), deps);

    assert.ok(result);
    assert.equal(result.provenance, "derived-flags");
    assert.equal(result.readiness, 44);
    const utilization = result.tracks.personal.factors.find((entry) => entry.key === "utilization_under_30");
    assert.equal(utilization?.state, "checking");
    assert.equal(result.utilization?.overallPct, 80);
  });

  it("throws rather than degrading to an empty view when a table read fails", async () => {
    const { gateway: deps } = gateway({
      async readLatestRun() {
        throw new OptimizationDataError("read_failed");
      },
    });

    await assert.rejects(
      () => readConsumerOptimizationWith(session(), deps),
      (error: unknown) => error instanceof OptimizationDataError && error.code === "read_failed",
    );
  });
});

/**
 * A stored `plans.body` the projection accepts as a real plan, so the narrative cases below run
 * through the `provenance: "plan"` path the worker actually writes rather than the flags fallback.
 */
const PLAN_BODY = {
  businessChecklist: [],
  personalChecklist: [],
  readinessLabel: "Optimization",
  readinessScore: 58,
  schemaVersion: 1,
};

const STORED_NARRATIVE = {
  businessSide: "Your business identifier is still missing; your funding team collects it.",
  generation: { driver: "mock", model: "mock-1", promptVersion: 1 },
  itemNotes: { credit_score_700: "Your middle score is 664, and the target is 700." },
  nextSteps: [
    {
      detail: "Pay the balance down to $1,500 so it reports under 30% of its limit.",
      itemKey: "utilization_under_30",
      title: "Pay the revolving card down",
    },
  ],
  schemaVersion: 1,
  timeline: { band: "30-60 days", reason: "New balances take one statement cycle to report." },
  verdict: "Not ready yet. 4 items to fix.",
  whereYouStand: "Six of ten personal items are verified.",
};

function planRow(overrides: Record<string, unknown> = {}) {
  return { body: PLAN_BODY as unknown, readinessScore: 58, ...overrides };
}

/**
 * The narrative's whole journey from a stored jsonb value to the read model, one row at a time.
 *
 * These run through `readConsumerOptimizationWith` rather than against the guard directly, because
 * what the handler owes the browser is not "the guard is strict" but "whatever that row held, the
 * field this API serialises is either a valid narrative or null".
 */
describe("the narrative on the consumer optimization read", () => {
  it("exposes a well-formed stored narrative", async () => {
    const { gateway: deps } = gateway({
      async readLatestPlan() {
        return planRow({ narrative: STORED_NARRATIVE });
      },
    });

    const result = await readConsumerOptimizationWith(session(), deps);

    assert.ok(result?.narrative);
    assert.equal(result.narrative.verdict, "Not ready yet. 4 items to fix.");
    assert.equal(result.narrative.timeline.band, "30-60 days");
    assert.equal(result.narrative.nextSteps[0].itemKey, "utilization_under_30");
  });

  it("answers null when the column is there and empty", async () => {
    const { gateway: deps } = gateway({
      async readLatestPlan() {
        return planRow({ narrative: null });
      },
    });

    assert.equal((await readConsumerOptimizationWith(session(), deps))?.narrative, null);
  });

  it("answers null when the stored value is malformed, rather than passing a hole to the browser", async () => {
    for (const narrative of [
      { ...STORED_NARRATIVE, timeline: { band: "next week", reason: "Soon." } },
      { ...STORED_NARRATIVE, verdict: "" },
      { ...STORED_NARRATIVE, estimatedFundingPotential: "$50,000" },
      { schemaVersion: 1 },
      "Not ready yet.",
    ]) {
      const { gateway: deps } = gateway({
        async readLatestPlan() {
          return planRow({ narrative });
        },
      });

      const result = await readConsumerOptimizationWith(session(), deps);
      assert.equal(result?.narrative, null, JSON.stringify(narrative));
      // And the rest of the view is untouched: a bad narrative costs the card, never the checklist.
      assert.equal(result?.provenance, "plan");
    }
  });

  it("answers null on a database whose plans table has no narrative column yet", async () => {
    // Migration 435 adds the column. Before it, the read cannot select it and hands back a row
    // with the property absent — which must read as "no narrative", not as a failed read.
    const { gateway: deps } = gateway({
      async readLatestPlan() {
        return planRow();
      },
    });

    const result = await readConsumerOptimizationWith(session(), deps);

    assert.equal(result?.narrative, null);
    assert.equal(result?.readiness, 58);
  });
});

describe("the missing-column test the server read falls back on", () => {
  it("recognises Postgres undefined_column by its SQLSTATE", () => {
    assert.equal(isMissingColumnError({ code: "42703", message: "whatever" }, "narrative"), true);
  });

  it("recognises it by message when the code is not forwarded", () => {
    assert.equal(
      isMissingColumnError({ message: "column plans.narrative does not exist" }, "narrative"),
      true,
    );
  });

  it("does not mistake another failure for a missing column", () => {
    for (const error of [
      null,
      "42703",
      { code: "42501", message: "permission denied for table plans" },
      { message: "column plans.body does not exist" },
      { message: "connection terminated" },
    ]) {
      assert.equal(isMissingColumnError(error, "narrative"), false, JSON.stringify(error));
    }
  });
});
