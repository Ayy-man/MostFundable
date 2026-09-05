import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { recordPaidInvoiceEvidence, PaidInvoiceEvidenceError } from "./paid-invoices.ts";
import { createPaidInvoiceEvidenceRepository } from "./repository-paid-invoices.ts";
import type { ParsedWebhook } from "./types.ts";

const EVENT: ParsedWebhook = {
  createdAt: "2026-08-16T00:00:00.000Z",
  currency: "usd",
  customerRef: "cus_paid",
  eventId: "evt_paid",
  eventType: "invoice.paid",
  invoiceAmountPaidCents: 4_900,
  invoicePaidAt: "2026-08-16T00:00:00.000Z",
  invoicePeriodEnd: "2026-09-16T00:00:00.000Z",
  invoicePeriodStart: "2026-08-16T00:00:00.000Z",
  invoiceRef: "in_paid",
  provider: "stripe",
  setupIntentRef: null,
  subscriptionRef: "sub_paid",
};

describe("paid invoice evidence", () => {
  it("persists the verified invoice fields and accepts an idempotent replay", async () => {
    for (const reason of ["recorded", "duplicate"] as const) {
      const calls: unknown[] = [];
      assert.equal(await recordPaidInvoiceEvidence(EVENT, {
        async record(input) {
          calls.push(input);
          return { reason, recorded: reason === "recorded" };
        },
      }), true);
      assert.deepEqual(calls, [{
        amountPaidCents: 4_900,
        currency: "usd",
        eventId: "evt_paid",
        invoiceRef: "in_paid",
        paidAt: "2026-08-16T00:00:00.000Z",
        periodEnd: "2026-09-16T00:00:00.000Z",
        periodStart: "2026-08-16T00:00:00.000Z",
        subscriptionRef: "sub_paid",
      }]);
    }
  });

  it("leaves mock invoice events on their existing pricing path", async () => {
    let calls = 0;
    assert.equal(await recordPaidInvoiceEvidence({ ...EVENT, provider: "mock" }, {
      async record() { calls += 1; throw new Error(); },
    }), false);
    assert.equal(calls, 0);
  });

  it("rejects incomplete or malformed Stripe invoice evidence without exposing it", async () => {
    for (const event of [
      { ...EVENT, invoiceRef: undefined },
      { ...EVENT, invoiceAmountPaidCents: -1 },
      { ...EVENT, invoicePeriodEnd: EVENT.invoicePeriodStart },
      { ...EVENT, currency: "USD" },
    ]) {
      await assert.rejects(recordPaidInvoiceEvidence(event), PaidInvoiceEvidenceError);
    }
  });

  it("maps database failures and malformed database verdicts to closed errors", async () => {
    for (const response of [
      { data: null, error: { code: "42501" } },
      { data: { reason_code: "recorded", recorded: false }, error: null },
    ]) {
      await assert.rejects(
        createPaidInvoiceEvidenceRepository({ async rpc() { return response; } }).record({
          amountPaidCents: 4_900, currency: "usd", eventId: "evt_paid", invoiceRef: "in_paid",
          paidAt: EVENT.invoicePaidAt!, periodEnd: EVENT.invoicePeriodEnd!, periodStart: EVENT.invoicePeriodStart!, subscriptionRef: "sub_paid",
        }),
      );
    }
  });
});
