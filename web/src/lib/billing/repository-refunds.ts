import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export type RefundObservationInput = {
  amountRefundedCents: number;
  chargeRef: string;
  currency: "usd";
  customerRef: string | null;
  eventId: string;
  occurredAt: string;
  subscriptionRef: string | null;
};

export type RefundObservationVerdict = {
  attributed: boolean;
  orgId: string | null;
  reason: "duplicate" | "recorded";
  recorded: boolean;
};

export type RefundRpcClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};

type Row = Record<string, unknown>;

function row(value: unknown): Row | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
}

export function createRefundRepository(client: RefundRpcClient) {
  return {
    async record(input: RefundObservationInput): Promise<RefundObservationVerdict> {
      const { data, error } = await client.rpc("billing_record_refund_observation", {
        p_charge_ref: input.chargeRef,
        p_cumulative_amount_refunded_cents: input.amountRefundedCents,
        p_currency: input.currency,
        p_customer_ref: input.customerRef,
        p_event_id: input.eventId,
        p_occurred_at: input.occurredAt,
        p_subscription_ref: input.subscriptionRef,
      });
      if (error) throw new Error("REFUND_OBSERVATION_WRITE_FAILED");
      const value = row(data);
      const reason = value?.reason_code;
      const recorded = value?.recorded;
      const attributed = value?.attributed;
      const orgId = value?.org_id;
      if (
        !value || typeof recorded !== "boolean" || typeof attributed !== "boolean" ||
        (reason !== "recorded" && reason !== "duplicate") ||
        recorded !== (reason === "recorded") ||
        !(orgId === null || typeof orgId === "string")
      ) throw new Error("REFUND_OBSERVATION_RESULT_INVALID");
      return { attributed, orgId, reason, recorded };
    },
  };
}

export function productionRefundRepository() {
  return createRefundRepository(createAdminClient() as unknown as RefundRpcClient);
}
