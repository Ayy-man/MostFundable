import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { handleAdminAudit, type AdminAuditHandlerDependencies } from "./audit-handler.ts";
import { ADMIN_AUDIT_DEFAULT_LIMIT, ADMIN_AUDIT_MAX_LIMIT } from "./audit-types.ts";

const EVENT = {
  action: "org.lifecycle_changed",
  actorName: "Ada Admin",
  id: "21000000-0000-4000-8000-000000000001",
  occurredAt: "2026-08-31T14:38:59.421586+00:00",
  subjectId: "21000000-0000-4000-8000-000000000002",
  subjectType: "org",
} as const;

function dependencies(overrides: Partial<AdminAuditHandlerDependencies> = {}): AdminAuditHandlerDependencies {
  return {
    async list() { return [EVENT]; },
    async requireAdmin() { return { id: "21000000-0000-4000-8000-000000000003", role: "platform_admin" }; },
    ...overrides,
  };
}

describe("admin audit handler", () => {
  it("authenticates before parsing filters", async () => {
    const calls: string[] = [];
    const response = await handleAdminAudit(
      new Request("http://local/api/admin/audit?unknown=1"),
      dependencies({
        async requireAdmin() { calls.push("auth"); throw { status: 401 }; },
        async list() { calls.push("list"); return []; },
      }),
    );
    assert.equal(response.status, 401);
    assert.deepEqual(calls, ["auth"]);
  });

  it("requires the platform-admin role", async () => {
    const response = await handleAdminAudit(new Request("http://local/api/admin/audit"), dependencies({
      async requireAdmin() { throw { status: 403 }; },
    }));
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: { code: "forbidden" } });
  });

  it("uses the bounded default and returns a private, metadata-free projection", async () => {
    let receivedLimit = 0;
    const response = await handleAdminAudit(new Request("http://local/api/admin/audit"), dependencies({
      async list(limit) {
        receivedLimit = limit;
        return [{ ...EVENT, meta: { private: true }, email: "private@example.test", risk: "High" }] as unknown as readonly typeof EVENT[];
      },
    }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(receivedLimit, ADMIN_AUDIT_DEFAULT_LIMIT);
    const text = await response.text();
    assert.deepEqual(JSON.parse(text), { events: [EVENT] });
    assert.doesNotMatch(text, /meta|email|risk|actorProfileId/i);
  });

  it("accepts one positive limit up to the hard maximum", async () => {
    let receivedLimit = 0;
    const response = await handleAdminAudit(
      new Request(`http://local/api/admin/audit?limit=${ADMIN_AUDIT_MAX_LIMIT}`),
      dependencies({ async list(limit) { receivedLimit = limit; return []; } }),
    );
    assert.equal(response.status, 200);
    assert.equal(receivedLimit, ADMIN_AUDIT_MAX_LIMIT);
  });

  it("rejects unknown, duplicate, non-decimal, zero, and over-limit filters without reading", async () => {
    for (const query of [
      "?other=1",
      "?limit=1&limit=2",
      "?limit=1.5",
      "?limit=0",
      `?limit=${ADMIN_AUDIT_MAX_LIMIT + 1}`,
    ]) {
      let reads = 0;
      const response = await handleAdminAudit(new Request(`http://local/api/admin/audit${query}`), dependencies({
        async list() { reads += 1; return []; },
      }));
      assert.equal(response.status, 400, query);
      assert.equal(reads, 0, query);
      assert.deepEqual(await response.json(), { error: { code: "audit_filter_invalid" } });
    }
  });

  it("redacts repository failures", async () => {
    const response = await handleAdminAudit(new Request("http://local/api/admin/audit"), dependencies({
      async list() { throw new Error("database hostname and private detail"); },
    }));
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: { code: "admin_request_failed" } });
  });
});
