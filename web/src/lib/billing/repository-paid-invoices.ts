import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export type PaidInvoiceEvidenceInput = {
  amountPaidCents: number;
  currency: string;
  eventId: string;
  invoiceRef: string;
  paidAt: string;
  periodEnd: string;
  periodStart: string;
  subscriptionRef: string;
};

export type PaidInvoiceEvidenceVerdict = {
  reason: "duplicate" | "ignored" | "recorded";
  recorded: boolean;
};

export type PaidInvoiceRpcClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};

type Row = Record<string, unknown>;

function row(value: unknown): Row | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
}

export function createPaidInvoiceEvidenceRepository(client: PaidInvoiceRpcClient) {
  return {
    async record(input: PaidInvoiceEvidenceInput): Promise<PaidInvoiceEvidenceVerdict> {
      const { data, error } = await client.rpc("billing_record_paid_invoice_evidence", {
        p_amount_paid_cents: input.amountPaidCents,
        p_currency: input.currency,
        p_event_id: input.eventId,
        p_paid_at: input.paidAt,
        p_period_end: input.periodEnd,
        p_period_start: input.periodStart,
        p_provider_invoice_ref: input.invoiceRef,
        p_subscription_ref: input.subscriptionRef,
      });
      if (error) throw new Error("PAID_INVOICE_EVIDENCE_WRITE_FAILED");
      const value = row(data);
      const reason = value?.reason_code;
      const recorded = value?.recorded;
      if (
        typeof recorded !== "boolean" ||
        (reason !== "duplicate" && reason !== "ignored" && reason !== "recorded") ||
        recorded !== (reason === "recorded")
      ) throw new Error("PAID_INVOICE_EVIDENCE_RESULT_INVALID");
      return { reason, recorded };
    },
  };
}

export function productionPaidInvoiceEvidenceRepository() {
  return createPaidInvoiceEvidenceRepository(createAdminClient() as unknown as PaidInvoiceRpcClient);
}
