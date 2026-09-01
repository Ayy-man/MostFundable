import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { currentVersion } from "@/lib/enrollment/consent-texts";
import { MOCK_SMS_CODE } from "@/lib/idv/config";

import {
  enrollmentBaseUrl,
  enrollmentBody,
  enrollmentServerUp,
  postEnrollment,
  provisionConsumer,
  readEvidence,
} from "./support";

const serverUp = await enrollmentServerUp();

describe(
  "enroll — happy path",
  {
    skip: serverUp
      ? false
      : `no dev server on ${enrollmentBaseUrl} — run \`npm run dev -- -p 3003\``,
  },
  () => {
    it("persists consent, signature, active enrollment, subscription and audit evidence", async () => {
      const clientId = randomUUID();
      const draftId = randomUUID();
      const name = "Enrollment Happy E2E";
      const email = `enrollment-happy-${clientId}@example.invalid`;
      const { actorId } = await provisionConsumer({ clientId, email, fullName: name });
      const started = await postEnrollment(
        "/api/enroll",
        actorId,
        enrollmentBody({ draftId, email, name }),
      );
      const active = await postEnrollment(
        `/api/enrollments/${started.enrollmentId}/idv`,
        actorId,
        { code: MOCK_SMS_CODE, kind: "sms" },
      );

      assert.equal(active.status, "active");
      const evidence = await readEvidence(clientId);
      assert.equal(evidence.enrollment.status, "active");
      assert.equal(evidence.consents.length, 2);
      assert.deepEqual(
        evidence.consents
          .map((consent) => ({
            action: consent.action,
            kind: consent.kind,
            textVersion: consent.textVersion,
          }))
          .toSorted((left, right) => left.kind.localeCompare(right.kind)),
        [
          {
            action: "granted",
            kind: "analysis",
            textVersion: currentVersion("analysis"),
          },
          {
            action: "granted",
            kind: "monitoring",
            textVersion: currentVersion("monitoring"),
          },
        ],
      );
      assert.equal(evidence.esignatures.length, 1);
      assert.equal(
        evidence.esignatures[0]?.textVersion,
        currentVersion("enrollment_agreement"),
      );
      assert.equal(evidence.subscriptionCount, 1);
      assert.equal(evidence.activeSubscriptionCount, 1);
      assert.match(evidence.subscriptions[0]?.subscriptionRef ?? "", /^mock_/);
      assert.deepEqual(
        evidence.milestones
          .map((milestone) => milestone.kind)
          .toSorted(),
        ["agreement_signed", "monitoring_connected"],
      );

      for (const action of [
        "enrollment.create",
        "enrollment.idv_started",
        "enrollment.idv_pass",
        "enrollment.activate",
        "billing.subscription_started",
      ]) {
        assert.ok(
          evidence.auditActions.includes(action),
          `missing audit_log transition ${action}`,
        );
      }
    });
  },
);
