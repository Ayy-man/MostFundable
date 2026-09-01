import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { handleEnrollmentReset } from "./route.ts";
import { AppError } from "@/lib/enrollment/errors";

/**
 * The demo reset must not exist unless every gate holds: the three flags, a consumer session, and
 * the persona list — the last enforced by the repository (and by migration 392 beneath it), so the
 * route passes the list through and surfaces the repository's refusal as the same 404.
 */
const CONSUMER = {
  disabledAt: null,
  id: "30100000-0000-4000-8000-000000000001",
  manages: [] as string[],
  orgId: null,
  orgMembership: null,
  orgRole: null,
  role: "consumer" as const,
};

const FLAGS = ["FEATURE_ENROLLMENT", "FEATURE_REAL_AUTH", "FEATURE_DEMO_QUICK_SIGN_IN"] as const;

async function withFlags<T>(on: readonly string[], run: () => Promise<T>): Promise<T> {
  const previous = new Map(FLAGS.map((flag) => [flag, process.env[flag]] as const));
  for (const flag of FLAGS) {
    if (on.includes(flag)) process.env[flag] = "1";
    else delete process.env[flag];
  }
  try {
    return await run();
  } finally {
    for (const [flag, value] of previous) {
      if (value === undefined) delete process.env[flag];
      else process.env[flag] = value;
    }
  }
}

describe("demo enrollment reset", () => {
  it("is absent (404) when any of the three flags is off, without touching the session", async () => {
    for (const missing of FLAGS) {
      const on = FLAGS.filter((flag) => flag !== missing);
      const response = await withFlags(on, () =>
        handleEnrollmentReset({
          async getSession() { throw new Error("session must not be read when the route is off"); },
          async resetDemoConsumerWorkspace() { throw new Error("must not reset"); },
        }),
      );
      assert.equal(response.status, 404, `expected 404 with ${missing} off`);
    }
  });

  it("requires a session", async () => {
    const response = await withFlags(FLAGS, () =>
      handleEnrollmentReset({
        async getSession() { return null; },
        async resetDemoConsumerWorkspace() { throw new Error("must not reset"); },
      }),
    );
    assert.equal(response.status, 401);
  });

  it("is absent (404) for a non-consumer session", async () => {
    const response = await withFlags(FLAGS, () =>
      handleEnrollmentReset({
        async getSession() { return { ...CONSUMER, role: "operator_member" as const }; },
        async resetDemoConsumerWorkspace() { throw new Error("must not reset"); },
      }),
    );
    assert.equal(response.status, 404);
  });

  it("surfaces the repository's persona refusal as 404", async () => {
    const response = await withFlags(FLAGS, () =>
      handleEnrollmentReset({
        async getSession() { return CONSUMER; },
        async resetDemoConsumerWorkspace() {
          return { ok: false, error: new AppError("not_found", "Client not found.") };
        },
      }),
    );
    assert.equal(response.status, 404);
  });

  it("returns the fresh client id when every gate holds, passing the closed persona list through", async () => {
    let seen: readonly string[] = [];
    const response = await withFlags(FLAGS, () =>
      handleEnrollmentReset({
        async getSession() { return CONSUMER; },
        async resetDemoConsumerWorkspace(actor, allowed) {
          assert.equal(actor.id, CONSUMER.id);
          seen = allowed;
          return { ok: true, value: "a3000000-0000-0000-0000-0000000000ff" };
        },
      }),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { clientId: "a3000000-0000-0000-0000-0000000000ff" });
    assert.ok(seen.includes("newcomer@northbridge.example"));
    assert.ok(seen.every((email) => email.endsWith("@northbridge.example")));
  });
});
