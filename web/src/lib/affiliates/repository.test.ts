import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AFFILIATE_VIEW_COLUMNS,
  createAffiliateRepository,
  type AffiliateDatabaseClient,
} from "@/lib/affiliates/repository";
import { AffiliateError } from "@/lib/affiliates/types";

test("repository uses the exact view projection and Phase-24 RPC names", async () => {
  const calls: Array<[string, unknown]> = [];
  const client: AffiliateDatabaseClient = {
    from(table) {
      calls.push(["from", table]);
      return {
        select(columns: string) {
          calls.push(["select", columns]);
          return Promise.resolve({ data: [{
            expected_commission_cents: null,
            funded_amount_cents: 0,
            payment_status: "not_ready",
            stage: "onboarding",
            started_at: "2026-08-17",
          }], error: null });
        },
      } as never;
    },
    rpc(name, args) {
      calls.push([name, args]);
      if (name === "affiliate_referral_valid") return Promise.resolve({ data: true, error: null });
      if (name === "affiliate_unshare_client") return Promise.resolve({ data: false, error: null });
      if (name === "operator_affiliate_roster") return Promise.resolve({ data: [{
        active: true,
        affiliate_id: "21000000-0000-4000-8000-000000000101",
        default_commission_bps: 1000,
        email: "partner@example.test",
        expected_commission_cents: 500,
        name: "Partner",
        paid_commission_cents: 100,
        profile_id: "21000000-0000-4000-8000-000000000102",
        referral_slug: "partner",
        shared_clients: 2,
      }], error: null });
      if (name === "operator_affiliate_statement") return Promise.resolve({ data: [{
        affiliate_id: "21000000-0000-4000-8000-000000000101",
        client_id: "21000000-0000-4000-8000-000000000301",
        client_name: "Client",
        commission_override: false,
        expected_commission_cents: 500,
        funded_amount_cents: 5000,
        payment_status: "pending",
        stage: "funded",
        started_at: "2026-08-17",
      }], error: null });
      if (name === "operator_affiliate_update") return Promise.resolve({ data: [{
        active: false,
        affiliate_id: "21000000-0000-4000-8000-000000000101",
        changed: true,
        default_commission_bps: 1000,
      }], error: null });
      return Promise.resolve({ data: [{
        affiliate_id: "21000000-0000-4000-8000-000000000101",
        changed: name === "affiliate_update_share",
        client_id: "21000000-0000-4000-8000-000000000301",
        expected_commission_cents: null,
        inserted: name === "affiliate_share_client",
        payment_status: "not_ready",
      }], error: null });
    },
  };
  const repository = createAffiliateRepository(client);
  assert.equal(await repository.referralValid("code"), true);
  assert.equal((await repository.listPortalRows()).length, 1);
  assert.equal((await repository.listOperatorRoster())[0]?.sharedClients, 2);
  assert.equal((await repository.getOperatorStatement("a"))[0]?.clientName, "Client");
  assert.equal((await repository.updateAffiliate("a", { active: false })).active, false);
  assert.equal((await repository.shareClient("a", "c")).inserted, true);
  assert.equal(await repository.unshareClient("a", "c"), false);
  assert.equal((await repository.updateShare("a", "c", { paymentStatus: "paid" })).changed, true);
  assert.deepEqual(calls.slice(1, 3), [["from", "affiliate_client_view"], ["select", AFFILIATE_VIEW_COLUMNS]]);
  assert.deepEqual(calls.filter(([name]) => String(name).startsWith("affiliate_")).map(([name]) => name), [
    "affiliate_referral_valid", "affiliate_share_client", "affiliate_unshare_client", "affiliate_update_share",
  ]);
  assert.deepEqual(calls.filter(([name]) => String(name).startsWith("operator_affiliate_")).map(([name]) => name), [
    "operator_affiliate_roster", "operator_affiliate_statement", "operator_affiliate_update",
  ]);
});

test("repository maps inaccessible rows to one stable error", async () => {
  const client = {
    from() { throw new Error("unused"); },
    rpc() { return Promise.resolve({ data: null, error: { code: "42501" } }); },
  } as unknown as AffiliateDatabaseClient;
  await assert.rejects(
    () => createAffiliateRepository(client).shareClient("a", "c"),
    (error) => error instanceof AffiliateError && error.code === "not_found",
  );
});
