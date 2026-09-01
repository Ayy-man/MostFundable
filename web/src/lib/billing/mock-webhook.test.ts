import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createMockAdapter, signMockWebhook } from "./mock.ts";
import { mockWebhookReady } from "./index.ts";

describe("mock webhook verification", () => {
  it("requires an explicit non-default value on the production dependency path", () => {
    assert.equal(mockWebhookReady({}), false);
    assert.equal(
      mockWebhookReady({ STRIPE_WEBHOOK_SECRET: "mock-webhook-signing-value" }),
      false,
    );
    assert.equal(
      mockWebhookReady({ STRIPE_WEBHOOK_SECRET: "injected-runtime-value" }),
      true,
    );
  });

  it("accepts a current signature from an injected test adapter", async () => {
    const nowSeconds = 2_000_000_000;
    const body = JSON.stringify({ id: "evt_current", type: "invoice.paid" });
    const signingValue = "injected-test-adapter-value";
    const adapter = createMockAdapter({
      nowMs: () => nowSeconds * 1000,
      webhookSigningValue: signingValue,
    });
    const parsed = await adapter.parseWebhook(
      body,
      signMockWebhook(body, nowSeconds, signingValue),
    );
    assert.equal(parsed.eventId, "evt_current");
  });

  it("rejects signatures older or newer than the bounded window", async () => {
    const nowSeconds = 2_000_000_000;
    const body = JSON.stringify({ id: "evt_stale", type: "invoice.paid" });
    const signingValue = "injected-test-adapter-value";
    const adapter = createMockAdapter({
      nowMs: () => nowSeconds * 1000,
      webhookSigningValue: signingValue,
    });
    for (const timestamp of [nowSeconds - 301, nowSeconds + 301]) {
      await assert.rejects(
        adapter.parseWebhook(body, signMockWebhook(body, timestamp, signingValue)),
        /timestamp is outside the accepted window/,
      );
    }
  });
});
