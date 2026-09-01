import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { EmailReceiptRepository } from "./repository.ts";
import { createResendEmailDriver, ResendEmailError } from "./resend-driver.ts";

const DELIVERY_ID = "82000000-0000-4000-8000-000000000201";
const RECEIPT_ID = "82000000-0000-4000-8000-000000000501";
const ORG_ID = "82000000-0000-4000-8000-000000000001";

function repository(events: unknown[]): EmailReceiptRepository {
  return {
    async claim(input) {
      events.push(["claim", input]);
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
      events.push(["accept", receiptId, providerRef]);
      return {
        receiptId,
        deliveryId: DELIVERY_ID,
        template: "operator_card_failure",
        status: "accepted",
        providerRef,
        attemptCount: 1,
      };
    },
    async fail(receiptId, errorCode) {
      events.push(["fail", receiptId, errorCode]);
      return {
        receiptId,
        deliveryId: DELIVERY_ID,
        template: "operator_card_failure",
        status: "failed",
        providerRef: null,
        attemptCount: 1,
      };
    },
  };
}

function request() {
  return {
    to: "owner@email.test",
    template: "operator_card_failure" as const,
    vars: { DELIVERY_REFERENCE: DELIVERY_ID },
    orgId: ORG_ID,
  };
}

describe("Resend email driver", () => {
  it("posts only the published template with a stable receipt idempotency key", async () => {
    const events: unknown[] = [];
    let captured: { url: string; init?: RequestInit } | null = null;
    const driver = createResendEmailDriver({
      apiKey: "unit-test",
      fromAddress: "mail@platform.test",
      repository: repository(events),
      resolveOrgDisplayName: async () => "Operator Name",
      fetch: async (url, init) => {
        captured = { url: String(url), init };
        return new Response(JSON.stringify({ id: "provider_email_1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    const result = await driver.send(request());
    const actual = captured as { url: string; init?: RequestInit } | null;
    assert.ok(actual);
    assert.equal(actual.url, "https://api.resend.com/emails");
    assert.equal(actual.init?.method, "POST");
    const headers = actual.init?.headers as Record<string, string>;
    assert.equal(headers["Idempotency-Key"], `email-outbox:${RECEIPT_ID}`);
    assert.equal(headers.Authorization, "Bearer unit-test");
    assert.deepEqual(JSON.parse(String(actual.init?.body)), {
      from: "Operator Name <mail@platform.test>",
      to: ["owner@email.test"],
      template: { id: "operator-card-failure", variables: {} },
    });
    assert.deepEqual(events.map((entry) => (entry as unknown[])[0]), ["claim", "accept"]);
    assert.deepEqual(result, {
      driver: "resend",
      receiptId: RECEIPT_ID,
      providerRef: "provider_email_1",
      status: "accepted",
      attemptCount: 1,
    });
  });

  it("uses an accepted receipt without another provider request", async () => {
    let fetches = 0;
    const acceptedRepository = repository([]);
    acceptedRepository.claim = async () => ({
      receiptId: RECEIPT_ID,
      deliveryId: DELIVERY_ID,
      template: "operator_card_failure",
      status: "accepted",
      providerRef: "provider_email_existing",
      attemptCount: 1,
    });
    const result = await createResendEmailDriver({
      apiKey: "unit-test",
      fromAddress: "mail@platform.test",
      repository: acceptedRepository,
      resolveOrgDisplayName: async () => "Operator Name",
      fetch: async () => { fetches += 1; throw new Error("unexpected"); },
    }).send(request());
    assert.equal(fetches, 0);
    assert.equal(result.providerRef, "provider_email_existing");
  });

  it("rejects malformed sender, recipient and display name before claim", async () => {
    let claims = 0;
    const repo = repository([]);
    repo.claim = async () => { claims += 1; throw new Error("unexpected"); };
    assert.throws(() => createResendEmailDriver({
      apiKey: "unit-test",
      fromAddress: "bad\nmail@platform.test",
      repository: repo,
      resolveOrgDisplayName: async () => "Operator Name",
    }));
    const driver = createResendEmailDriver({
      apiKey: "unit-test",
      fromAddress: "mail@platform.test",
      repository: repo,
      resolveOrgDisplayName: async () => "Bad\nName",
    });
    await assert.rejects(driver.send({ ...request(), to: "bad-address" }), ResendEmailError);
    await assert.rejects(driver.send(request()), ResendEmailError);
    assert.equal(claims, 0);
  });

  it("records stable errors for HTTP, oversized and invalid envelopes", async () => {
    for (const [response, code] of [
      [new Response("private response", { status: 429 }), "RESEND_HTTP"],
      [new Response("{}", { status: 200, headers: { "content-length": "65537" } }), "RESEND_RESPONSE_TOO_LARGE"],
      [new Response("{}", { status: 200 }), "RESEND_ENVELOPE_INVALID"],
    ] as const) {
      const events: unknown[] = [];
      const driver = createResendEmailDriver({
        apiKey: "unit-test",
        fromAddress: "mail@platform.test",
        repository: repository(events),
        resolveOrgDisplayName: async () => "Operator Name",
        fetch: async () => response,
      });
      await assert.rejects(driver.send(request()), (error: unknown) => {
        assert.ok(error instanceof ResendEmailError);
        assert.equal(error.code, code);
        assert.equal(JSON.stringify(error).includes("private response"), false);
        assert.equal(JSON.stringify(error).includes("owner@email.test"), false);
        assert.equal(JSON.stringify(error).includes("unit-test"), false);
        return true;
      });
      assert.equal((events.at(-1) as unknown[])[2], code);
    }
  });

  it("aborts a bounded request and records a timeout code", async () => {
    const events: unknown[] = [];
    const driver = createResendEmailDriver({
      apiKey: "unit-test",
      fromAddress: "mail@platform.test",
      repository: repository(events),
      resolveOrgDisplayName: async () => "Operator Name",
      setTimer(callback) { callback(); return 1 as unknown as ReturnType<typeof setTimeout>; },
      clearTimer() {},
      fetch: async (_url, init) => {
        assert.equal(init?.signal?.aborted, true);
        throw new DOMException("aborted", "AbortError");
      },
    });
    await assert.rejects(driver.send(request()), (error: unknown) => {
      assert.ok(error instanceof ResendEmailError);
      assert.equal(error.code, "RESEND_TIMEOUT");
      return true;
    });
    assert.equal((events.at(-1) as unknown[])[2], "RESEND_TIMEOUT");
  });
});

describe("email real arm", () => {
  it(
    "requires a provider receipt before account acceptance",
    { skip: "SKIPPED-MISSING-KEY: account execution belongs to the key-arrival arm" },
    () => {},
  );
});
