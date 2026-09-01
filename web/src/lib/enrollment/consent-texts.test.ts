import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CONSENT_DOCUMENTS,
  currentVersion,
  documentForVersion,
} from "@/lib/enrollment/consent-texts";
import { CRS_SPEC_REPORT_RETENTION_MONTHS } from "@/lib/crs/spec-catalog";

const agreement = CONSENT_DOCUMENTS.enrollment_agreement.body
  .join(" ")
  .toLowerCase();

describe("versioned consent documents", () => {
  it("discloses provider retention separately from our derived-only storage", () => {
    const monitoring = CONSENT_DOCUMENTS.monitoring.body.join(" ");
    assert.match(monitoring, new RegExp(`${CRS_SPEC_REPORT_RETENTION_MONTHS} months?`, "i"));
    assert.match(monitoring, /provider/i);
    assert.match(monitoring, /we (?:do not|don't) store the (?:raw|underlying) (?:report|credit file)/i);
  });
  it("states the agreement to initiate recurring payments", () => {
    assert.ok(agreement.includes("authorize us to charge"));
    assert.ok(agreement.includes("recurring monthly"));
  });

  it("states the anticipated payment timing and frequency", () => {
    assert.ok(agreement.includes("identity check passes"));
    assert.ok(agreement.includes("same day each month"));
  });

  it("states how the payment amount is determined", () => {
    assert.ok(agreement.includes("the amount is"));
    assert.ok(agreement.includes("price shown to you before you sign"));
  });

  it("states how future recurring payments can be stopped", () => {
    assert.ok(agreement.includes("cancel"));
    assert.ok(agreement.includes("stops all future charges"));
  });

  it("states the monthly and alert-triggered analysis scope", () => {
    const analysis = CONSENT_DOCUMENTS.analysis.body.join(" ").toLowerCase();
    assert.ok(analysis.includes("recurring monthly"));
    assert.ok(analysis.includes("monitoring alert"));
    assert.ok(analysis.includes("until you withdraw"));
  });

  it("resolves every current version to its registered document", () => {
    for (const [key, document] of Object.entries(CONSENT_DOCUMENTS)) {
      assert.equal(
        currentVersion(key as keyof typeof CONSENT_DOCUMENTS),
        document.version,
      );
      assert.equal(documentForVersion(document.version), document);
    }
  });

  it("throws when a retained version has no registered text", () => {
    assert.throws(() => documentForVersion("no-such-version"));
  });

  it("keeps every document inside the approved vocabulary", () => {
    const forbidden = [
      "dis" + "pute",
      [6, 0, 9].join(""),
      "pay" + "-for-delete",
      "remo" + "val",
      "credit" + " repair",
      "good" + "will letter",
    ];
    for (const document of Object.values(CONSENT_DOCUMENTS)) {
      const body = document.body.join(" ").toLowerCase();
      for (const term of forbidden) assert.ok(!body.includes(term));
    }
  });

  it("describes authorization without a zero-dollar promise", () => {
    assert.ok(!agreement.includes("$0"));
    assert.ok(agreement.includes("temporary hold"));
    assert.ok(agreement.includes("never taken"));
  });
});
