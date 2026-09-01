import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadAdminAudit, parseAdminAudit } from "./audit-client.ts";
import { ADMIN_AUDIT_DEFAULT_LIMIT, ADMIN_AUDIT_MAX_LIMIT } from "./audit-types.ts";

const EVENT = {
  action: "org.lifecycle_changed",
  actorName: "Ada Admin",
  id: "21000000-0000-4000-8000-000000000001",
  occurredAt: "2026-08-31T14:38:59.421586+00:00",
  subjectId: "21000000-0000-4000-8000-000000000002",
  subjectType: "org",
} as const;

const respond = (status: number, body?: unknown) =>
  (async () => new Response(body === undefined ? null : JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("admin audit client", () => {
  it("strictly parses the safe response contract", () => {
    assert.deepEqual(parseAdminAudit({ events: [EVENT] }), [EVENT]);
    assert.deepEqual(parseAdminAudit({ events: [{ ...EVENT, actorName: null }] }), [{ ...EVENT, actorName: null }]);
    assert.equal(parseAdminAudit({ events: [{ ...EVENT, risk: "High" }] }), null);
    assert.equal(parseAdminAudit({ events: [{ ...EVENT, meta: {} }] }), null);
    assert.equal(parseAdminAudit({ events: [{ ...EVENT, email: "private@example.test" }] }), null);
    assert.equal(parseAdminAudit({ events: [{ ...EVENT, occurredAt: "not-a-time" }] }), null);
    assert.equal(parseAdminAudit({ events: [{ ...EVENT, subjectId: "not-a-uuid" }] }), null);
    assert.equal(parseAdminAudit({ events: [EVENT], other: true }), null);
  });

  it("rejects a response larger than the server maximum", () => {
    assert.equal(parseAdminAudit({ events: Array.from({ length: ADMIN_AUDIT_MAX_LIMIT + 1 }, () => EVENT) }), null);
  });

  it("requests the bounded endpoint without using a shared cache", async () => {
    let path = "";
    let init: RequestInit | undefined;
    const result = await loadAdminAudit(async (input, options) => {
      path = String(input);
      init = options;
      return new Response(JSON.stringify({ events: [EVENT] }), { status: 200 });
    });
    assert.deepEqual(result, [EVENT]);
    assert.equal(path, `/api/admin/audit?limit=${ADMIN_AUDIT_DEFAULT_LIMIT}`);
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.credentials, "same-origin");
  });

  it("keeps disabled, failed, and a healthy empty audit trail distinct", async () => {
    assert.equal(await loadAdminAudit(respond(404)), null);
    assert.equal(await loadAdminAudit(respond(403, {})), "failed");
    assert.equal(await loadAdminAudit(respond(500, {})), "failed");
    assert.equal(await loadAdminAudit(respond(200, { events: [{ id: 4 }] })), "failed");
    assert.deepEqual(await loadAdminAudit(respond(200, { events: [] })), []);
    assert.equal(await loadAdminAudit((async () => { throw new Error("network"); }) as typeof fetch), "failed");
  });
});
