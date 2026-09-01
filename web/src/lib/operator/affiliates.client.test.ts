import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  OperatorAffiliateClientError,
  affiliatePaymentStatusLabel,
  loadOperatorAffiliates,
  loadOperatorAffiliateStatement,
  shareOperatorAffiliateClient,
  unshareOperatorAffiliateClient,
  updateOperatorAffiliateLifecycle,
  updateOperatorAffiliateShare,
} from "./affiliates.client.ts";

const AFFILIATE = "21000000-0000-4000-8000-000000000101";
const PROFILE = "21000000-0000-4000-8000-000000000102";
const CLIENT = "21000000-0000-4000-8000-000000000301";

const roster = {
  active: true,
  affiliateId: AFFILIATE,
  defaultCommissionBps: 1000,
  email: "partner@example.test",
  expectedCommissionCents: 500,
  name: "Partner",
  paidCommissionCents: 100,
  profileId: PROFILE,
  referralSlug: "partner",
  sharedClients: 2,
};

describe("operator affiliate client", () => {
  it("reads a closed roster and rejects a malformed success", async () => {
    assert.deepEqual(await loadOperatorAffiliates(async () => Response.json({ affiliates: [roster] })), [roster]);
    await assert.rejects(
      loadOperatorAffiliates(async () => Response.json({ affiliates: [{ ...roster, sharedClients: -1 }] })),
      (error) => error instanceof OperatorAffiliateClientError && error.status === 502,
    );
  });

  it("reads a statement through the affiliate-scoped URL", async () => {
    let url = "";
    const rows = await loadOperatorAffiliateStatement(AFFILIATE, async (input) => {
      url = String(input);
      return Response.json({ statement: [{
        affiliateId: AFFILIATE,
        clientId: CLIENT,
        clientName: "Client",
        commissionOverride: false,
        expectedCommissionCents: 500,
        fundedAmountCents: 5000,
        paymentStatus: "pending",
        stage: "funded",
        startedAt: "2026-08-17",
      }] });
    });
    assert.equal(url, `/api/affiliates/${AFFILIATE}/statement`);
    assert.equal(rows[0]?.clientName, "Client");
  });

  it("sends an exact lifecycle patch and validates server readback", async () => {
    let captured: RequestInit | undefined;
    const updated = await updateOperatorAffiliateLifecycle(AFFILIATE, { active: false, defaultCommissionBps: 750 }, async (_input, init) => {
      captured = init;
      return Response.json({ affiliate: {
        active: false,
        affiliateId: AFFILIATE,
        changed: true,
        defaultCommissionBps: 750,
      } });
    });
    assert.equal(captured?.method, "PATCH");
    assert.deepEqual(JSON.parse(String(captured?.body)), { active: false, defaultCommissionBps: 750 });
    assert.equal(updated.active, false);
  });

  it("maps authorization failures and display statuses without leaking a body", async () => {
    await assert.rejects(
      updateOperatorAffiliateLifecycle(AFFILIATE, { active: false }, async () => Response.json({ detail: "private" }, { status: 403 })),
      (error) => error instanceof OperatorAffiliateClientError
        && error.status === 403
        && !error.message.includes("private"),
    );
    assert.equal(affiliatePaymentStatusLabel("not_ready"), "Not ready");
    assert.equal(affiliatePaymentStatusLabel("submitted"), "Submitted");
  });

  it("shares, annotates, and removes a client through identity-bound routes", async () => {
    const calls: Array<{ body: unknown; method: string; url: string }> = [];
    const share = {
      affiliateId: AFFILIATE,
      clientId: CLIENT,
      expectedCommissionCents: null,
      paymentStatus: "not_ready",
    } as const;
    await shareOperatorAffiliateClient(AFFILIATE, CLIENT, async (input, init) => {
      calls.push({ body: JSON.parse(String(init?.body)), method: String(init?.method), url: String(input) });
      return Response.json(share, { status: 201 });
    });
    await updateOperatorAffiliateShare(AFFILIATE, CLIENT, { expectedCommissionCents: 1250, paymentStatus: "pending" }, async (input, init) => {
      calls.push({ body: JSON.parse(String(init?.body)), method: String(init?.method), url: String(input) });
      return Response.json({ ...share, changed: true, expectedCommissionCents: 1250, paymentStatus: "pending" });
    });
    await unshareOperatorAffiliateClient(AFFILIATE, CLIENT, async (input, init) => {
      calls.push({ body: JSON.parse(String(init?.body)), method: String(init?.method), url: String(input) });
      return new Response(null, { status: 204 });
    });

    assert.deepEqual(calls, [
      { body: { clientId: CLIENT }, method: "POST", url: `/api/affiliates/${AFFILIATE}/share` },
      {
        body: { expectedCommissionCents: 1250, paymentStatus: "pending" },
        method: "PATCH",
        url: `/api/affiliates/${AFFILIATE}/shares/${CLIENT}`,
      },
      { body: { clientId: CLIENT }, method: "DELETE", url: `/api/affiliates/${AFFILIATE}/share` },
    ]);
  });
});
