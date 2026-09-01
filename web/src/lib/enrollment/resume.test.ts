import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { enrollmentResumeState } from "./resume.ts";

import type { EnrollmentView } from "./types.ts";

function enrollment(overrides: Partial<EnrollmentView> = {}): EnrollmentView {
  return {
    attemptsRemaining: 2,
    consents: [],
    enrollmentId: "10000000-0000-4000-8000-000000000001",
    idvState: "sms_sent",
    lockedUntil: null,
    milestones: [],
    needsOperatorAttention: null,
    parkedUntil: null,
    status: "enrolled",
    subscription: {
      activatedAt: null,
      authorizedAt: "2026-08-23T10:00:00.000Z",
      cancelledAt: null,
      currency: "usd",
      paymentMethodOnFile: true,
      priceCents: 4900,
      status: "authorized",
    },
    ...overrides,
  };
}

describe("enrollment resume state", () => {
  it("returns an active enrollment to the completed identity screen", () => {
    assert.deepEqual(
      enrollmentResumeState(enrollment({ idvState: "passed", status: "active" })),
      { identityMode: "sms", paymentAuthorized: true, step: 4, verified: true },
    );
  });

  it("returns an in-flight SMS or quiz challenge to identity verification", () => {
    assert.deepEqual(enrollmentResumeState(enrollment()), {
      identityMode: "sms",
      paymentAuthorized: true,
      step: 4,
      verified: false,
    });
    assert.deepEqual(enrollmentResumeState(enrollment({ idvState: "quiz" })), {
      identityMode: "quiz",
      paymentAuthorized: true,
      step: 4,
      verified: false,
    });
  });

  it("returns a parked enrollment to its locked explanation", () => {
    assert.deepEqual(
      enrollmentResumeState(enrollment({ idvState: "locked", status: "parked" })),
      { identityMode: "locked", paymentAuthorized: false, step: 4, verified: false },
    );
  });

  it("retries the signature action when provider setup never started", () => {
    assert.deepEqual(
      enrollmentResumeState(enrollment({ idvState: "pending", subscription: null })),
      { identityMode: "sms", paymentAuthorized: false, step: 2, verified: false },
    );
  });
});
