import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

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
  "enrollment consent withdrawal",
  {
    skip: serverUp
      ? false
      : `no dev server on ${enrollmentBaseUrl} — run \`npm run dev -- -p 3003\``,
  },
  () => {
    it("appends one revocation while leaving the original consent byte-identical", async () => {
      const clientId = randomUUID();
      const draftId = randomUUID();
      const name = "Enrollment Revocation E2E";
      const email = `enrollment-revoke-${clientId}@example.invalid`;
      const { actorId } = await provisionConsumer({ clientId, email, fullName: name });
      const started = await postEnrollment(
        "/api/enroll",
        actorId,
        enrollmentBody({ draftId, email, name }),
      );
      const before = await readEvidence(clientId);
      const original = before.consents.find(
        (consent) => consent.kind === "analysis" && consent.action === "granted",
      );
      assert.ok(original, "analysis consent was not created");

      const first = await postEnrollment(
        `/api/enrollments/${started.enrollmentId}/revoke-consent`,
        actorId,
        { kind: "analysis" },
      );
      assert.equal(
        first.consents.find((consent) => consent.kind === "analysis")?.authorized,
        false,
      );
      await postEnrollment(
        `/api/enrollments/${started.enrollmentId}/revoke-consent`,
        actorId,
        { kind: "analysis" },
      );

      const after = await readEvidence(clientId);
      const unchanged = after.consents.find(
        (consent) => consent.id === original.id,
      );
      assert.deepEqual(unchanged, original);
      assert.deepEqual(
        after.revocations.map((revocation) => ({
          consentId: revocation.consentId,
          kind: revocation.kind,
        })),
        [{ consentId: original.id, kind: "analysis" }],
      );
      assert.equal(
        after.auditActions.filter((action) => action === "consent.revoke").length,
        1,
      );
    });
  },
);
