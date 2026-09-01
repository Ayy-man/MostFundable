import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mapConsumerPaidRefreshHistory, type PaidRefreshReadSource } from "./paid-refresh-read-map.ts";
import {
  paidRefreshCanResume,
  paidRefreshBlocksNewPurchase,
  parseConsumerPaidRefreshHistory,
} from "./paid-refresh-read.ts";

const CLIENT_ID = "client-1";

function source(overrides: Partial<PaidRefreshReadSource> = {}): PaidRefreshReadSource {
  return {
    clientId: CLIENT_ID,
    events: [{
      amount_cents: 1900,
      currency: "usd",
      occurred_at: "2026-09-01T10:00:02.000Z",
      outcome: "succeeded",
      request_id: "request-1",
    }],
    jobs: [{
      analysis_run_id: "run-1",
      client_id: CLIENT_ID,
      source_id: "request-1",
      source_kind: "force_pull",
      status: "succeeded",
      trigger: "force_pull",
      updated_at: "2026-09-01T10:00:05.000Z",
    }],
    remediations: [],
    requests: [{
      amount_cents: 1900,
      analysis_run_id: "run-1",
      created_at: "2026-09-01T10:00:00.000Z",
      currency: "usd",
      id: "request-1",
      payment_attempt_state: "recorded",
      state: "queued",
    }],
    runs: [{
      client_id: CLIENT_ID,
      id: "run-1",
      ran_at: "2026-09-01T10:00:04.000Z",
      trigger: "force_pull",
    }],
    ...overrides,
  };
}

describe("consumer paid refresh readback", () => {
  it("calls a refresh completed only with succeeded payment, job, and persisted run evidence", () => {
    assert.deepEqual(mapConsumerPaidRefreshHistory(source()), [{
      amountCents: 1900,
      completedAt: "2026-09-01T10:00:04.000Z",
      currency: "usd",
      paidAt: "2026-09-01T10:00:02.000Z",
      requestId: "request-1",
      requestedAt: "2026-09-01T10:00:00.000Z",
      status: "completed",
    }]);
  });

  it("keeps a succeeded job running when the persisted analysis row is absent", () => {
    const [record] = mapConsumerPaidRefreshHistory(source({ runs: [] }));
    assert.equal(record.status, "running");
    assert.equal(record.completedAt, null);
    assert.ok(record.paidAt, "the charge evidence remains independently visible");
  });

  it("maps every initiated request to the blocked payment-pending state", () => {
    for (const paymentAttemptState of ["none", "dispatching", "provider_returned"] as const) {
      const [record] = mapConsumerPaidRefreshHistory(source({
        events: [],
        jobs: [],
        requests: [{
          amount_cents: 1900,
          analysis_run_id: null,
          created_at: "2026-09-01T10:00:00.000Z",
          currency: "usd",
          id: "request-1",
          payment_attempt_state: paymentAttemptState,
          state: "initiated",
        }],
        runs: [],
      }));
      assert.equal(record.status, "payment_pending");
      assert.equal(paidRefreshBlocksNewPurchase(record.status), true);
      assert.equal(record.paidAt, null);
    }
  });

  it("surfaces needs-review and open remediation states without manufacturing completion", () => {
    const review = source({
      events: [], jobs: [], runs: [],
      requests: [{
        amount_cents: 1900, analysis_run_id: null,
        created_at: "2026-09-01T10:00:00.000Z", currency: "usd", id: "request-1",
        payment_attempt_state: "needs_review", state: "initiated",
      }],
    });
    assert.equal(mapConsumerPaidRefreshHistory(review)[0].status, "payment_review");

    const unfulfillable = source({ jobs: [], runs: [], requests: [{
      amount_cents: 1900, analysis_run_id: null,
      created_at: "2026-09-01T10:00:00.000Z", currency: "usd", id: "request-1",
      payment_attempt_state: "recorded", state: "unfulfillable",
    }] });
    const record = mapConsumerPaidRefreshHistory(unfulfillable)[0];
    assert.equal(record.status, "unfulfillable");
    assert.equal(record.completedAt, null);
  });

  it("releases a remediated unfulfillable request without hiding its payment evidence", () => {
    const remediated = source({
      jobs: [],
      remediations: [{ request_id: "request-1", state: "resolved" }],
      requests: [{
        amount_cents: 1900,
        analysis_run_id: null,
        created_at: "2026-09-01T10:00:00.000Z",
        currency: "usd",
        id: "request-1",
        payment_attempt_state: "recorded",
        state: "unfulfillable",
      }],
      runs: [],
    });
    const record = mapConsumerPaidRefreshHistory(remediated)[0];
    assert.equal(record.status, "remediated");
    assert.ok(record.paidAt);
    assert.equal(paidRefreshBlocksNewPurchase(record.status), false);
  });

  it("rejects a payment event whose amount disagrees with the request", () => {
    assert.throws(
      () => mapConsumerPaidRefreshHistory(source({
        events: [{
          amount_cents: 2900, currency: "usd", occurred_at: "2026-09-01T10:00:02.000Z",
          outcome: "succeeded", request_id: "request-1",
        }],
      })),
      /PAID_REFRESH_HISTORY_INVALID/,
    );
  });

  it("browser parsing rejects a completed claim without both evidence timestamps", () => {
    assert.equal(parseConsumerPaidRefreshHistory({ refreshes: [{
      amountCents: 1900,
      completedAt: null,
      currency: "usd",
      paidAt: "2026-09-01T10:00:02.000Z",
      requestId: "request-1",
      requestedAt: "2026-09-01T10:00:00.000Z",
      status: "completed",
    }] }), null);
  });

  it("blocks a second purchase for every unresolved money or work state", () => {
    for (const status of [
      "payment_pending", "payment_action_required", "payment_review",
      "paid", "queued", "running", "unfulfillable",
    ] as const) {
      assert.equal(paidRefreshBlocksNewPurchase(status), true, status);
    }
    for (const status of ["payment_failed", "completed", "failed", "cancelled", "remediated"] as const) {
      assert.equal(paidRefreshBlocksNewPurchase(status), false, status);
    }
  });

  it("allows exact-key recovery only for states the service can advance", () => {
    for (const status of ["payment_pending", "payment_action_required", "paid"] as const) {
      assert.equal(paidRefreshCanResume(status), true, status);
    }
    for (const status of [
      "payment_review", "queued", "running", "unfulfillable", "remediated",
      "payment_failed", "completed", "failed", "cancelled",
    ] as const) {
      assert.equal(paidRefreshCanResume(status), false, status);
    }
  });
});
