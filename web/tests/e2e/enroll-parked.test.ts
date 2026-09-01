import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { IDV_LOCK_DURATION_HOURS, MAX_IDV_ATTEMPTS } from "@/lib/idv/config";

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
  "enroll — parked path",
  {
    skip: serverUp
      ? false
      : `no dev server on ${enrollmentBaseUrl} — run \`npm run dev -- -p 3003\``,
  },
  () => {
    it("parks for 72 hours without settling or charging a subscription", async () => {
      const clientId = randomUUID();
      const draftId = randomUUID();
      const name = "Enrollment Parked E2E";
      const email = `enrollment-parked-${clientId}@example.invalid`;
      const { actorId } = await provisionConsumer({ clientId, email, fullName: name });
      let view = await postEnrollment(
        "/api/enroll",
        actorId,
        enrollmentBody({ draftId, email, name }),
      );

      view = await postEnrollment(
        `/api/enrollments/${view.enrollmentId}/idv`,
        actorId,
        { code: "incorrect", kind: "sms" },
      );
      assert.equal(view.idvState, "quiz");

      for (let attempt = 0; attempt < MAX_IDV_ATTEMPTS; attempt += 1) {
        view = await postEnrollment(
          `/api/enrollments/${view.enrollmentId}/idv`,
          actorId,
          {
            answers: [{ answerId: "incorrect", questionId: "business-name" }],
            kind: "quiz",
          },
        );
      }

      assert.equal(view.status, "parked");
      const evidence = await readEvidence(clientId);
      assert.equal(evidence.enrollment.status, "parked");
      assert.ok(evidence.enrollment.parkedUntil, "parked_until is missing");
      const expectedUntil = Date.now() + IDV_LOCK_DURATION_HOURS * 60 * 60 * 1000;
      const actualUntil = Date.parse(evidence.enrollment.parkedUntil as string);
      assert.ok(
        Math.abs(actualUntil - expectedUntil) <= 5 * 60 * 1000,
        "parked_until is outside the 72-hour tolerance",
      );
      assert.ok(
        !evidence.milestones.some(
          (milestone) => milestone.kind === "monitoring_connected",
        ),
      );

      // This is a direct count query against consumer_subscriptions by client
      // id. The pre-IDV SetupIntent remains as one authorized row; zero active
      // rows and no subscription-start audit prove that no charge was created.
      assert.equal(evidence.activeSubscriptionCount, 0);
      assert.equal(evidence.subscriptionCount, 1);
      assert.equal(evidence.subscriptions[0]?.status, "authorized");
      assert.equal(evidence.subscriptions[0]?.subscriptionRef, null);
      assert.ok(!evidence.auditActions.includes("billing.subscription_started"));
      assert.ok(evidence.auditActions.includes("enrollment.park"));
    });
  },
);
