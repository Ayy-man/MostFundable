import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  loadAdminPrivacyRequests,
  loadConsumerPrivacyRequests,
  parsePrivacyRequest,
  submitConsumerPrivacyRequest,
  updateAdminPrivacyRequest,
} from "./client.ts";

const REQUEST = "41600000-0000-4000-8000-000000000003";

function item(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  };
}

describe("privacy browser client", () => {
  it("accepts only the exact request shape and coherent lifecycle timestamps", () => {
    assert.equal(parsePrivacyRequest(item())?.id, REQUEST);
    assert.equal(parsePrivacyRequest(item({ profileId: REQUEST })), null);
    assert.equal(parsePrivacyRequest(item({ reviewedAt: "2026-09-01T01:00:00.000Z" })), null);
    assert.equal(parsePrivacyRequest(item({ status: "completed" })), null);
    assert.equal(parsePrivacyRequest(item({ status: "queued" })), null);
  });

  it("loads scoped consumer and admin histories without caching", async () => {
    const calls: unknown[] = [];
    const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push([url, init]);
      return Response.json({ requests: [item()] });
    };
    const consumerRead = await loadConsumerPrivacyRequests(fetcher as typeof fetch);
    const adminRead = await loadAdminPrivacyRequests(fetcher as typeof fetch);
    assert.ok(Array.isArray(consumerRead));
    assert.ok(Array.isArray(adminRead));
    assert.equal(consumerRead[0]?.kind, "deletion");
    assert.equal(adminRead[0]?.id, REQUEST);
    assert.deepEqual(calls, [
      ["/api/consumer/privacy-requests", { cache: "no-store", credentials: "same-origin" }],
      ["/api/admin/privacy-requests", { cache: "no-store", credentials: "same-origin" }],
    ]);
  });

  it("sends only the closed consumer submission payload and rejects a malformed success", async () => {
    const calls: unknown[] = [];
    const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push([url, init]);
      return Response.json(calls.length === 1 ? { request: item() } : { request: { ...item(), secret: "leak" } });
    };
    const accepted = await submitConsumerPrivacyRequest("deletion", fetcher as typeof fetch);
    assert.equal(accepted.ok, true);
    const malformed = await submitConsumerPrivacyRequest("deletion", fetcher as typeof fetch);
    assert.deepEqual(malformed, { blockers: [], code: "privacy_request_unavailable", ok: false });
    assert.deepEqual(calls[0], ["/api/consumer/privacy-requests", {
      body: JSON.stringify({ kind: "deletion" }),
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }]);
  });

  it("parses only closed erasure blocker codes and never exposes an arbitrary service error", async () => {
    const blocked = await updateAdminPrivacyRequest(
      REQUEST,
      { action: "complete", completionNote: null },
      (async () => Response.json({
        error: {
          blockers: ["active_subscription", "provider_cancellation_pending"],
          code: "privacy_erasure_blocked",
        },
      }, { status: 409 })) as typeof fetch,
    );
    assert.deepEqual(blocked, {
      blockers: ["active_subscription", "provider_cancellation_pending"],
      code: "privacy_erasure_blocked",
      ok: false,
    });

    const untrusted = await updateAdminPrivacyRequest(
      REQUEST,
      { action: "review" },
      (async () => Response.json({
        error: { blockers: ["provider_exception: secret"], code: "provider_exception: secret" },
      }, { status: 503 })) as typeof fetch,
    );
    assert.deepEqual(untrusted, {
      blockers: [],
      code: "privacy_request_unavailable",
      ok: false,
    });
  });
});
