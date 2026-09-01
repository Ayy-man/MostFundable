import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("public legal and recovery surfaces", () => {
  it("links sign-in to password recovery and both legal pages", () => {
    const source = read("./sign-in/sign-in-form.tsx");
    assert.match(source, /href="\/forgot-password"/);
    assert.match(source, /href="\/terms"/);
    assert.match(source, /href="\/privacy"/);
  });

  it("routes recovery OTPs to the password form regardless of next", () => {
    const source = read("./api/auth/confirm/route.ts");
    assert.match(source, /otpType === "recovery"[\s\S]*RESET_PASSWORD_PATH/);
  });

  it("publishes substantive terms and privacy content", () => {
    const terms = read("./terms/page.tsx");
    const privacy = read("./privacy/page.tsx");
    assert.match(terms, /not a lender/);
    assert.match(terms, /Acceptable use/);
    assert.match(privacy, /does not store raw bureau reports/);
    assert.match(privacy, /Retention and deletion/);
  });
});
