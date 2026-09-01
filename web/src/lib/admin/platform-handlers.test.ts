import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  handleFundedVolume,
  handlePendingOutcomeReviews,
  handleSaasMetrics,
  handleTenants,
} from "./handlers.ts";
import {
  adminReadReason,
  isAdminReady,
  loadAdminResource,
  parseAdminFundedSeries,
  parseAdminReviewQueue,
  parseAdminSaasMetrics,
  parseAdminTenants,
} from "./platform-client.ts";

const ACTOR = "23000000-0000-4000-8000-000000000001";
const admin = { async requireAdmin() { return { id: ACTOR, role: "platform_admin" as const }; } };

const TENANT = {
  id: "23000000-0000-4000-8000-000000000010",
  name: "Alpha",
  slug: "alpha",
  plan: "agency",
  membership: "current",
  startedAt: "2025-09-12",
  clients: 12,
  fundingReadyDays: 20,
  fundedYtdCents: 4_500_000,
  fundedAllTimeCents: 5_500_000,
  fundedOutcomes: 3,
};

describe("a figure whose flag is off is null, never zero", () => {
  it("nulls the recorded funded columns while applications are off", async () => {
    const response = await handleTenants({ applications: false }, { ...admin, async readTenants() { return [TENANT]; } });
    const body = await response.json() as { tenants: Record<string, unknown>[] };
    assert.equal(body.tenants[0].fundedYtdCents, null);
    assert.equal(body.tenants[0].fundedAllTimeCents, null);
    assert.equal(body.tenants[0].fundedOutcomes, null);
    // The figures that do not depend on the outcomes surface still answer.
    assert.equal(body.tenants[0].clients, TENANT.clients);
    assert.equal(body.tenants[0].fundingReadyDays, TENANT.fundingReadyDays);
  });

  it("returns the recorded figures once applications are on", async () => {
    const response = await handleTenants({ applications: true }, { ...admin, async readTenants() { return [TENANT]; } });
    const body = await response.json() as { tenants: Record<string, unknown>[] };
    assert.equal(body.tenants[0].fundedYtdCents, TENANT.fundedYtdCents);
  });

  it("says the funded series is disabled rather than returning an empty enabled series", async () => {
    const off = await (await handleFundedVolume({ applications: false }, admin)).json() as { enabled: boolean };
    assert.equal(off.enabled, false);
    const on = await (await handleFundedVolume({ applications: true }, {
      ...admin,
      async readFundedVolume() { return { monthly: [], weekly: [{ label: "2026-08-10", amountCents: 0 }] }; },
    })).json() as { enabled: boolean };
    assert.equal(on.enabled, true);
  });

  it("says the review queue is disabled rather than returning an empty enabled queue", async () => {
    const off = await (await handlePendingOutcomeReviews({ applications: false }, admin)).json() as { enabled: boolean; reviews: unknown[] };
    assert.deepEqual(off, { enabled: false, reviews: [] });
  });

  it("answers 500 rather than a zero when the subscription read throws", async () => {
    const response = await handleSaasMetrics({ ...admin, async readPlatformMrrCents() { throw new Error("down"); } });
    assert.equal(response.status, 500);
  });
});

describe("the client reader keeps disabled, failed and empty apart", () => {
  const respond = (status: number, body: unknown) =>
    (async () => new Response(status === 404 ? null : JSON.stringify(body), { status })) as unknown as typeof fetch;

  it("maps the flag-off 404 to null and every other failure to failed", async () => {
    assert.equal(await loadAdminResource("/x", parseAdminTenants, respond(404, null)), null);
    assert.equal(await loadAdminResource("/x", parseAdminTenants, respond(500, {})), "failed");
    assert.equal(await loadAdminResource("/x", parseAdminTenants, respond(403, {})), "failed");
  });

  it("treats a 200 whose body does not parse as failed, not as an empty roster", async () => {
    assert.equal(await loadAdminResource("/x", parseAdminTenants, respond(200, { tenants: [{ id: 4 }] })), "failed");
    assert.equal(await loadAdminResource("/x", parseAdminSaasMetrics, respond(200, { platformMrrCents: -1 })), "failed");
    assert.equal(await loadAdminResource("/x", parseAdminFundedSeries, respond(200, { enabled: true, monthly: [], weekly: [{}] })), "failed");
    assert.equal(await loadAdminResource("/x", parseAdminReviewQueue, respond(200, { enabled: true })), "failed");
  });

  it("accepts the payloads the handlers actually produce", async () => {
    const tenants = await (await handleTenants({ applications: true }, { ...admin, async readTenants() { return [TENANT]; } })).json();
    assert.deepEqual(parseAdminTenants(tenants), [TENANT]);
    const queue = await (await handlePendingOutcomeReviews({ applications: true }, {
      ...admin,
      async readPendingReviews() {
        return [{ outcomeId: "o1", clientName: "Ada", operatorName: "Alpha", bankRef: "amex-business", kind: "approved", amountCents: 1000, recordedBy: null, decidedOn: "2026-08-01" }];
      },
    })).json();
    assert.equal(parseAdminReviewQueue(queue)?.reviews.length, 1);
  });

  it("names every unready state distinctly", () => {
    assert.equal(adminReadReason("loading", "off"), "Loading platform totals");
    assert.equal(adminReadReason("failed", "off"), "Platform totals unavailable");
    assert.equal(adminReadReason(null, "off"), "off");
    assert.equal(isAdminReady("loading"), false);
    assert.equal(isAdminReady(null), false);
    assert.equal(isAdminReady("failed"), false);
    assert.equal(isAdminReady({ ok: true }), true);
  });
});
