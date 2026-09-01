import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("resolver awaits params and validates before repository access", () => {
  assert.match(source, /await context\.params/);
  assert.ok(source.indexOf("parseReferralToken") < source.indexOf("resolveConsumerReferral(parsedToken)"));
  assert.ok(source.indexOf("config.intakeOrigin") < source.indexOf("resolveConsumerReferral(parsedToken)"));
});

test("only success redirects and sets the opaque session cookie", () => {
  assert.match(source, /NextResponse\.redirect\(result\.intakeUrl, 303\)/);
  assert.match(source, /mf_referral_token/);
  assert.match(source, /httpOnly: true/);
  assert.match(source, /sameSite: "lax"/);
  assert.match(source, /Referrer-Policy/);
  const failure = source.slice(source.indexOf("function notFound"), source.indexOf("export async function GET"));
  assert.doesNotMatch(failure, /cookies\.set|Location/);
});
