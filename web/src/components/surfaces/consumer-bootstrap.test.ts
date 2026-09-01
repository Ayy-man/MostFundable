import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import {
  loadAncillaryBootstrap,
  loadEnrollmentBootstrap,
} from "./consumer-bootstrap";

const CONSUMER_SOURCE = new URL("./consumer.tsx", import.meta.url);
const ONBOARDING_SOURCE = new URL("../onboarding1.tsx", import.meta.url);
const BOOTSTRAP_SOURCE = new URL("./consumer-bootstrap.ts", import.meta.url);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("ancillary bootstrap classification (R4B-03)", () => {
  it("treats a 503 as unavailable rather than disabled", async () => {
    const result = await loadAncillaryBootstrap(async () =>
      jsonResponse({ error: "down" }, 503),
    );
    assert.deepEqual(result, { state: "unavailable" });
  });

  it("treats a network failure as unavailable", async () => {
    const result = await loadAncillaryBootstrap(async () => {
      throw new Error("offline");
    });
    assert.deepEqual(result, { state: "unavailable" });
  });

  it("treats an unparseable 200 body as unavailable", async () => {
    const result = await loadAncillaryBootstrap(async () =>
      new Response("<html>gateway</html>", {
        headers: { "content-type": "text/html" },
        status: 200,
      }),
    );
    assert.deepEqual(result, { state: "unavailable" });
  });

  it("treats a payload with no enabled field as unavailable", async () => {
    const result = await loadAncillaryBootstrap(async () =>
      jsonResponse({ northwestPartnerUrl: null }),
    );
    assert.deepEqual(result, { state: "unavailable" });
  });

  it("selects the fixture path only for an explicit disabled payload", async () => {
    const result = await loadAncillaryBootstrap(async () =>
      jsonResponse({ enabled: false, northwestPartnerUrl: null, platformTrainingsUrl: null }),
    );
    assert.deepEqual(result, { state: "disabled" });
  });

  it("carries the live config through on an enabled payload", async () => {
    const result = await loadAncillaryBootstrap(async () =>
      jsonResponse({
        attestationAvailable: true,
        enabled: true,
        northwestPartnerUrl: "https://partner.example/start",
        platformTrainingsUrl: null,
      }),
    );
    assert.deepEqual(result, {
      config: {
        enabled: true,
        northwestPartnerUrl: "https://partner.example/start",
        platformTrainingsUrl: null,
      },
      state: "ready",
    });
  });
});

describe("enrollment bootstrap classification (R4B-02)", () => {
  const READY = {
    currency: "usd",
    enabled: true,
    idvDriver: "mock",
    priceCents: 4900,
  };

  it("treats a failed request as unavailable rather than disabled", async () => {
    const result = await loadEnrollmentBootstrap(async () => ({
      code: "http_503",
      message: "Something went wrong. Try that step again.",
      ok: false,
    }));
    assert.deepEqual(result, { state: "unavailable" });
  });

  it("treats a network failure as unavailable", async () => {
    const result = await loadEnrollmentBootstrap(async () => ({
      code: "network",
      message: "Could not reach the server. Check your connection and try again.",
      ok: false,
    }));
    assert.deepEqual(result, { state: "unavailable" });
  });

  it("treats the malformed-body success getJson reports as unavailable", async () => {
    // `getJson` maps an unparseable payload to `{ ok: true, data: null }`.
    const result = await loadEnrollmentBootstrap(async () => ({
      data: null as unknown as typeof READY,
      ok: true,
    }));
    assert.deepEqual(result, { state: "unavailable" });
  });

  it("treats a payload with no enabled field as unavailable", async () => {
    const result = await loadEnrollmentBootstrap(async () => ({
      data: { currency: "usd", idvDriver: "mock", priceCents: 4900 } as typeof READY,
      ok: true,
    }));
    assert.deepEqual(result, { state: "unavailable" });
  });

  it("selects the fixture path only for an explicit disabled payload", async () => {
    const result = await loadEnrollmentBootstrap(async () => ({
      data: { ...READY, enabled: false },
      ok: true,
    }));
    assert.deepEqual(result, { state: "disabled" });
  });

  it("carries the live config through on an enabled payload", async () => {
    const result = await loadEnrollmentBootstrap(async (path) => {
      assert.equal(path, "/api/enroll");
      return { data: READY, ok: true };
    });
    assert.deepEqual(result, { config: READY, state: "ready" });
  });
});

