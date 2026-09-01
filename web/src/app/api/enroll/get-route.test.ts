import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { handleEnrollmentGet } from "./route.ts";
import { AppError } from "@/lib/enrollment/errors";
import { DEMO_PROFILE_IDS } from "@/lib/demo/demo-session";

/**
 * R3B-01 asked that a consumer session bound to no workspace refuse rather than render. The class was
 * right; the enumeration standing in for it was "holds at least one enrollment", and that rotted the
 * moment G-3B-10 removed the demo consumer's seeded enrollment on 2026-08-17 to make the Milestone-2
 * enrollment beat repeatable. A consumer with a client and no enrollment *is* the pre-enrollment state,
 * and answering it 404 disables the whole onboarding flow: the bootstrap's `!ok` arm maps to
 * `unavailable`, and `onboarding1.tsx` gates the signature, payment, IDV-verify and quiz controls on it.
 *
 * So these tests assert the property — refusal follows the *workspace binding* — and the last one
 * derives its subject from `supabase/seed.sql` rather than transcribing an id, so a seed that re-attaches
 * an enrollment to the demo consumer, or unbinds its client, fails here instead of on camera.
 */
const SESSION = {
  disabledAt: null,
  id: "30100000-0000-4000-8000-000000000001",
  manages: [] as string[],
  orgId: null,
  orgMembership: null,
  orgRole: null,
  role: "consumer" as const,
};

async function withEnrollmentFlag<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env.FEATURE_ENROLLMENT;
  process.env.FEATURE_ENROLLMENT = "1";
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.FEATURE_ENROLLMENT;
    else process.env.FEATURE_ENROLLMENT = previous;
  }
}

describe("enrollment read for an unbound consumer", () => {
  it("returns the typed not-found response when no client is bound to the session", async () => {
    const response = await withEnrollmentFlag(async () =>
      handleEnrollmentGet(new Request("http://local.test/api/enroll"), {
        async getSession() { return SESSION; },
        async listEnrollmentSummaries() { return { ok: true, value: [] }; },
        async readEnrollmentState() { throw new Error("must not read a missing enrollment"); },
        async resolveConsumerClient() {
          return { ok: false, error: new AppError("not_found", "Client not found.") };
        },
      }),
    );

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      error: {
        code: "not_found",
        message: "No enrollment workspace is assigned to this account.",
      },
    });
  });

  it("returns the ready config for a bound consumer that has not enrolled yet", async () => {
    const response = await withEnrollmentFlag(async () =>
      handleEnrollmentGet(new Request("http://local.test/api/enroll"), {
        async getSession() { return SESSION; },
        async listEnrollmentSummaries() { return { ok: true, value: [] }; },
        async readEnrollmentState() { throw new Error("must not read a missing enrollment"); },
        async resolveConsumerClient() { return { ok: true, value: "a3000000-0000-0000-0000-000000000004" }; },
      }),
    );

    assert.equal(response.status, 200);
    const body = await response.json() as { enabled?: unknown; currentEnrollment?: unknown; enrollments?: unknown };
    assert.equal(body.enabled, true, "the bootstrap treats anything but enabled:true as unavailable");
    assert.equal(body.currentEnrollment, null);
    assert.deepEqual(body.enrollments, []);
  });

  it("keeps the seeded demo consumer bound to a client and carrying no enrollment", () => {
    const seed = readFileSync(new URL("../../../../../supabase/seed.sql", import.meta.url), "utf8");
    const consumerProfileId = DEMO_PROFILE_IDS.consumer;

    const boundClient = new RegExp(`'${consumerProfileId}'`).test(seed);
    assert.ok(boundClient, `seed no longer mentions the demo consumer profile ${consumerProfileId}`);

    const clientIdMatch = /\(\s*'(a3000000-0000-0000-0000-0000000000\d\d)',[^)]*'a1000000-0000-0000-0000-000000000014'/.exec(seed);
    assert.ok(clientIdMatch, "could not derive the demo consumer's client id from the seed");
    const demoClientId = clientIdMatch[1];

    const enrollmentsBlock = seed.slice(seed.indexOf("insert into public.enrollments"));
    const enrollmentRows = enrollmentsBlock.slice(0, enrollmentsBlock.indexOf("on conflict"));
    assert.ok(
      !enrollmentRows.includes(demoClientId),
      `the demo consumer's client ${demoClientId} has a seeded enrollment again — the Milestone-2 enrollment beat answers 409 (G-3B-10)`,
    );
  });
});
