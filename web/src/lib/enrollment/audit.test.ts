import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AUDIT_ACTIONS,
  clientSubject,
  consentSubject,
  enrollmentSubject,
  rowlessAuditEntry,
} from "@/lib/enrollment/audit";

describe("enrollment audit vocabulary", () => {
  it("matches the fifteen database-trigger actions", () => {
    const expected = [
      "consent.create",
      "consent.revoke",
      "enrollment.create",
      "enrollment.idv_started",
      "enrollment.idv_retry",
      "enrollment.idv_quiz",
      "enrollment.idv_pass",
      "enrollment.idv_locked",
      "enrollment.park",
      "enrollment.activate",
      "enrollment.cancel",
      "billing.setup_intent_recorded",
      "billing.subscription_started",
      "billing.subscription_cancelled",
      "milestone.complete",
    ];
    assert.deepEqual(new Set(AUDIT_ACTIONS), new Set(expected));
    assert.equal(AUDIT_ACTIONS.length, expected.length);
  });

  it("builds subjects in the shared grammar", () => {
    assert.equal(enrollmentSubject("e1"), "enrollment:e1");
    assert.equal(clientSubject("c1"), "client:c1");
    assert.equal(consentSubject("a1"), "consent:a1");
  });

  it("builds a rowless entry without performing I/O", () => {
    assert.deepEqual(
      rowlessAuditEntry(
        "actor-1",
        "enrollment.create",
        enrollmentSubject("e1"),
        { reason: "request_rejected" },
      ),
      {
        actor: "actor-1",
        action: "enrollment.create",
        subject: "enrollment:e1",
        meta: { reason: "request_rejected" },
      },
    );
  });
});
