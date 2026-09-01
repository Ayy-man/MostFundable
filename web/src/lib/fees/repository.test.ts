import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  listOrgReceivables,
  readOrgDefault,
  type FeesRpcClient,
} from "./repository.ts";

const ORG_ID = "00000000-0000-0000-0000-0000000012a1";
const CLIENT_ID = "00000000-0000-0000-0000-0000000012c1";

function stubClient(options: {
  rpcData?: unknown;
  selectData?: unknown;
  selectError?: unknown;
  selectedOrgIds?: string[];
} = {}): FeesRpcClient {
  return {
    from(table) {
      assert.equal(table, "org_fee_defaults");
      const query = {
        eq(column: string, value: unknown) {
          assert.equal(column, "org_id");
          options.selectedOrgIds?.push(String(value));
          return query;
        },
        async maybeSingle() {
          return {
            data: options.selectData ?? null,
            error: options.selectError ?? null,
          };
        },
      };
      return {
        select(columns) {
          assert.match(columns, /custom_total_cents/);
          return query;
        },
      };
    },
    async rpc(name) {
      assert.equal(name, "fees_list_org_receivables");
      return { data: options.rpcData ?? [], error: null };
    },
  };
}

describe("fee repository reads", () => {
  it("maps funded basis and an unconfigured active client without inventing an agreement", async () => {
    const result = await listOrgReceivables(
      stubClient({
        rpcData: [
          {
            balance_cents: 450_000,
            client_id: CLIENT_ID,
            display_name: "Riley Funded Demo",
            last_payment_on: "2026-08-30",
            model: "percentage",
            outcome_basis_cents: 4_500_000,
            paid_cents: 450_000,
            status: "active",
            total_cents: 450_000,
          },
          {
            balance_cents: 0,
            client_id: "00000000-0000-0000-0000-0000000012c2",
            display_name: "New Client",
            last_payment_on: null,
            model: null,
            outcome_basis_cents: 0,
            paid_cents: 0,
            status: null,
            total_cents: 0,
          },
        ],
      }),
      ORG_ID,
      50,
      0,
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value[0]?.outcomeBasisCents, 4_500_000);
    assert.deepEqual(result.value[1], {
      balanceCents: 0,
      clientId: "00000000-0000-0000-0000-0000000012c2",
      displayName: "New Client",
      lastPaymentOn: null,
      model: null,
      outcomeBasisCents: 0,
      paidCents: 0,
      status: null,
      totalCents: 0,
    });
  });

  it("reads and maps the stored org default through the tenant-scoped table", async () => {
    const selectedOrgIds: string[] = [];
    const result = await readOrgDefault(
      stubClient({
        selectedOrgIds,
        selectData: {
          custom_total_cents: null,
          model: "percentage",
          org_id: ORG_ID,
          pct: "12.50",
          success_cents: null,
          trigger_cents: null,
          upfront_cents: "25000",
          updated_at: "2026-09-01T00:00:00.000Z",
          updated_by: "00000000-0000-0000-0000-0000000012b1",
        },
      }),
      ORG_ID,
    );

    assert.deepEqual(selectedOrgIds, [ORG_ID]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value?.pct, 12.5);
    assert.equal(result.value?.upfrontCents, 25_000);
  });

  it("returns an honest null when no workspace default exists", async () => {
    assert.deepEqual(
      await readOrgDefault(stubClient(), ORG_ID),
      { ok: true, value: null },
    );
  });
});
