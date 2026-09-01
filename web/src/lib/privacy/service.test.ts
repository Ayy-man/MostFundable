import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { administerPrivacyRequest, submitPrivacyRequest } from "./service.ts";
import {
  PrivacyWorkflowError,
  type PrivacyErasurePlan,
  type PrivacyRequest,
} from "./types.ts";
import type { PrivacyServiceDependencies } from "./service.ts";

const ACTOR = "41600000-0000-4000-8000-000000000001";
const PROFILE = "41600000-0000-4000-8000-000000000002";
const REQUEST = "41600000-0000-4000-8000-000000000003";
const PATH = "41600000-0000-4000-8000-000000000010/41600000-0000-4000-8000-000000000011/41600000-0000-4000-8000-000000000012/source.pdf";

function request(overrides: Partial<PrivacyRequest> = {}): PrivacyRequest {
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
    reviewedAt: "2026-09-01T01:00:00.000Z",
    status: "in_review",
    submittedAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T01:00:00.000Z",
    ...overrides,
  });
}

function plan(overrides: Partial<PrivacyErasurePlan> = {}): PrivacyErasurePlan {
  return Object.freeze({
    blockers: Object.freeze([]),
    profileId: PROFILE,
    pseudonymEmail: "deleted+41600000000040008000000000000002@privacy.invalid",
    targets: Object.freeze([{ bucket: "client-documents" as const, objectPath: PATH }]),
    ...overrides,
  });
}

function dependencies(events: string[] = []): PrivacyServiceDependencies {
  return {
    auth: {
      async disable(profileId, email) { events.push(`auth:${profileId}:${email}`); },
    },
    repository: {
      async completeAccess(_id, _actor, note) { events.push(`access:${note}`); return request({ completionNote: note, kind: "access", status: "completed" }); },
      async completeDeletion() { events.push("database"); return request({ completedAt: "2026-09-01T02:00:00.000Z", completionNote: "done", status: "completed" }); },
      async deny(_id, _actor, reason) { events.push(`deny:${reason}`); return request({ denialReason: reason, status: "denied" }); },
      async erasurePlan() { events.push("plan"); return plan(); },
      async get() { return request(); },
      async list() { return [request()]; },
      async review() { events.push("review"); return request(); },
      async submit(_actor, kind) { events.push(`submit:${kind}`); return request({ kind }); },
    },
    storage: {
      async exists() { events.push("absence"); return false; },
      async remove() { events.push("remove"); },
    },
  };
}

describe("privacy request service", () => {
  it("submits only a closed request kind", async () => {
    const events: string[] = [];
    const result = await submitPrivacyRequest(ACTOR, "access", dependencies(events));
    assert.equal(result.kind, "access");
    assert.deepEqual(events, ["submit:access"]);
    await assert.rejects(
      submitPrivacyRequest(ACTOR, "export" as "access", dependencies(events)),
      (error: unknown) => error instanceof PrivacyWorkflowError && error.code === "invalid_request",
    );
  });

  it("fails closed on provider blockers before touching storage or auth", async () => {
    const events: string[] = [];
    const deps = dependencies(events);
    deps.repository.erasurePlan = async () => {
      events.push("plan");
      return plan({ blockers: ["active_subscription", "provider_cancellation_pending"] });
    };
    await assert.rejects(
      administerPrivacyRequest(ACTOR, REQUEST, { action: "complete", completionNote: null }, deps),
      (error: unknown) => error instanceof PrivacyWorkflowError
        && error.code === "erasure_blocked"
        && error.blockers.join(",") === "active_subscription,provider_cancellation_pending",
    );
    assert.deepEqual(events, ["plan"]);
  });

  it("removes and verifies every private object before auth disable and database anonymization", async () => {
    const events: string[] = [];
    const completed = await administerPrivacyRequest(
      ACTOR,
      REQUEST,
      { action: "complete", completionNote: null },
      dependencies(events),
    );
    assert.equal(completed.status, "completed");
    assert.deepEqual(events, [
      "plan",
      "remove",
      "absence",
      `auth:${PROFILE}:deleted+41600000000040008000000000000002@privacy.invalid`,
      "database",
    ]);
  });

  it("does not disable auth or anonymize when storage absence cannot be proved", async () => {
    const events: string[] = [];
    const deps = dependencies(events);
    deps.storage.exists = async () => { events.push("present"); return true; };
    await assert.rejects(
      administerPrivacyRequest(ACTOR, REQUEST, { action: "complete", completionNote: null }, deps),
      (error: unknown) => error instanceof PrivacyWorkflowError && error.code === "storage_cleanup_failed",
    );
    assert.deepEqual(events, ["plan", "remove", "present"]);
  });

  it("does not claim completion when provider auth disable cannot be verified", async () => {
    const events: string[] = [];
    const deps = dependencies(events);
    deps.auth.disable = async () => { events.push("auth-failed"); throw new Error("provider detail"); };
    await assert.rejects(
      administerPrivacyRequest(ACTOR, REQUEST, { action: "complete", completionNote: null }, deps),
      (error: unknown) => error instanceof PrivacyWorkflowError && error.code === "auth_disable_failed",
    );
    assert.deepEqual(events, ["plan", "remove", "absence", "auth-failed"]);
  });

  it("records access fulfillment only with a bounded delivery note and skips erasure", async () => {
    const events: string[] = [];
    const deps = dependencies(events);
    deps.repository.get = async () => request({ kind: "access" });
    await administerPrivacyRequest(
      ACTOR,
      REQUEST,
      { action: "complete", completionNote: "  Delivered through verified support channel.  " },
      deps,
    );
    assert.deepEqual(events, ["access:Delivered through verified support channel."]);
    await assert.rejects(
      administerPrivacyRequest(ACTOR, REQUEST, { action: "complete", completionNote: null }, deps),
      (error: unknown) => error instanceof PrivacyWorkflowError && error.code === "invalid_request",
    );
  });
});
