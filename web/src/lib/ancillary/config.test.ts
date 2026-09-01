import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getAuthenticatedAncillaryConfig, trainingAttestationText } from "./config.ts";

describe("ancillary config", () => {
  it("is inert and unavailable under an empty environment", () => {
    assert.deepEqual(getAuthenticatedAncillaryConfig("consumer", {}), {
      enabled: false,
      consoleOpsEnabled: false,
      attestationAvailable: false,
      platformTrainingsUrl: null,
      northwestPartnerUrl: null,
    });
  });

  it("requires both parent and console flags for console capability", () => {
    assert.equal(getAuthenticatedAncillaryConfig("operator_member", { FEATURE_CONSOLE_OPS: "true" }).consoleOpsEnabled, false);
    assert.equal(getAuthenticatedAncillaryConfig("operator_member", { FEATURE_ANCILLARY: "true" }).consoleOpsEnabled, false);
    assert.equal(getAuthenticatedAncillaryConfig("operator_member", { FEATURE_ANCILLARY: "true", FEATURE_CONSOLE_OPS: "true" }).consoleOpsEnabled, true);
  });

  it("returns exact text only to operator and admin roles", () => {
    const env = { TRAINING_ATTESTATION_TEXT: "  Approved exact copy.  " };
    assert.equal(getAuthenticatedAncillaryConfig("operator_member", env).attestationText, "Approved exact copy.");
    assert.equal(getAuthenticatedAncillaryConfig("platform_admin", env).attestationText, "Approved exact copy.");
    assert.equal(getAuthenticatedAncillaryConfig("consumer", env).attestationText, undefined);
    assert.equal(getAuthenticatedAncillaryConfig("consumer", env).attestationAvailable, true);
    assert.equal(getAuthenticatedAncillaryConfig("affiliate", env).attestationText, undefined);
  });

  it("accepts only absolute HTTPS links without echoing invalid input", () => {
    const config = getAuthenticatedAncillaryConfig("platform_admin", {
      FEATURE_ANCILLARY: "true",
      PLATFORM_TRAININGS_URL: "https://example.test/training",
      NORTHWEST_PARTNER_URL: "http://private.invalid/path",
    });
    assert.equal(config.enabled, true);
    assert.equal(config.platformTrainingsUrl, "https://example.test/training");
    assert.equal(config.northwestPartnerUrl, null);
  });

  it("reads text lazily after runtime environment changes", () => {
    const previous = process.env.TRAINING_ATTESTATION_TEXT;
    try {
      delete process.env.TRAINING_ATTESTATION_TEXT;
      assert.equal(trainingAttestationText(), null);
      process.env.TRAINING_ATTESTATION_TEXT = "later approved copy";
      assert.equal(trainingAttestationText(), "later approved copy");
    } finally {
      if (previous === undefined) delete process.env.TRAINING_ATTESTATION_TEXT;
      else process.env.TRAINING_ATTESTATION_TEXT = previous;
    }
  });
});
