import "server-only";

import type { ParsedWebhook } from "./types.ts";
import { productionRefundRepository } from "./repository-refunds.ts";
import type { RefundObservationInput, RefundObservationVerdict } from "./repository-refunds.ts";

type RefundRepository = { record(input: RefundObservationInput): Promise<RefundObservationVerdict> };

export class RefundObservationError extends Error {
  readonly code = "REFUND_OBSERVATION_FAILED";
  constructor() {
    super("The refund observation could not be recorded.");
    this.name = "RefundObservationError";
  }
}

function reference(value: string | null | undefined, required: boolean): string | null {
  if (value === null || value === undefined) {
    if (required) throw new RefundObservationError();
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 255 || /[\r\n]/.test(trimmed)) throw new RefundObservationError();
  return trimmed;
}

export async function recordRefundObservation(
  event: ParsedWebhook,
  repository?: RefundRepository,
): Promise<boolean> {
  if (event.eventType !== "charge.refunded") return false;
  const chargeRef = reference(event.chargeRef, true) as string;
  const customerRef = reference(event.customerRef, false);
  const subscriptionRef = reference(event.subscriptionRef, false);
  if (
    !Number.isSafeInteger(event.amountRefundedCents) ||
    (event.amountRefundedCents as number) < 0 ||
    event.currency !== "usd" ||
    !Number.isFinite(Date.parse(event.createdAt))
  ) throw new RefundObservationError();
  try {
    await (repository ?? productionRefundRepository()).record({
      amountRefundedCents: event.amountRefundedCents as number,
      chargeRef,
      currency: "usd",
      customerRef,
      eventId: reference(event.eventId, true) as string,
      occurredAt: event.createdAt,
      subscriptionRef,
    });
  } catch {
    throw new RefundObservationError();
  }
  return true;
}
