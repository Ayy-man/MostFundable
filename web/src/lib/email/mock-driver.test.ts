import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createMockEmailDriver } from "./mock-driver.ts";
import { createEmailReceiptRepository, type EmailReceiptRepository } from "./repository.ts";
import { CONSUMER_EMAIL_TEMPLATES, EMAIL_TEMPLATE_REGISTRY } from "./templates.ts";
import type { EmailSendInput } from "./types.ts";

const DELIVERY_ID = "82000000-0000-4000-8000-000000000201";
const RECEIPT_ID = "82000000-0000-4000-8000-000000000501";

describe("mock email driver", () => {
  it("accepts every catalog-published template", async () => {
    const claimed: string[] = [];
    let template = "operator_card_failure" as const;
    const repository: EmailReceiptRepository = {
      async claim(input) {
        claimed.push(input.template);
        template = input.template as typeof template;
        return {
          receiptId: RECEIPT_ID,
          deliveryId: input.deliveryId,
          template: input.template,
          status: "pending",
          providerRef: null,
          attemptCount: 1,
        };
      },
      async accept(receiptId, providerRef) {
        return {
          receiptId,
          deliveryId: DELIVERY_ID,
          template,
          status: "accepted",
          providerRef,
          attemptCount: 1,
        };
      },
      async fail() { throw new Error("unexpected"); },
    };
    const requests: EmailSendInput[] = [
      {
        to: "owner@email.test",
        template: "operator_card_failure",
        vars: { DELIVERY_REFERENCE: DELIVERY_ID },
        orgId: "82000000-0000-4000-8000-000000000001",
      },
      ...CONSUMER_EMAIL_TEMPLATES.map((consumerTemplate) => ({
        to: "consumer@email.test",
        template: consumerTemplate,
        vars: {
          APP_PATH: "/consumer",
          DELIVERY_REFERENCE: DELIVERY_ID,
          FIRST_NAME: "Dana",
        },
        orgId: "82000000-0000-4000-8000-000000000001",
      })),
    ];

    for (const request of requests) await createMockEmailDriver({ repository }).send(request);

    assert.deepEqual(claimed.sort(), Object.keys(EMAIL_TEMPLATE_REGISTRY).sort());
  });

  it("claims then accepts one deterministic receipt without a network", async () => {
    const calls: unknown[] = [];
    const repository: EmailReceiptRepository = {
      async claim(input) {
        calls.push(["claim", input]);
        return {
          receiptId: RECEIPT_ID,
          deliveryId: DELIVERY_ID,
          template: "operator_card_failure",
          status: "pending",
          providerRef: null,
          attemptCount: 1,
        };
      },
      async accept(receiptId, providerRef) {
        calls.push(["accept", receiptId, providerRef]);
        return {
          receiptId,
          deliveryId: DELIVERY_ID,
          template: "operator_card_failure",
          status: "accepted",
          providerRef,
          attemptCount: 1,
        };
      },
      async fail() { throw new Error("unexpected"); },
    };
    const receipt = await createMockEmailDriver({ repository }).send({
      to: " Owner@Email.Test ",
      template: "operator_card_failure",
      vars: { DELIVERY_REFERENCE: DELIVERY_ID },
      orgId: "82000000-0000-4000-8000-000000000001",
    });
    assert.deepEqual(calls, [
      ["claim", { deliveryId: DELIVERY_ID, template: "operator_card_failure", recipient: "owner@email.test" }],
      ["accept", RECEIPT_ID, `mock_email_${RECEIPT_ID}`],
    ]);
    assert.deepEqual(receipt, {
      driver: "mock",
      receiptId: RECEIPT_ID,
      providerRef: `mock_email_${RECEIPT_ID}`,
      status: "accepted",
      attemptCount: 1,
    });
    assert.equal(JSON.stringify(receipt).includes("owner@email.test"), false);
  });

  it("reuses an already accepted receipt", async () => {
    let accepts = 0;
    const repository: EmailReceiptRepository = {
      async claim() {
        return {
          receiptId: RECEIPT_ID,
          deliveryId: DELIVERY_ID,
          template: "operator_card_failure",
          status: "accepted",
          providerRef: `mock_email_${RECEIPT_ID}`,
          attemptCount: 1,
        };
      },
      async accept() { accepts += 1; throw new Error("unexpected"); },
      async fail() { throw new Error("unexpected"); },
    };
    const result = await createMockEmailDriver({ repository }).send({
      to: "owner@email.test",
      template: "operator_card_failure",
      vars: { DELIVERY_REFERENCE: DELIVERY_ID },
      orgId: "82000000-0000-4000-8000-000000000001",
    });
    assert.equal(accepts, 0);
    assert.equal(result.providerRef, `mock_email_${RECEIPT_ID}`);
  });

  it("rejects invalid input before repository activity", async () => {
    let calls = 0;
    const repository: EmailReceiptRepository = {
      async claim() { calls += 1; throw new Error("unexpected"); },
      async accept() { throw new Error("unexpected"); },
      async fail() { throw new Error("unexpected"); },
    };
    await assert.rejects(createMockEmailDriver({ repository }).send({
      to: "invalid",
      template: "operator_card_failure",
      vars: { DELIVERY_REFERENCE: DELIVERY_ID },
      orgId: "82000000-0000-4000-8000-000000000001",
    }));
    assert.equal(calls, 0);
  });
});

describe("email repository", () => {
  it("maps one RPC result through the exact claim contract", async () => {
    const calls: unknown[] = [];
    const repository = createEmailReceiptRepository({
      async rpc(name, args) {
        calls.push([name, args]);
        return {
          data: [{
            receipt_id: RECEIPT_ID,
            delivery_id: DELIVERY_ID,
            template: "operator_card_failure",
            status: "pending",
            provider_ref: null,
            attempt_count: 1,
          }],
          error: null,
        };
      },
    });
    const receipt = await repository.claim({
      deliveryId: DELIVERY_ID,
      template: "operator_card_failure",
      recipient: "owner@email.test",
    });
    assert.deepEqual(calls, [["claim_email_delivery", {
      p_delivery_id: DELIVERY_ID,
      p_template: "operator_card_failure",
      p_recipient: "owner@email.test",
    }]]);
    assert.equal(receipt.receiptId, RECEIPT_ID);
  });

  it("does not expose raw database failures", async () => {
    const repository = createEmailReceiptRepository({
      async rpc() { return { data: null, error: new Error("private database detail") }; },
    });
    await assert.rejects(
      repository.claim({
        deliveryId: DELIVERY_ID,
        template: "operator_card_failure",
        recipient: "owner@email.test",
      }),
      /EMAIL_RECEIPT_WRITE_FAILED/,
    );
  });
});
