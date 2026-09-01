import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  handleAdminPrivacyRequestAction,
  handleConsumerPrivacyRequests,
  type PrivacyHttpDependencies,
} from "./http.ts";
import { PrivacyWorkflowError, type PrivacyRequest } from "./types.ts";

const ACTOR = "41600000-0000-4000-8000-000000000001";
const REQUEST = "41600000-0000-4000-8000-000000000003";

function item(): PrivacyRequest {
  return Object.freeze({
    completedAt: null,
    completionNote: null,
    consumerEmail: "consumer@example.test",
    consumerName: "Consumer",
    denialReason: null,
    deniedAt: null,
    id: REQUEST,
    kind: "deletion",
    organizationName: "Northbridge",
    reviewedAt: null,
    status: "submitted",
    submittedAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  });
}

function dependencies(overrides: Partial<PrivacyHttpDependencies> = {}): PrivacyHttpDependencies {
  return {
    async administer() { return item(); },
    async list() { return [item()]; },
    async requireAdmin() { return { id: ACTOR, role: "platform_admin" }; },
    async requireConsumer() { return { id: ACTOR, role: "consumer" }; },
    async submit() { return item(); },
    ...overrides,
  };
}

describe("privacy HTTP boundary", () => {
  it("authenticates before reading a consumer mutation body", async () => {
    let submitted = false;
    const response = await handleConsumerPrivacyRequests(
      new Request("http://local/api/consumer/privacy-requests", { method: "POST", body: "not json" }),
      dependencies({
        async requireConsumer() { throw { status: 401 }; },
        async submit() { submitted = true; return item(); },
      }),
    );
    assert.equal(response.status, 401);
    assert.equal(submitted, false);
  });

  it("accepts the exact consumer request and rejects extra fields", async () => {
    const accepted = await handleConsumerPrivacyRequests(
      new Request("http://local/api/consumer/privacy-requests", {
        method: "POST",
        body: JSON.stringify({ kind: "deletion" }),
      }),
      dependencies(),
    );
    assert.equal(accepted.status, 201);
    assert.equal((await accepted.json()).request.kind, "deletion");
    const widened = await handleConsumerPrivacyRequests(
      new Request("http://local/api/consumer/privacy-requests", {
        method: "POST",
        body: JSON.stringify({ kind: "deletion", profileId: ACTOR }),
      }),
      dependencies(),
    );
    assert.equal(widened.status, 400);
  });

  it("returns only safe blocker codes when deletion completion is refused", async () => {
    const response = await handleAdminPrivacyRequestAction(
      new Request(`http://local/api/admin/privacy-requests/${REQUEST}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "complete", completionNote: null }),
      }),
      REQUEST,
      dependencies({
        async administer() {
          throw new PrivacyWorkflowError("erasure_blocked", [
            "active_subscription",
            "monitoring_provider_cleanup_pending",
          ]);
        },
      }),
    );
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      error: {
        blockers: ["active_subscription", "monitoring_provider_cleanup_pending"],
        code: "privacy_erasure_blocked",
      },
    });
  });

  it("requires exact denial and completion payloads", async () => {
    const denied = await handleAdminPrivacyRequestAction(
      new Request("http://local", { method: "PATCH", body: JSON.stringify({ action: "deny", reason: "  Duplicate request.  " }) }),
      REQUEST,
      dependencies({
        async administer(_actor, _id, action) {
          assert.deepEqual(action, { action: "deny", reason: "Duplicate request." });
          return item();
        },
      }),
    );
    assert.equal(denied.status, 200);
    const widened = await handleAdminPrivacyRequestAction(
      new Request("http://local", { method: "PATCH", body: JSON.stringify({ action: "review", reason: "ignored" }) }),
      REQUEST,
      dependencies(),
    );
    assert.equal(widened.status, 400);
  });
});
