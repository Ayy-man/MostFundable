import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { handleAgreementDownload, type AgreementDownloadDependencies } from "./agreement-download.server.ts";

const ENROLLMENT = "00000000-0000-4000-8000-000000004077";
const artifact = {
  signedAt: "2026-08-30T14:20:00.000Z",
  signerName: "Jordan Newcomer",
  textVersion: "agreement-2026-08-16.1",
  typedSignature: "Jordan Newcomer",
};

function dependencies(read: AgreementDownloadDependencies["read"]): AgreementDownloadDependencies {
  return {
    read,
    async requireConsumer() { return { id: "00000000-0000-4000-8000-000000004071" }; },
  };
}

describe("consumer agreement download", () => {
  it("authenticates, scopes the read, and returns a private attachment", async () => {
    const calls: unknown[][] = [];
    const response = await handleAgreementDownload(ENROLLMENT, dependencies(async (...args) => {
      calls.push(args);
      return artifact;
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(calls, [[ENROLLMENT, "00000000-0000-4000-8000-000000004071"]]);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.match(response.headers.get("content-disposition") ?? "", /^attachment;/);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  });

  it("uses the same not-found response for absent and out-of-scope records", async () => {
    const response = await handleAgreementDownload(ENROLLMENT, dependencies(async () => null));
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, "agreement_not_found");
  });

  it("authenticates before validating the path", async () => {
    const calls: string[] = [];
    const response = await handleAgreementDownload("bad", {
      async read() { calls.push("read"); return artifact; },
      async requireConsumer() { calls.push("auth"); return { id: "consumer" }; },
    });
    assert.equal(response.status, 400);
    assert.deepEqual(calls, ["auth"]);
  });
});
