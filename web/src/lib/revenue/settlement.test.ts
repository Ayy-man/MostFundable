import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createRevenueRepository, RevenueRepositoryError } from "./repository.ts";
import { createSettlementService, SettlementError } from "./settlement.ts";
import type { RevenueRpcClient, SettlementRepository } from "./types.ts";

const LEDGER_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";

function repository(overrides: Partial<SettlementRepository> = {}): SettlementRepository {
  return {
    async readSettlementStatus(kind, ledgerId) { return { ledger: kind, ledgerId, status: "accrued" }; },
    async markSettlement(input) {
      return { applied: true, row: { ledger: input.ledger, ledgerId: input.ledgerId, status: input.status } };
    },
    ...overrides,
  };
}

describe("settlement service", () => {
  it("reads every stored state on both ledgers, including system-only reversed", async () => {
    for (const ledger of ["operator", "referral"] as const) {
      for (const status of ["accrued", "exported", "paid", "reversed"] as const) {
        const service = createSettlementService(repository({
          async readSettlementStatus() { return { ledger, ledgerId: LEDGER_ID, status }; },
        }));
        assert.deepEqual(await service.readSettlementStatus(ledger, LEDGER_ID), { ledger, ledgerId: LEDGER_ID, status });
      }
    }
  });

  it("permits only accrued to exported and exported to paid", async () => {
    const service = createSettlementService(repository());
    assert.equal((await service.markSettlement({ actorId: ACTOR_ID, expectedStatus: "accrued", kind: "operator", ledgerId: LEDGER_ID, status: "exported" })).status, "exported");
    assert.equal((await service.markSettlement({ actorId: ACTOR_ID, expectedStatus: "exported", kind: "referral", ledgerId: LEDGER_ID, status: "paid" })).status, "paid");
    await assert.rejects(
      service.markSettlement({ actorId: ACTOR_ID, expectedStatus: "accrued", kind: "operator", ledgerId: LEDGER_ID, status: "paid" }),
      (error: unknown) => error instanceof SettlementError && error.status === 400,
    );
  });

  it("maps not-found and stale verdicts to stable owned errors", async () => {
    const notFound = createSettlementService(repository({ async markSettlement() { return { applied: false, reason: "not_found", row: null }; } }));
    const stale = createSettlementService(repository({ async markSettlement(input) { return { applied: false, reason: "stale", row: { ledger: input.ledger, ledgerId: input.ledgerId, status: "paid" } }; } }));
    const input = { actorId: ACTOR_ID, expectedStatus: "accrued" as const, kind: "operator" as const, ledgerId: LEDGER_ID, status: "exported" as const };
    await assert.rejects(notFound.markSettlement(input), (error: unknown) => error instanceof SettlementError && error.code === "SETTLEMENT_NOT_FOUND" && error.status === 404);
    await assert.rejects(stale.markSettlement(input), (error: unknown) => error instanceof SettlementError && error.code === "SETTLEMENT_STALE" && error.status === 409);
  });

  it("maps incomplete ledgers to a typed conflict", async () => {
    const service = createSettlementService(repository({
      async markSettlement(input) {
        return { applied: false, reason: "incomplete", row: { ledger: input.ledger, ledgerId: input.ledgerId, status: "accrued" } };
      },
    }));
    await assert.rejects(
      service.markSettlement({ actorId: ACTOR_ID, expectedStatus: "accrued", kind: "operator", ledgerId: LEDGER_ID, status: "exported" }),
      (error: unknown) => error instanceof SettlementError && error.code === "SETTLEMENT_INCOMPLETE" && error.status === 409,
    );
  });

  it("rejects corrupt RPC rows and never exposes database text", async () => {
    const responses = [
      { data: { ledger: "operator", ledger_id: "wrong", status: "accrued" }, error: null },
      { data: null, error: { code: "credential-shaped-provider-detail" } },
    ];
    for (const response of responses) {
      const client = { async rpc() { return response; } } satisfies RevenueRpcClient;
      await assert.rejects(
        createRevenueRepository(client).readSettlementStatus("operator", LEDGER_ID),
        (error: unknown) => error instanceof RevenueRepositoryError && !error.message.includes("provider-detail"),
      );
    }
  });
});
