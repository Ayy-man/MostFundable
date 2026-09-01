import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertPullAllowed, setPullCap, type PullCause } from "./pull-caps.ts";
import type { AncillaryRepository } from "./repository.ts";

const CLIENT = "17000000-0000-4000-8000-000000000101";
const SOURCE = "17000000-0000-4000-8000-000000000102";
const ACTOR = "17000000-0000-4000-8000-000000000103";
function repo(overrides: Partial<AncillaryRepository>): AncillaryRepository { return overrides as AncillaryRepository; }

describe("pull cap service", () => {
  it("allows every cause without database access while ancillary is off", async () => {
    for (const cause of ["scheduled", "alert", "upload", "force_pull"] satisfies PullCause[]) {
      let calls = 0;
      assert.deepEqual(await assertPullAllowed(CLIENT, cause, SOURCE, { env: {}, repository: repo({ async assertPullAllowed() { calls += 1; return { allowed: false, reason: "count_window" }; } }) }), { allowed: true });
      assert.equal(calls, 0);
    }
  });

  it("maps only fixed allowed and blocked results and propagates failures", async () => {
    assert.deepEqual(await assertPullAllowed(CLIENT, "alert", SOURCE, { env: { FEATURE_ANCILLARY: "true" }, repository: repo({ async assertPullAllowed() { return { allowed: false, reason: "minimum_interval" }; } }) }), { allowed: false, reason: "minimum_interval" });
    await assert.rejects(() => assertPullAllowed(CLIENT, "alert", SOURCE, { env: { FEATURE_ANCILLARY: "true" }, repository: repo({ async assertPullAllowed() { throw new Error("db down"); } }) }), /db down/);
    await assert.rejects(() => assertPullAllowed(CLIENT, "alert", SOURCE, { env: { FEATURE_ANCILLARY: "true" }, repository: repo({ async assertPullAllowed() { return { allowed: true, reason: "count_window" }; } }) }), /PULL_CAP_RESULT_INVALID/);
  });

  it("validates the paired count window before writing", async () => {
    let calls = 0;
    await assert.rejects(() => setPullCap({ id: ACTOR, role: "platform_admin" }, { clientId: CLIENT, minIntervalSeconds: null, maxCount: 2, countWindowSeconds: null }, repo({ async setPullCap() { calls += 1; throw new Error("unexpected"); } })), /PULL_CAP_INPUT_INVALID/);
    assert.equal(calls, 0);
  });
});
