import assert from "node:assert/strict";
import test from "node:test";

import { AuthError } from "@/lib/auth/errors";
import { handleTrialExpiryRunNow } from "./route.ts";

const SESSION = {
  disabledAt: null,
  id: "11111111-1111-4111-8111-111111111111", role: "platform_admin" as const,
  orgId: null, orgMembership: null, orgRole: null, manages: [],
};

test("feature-off and authorization failure precede run-now", async () => {
  let ran = false;
  const off = await handleTrialExpiryRunNow({
    enabled: () => false,
    now: () => new Date(),
    async requirePlatformAdmin() { throw new Error(); },
    async runNow() { ran = true; throw new Error(); },
  });
  assert.equal(off.status, 404);
  assert.equal(ran, false);

  const forbidden = await handleTrialExpiryRunNow({
    enabled: () => true,
    now: () => new Date(),
    async requirePlatformAdmin() { throw new AuthError(403, "forbidden", "private detail"); },
    async runNow() { ran = true; throw new Error(); },
  });
  assert.equal(forbidden.status, 403);
  assert.equal(ran, false);
});

test("platform admin runs the exact global UTC-date tuple through shared drainer", async () => {
  let tuple: unknown;
  const response = await handleTrialExpiryRunNow({
    enabled: () => true,
    now: () => new Date("2026-08-17T23:00:00-07:00"),
    async requirePlatformAdmin() { return SESSION; },
    async runNow(subject, window) {
      tuple = { job: "tenancy.trial_expiry", subject, window };
      return { claimed: 1, failed: 0, retried: 0, skipped: 0, succeeded: 1 };
    },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(tuple, { job: "tenancy.trial_expiry", subject: "global", window: "2026-08-18" });
  assert.deepEqual(await response.json(), {
    claimed: 1, completed: 1, failed: 0, retried: 0, status: "complete",
  });
});

test("shared drainer retry/failure counts remain explicit", async () => {
  const response = await handleTrialExpiryRunNow({
    enabled: () => true,
    now: () => new Date("2026-08-17T00:00:00Z"),
    async requirePlatformAdmin() { return SESSION; },
    async runNow() { return { claimed: 1, failed: 0, retried: 1, skipped: 0, succeeded: 0 }; },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json() as { status: string }).status, "retrying");
});
