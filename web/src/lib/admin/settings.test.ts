import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  GOVERNED_SETTING_KEYS,
  resolveGovernedEnv,
  resolveGovernedForcePullPrice,
  resolveGovernedInteger,
} from "./settings.ts";

import type { GovernedSettingKey, SettingsReadRepository } from "./settings-types.ts";

const NOW = "2026-08-17T00:00:00.000Z";
const row = (key: GovernedSettingKey, value: number) => ({ key, value, updatedBy: null, updatedAt: NOW });

describe("admin settings", () => {
  it("keeps the closed four-key allow-list free of flags and gate controls", () => {
    assert.deepEqual([...GOVERNED_SETTING_KEYS], [
      "SUPPORT_DRAFT_CONFIDENCE_THRESHOLD",
      "TRIAL_DAYS",
      "OPERATOR_GRACE_DAYS",
      "FORCE_PULL_PRICE_CENTS",
    ]);
    assert.equal(GOVERNED_SETTING_KEYS.some((key) => key.startsWith("FEATURE_")), false);
    assert.equal(GOVERNED_SETTING_KEYS.some((key) => /gate|supervisor|evaluator/i.test(key)), false);
  });

  it("returns the original env and performs no read while admin governance is off", async () => {
    const fallback = Object.freeze({ FORCE_PULL_PRICE_CENTS: "2100" });
    let reads = 0;
    const repository: SettingsReadRepository = { async read() { reads += 1; return []; } };
    assert.equal(await resolveGovernedEnv(["FORCE_PULL_PRICE_CENTS"], fallback, repository), fallback);
    assert.equal(reads, 0);
  });

  it("overlays present rows and preserves absent env values in one repository read", async () => {
    let reads = 0;
    const repository: SettingsReadRepository = {
      async read(keys) {
        reads += 1;
        assert.deepEqual(keys, ["TRIAL_DAYS", "FORCE_PULL_PRICE_CENTS"]);
        return [row("TRIAL_DAYS", 21)];
      },
    };
    const result = await resolveGovernedEnv(
      ["TRIAL_DAYS", "FORCE_PULL_PRICE_CENTS"],
      { FEATURE_ADMIN: "true", TRIAL_DAYS: "14", FORCE_PULL_PRICE_CENTS: "2300" },
      repository,
    );
    assert.equal(result.TRIAL_DAYS, "21");
    assert.equal(result.FORCE_PULL_PRICE_CENTS, "2300");
    assert.equal(reads, 1);
    assert.equal(Object.isFrozen(result), true);
  });

  it("reads afresh on consecutive calls", async () => {
    let value = 20;
    const repository: SettingsReadRepository = { async read() { return [row("TRIAL_DAYS", value++)]; } };
    const env = { FEATURE_ADMIN: "true" };
    assert.equal((await resolveGovernedEnv(["TRIAL_DAYS"], env, repository)).TRIAL_DAYS, "20");
    assert.equal((await resolveGovernedEnv(["TRIAL_DAYS"], env, repository)).TRIAL_DAYS, "21");
  });

  it("fails closed for malformed, duplicate, or unexpected present rows", async () => {
    const env = { FEATURE_ADMIN: "true" };
    await assert.rejects(
      resolveGovernedEnv(["TRIAL_DAYS"], env, { async read() { return [{ ...row("TRIAL_DAYS", 14), value: 1.5 }]; } }),
      { message: "ADMIN_SETTINGS_RESULT_INVALID" },
    );
    await assert.rejects(
      resolveGovernedEnv(["TRIAL_DAYS"], env, { async read() { return [row("TRIAL_DAYS", 14), row("TRIAL_DAYS", 21)]; } }),
      { message: "ADMIN_SETTINGS_RESULT_INVALID" },
    );
  });

  it("exports typed integer and governed force-pull readers", async () => {
    const repository: SettingsReadRepository = { async read(keys) { return [row(keys[0], keys[0] === "TRIAL_DAYS" ? 30 : 2500)]; } };
    const env = { FEATURE_ADMIN: "true", TRIAL_DAYS: "14", FORCE_PULL_PRICE_CENTS: "1900" };
    assert.equal(await resolveGovernedInteger("TRIAL_DAYS", env, repository), 30);
    assert.equal((await resolveGovernedForcePullPrice(env, repository)).FORCE_PULL_PRICE_CENTS, "2500");
  });
});
