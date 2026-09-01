// http.test.ts — the envelope contract, pinned by equality rather than by shape.
//
// These are the only strings a browser ever sees from a billing route, so each
// one is asserted whole. A shape check would let a database message or an
// organization name slip into a field nobody is looking at.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BILLING_ERROR_CODES,
  billingError,
  billingErrorFor,
  billingOk,
  disabledRead,
  disabledWrite,
  isUuid,
  validateStartSubscription,
} from "@/lib/billing/http";

function cacheHeader(response: Response): string | null {
  return response.headers.get("Cache-Control");
}

describe("the billing envelopes", () => {
  it("answers a disabled read with exactly { enabled: false }", async () => {
    const response = disabledRead();

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { enabled: false });
    assert.equal(cacheHeader(response), "private, no-store");
  });

  it("answers a disabled write with exactly { code: \"billing_disabled\" } and a 200", async () => {
    const response = disabledWrite();

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { code: "billing_disabled" });
    assert.equal(cacheHeader(response), "private, no-store");
  });

  it("wraps a success body under enabled: true and marks it private", async () => {
    const response = billingOk({ billing: null }, 201);

    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { billing: null, enabled: true });
    assert.equal(cacheHeader(response), "private, no-store");
  });

  it("emits only a code and a message from the closed map", async () => {
    for (const code of BILLING_ERROR_CODES) {
      const response = billingError(code);
      const body = (await response.json()) as { error: { code: string; message: string } };

      assert.deepEqual(Object.keys(body), ["error"]);
      assert.deepEqual(Object.keys(body.error).sort(), ["code", "message"]);
      assert.equal(body.error.code, code);
      assert.equal(typeof body.error.message, "string");
      assert.ok(body.error.message.length > 0);
      assert.equal(cacheHeader(response), "private, no-store");
    }
  });

  it("carries no organization identifier, no tenant name and no database wording in any message", async () => {
    for (const code of BILLING_ERROR_CODES) {
      const body = (await billingError(code).json()) as {
        error: { message: string };
      };

      assert.doesNotMatch(body.error.message, /[0-9a-f]{8}-[0-9a-f]{4}/i);
      assert.doesNotMatch(body.error.message, /postgres|pgrst|relation|column|constraint|sql/i);
      assert.doesNotMatch(body.error.message, /stripe|sub_|cus_|price_/i);
    }
  });

  it("maps each code to a stable status", () => {
    assert.equal(billingError("session_required").status, 401);
    assert.equal(billingError("role_forbidden").status, 403);
    assert.equal(billingError("org_required").status, 403);
    assert.equal(billingError("invalid_request").status, 400);
    assert.equal(billingError("subscription_conflict").status, 409);
    assert.equal(billingError("billing_unavailable").status, 500);
  });
});

describe("billingErrorFor", () => {
  async function codeOf(response: Response): Promise<string> {
    const body = (await response.json()) as { error: { code: string } };
    return body.error.code;
  }

  it("maps an AuthError by its status, without instanceof", async () => {
    const unauthenticated = { message: "Authentication is required.", name: "AuthError", status: 401 };
    const forbidden = { message: "Role access is denied.", name: "AuthError", status: 403 };

    assert.equal(await codeOf(billingErrorFor(unauthenticated)), "session_required");
    assert.equal(await codeOf(billingErrorFor(forbidden)), "role_forbidden");
  });

  it("maps an application error by its code", async () => {
    assert.equal(await codeOf(billingErrorFor({ code: "conflict" })), "subscription_conflict");
    assert.equal(await codeOf(billingErrorFor({ code: "forbidden" })), "role_forbidden");
    assert.equal(await codeOf(billingErrorFor({ code: "invalid_payload" })), "invalid_request");
  });

  it("degrades anything it does not recognise to billing_unavailable", async () => {
    for (const thrown of [
      new Error("relation \"operator_subscriptions\" does not exist"),
      { code: "42P01" },
      "a string",
      null,
      undefined,
    ]) {
      assert.equal(await codeOf(billingErrorFor(thrown)), "billing_unavailable");
    }
  });

  it("never forwards the thrown message", async () => {
    const response = billingErrorFor(new Error("sub_1234 could not be updated: column missing"));
    const body = (await response.json()) as { error: { message: string } };

    assert.doesNotMatch(body.error.message, /sub_1234|column/);
  });
});

describe("the start-subscription validator", () => {
  it("accepts an empty body, because every billable value is derived server-side", () => {
    const parsed = validateStartSubscription({});

    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.ok && parsed.value, {});
  });

  it("rejects an unknown key rather than ignoring it", () => {
    for (const extra of ["customerRef", "idempotencyKey", "seatQuantity", "priceRef", "plan", "membership", "orgId"]) {
      const parsed = validateStartSubscription({ [extra]: "anything" });
      assert.equal(parsed.ok, false, `${extra} must not be accepted`);
    }
  });

  it("rejects a body that is not an object at all", () => {
    for (const body of [null, "cus_operator", 7, true, ["customerRef"]]) {
      assert.equal(validateStartSubscription(body).ok, false);
    }
  });
});

describe("isUuid", () => {
  it("accepts a canonical uuid and refuses anything else", () => {
    assert.equal(isUuid("70000000-0000-0000-0000-0000000000aa"), true);
    assert.equal(isUuid("70000000-0000-0000-0000-0000000000AA"), true);
    assert.equal(isUuid("70000000000000000000000000000aa"), false);
    assert.equal(isUuid("../../etc/passwd"), false);
    assert.equal(isUuid(""), false);
  });
});
