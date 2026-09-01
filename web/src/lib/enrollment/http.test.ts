import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { toHttpResponse } from "./errors.ts";
import { readEnrollmentJson } from "./http.ts";

describe("enrollment route JSON reader", () => {
  it("maps malformed JSON to the shared 400 response", async () => {
    const request = new Request("http://local.test/api/enroll", {
      body: "{",
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    let thrown: unknown;
    try {
      await readEnrollmentJson(request);
    } catch (error) {
      thrown = error;
    }
    const response = toHttpResponse(thrown);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "invalid_payload");
  });

  it("is used by every JSON-writing enrollment route", async () => {
    const files = [
      "src/app/api/enroll/route.ts",
      "src/app/api/enrollments/[id]/idv/route.ts",
      "src/app/api/enrollments/[id]/reauthorize-consent/route.ts",
      "src/app/api/enrollments/[id]/revoke-consent/route.ts",
    ];
    for (const file of files) {
      const source = await readFile(new URL(`../../../${file}`, import.meta.url), "utf8");
      assert.match(source, /readEnrollmentJson\(request\)/, file);
      assert.doesNotMatch(source, /await request\.json\(\)/, file);
    }
  });

  it("validates every enrollment path id before its mutation", async () => {
    const files = [
      ["src/app/api/enrollments/[id]/cancel/route.ts", "cancelEnrollment(id, actor)"],
      ["src/app/api/enrollments/[id]/idv/route.ts", "reconcile(id, actor)"],
      ["src/app/api/enrollments/[id]/reauthorize-consent/route.ts", "const view = await reauthorizeConsent("],
      ["src/app/api/enrollments/[id]/revoke-consent/route.ts", "revokeConsent(id, body.kind, actor)"],
    ] as const;
    for (const [file, mutationCall] of files) {
      const source = await readFile(new URL(`../../../${file}`, import.meta.url), "utf8");
      const validation = source.indexOf("parseEnrollmentId((await context.params).id)");
      const mutation = source.indexOf(mutationCall);
      assert.ok(validation >= 0 && mutation > validation, file);
    }
  });

  it("stop routes never run general reconciliation before persisting the request", async () => {
    for (const file of [
      "src/app/api/enrollments/[id]/cancel/route.ts",
      "src/app/api/enrollments/[id]/revoke-consent/route.ts",
    ]) {
      const source = await readFile(new URL(`../../../${file}`, import.meta.url), "utf8");
      assert.doesNotMatch(source, /\breconcile\b/, file);
    }
  });
});
