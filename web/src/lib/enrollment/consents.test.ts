import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  currentlyAuthorized,
  isAuthorized,
} from "@/lib/enrollment/consents";
import type {
  ConsentRow,
  RevocationRow,
} from "@/lib/enrollment/consents";

const older: ConsentRow = {
  id: "monitoring-old",
  kind: "monitoring",
  textVersion: "v1",
  signedAt: "2026-01-01T00:00:00Z",
};
const newer: ConsentRow = {
  id: "monitoring-new",
  kind: "monitoring",
  textVersion: "v2",
  signedAt: "2026-02-01T00:00:00Z",
};

function revoked(consent: ConsentRow): RevocationRow {
  return {
    consentId: consent.id,
    kind: consent.kind,
    revokedAt: "2026-03-01T00:00:00Z",
  };
}

describe("current consent authorization", () => {
  it("authorizes a consent with no revocation", () => {
    assert.equal(isAuthorized("monitoring", [older], []), true);
  });

  it("does not authorize a revoked consent", () => {
    assert.equal(isAuthorized("monitoring", [older], [revoked(older)]), false);
  });

  it("a newer consent restores authorization after an older revocation", () => {
    assert.equal(
      isAuthorized("monitoring", [older, newer], [revoked(older)]),
      true,
    );
  });

  it("a revoked latest consent decides even when an older row is live", () => {
    assert.equal(
      isAuthorized("monitoring", [older, newer], [revoked(newer)]),
      false,
    );
  });

  it("revoking one consent kind leaves the other kind authorized", () => {
    const analysis: ConsentRow = {
      id: "analysis-current",
      kind: "analysis",
      textVersion: "v1",
      signedAt: "2026-01-15T00:00:00Z",
    };
    assert.deepEqual(
      currentlyAuthorized([older, analysis], [revoked(analysis)]),
      ["monitoring"],
    );
  });
});
