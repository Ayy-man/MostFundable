import assert from "node:assert/strict";
import { test } from "node:test";

import type { AffiliateRepository } from "@/lib/affiliates/repository";
import {
  affiliateReferralValid,
  getAffiliatePortal,
  getOperatorAffiliateRoster,
  getOperatorAffiliateStatement,
  shareClient,
  unshareClient,
  updateOperatorAffiliate,
  updateShare,
} from "@/lib/affiliates/service";

function repository(): AffiliateRepository {
  return {
    async referralValid(code) { return code === "known"; },
    async listPortalRows() { return [{
      expected_commission_cents: 50,
      funded_amount_cents: 100,
      payment_status: "pending",
      stage: "onboarding",
      started_at: "2026-08-10",
    }]; },
    async listOperatorRoster() { return [{
      active: true,
      affiliateId: "a",
      defaultCommissionBps: 1000,
      email: "partner@example.test",
      expectedCommissionCents: 50,
      name: "Partner",
      paidCommissionCents: 0,
      profileId: "p",
      referralSlug: "partner",
      sharedClients: 1,
    }]; },
    async getOperatorStatement(affiliateId) { return [{
      affiliateId,
      clientId: "c",
      clientName: "Client",
      commissionOverride: false,
      expectedCommissionCents: 50,
      fundedAmountCents: 500,
      paymentStatus: "pending",
      stage: "funded",
      startedAt: "2026-08-10",
    }]; },
    async updateAffiliate(affiliateId, patch) {
      return { affiliateId, active: patch.active ?? true, changed: true, defaultCommissionBps: patch.defaultCommissionBps ?? 1000 };
    },
    async shareClient(affiliateId, clientId) {
      return { affiliateId, clientId, expectedCommissionCents: null, inserted: true, paymentStatus: "not_ready" };
    },
    async unshareClient() { return false; },
    async updateShare(affiliateId, clientId, patch) {
      return { affiliateId, changed: true, clientId, expectedCommissionCents: patch.expectedCommissionCents ?? null, paymentStatus: patch.paymentStatus ?? "not_ready" };
    },
  };
}

test("route-facing affiliate services preserve idempotency and DTO closure", async () => {
  const repo = repository();
  assert.equal(await affiliateReferralValid("known", repo), true);
  assert.equal((await shareClient("a", "c", repo)).inserted, true);
  assert.equal(await unshareClient("a", "c", repo), false);
  assert.equal((await updateShare("a", "c", { paymentStatus: "paid" }, repo)).paymentStatus, "paid");
  assert.equal((await getOperatorAffiliateRoster(repo))[0]?.affiliateId, "a");
  assert.equal((await getOperatorAffiliateStatement("a", repo))[0]?.clientId, "c");
  assert.equal((await updateOperatorAffiliate("a", { active: false }, repo)).active, false);
  const portal = await getAffiliatePortal(new Date("2026-08-17T00:00:00Z"), repo);
  assert.deepEqual(Object.keys(portal), ["kpis", "rows"]);
  assert.equal(portal.rows[0]?.needsAttention, true);
});
