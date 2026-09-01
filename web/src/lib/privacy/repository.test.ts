import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createPrivacyRepository } from "./repository.ts";
import { PrivacyWorkflowError } from "./types.ts";

const ACTOR = "41600000-0000-4000-8000-000000000001";
const REQUEST = "41600000-0000-4000-8000-000000000003";
const PROFILE = "41600000-0000-4000-8000-000000000002";
const PATH = "41600000-0000-4000-8000-000000000010/41600000-0000-4000-8000-000000000011/41600000-0000-4000-8000-000000000012/source.pdf";

function row(overrides: Record<string, unknown> = {}) {
  return {
    completed_at: null,
    completion_note: null,
    consumer_email: "consumer@example.test",
    consumer_name: "Consumer",
    denial_reason: null,
    denied_at: null,
    id: REQUEST,
    kind: "deletion",
    organization_name: "Northbridge",
    reviewed_at: "2026-09-01T01:00:00.000Z",
    status: "in_review",
    submitted_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T01:00:00.000Z",
    ...overrides,
  };
}

describe("privacy repository", () => {
  it("strictly maps the scoped request list", async () => {
    const repository = createPrivacyRepository(() => ({
      async rpc(name: string) {
        assert.equal(name, "privacy_list_requests");
        return { data: [row()], error: null };
      },
    }));
    const requests = await repository.list(ACTOR);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].consumerName, "Consumer");
    assert.equal(requests[0].kind, "deletion");
  });

  it("rejects widened provider shapes instead of inventing a request", async () => {
    const repository = createPrivacyRepository(() => ({
      async rpc() { return { data: [row({ status: "queued" })], error: null }; },
    }));
    await assert.rejects(
      repository.list(ACTOR),
      (error: unknown) => error instanceof PrivacyWorkflowError && error.code === "read_failed",
    );
  });

  it("accepts only private client-document coordinates from the server-only preflight", async () => {
    const repository = createPrivacyRepository(() => ({
      async rpc(name: string) {
        assert.equal(name, "privacy_request_erasure_targets");
        return { data: {
          blockers: ["provider_cancellation_pending"],
          profileId: PROFILE,
          pseudonymEmail: "deleted+41600000000040008000000000000002@privacy.invalid",
          targets: [{ bucket: "client-documents", objectPath: PATH }],
        }, error: null };
      },
    }));
    const plan = await repository.erasurePlan(REQUEST, ACTOR);
    assert.deepEqual(plan.blockers, ["provider_cancellation_pending"]);
    assert.deepEqual(plan.targets, [{ bucket: "client-documents", objectPath: PATH }]);
  });

  it("rejects a caller-controlled bucket or traversal-like object name", async () => {
    const repository = createPrivacyRepository(() => ({
      async rpc() { return { data: {
        blockers: [],
        profileId: PROFILE,
        pseudonymEmail: "deleted+41600000000040008000000000000002@privacy.invalid",
        targets: [{ bucket: "public", objectPath: PATH.replace("source.pdf", "../source.pdf") }],
      }, error: null }; },
    }));
    await assert.rejects(
      repository.erasurePlan(REQUEST, ACTOR),
      (error: unknown) => error instanceof PrivacyWorkflowError && error.code === "read_failed",
    );
  });
});
