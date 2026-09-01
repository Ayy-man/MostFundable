import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  latestAuthorizationByClient,
  monitoringState,
  type ConsentAuthorizationEvent,
} from "./consent-state";

function event(
  id: string,
  occurredAt: string,
  authorized: boolean,
  clientId = "client-1",
): ConsentAuthorizationEvent {
  return { authorized, clientId, id, occurredAt };
}

describe("tracker consent state", () => {
  it("uses the latest grant or withdrawal instead of the enrollment snapshot", () => {
    const authorization = latestAuthorizationByClient([
      event("grant-1", "2026-08-01T00:00:00.000Z", true),
      event("revoke-1", "2026-08-02T00:00:00.000Z", false),
      event("grant-2", "2026-08-03T00:00:00.000Z", true),
    ]);
    assert.equal(authorization.get("client-1"), true);
  });

  it("lets a withdrawal win an exact timestamp tie, matching Postgres", () => {
    const at = "2026-08-02T00:00:00.000Z";
    const authorization = latestAuthorizationByClient([
      event("z-grant", at, true),
      event("a-revoke", at, false),
    ]);
    assert.equal(authorization.get("client-1"), false);
  });

  it("shows an active enrollment as paused after authorization is withdrawn", () => {
    assert.equal(monitoringState("active", false), "paused");
    assert.equal(monitoringState("active", true), "active");
    assert.equal(monitoringState("pending", false), "pending");
    assert.equal(monitoringState("cancelled", true), "paused");
  });
});
