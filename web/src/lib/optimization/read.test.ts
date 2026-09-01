import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
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
