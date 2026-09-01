import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AdminWorkspaceClientError,
  changeAdminWorkspaceLifecycle,
  loadAdminWorkspaceRoster,
  provisionAdminWorkspace,
} from "./tenant-lifecycle-client.ts";

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const INVITE_ID = "33333333-3333-4333-8333-333333333333";
const IDEMPOTENCY_KEY = "55555555-5555-4555-8555-555555555555";

const WORKSPACE = {
  clients: 2,
  fundedAllTimeCents: 4_500_000,
  fundedOutcomes: 1,
  fundedYtdCents: 4_500_000,
  fundingReadyDays: 20,
  id: ORG_ID,
  membership: "trial",
  name: "Example Funding",
  plan: "trial",
  slug: "example-funding",
  startedAt: "2026-09-01",
};

const INPUT = {
  email: " Owner@Example.Test ",
  fullName: " First Owner ",
  name: " Example Funding ",
  plan: "trial" as const,
  slug: " Example-Funding ",
};

const json = (body: unknown, status = 200): Response => Response.json(body, { status });

async function clientError(
  promise: Promise<unknown>,
  code: string,
): Promise<AdminWorkspaceClientError> {
  try {
    await promise;
    assert.fail("expected the client request to fail");
  } catch (error) {
    assert.ok(error instanceof AdminWorkspaceClientError);
    assert.equal(error.code, code);
    return error;
  }
}

describe("platform workspace roster client", () => {
  it("loads a no-cache same-origin roster and validates governed enums", async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const workspaces = await loadAdminWorkspaceRoster(async (input, init) => {
      calls.push({ input, init });
      return json({ tenants: [WORKSPACE] });
    });
    assert.deepEqual(workspaces, [WORKSPACE]);
    assert.deepEqual(calls, [{
      input: "/api/admin/tenants",
      init: { cache: "no-store", credentials: "same-origin" },
    }]);
  });

  it("keeps feature-disabled, failed, malformed, and network reads distinct", async () => {
    assert.equal(await loadAdminWorkspaceRoster(async () => json({}, 404)), null);
    assert.equal(
      (await clientError(
        loadAdminWorkspaceRoster(async () => json({ error: { code: "forbidden", message: "Access is denied." } }, 403)),
        "forbidden",
      )).status,
      403,
    );
    await clientError(
      loadAdminWorkspaceRoster(async () => json({ tenants: [{ ...WORKSPACE, plan: "enterprise" }] })),
      "INVALID_RESPONSE",
    );
    await clientError(
      loadAdminWorkspaceRoster(async () => { throw new Error("offline detail"); }),
      "NETWORK_UNAVAILABLE",
    );
  });
});

describe("platform workspace provision client", () => {
  it("sends only the canonical owner/workspace fields and a stable idempotency key", async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const created = await provisionAdminWorkspace(INPUT, IDEMPOTENCY_KEY, async (input, init) => {
      calls.push({ input, init });
      return json({ tenant: { inviteId: INVITE_ID, orgId: ORG_ID, replayed: false } }, 201);
    });
    assert.deepEqual(created, { inviteId: INVITE_ID, orgId: ORG_ID, replayed: false });
    const call = calls[0];
    assert.ok(call);
    assert.equal(call.input, "/api/admin/tenants");
    assert.equal(call.init?.method, "POST");
    assert.equal(call.init?.cache, "no-store");
    assert.equal(call.init?.credentials, "same-origin");
    assert.deepEqual(JSON.parse(call.init?.body as string), {
      email: "owner@example.test",
      fullName: "First Owner",
      name: "Example Funding",
      slug: "example-funding",
    });
    assert.equal((call.init?.headers as Record<string, string>)["Idempotency-Key"], IDEMPOTENCY_KEY);
    assert.equal(Object.hasOwn(JSON.parse(call.init?.body as string), "plan"), false);
  });

  it("refuses unsupported plans and malformed inputs before fetch", async () => {
    let calls = 0;
    const fetcher = async () => { calls += 1; return json({}); };
    await clientError(
      provisionAdminWorkspace({ ...INPUT, plan: "pro" } as never, IDEMPOTENCY_KEY, fetcher),
      "INVALID_WORKSPACE_INPUT",
    );
    await clientError(
      provisionAdminWorkspace({ ...INPUT, slug: "admin" }, IDEMPOTENCY_KEY, fetcher),
      "INVALID_WORKSPACE_INPUT",
    );
    await clientError(
      provisionAdminWorkspace(INPUT, "not-a-key", fetcher),
      "INVALID_WORKSPACE_INPUT",
    );
    assert.equal(calls, 0);
  });

  it("preserves typed partial-delivery failures and rejects malformed successes", async () => {
    const partial = await clientError(
      provisionAdminWorkspace(INPUT, IDEMPOTENCY_KEY, async () => json({
        error: {
          code: "TENANT_INVITE_DELIVERY_FAILED",
          message: "The tenant was provisioned, but the invite could not be sent.",
        },
      }, 502)),
      "TENANT_INVITE_DELIVERY_FAILED",
    );
    assert.equal(partial.status, 502);
    await clientError(
      provisionAdminWorkspace(INPUT, IDEMPOTENCY_KEY, async () => json({
        tenant: { inviteId: INVITE_ID, orgId: "wrong", replayed: false },
      }, 201)),
      "INVALID_RESPONSE",
    );
  });
});

describe("platform workspace lifecycle client", () => {
  it("sends the governed lifecycle action and validates its resulting membership", async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const result = await changeAdminWorkspaceLifecycle(ORG_ID, "deactivate", async (input, init) => {
      calls.push({ input, init });
      return json({ tenant: { membership: "deactivated", orgId: ORG_ID, slug: null, trialEndsAt: null } });
    });
    assert.deepEqual(result, {
      membership: "deactivated",
      orgId: ORG_ID,
      slug: null,
      trialEndsAt: null,
    });
    assert.equal(calls[0]?.input, `/api/admin/tenants/${ORG_ID}`);
    assert.equal(calls[0]?.init?.method, "PATCH");
    assert.equal(calls[0]?.init?.cache, "no-store");
    assert.equal(calls[0]?.init?.credentials, "same-origin");
    assert.deepEqual(JSON.parse(calls[0]?.init?.body as string), { action: "deactivate" });
  });

  it("accepts only trial/current reactivation and preserves the trial-extension prerequisite", async () => {
    assert.equal(
      (await changeAdminWorkspaceLifecycle(ORG_ID, "reactivate", async () => json({
        tenant: { membership: "current", orgId: ORG_ID, slug: null, trialEndsAt: null },
      }))).membership,
      "current",
    );
    await clientError(
      changeAdminWorkspaceLifecycle(ORG_ID, "reactivate", async () => json({
        tenant: { membership: "deactivated", orgId: ORG_ID, slug: null, trialEndsAt: null },
      })),
      "INVALID_RESPONSE",
    );
    const blocked = await clientError(
      changeAdminWorkspaceLifecycle(ORG_ID, "reactivate", async () => json({
        error: {
          code: "TENANT_REACTIVATION_REQUIRES_TRIAL_EXTENSION",
          message: "Extend the tenant trial before reactivation.",
        },
      }, 409)),
      "TENANT_REACTIVATION_REQUIRES_TRIAL_EXTENSION",
    );
    assert.equal(blocked.status, 409);
  });
});
