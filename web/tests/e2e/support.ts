import assert from "node:assert/strict";

import type { EnrollmentView } from "@/lib/enrollment/types";

export const enrollmentBaseUrl =
  process.env.ENROLL_TEST_BASE_URL ?? "http://127.0.0.1:3003";

export async function enrollmentServerUp(): Promise<boolean> {
  return fetch(`${enrollmentBaseUrl}/api/enroll`).then(
    (response) => response.ok,
    () => false,
  );
}

export async function provisionConsumer(input: {
  clientId: string;
  email: string;
  fullName: string;
}): Promise<{ actorId: string }> {
  const repository = await import("@/lib/enrollment/repository");
  return repository.createEnrollmentE2eFixture(input);
}

export async function readEvidence(clientId: string) {
  const repository = await import("@/lib/enrollment/repository");
  return repository.readEnrollmentE2eEvidence(clientId);
}

export async function postEnrollment(
  path: string,
  actorId: string,
  body: unknown,
): Promise<EnrollmentView> {
  const response = await fetch(`${enrollmentBaseUrl}${path}`, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      "x-mf-demo-profile-id": actorId,
    },
    method: "POST",
  });
  const payload = (await response.json()) as EnrollmentView | {
    code?: string;
  };
  assert.equal(
    response.status,
    200,
    `POST ${path} returned ${response.status} (${"code" in payload ? payload.code : "unexpected response"})`,
  );
  assert.ok("enrollmentId" in payload, `POST ${path} returned no enrollment view`);
  return payload;
}

export function enrollmentBody(input: {
  draftId: string;
  email: string;
  name: string;
}) {
  return {
    analysis: true,
    draftId: input.draftId,
    email: input.email,
    monitoring: true,
    name: input.name,
    phone: "+15555550100",
    signature: input.name,
  };
}
