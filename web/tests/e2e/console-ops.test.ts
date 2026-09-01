import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const operator = readFileSync(new URL("../../src/components/surfaces/operator.tsx", import.meta.url), "utf8");
const apiVerifier = readFileSync(new URL("../../scripts/verify-console-ops-api.mjs", import.meta.url), "utf8");

describe("console ops acceptance harness", () => {
  it("requires persisted reads after both client status writes", () => {
    assert.match(apiVerifier, /status,archived_at,archived_by/);
    assert.match(apiVerifier, /restoreAudits\.data\?\.length, 2/);
    assert.match(apiVerifier, /afterArchive\.value\.clients\.some/);
  });

  it("requires persisted training reset and visible reason evidence", () => {
    assert.match(apiVerifier, /published,published_at,published_by,attested,attested_at,attestation_text/);
    assert.match(apiVerifier, /takedown_reason,taken_down_by,taken_down_at/);
    assert.match(apiVerifier, /visiblePlatform\.takedownReason/);
  });

  it("keeps both visual additions behind server-returned capabilities", () => {
    assert.match(operator, /trackerClients\.consoleOpsEnabled/);
    assert.match(operator, /ancillaryConfig\?\.consoleOpsEnabled && training\.takedownReason/);
    assert.doesNotMatch(operator, /FEATURE_CONSOLE_OPS|process\.env/);
  });
});