describe("consumer surface bootstrap wiring (R4B-02, R4B-03, R4D-04)", () => {
  it("routes both bootstraps through the four-state loaders", async () => {
    const source = await readFile(CONSUMER_SOURCE, "utf8");
    assert.match(source, /void loadAncillaryBootstrap\(\)\.then/);
    assert.match(source, /void loadEnrollmentBootstrap\(\)\.then/);
    // The nullable bootstrap that read every failure as flag-off is gone.
    assert.doesNotMatch(source, /getJson<EnrollConfig>\("\/api\/enroll"\)/);
    assert.doesNotMatch(source, /fetch\("\/api\/trainings\/config"\)/);
  });

  it("runs each local fixture branch only on an explicit disabled bootstrap", async () => {
    const source = await readFile(CONSUMER_SOURCE, "utf8");
    assert.match(source, /if \(!ancillaryFixture \|\| uploadingCategory\) return;/);
    // Re-pinned by the Tier-2 eviction lane. The refusal is unchanged; what it does on the way out
    // is not. `enrollFixture` now also requires the fixture shell, so a signed-in consumer with
    // the enrollment bootstrap off reaches this arm — and a Cancel control that returns silently
    // is worse than one that names its reason.
    assert.match(
      source,
      /if \(!enrollFixture\) \{\s+setCancelOpen\(false\);\s+notify\(CANCELLATION_UNAVAILABLE\);\s+return;\s+\}\s+setCancelOpen\(false\);\s+setCanceled\(true\);/,
    );
    assert.match(source, /const enrollFixture = enrollState === "disabled" && !durableWorkspace;/);
  });

  it("refuses cancellation and consent revocation while the record is not loaded", async () => {
    const source = await readFile(CONSUMER_SOURCE, "utf8");
    assert.match(
      source,
      /async function confirmCancellation\(\) \{\s+if \(enrollPending\) \{[\s\S]*?notify\(ENROLLMENT_UNAVAILABLE_NOTICE\);\s+return;/,
    );
    assert.match(
      source,
      /async function revokeConsent\(\) \{\s+if \(enrollPending\) \{[\s\S]*?notify\(ENROLLMENT_UNAVAILABLE_NOTICE\);\s+return;/,
    );
    // The cancel control gained a third reason to be off — a durable account with no subscription
    // row has nothing to cancel — but `enrollmentPending` staying in the disjunction is the
    // property this test exists for.
    assert.match(source, /disabled=\{canceled \|\| enrollmentPending \|\| \(billingDurable && subscription === null\)\}/);
    const notices = await readFile(BOOTSTRAP_SOURCE, "utf8");
    assert.match(notices, /ENROLLMENT_UNAVAILABLE_NOTICE =\s+"Your subscription record could not be loaded, so nothing was changed/);
  });

  it("refuses file selection while the ancillary bootstrap is not loaded", async () => {
    const source = await readFile(CONSUMER_SOURCE, "utf8");
    assert.match(source, /if \(ancillaryPending\) \{\s+event\.target\.value = "";/);
    // Re-pinned by the Tier-2 eviction lane: the control gained a third reason to be off — with
    // the ancillary set switched off on a durable account there is no vault to add to, and the
    // fixture files that used to fill it belong to somebody else. `ancillaryPending` staying in
    // the disjunction is the property this test exists for.
    assert.match(source, /disabled=\{uploadingCategory !== null \|\| ancillaryPending \|\| documentsOff\}/);
    const notices = await readFile(BOOTSTRAP_SOURCE, "utf8");
    assert.match(notices, /ANCILLARY_UNAVAILABLE_NOTICE =\s+"The document service could not be reached, so nothing can be stored/);
  });

  it("hydrates the cancelled status and drives both controls from it", async () => {
    const source = await readFile(CONSUMER_SOURCE, "utf8");
    // R5D-03 moved the mask into `consentStateFromView`, shared with the cancel success callback,
    // because two copies of it are what let the sibling path drift. The property the regex used to
    // pin is now asserted behaviourally in `consumer-cancel.test.ts`; what stays here is that the
    // hydration path still routes through the one derivation.
    assert.match(source, /const state = consentStateFromView\(current\);/);
    assert.match(source, /setCanceled\(state\.canceled\);/);
    assert.match(source, /setMonitoringActive\(state\.monitoringActive\);/);
    assert.match(source, /setAnalysisActive\(state\.analysisActive\);/);
    // The grants stay visible as retained history rather than as live permissions.
    assert.match(source, /const cancelledEnrollment = enrollment\?\.status === "cancelled";/);
    assert.match(source, /cancelledEnrollment && monitoringGranted \? "Retained"/);
  });

  it("carries no fixed derived-data deletion date", async () => {
    const source = await readFile(CONSUMER_SOURCE, "utf8");
    assert.doesNotMatch(source, /deletion is scheduled by Aug/);
    assert.doesNotMatch(source, /scheduled for deletion by Aug/);
    assert.equal(source.match(/derived data deletion is scheduled within 30 days/g)?.length, 1);
    assert.equal(source.match(/scheduled for deletion within 30 days/g)?.length, 3);
  });
});

// Swept sibling. `Onboarding1` holds its own `/api/enroll` read, so the surface fix alone still
// leaves a failed request routing consent, e-signature, card authorization and IDV into the local
// five-step demo, which persists nothing and ends on an "identity is verified, payment was taken"
// screen.
describe("onboarding flow bootstrap wiring (R4B-02, swept sibling)", () => {
  it("routes its own enrollment read through the four-state loader", async () => {
    const source = await readFile(ONBOARDING_SOURCE, "utf8");
    assert.match(source, /void loadEnrollmentBootstrap\(\)\.then/);
    assert.doesNotMatch(source, /getJson<EnrollConfig>\("\/api\/enroll"\)/);
    assert.doesNotMatch(source, /if \(!enroll\?\.enabled\)/);
  });

  it("refuses every enrollment step while the record is not loaded", async () => {
    const source = await readFile(ONBOARDING_SOURCE, "utf8");
    for (const setter of ["setSignatureError", "setPaymentError", "setCodeError"]) {
      assert.match(
        source,
        new RegExp(`if \\(enrollPending\\) \\{\\s+${setter}\\(ENROLLMENT_STEP_UNAVAILABLE_NOTICE\\);`),
        setter,
      );
    }
    // One guard per local-demo branch: signature, payment, code entry, knowledge check.
    assert.equal(source.match(/if \(enrollPending\) \{/g)?.length, 4);
    assert.equal(source.match(/if \(!enrollLive\) \{/g)?.length, 4);
  });

  it("disables each step control and offers a retry while the record is not loaded", async () => {
    const source = await readFile(ONBOARDING_SOURCE, "utf8");
    assert.match(source, /disabled=\{enrollPending \|\| pending === "sign"\}/);
    assert.match(source, /disabled=\{enrollPending \|\| \(!enrollLive && !paymentReady\) \|\| pending === "pay"\}/);
    assert.match(source, /disabled=\{enrollPending \|\| code\.length !== 6/);
    assert.match(source, /disabled=\{enrollPending \|\| pending === "verify"\}/);
    assert.match(source, /enrollState === "unavailable" \? \(/);
    assert.match(source, /setEnrollReloadToken\(\(current\) => current \+ 1\)/);
  });
});
