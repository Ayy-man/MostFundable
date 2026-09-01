import "server-only";

import { productionRevenueRepository } from "./repository.ts";
import type {
  LedgerKind,
  SettlementRepository,
  SettlementRow,
} from "./types.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class SettlementError extends Error {
  readonly code: "SETTLEMENT_INCOMPLETE" | "SETTLEMENT_INPUT_INVALID" | "SETTLEMENT_NOT_FOUND" | "SETTLEMENT_STALE";
  readonly status: 400 | 404 | 409;

  constructor(status: 400 | 404 | 409, code: SettlementError["code"], message: string) {
    super(message);
    this.name = "SettlementError";
    this.code = code;
    this.status = status;
  }
}

function validateIdentity(kind: LedgerKind, ledgerId: string): void {
  if ((kind !== "operator" && kind !== "referral") || !UUID_PATTERN.test(ledgerId)) {
    throw new SettlementError(400, "SETTLEMENT_INPUT_INVALID", "The settlement input is invalid.");
  }
}

export function createSettlementService(repository: SettlementRepository) {
  return {
    async readSettlementStatus(kind: LedgerKind, ledgerId: string): Promise<SettlementRow | null> {
      validateIdentity(kind, ledgerId);
      return repository.readSettlementStatus(kind, ledgerId);
    },

    async markSettlement(input: {
      actorId: string;
      expectedStatus: "accrued" | "exported";
      kind: LedgerKind;
      ledgerId: string;
      status: "exported" | "paid";
    }): Promise<SettlementRow> {
      validateIdentity(input.kind, input.ledgerId);
      if (!UUID_PATTERN.test(input.actorId) || !(
        (input.expectedStatus === "accrued" && input.status === "exported") ||
        (input.expectedStatus === "exported" && input.status === "paid")
      )) {
        throw new SettlementError(400, "SETTLEMENT_INPUT_INVALID", "The settlement input is invalid.");
      }
      const verdict = await repository.markSettlement({
        actorId: input.actorId,
        expectedStatus: input.expectedStatus,
        ledger: input.kind,
        ledgerId: input.ledgerId,
        status: input.status,
      });
      if (verdict.applied) return verdict.row;
      if (verdict.reason === "not_found") {
        throw new SettlementError(404, "SETTLEMENT_NOT_FOUND", "The settlement row was not found.");
      }
      if (verdict.reason === "incomplete") {
        throw new SettlementError(409, "SETTLEMENT_INCOMPLETE", "The settlement row is incomplete.");
      }
      throw new SettlementError(409, "SETTLEMENT_STALE", "The settlement state changed before this request completed.");
    },
  };
}

export async function readSettlementStatus(
  kind: LedgerKind,
  ledgerId: string,
): Promise<SettlementRow | null> {
  return createSettlementService(productionRevenueRepository()).readSettlementStatus(kind, ledgerId);
}

export async function markSettlement(input: {
  actorId: string;
  expectedStatus: "accrued" | "exported";
  kind: LedgerKind;
  ledgerId: string;
  status: "exported" | "paid";
}): Promise<SettlementRow> {
  return createSettlementService(productionRevenueRepository()).markSettlement(input);
}
