import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { stripComments } from "@/lib/testing/strip-comments";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = stripComments(readFileSync(path.join(here, "consumer.tsx"), "utf8"));

describe("consumer signed agreement control", () => {
  it("renders only for signed metadata on the current durable enrollment", () => {
    assert.match(
      source,
      /signedAgreementDownloadAvailable\s*=\s*enrollment !== null && agreementSignedAt !== null/,
    );
    const rows = source.slice(
      source.indexOf("const agreementRows ="),
      source.indexOf("return (", source.indexOf("const agreementRows =")),
    );
    const serviceAgreementRow = rows.slice(0, rows.indexOf("download: durableWorkspace"));
    assert.match(serviceAgreementRow, /download: signedAgreementDownloadAvailable \? "signed" : "none"/);
    assert.doesNotMatch(
      serviceAgreementRow,
      /demo|downloadDemoDocument/,
      "the signed agreement row must not invent a fixture download",
    );
  });

  it("downloads through the scoped endpoint and never substitutes local content", () => {
    const method = source.slice(
      source.indexOf("async function downloadSignedAgreement"),
      source.indexOf("function openFilePicker", source.indexOf("async function downloadSignedAgreement")),
    );
    assert.match(method, /if \(!enrollment \|\| !agreementSignedAt/);
    assert.match(method, /\/api\/enrollments\/\$\{enrollment\.enrollmentId\}\/agreement/);
    assert.match(method, /await response\.blob\(\)/);
    assert.match(method, /content-disposition/i);
    assert.doesNotMatch(method, /downloadDemoDocument|new Blob/);
    assert.match(source, /aria-label="Download signed service agreement"/);
  });
});
