// operator-mock.ts — the credential-free arm of the operator billing port.
//
// This is the default arm, not the fallback one (D-12). With no environment at
// all the selector lands here, and the whole dunning ladder is provable against
// it: `replayDunningFixture` signs each fixture body at replay time and pushes
// it through the same HMAC verification a real event would face, so the replay
// exercises the signature path instead of stepping around it.
//
// Row shapes match the real driver's, with `mock_…` references produced by the
// same `mockRef` lane B's consumer mock uses, so nothing downstream has to know
// which arm produced a reference.

import { createMockAdapter, mockRef, signMockWebhook } from "./mock";
import { DUNNING_FIXTURE_STREAM } from "./fixtures/dunning-stream";
import type {
  CancelOperatorSubscriptionRequest,
  CancelOperatorSubscriptionResult,
  OperatorBillingAdapter,
  OperatorSubscriptionSnapshot,
  ParsedWebhook,
  ReadOperatorSubscriptionRequest,
  StartOperatorSubscriptionRequest,
  UpdateSeatQuantityRequest,
  UpdateSeatQuantityResult,
} from "./types";

const MOCK_PERIOD_MONTHS = 1;

function oneMonthOut(from: Date): string {
  const end = new Date(from);
  end.setUTCMonth(end.getUTCMonth() + MOCK_PERIOD_MONTHS);
  return end.toISOString();
}

function operationKey(orgId: string, operationId: string): string {
  return `${orgId}:${operationId}`;
}

export function createMockOperatorAdapter(): OperatorBillingAdapter {
  const byOrg = new Map<string, OperatorSubscriptionSnapshot>();
  const bySubscriptionRef = new Map<string, OperatorSubscriptionSnapshot>();
  // What the real arm keeps in provider metadata (R4C-09): the operation id a
  // crashed attempt can still name, pointing at whatever that attempt created.
  const byOperation = new Map<string, OperatorSubscriptionSnapshot>();

  return {
    async getSubscriptionState(request) {
      return bySubscriptionRef.get(request.subscriptionRef) ?? null;
    },
    async startOperatorSubscription(
      request: StartOperatorSubscriptionRequest,
    ): Promise<OperatorSubscriptionSnapshot> {
      const existing = byOrg.get(request.orgId);
      if (existing) {
        byOperation.set(operationKey(request.orgId, request.operationId), existing);
        return existing;
      }

      const snapshot: OperatorSubscriptionSnapshot = {
        // Exactly two items, a base and a seat, and never a third: a bureau
        // pull is a charge, not a subscription line (#31).
        baseItemRef: mockRef("si_base", request.orgId),
        cancelAtPeriodEnd: false,
        currentPeriodEnd: oneMonthOut(new Date()),
        customerRef: request.billingCustomerRef,
        providerStatus: "active",
        seatItemRef: mockRef("si_seat", request.orgId),
        seatQuantity: request.seatQuantity,
        status: "active",
        subscriptionRef: mockRef("sub", `operator:${request.orgId}:subscription:${request.operationId}`),
      };

      byOrg.set(request.orgId, snapshot);
      bySubscriptionRef.set(snapshot.subscriptionRef, snapshot);
      byOperation.set(operationKey(request.orgId, request.operationId), snapshot);
      return snapshot;
    },

    async findOperatorSubscription(request) {
      const found = byOperation.get(operationKey(request.orgId, request.operationId));
      if (!found) return null;
      // Same refusal as the real arm: a subscription that answers to this
      // operation but belongs to a different customer is not this attempt's.
      if (found.customerRef !== request.billingCustomerRef) {
        throw new Error("OPERATOR_SUBSCRIPTION_RECONCILIATION_AMBIGUOUS");
      }
      return found;
    },

    async updateSeatQuantity(
      request: UpdateSeatQuantityRequest,
    ): Promise<UpdateSeatQuantityResult> {
      const snapshot = bySubscriptionRef.get(request.subscriptionRef);
      if (snapshot) {
        const updated = { ...snapshot, seatQuantity: request.quantity };
        bySubscriptionRef.set(request.subscriptionRef, updated);
        for (const [key, value] of byOrg) {
          if (value.subscriptionRef === request.subscriptionRef) {
            byOrg.set(key, updated);
          }
        }
      }

      return {
        quantity: request.quantity,
        seatItemRef: request.seatItemRef,
        subscriptionRef: request.subscriptionRef,
      };
    },

    async cancelOperatorSubscription(
      request: CancelOperatorSubscriptionRequest,
    ): Promise<CancelOperatorSubscriptionResult> {
      const snapshot = bySubscriptionRef.get(request.subscriptionRef);
      if (snapshot) {
        bySubscriptionRef.set(request.subscriptionRef, {
          ...snapshot,
          cancelAtPeriodEnd: request.atPeriodEnd,
          providerStatus: request.atPeriodEnd ? snapshot.providerStatus : "canceled",
          status: request.atPeriodEnd ? snapshot.status : "canceled",
        });
      }

      return {
        cancelledAt: request.atPeriodEnd ? null : new Date().toISOString(),
        status: request.atPeriodEnd ? "active" : "canceled",
        subscriptionRef: request.subscriptionRef,
      };
    },

    async readOperatorSubscription(
      request: ReadOperatorSubscriptionRequest,
    ): Promise<OperatorSubscriptionSnapshot | null> {
      return bySubscriptionRef.get(request.subscriptionRef) ?? null;
    },
  };
}

export type ReplayOptions = {
  /** Injected in a test that wants to watch verification with its own value. */
  signingValue?: string;
  /** The moment the stream is signed and anchored against. Defaults to now. */
  signedAt?: Date;
  /**
   * Alters one byte after signing, so the suite can prove the replay is really
   * verifying rather than parsing whatever it is handed.
   */
  tamper?: boolean;
};

/**
 * Signs and verifies every fixture body, returning the parsed events in
 * delivery order. Each body's `createdOffsetSeconds` is added to the base
 * moment, so the stream's out-of-order event really is older than the one
 * before it while nothing in the committed file names a date.
 */
export async function replayDunningFixture(
  options: ReplayOptions = {},
): Promise<ParsedWebhook[]> {
  const adapter = createMockAdapter(
    options.signingValue ? { webhookSigningValue: options.signingValue } : {},
  );
  const baseSeconds = Math.floor((options.signedAt ?? new Date()).getTime() / 1000);
  const parsed: ParsedWebhook[] = [];

  for (const fixture of DUNNING_FIXTURE_STREAM) {
    const created = baseSeconds + fixture.createdOffsetSeconds;
    const rawBody = JSON.stringify({ ...fixture.body, created });
    const header = signMockWebhook(rawBody, baseSeconds, options.signingValue);
    const delivered = options.tamper ? `${rawBody.slice(0, -1)} }` : rawBody;

    parsed.push(await adapter.parseWebhook(delivered, header));
  }

  return parsed;
}
