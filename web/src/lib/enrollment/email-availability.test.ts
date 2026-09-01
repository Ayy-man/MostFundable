import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createEmailAvailabilityReader } from "./email-availability.ts";
import { AppError, toHttpResponse } from "./errors.ts";

/**
 * The tenancy email guard sits in front of `startEnrollment`, and whatever it throws is caught by
 * the enroll route's single `catch` and handed to `toHttpResponse`. That makes the *type* it throws
 * load-bearing rather than incidental: `toHttpResponse` recognises `AppError` and `SessionAccessError`
 * and nothing else, so a bare `Error` from here becomes an unmapped 500.
 *
 * These assertions derive the expected status from `toHttpResponse` and the shared `AppError`
 * taxonomy rather than transcribing 503 from the fix. If someone re-points `driver_unavailable` at a
 * different status in `errors.ts`, this file follows it instead of contradicting it.
 */

function readerRejectingWith(error: unknown) {
  return createEmailAvailabilityReader({
    rpc: async () => ({ data: null, error }),
  });
}

const CALL = { actorId: "a1000000-0000-0000-0000-000000000011", email: "clean@northbridge.example" };

describe("email availability reader", () => {
  it("answers a healthy read straight through, without wrapping the boolean", async () => {
    for (const value of [true, false]) {
      const reader = createEmailAvailabilityReader({
        rpc: async () => ({ data: value, error: null }),
      });
      assert.equal(await reader.registeredElsewhere(CALL), value);
    }
  });

  it("lowercases and trims the email before the guard sees it", async () => {
    let seen: unknown = null;
    const reader = createEmailAvailabilityReader({
      rpc: async (_name, args) => {
        seen = args.p_email;
        return { data: false, error: null };
      },
    });
    await reader.registeredElsewhere({ ...CALL, email: "  Clean@Northbridge.Example  " });
    assert.equal(seen, "clean@northbridge.example");
  });

  // The regression. Watched failing on the pre-fix tree, where the module threw `new Error(...)`:
  // `instanceof AppError` was false and the mapped status was 500.
  it("throws a mappable AppError when the read fails, so the route cannot answer an opaque 500", async () => {
    const reader = readerRejectingWith({ code: "42501", message: "permission denied" });

    const thrown = await reader
      .registeredElsewhere(CALL)
      .then(() => null)
      .catch((error: unknown) => error);

    assert.ok(
      thrown instanceof AppError,
      "a bare Error here is invisible to toHttpResponse and becomes an unmapped 500",
    );

    // Derived, not transcribed: whatever `errors.ts` maps this code to is what the route answers.
    const expected = new AppError("driver_unavailable", "probe").status;
    assert.equal(thrown.code, "driver_unavailable");
    assert.equal(toHttpResponse(thrown).status, expected);
    assert.notEqual(toHttpResponse(thrown).status, 500);
  });

  it("treats a contract-breaking shape the same way, since the guard is equally unreadable", async () => {
    // `tenancy_email_registered_elsewhere` is declared `returns boolean`, so anything else means the
    // guard did not answer — indistinguishable, for the caller, from the read having failed.
    for (const data of [null, undefined, "true", 1, {}]) {
      const reader = createEmailAvailabilityReader({
        rpc: async () => ({ data: data as never, error: null }),
      });
      const thrown = await reader
        .registeredElsewhere(CALL)
        .then(() => null)
        .catch((error: unknown) => error);
      assert.ok(thrown instanceof AppError, `shape ${String(data)} escaped as an unmapped throw`);
      assert.notEqual(toHttpResponse(thrown).status, 500);
    }
  });

  it("fails closed — a failed read never resolves to a permissive answer", async () => {
    // The guard exists to stop an email registering across orgs. If an unreadable guard resolved
    // `false`, an outage would silently disable it, which is worse than refusing the enrollment.
    const reader = readerRejectingWith(new Error("network"));
    const settled = await reader.registeredElsewhere(CALL).then(
      () => "resolved",
      () => "rejected",
    );
    assert.equal(settled, "rejected");
  });
});
