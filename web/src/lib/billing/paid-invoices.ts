import "server-only";

import type { ParsedWebhook } from "./types.ts";
import {
  productionPaidInvoiceEvidenceRepository,
  type PaidInvoiceEvidenceInput,
  type PaidInvoiceEvidenceVerdict,
} from "./repository-paid-invoices.ts";

type PaidInvoiceEvidenceRepository = {
  record(input: PaidInvoiceEvidenceInput): Promise<PaidInvoiceEvidenceVerdict>;
};

export class PaidInvoiceEvidenceError extends Error {
  readonly code = "PAID_INVOICE_EVIDENCE_FAILED";
  constructor() {
    super("The paid invoice evidence could not be recorded.");
  }
}

function reference(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length > 255 || /[\r\n]/.test(trimmed)) throw new PaidInvoiceEvidenceError();
  return trimmed;
}

function timestamp(value: string | undefined): string {
  if (!value || !Number.isFinite(Date.parse(value))) throw new PaidInvoiceEvidenceError();
  return value;
}

/**
 * Stripe invoices are the only source for the real-provider revenue arm. A
 * mock invoice deliberately bypasses this path so fixture pricing remains the
 * mock provider's existing source of truth.
 */
export async function recordPaidInvoiceEvidence(
  event: ParsedWebhook,
  repository?: PaidInvoiceEvidenceRepository,
): Promise<boolean> {
  if (event.provider !== "stripe" || event.eventType !== "invoice.paid") return false;
  const periodStart = timestamp(event.invoicePeriodStart);
  const periodEnd = timestamp(event.invoicePeriodEnd);
  const paidAt = timestamp(event.invoicePaidAt);
  if (
    Date.parse(periodEnd) <= Date.parse(periodStart) ||
    !Number.isSafeInteger(event.invoiceAmountPaidCents) ||
    (event.invoiceAmountPaidCents as number) < 0 ||
    !/^[a-z]{3}$/.test(event.currency ?? "")
  ) throw new PaidInvoiceEvidenceError();
  try {
    await (repository ?? productionPaidInvoiceEvidenceRepository()).record({
      amountPaidCents: event.invoiceAmountPaidCents as number,
      currency: event.currency as string,
      eventId: reference(event.eventId),
      invoiceRef: reference(event.invoiceRef),
      paidAt,
      periodEnd,
      periodStart,
      subscriptionRef: reference(event.subscriptionRef ?? undefined),
    });
  } catch {
    throw new PaidInvoiceEvidenceError();
  }
  return true;
}
