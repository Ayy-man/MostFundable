import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AppError, toHttpResponse } from "@/lib/enrollment/errors";
import {
  parseEnrollmentId,
  parseEnrollRequest,
  parseIdvSubmitBody,
  parseReauthorizeConsentBody,
  parseRevokeConsentBody,
} from "@/lib/enrollment/validate";

const good = {
  draftId: "11111111-1111-4111-8111-111111111111",
  name: "A B",
  email: "a@b.co",
  phone: "+15550001111",
  monitoring: true,
  analysis: true,
  signature: "A B",
};

const crsIdentity = {
  dateOfBirth: "1990-01-01",
  ssn: "000000000",
  address: {
    line1: "1 Contract Way",
    city: "Contract",
    state: "CA",
    postalCode: "00000",
  },
};

function captured(fn: () => unknown): AppError {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof AppError);
    return error;
  }
  assert.fail("expected an AppError");
}

describe("enrollment request validation", () => {
  it("validates path ids with the Postgres UUID shape", () => {
    assert.equal(
      captured(() => parseEnrollmentId("not-a-uuid")).code,
      "invalid_payload",
    );
    assert.equal(
      parseEnrollmentId("00000000-0000-0000-0000-000000000001"),
      "00000000-0000-0000-0000-000000000001",
    );
  });

  it("parses a complete enrollment payload", () => {
    assert.deepEqual(parseEnrollRequest(good), good);
  });

  it("accepts only the spec-derived transient CRS identity shape", () => {
    assert.deepEqual(parseEnrollRequest({ ...good, crsIdentity }), { ...good, crsIdentity });
    for (const identity of [
      { ...crsIdentity, ssn: "000-00-0000" },
      { ...crsIdentity, dateOfBirth: "not-a-date" },
      { ...crsIdentity, dateOfBirth: "2026-02-31" },
      { ...crsIdentity, address: { ...crsIdentity.address, state: "California" } },
      { ...crsIdentity, score: 800 },
    ]) {
      assert.equal(
        captured(() => parseEnrollRequest({ ...good, crsIdentity: identity })).code,
        "invalid_payload",
      );
    }
  });

  it("rejects an unknown key", () => {
    assert.equal(captured(() => parseEnrollRequest({ ...good, extra: true })).code, "invalid_payload");
  });

  it("accepts one trimmed affiliate code and rejects unusable values", () => {
    assert.deepEqual(parseEnrollRequest({ ...good, aff: "  partner-code  " }), {
      ...good,
      aff: "partner-code",
    });
    for (const aff of ["", "   ", "x".repeat(256), 123]) {
      assert.equal(
        captured(() => parseEnrollRequest({ ...good, aff })).code,
        "invalid_payload",
      );
    }
  });

  it("rejects payment fields without echoing their value", () => {
    const error = captured(() =>
      parseEnrollRequest({ ...good, cardNumber: "4242424242424242" }),
    );
    assert.equal(error.code, "payment_field_rejected");
    assert.ok(!JSON.stringify(error).includes("4242"));
    assert.ok(!error.message.includes("4242"));
  });

  it("rejects missing and malformed enrollment anchors", () => {
    for (const input of [
      { ...good, draftId: "" },
      { ...good, draftId: "not-a-uuid" },
      { ...good, email: "" },
      { ...good, email: "not-an-email" },
      { ...good, signature: "" },
    ]) {
      assert.equal(captured(() => parseEnrollRequest(input)).code, "invalid_payload");
    }
  });

  it("requires both named consent booleans to be true", () => {
    assert.equal(
      captured(() => parseEnrollRequest({ ...good, monitoring: false })).code,
      "invalid_payload",
    );
    assert.equal(
      captured(() => parseEnrollRequest({ ...good, analysis: false })).code,
      "invalid_payload",
    );
  });

  it("parses the mock submissions and the CRS SMFA status submission", () => {
    assert.deepEqual(parseIdvSubmitBody({ kind: "sms", code: "123456" }), {
      kind: "sms",
      code: "123456",
    });
    assert.deepEqual(
      parseIdvSubmitBody({
        kind: "quiz",
        answers: [{ questionId: "q1", answerId: "a1" }],
      }),
      {
        kind: "quiz",
        answers: [{ questionId: "q1", answerId: "a1" }],
      },
    );
    assert.deepEqual(parseIdvSubmitBody({ kind: "smfa_status" }), {
      kind: "smfa_status",
    });
  });

  it("parses only a named consent revocation", () => {
    assert.deepEqual(parseRevokeConsentBody({ kind: "analysis" }), {
      kind: "analysis",
    });
    assert.equal(
      captured(() => parseRevokeConsentBody({ kind: "other" })).code,
      "invalid_payload",
    );
  });

  it("requires an affirmative, signed, idempotent reauthorization payload", () => {
    const payload = {
      accepted: true,
      draftId: "11111111-1111-4111-8111-111111111111",
      kind: "monitoring",
      signature: "  A B  ",
    } as const;
    assert.deepEqual(parseReauthorizeConsentBody(payload), {
      ...payload,
      signature: "A B",
    });
    for (const invalid of [
      { ...payload, accepted: false },
      { ...payload, draftId: "not-a-uuid" },
      { ...payload, kind: "other" },
      { ...payload, signature: "" },
      { ...payload, signature: "x".repeat(201) },
      { ...payload, textVersion: "browser-chosen" },
    ]) {
      assert.equal(
        captured(() => parseReauthorizeConsentBody(invalid)).code,
        "invalid_payload",
      );
    }
  });
});

describe("enrollment HTTP errors", () => {
  it("maps stable application errors to their HTTP status", async () => {
    for (const [code, status] of [
      ["unauthenticated", 401],
      ["forbidden", 403],
      ["not_found", 404],
      ["invalid_payload", 400],
      ["identity_account_exists", 409],
      ["identity_verification_failed", 422],
      ["conflict", 409],
      ["billing_configuration", 409],
      ["settlement_blocked", 409],
    ] as const) {
      const response = toHttpResponse(new AppError(code, "Safe response"));
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), {
        error: { code, message: "Safe response" },
      });
    }
  });

  it("maps the merged session helper error without exposing its internals", async () => {
    const error = Object.assign(new Error("Authentication required"), {
      name: "SessionAccessError",
      status: 401,
    });
    const response = toHttpResponse(error);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      error: { code: "unauthenticated", message: "Authentication is required." },
    });
  });

  it("drops an unexpected provider message", async () => {
    const response = toHttpResponse(new Error("provider-private-detail"));
    assert.equal(response.status, 500);
    assert.ok(!JSON.stringify(await response.json()).includes("provider-private-detail"));
  });
});
