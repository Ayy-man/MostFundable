import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { agreementFilename, renderSignedAgreement } from "./agreement-download.ts";

const artifact = {
  signedAt: "2026-08-30T14:20:00.000Z",
  signerName: "Jordan <script>alert(1)</script>",
  textVersion: "agreement-2026-08-16.1",
  typedSignature: "Jordan & Newcomer",
};

describe("signed agreement artifact", () => {
  it("renders the retained version and electronic signature without executable markup", () => {
    const html = renderSignedAgreement(artifact);
    assert.match(html, /Service agreement and payment authorization/);
    assert.match(html, /agreement-2026-08-16\.1/);
    assert.match(html, /Jordan &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(html, /Jordan &amp; Newcomer/);
    assert.doesNotMatch(html, /<script>/);
  });

  it("uses the immutable signing day in the download name", () => {
    assert.equal(agreementFilename(artifact.signedAt), "mostfundable-service-agreement-2026-08-30.html");
  });

  it("refuses a consent document that is not the service agreement", () => {
    assert.throws(() => renderSignedAgreement({ ...artifact, textVersion: "analysis-2026-08-16.1" }), /AGREEMENT_VERSION_INVALID/);
  });
});
