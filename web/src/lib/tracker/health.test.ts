import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { orderTrackerClientsByHealth, validateTrackerHealthRows } from "./health.ts";
import { TARGET_DAYS } from "./timer.ts";
import { validateTrackerPatchInput, type TrackerClient, type TrackerHealth } from "./types.ts";

const ids = ["a", "b", "c"];

function client(id: string, health: TrackerHealth): TrackerClient {
  return {
    id, health, status: "active", lastActivityAt: "2026-08-16T00:00:00Z", archivedAt: null, archivedById: null,
    consumerProfileId: null, displayName: id, businessName: null, assignedToId: null, assignedToName: null,
    stage: "optimization", stageEnteredAt: "2026-08-01T00:00:00Z", startedAt: "2026-08-01", history: [],
    analysisAt: null, analysisPending: null, readiness: null, openActionCount: null, estimatedCompletionAt: null, monitoring: "pending",
    nextRefreshAt: null, goalCents: null, matchesUnlockedOverride: false, fundingApprovedCents: null,
  };
}

describe("tracker SQL health contract", () => {
  it("accepts one exact closed result per requested client", () => {
    assert.deepEqual([...validateTrackerHealthRows(ids, [
      { client_id: "a", health: "red", health_rank: 0 },
      { client_id: "b", health: "amber", health_rank: 1 },
      { client_id: "c", health: "green", health_rank: 2 },
    ])], [["a", "red"], ["b", "amber"], ["c", "green"]]);
  });

  for (const [name, rows] of [
    ["missing", [{ client_id: "a", health: "red", health_rank: 0 }, { client_id: "b", health: "amber", health_rank: 1 }]],
    ["duplicate", [{ client_id: "a", health: "red", health_rank: 0 }, { client_id: "a", health: "red", health_rank: 0 }, { client_id: "c", health: "green", health_rank: 2 }]],
    ["unknown client", [{ client_id: "a", health: "red", health_rank: 0 }, { client_id: "b", health: "amber", health_rank: 1 }, { client_id: "x", health: "green", health_rank: 2 }]],
    ["unknown health", [{ client_id: "a", health: "blue", health_rank: 0 }, { client_id: "b", health: "amber", health_rank: 1 }, { client_id: "c", health: "green", health_rank: 2 }]],
    ["wrong rank", [{ client_id: "a", health: "red", health_rank: 2 }, { client_id: "b", health: "amber", health_rank: 1 }, { client_id: "c", health: "green", health_rank: 2 }]],
  ] as const) {
    it(`fails closed for a ${name} response`, () => assert.throws(() => validateTrackerHealthRows(ids, rows), /TRACKER_HEALTH_INVALID/));
  }

  it("orders attention levels and preserves ties", () => {
    assert.deepEqual(orderTrackerClientsByHealth([
      client("g", "green"), client("r1", "red"), client("r2", "red"), client("a", "amber"),
    ]).map(({ id }) => id), ["r1", "r2", "a", "g"]);
  });

  it("pins only the two 60-day target stages", () => {
    assert.deepEqual(TARGET_DAYS, { optimization: 60, applying: 60 });
  });
});

describe("tracker status patch", () => {
  it("accepts one exact status key", () => assert.deepEqual(validateTrackerPatchInput({ status: "archived" }), { ok: true, value: { status: "archived" } }));
  for (const body of [{ status: "red" }, { status: "active", stage: "ready" }, { status: "active", actor: "x" }]) {
    it("rejects status mixtures and unsupported values", () => assert.equal(validateTrackerPatchInput(body).ok, false));
  }
});

describe("tracker client metadata patch", () => {
  const ASSIGNEE_ID = "11111111-1111-4111-8111-111111111111";

  it("trims editable identity fields and accepts an explicit assignment", () => {
    assert.deepEqual(
      validateTrackerPatchInput({
        assignedToId: ASSIGNEE_ID,
        businessName: "  North Star LLC  ",
        displayName: "  Ada Client  ",
      }),
      {
        ok: true,
        value: {
          assignedToId: ASSIGNEE_ID,
          businessName: "North Star LLC",
          displayName: "Ada Client",
        },
      },
    );
  });

  it("accepts clearing a business and assignment without inventing empty text", () => {
    assert.deepEqual(
      validateTrackerPatchInput({ assignedToId: null, businessName: null }),
      { ok: true, value: { assignedToId: null, businessName: null } },
    );
  });

  for (const body of [
    { assignedToId: "not-a-uuid" },
    { businessName: "   " },
    { displayName: "   " },
    { displayName: "Ada", status: "active" },
    { displayName: "Ada", orgId: ASSIGNEE_ID },
  ]) {
    it("rejects untrusted identity, assignment, and mixed lifecycle input", () => {
      assert.equal(validateTrackerPatchInput(body).ok, false);
    });
  }
});
