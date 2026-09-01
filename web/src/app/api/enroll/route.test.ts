import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { GET } from "./route.ts";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

describe("enrollment affiliate bootstrap", () => {
  it("preserves the exact flag-off bootstrap shape", async () => {
    const response = await GET(new Request("https://mf.test/api/enroll?aff=ignored"));
    const body = await response.json() as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), ["currency", "enabled", "idvDriver", "priceCents"]);
    assert.equal("affiliate" in body, false);
  });

  it("adds only code and boolean validity when the affiliate flag is on", () => {
    assert.match(source, /searchParams\.get\("aff"\)/);
    assert.match(source, /affiliate: null/);
    assert.match(source, /affiliate: \{ code, valid \}/);
    assert.match(source, /affiliateReferralValid\(code\)/);
    assert.match(source, /catch \{\s*valid = false;/);
    assert.doesNotMatch(source, /affiliate(Id|Name)|orgId|profile/);
  });

  it("keeps POST on the existing closed parser and service path", () => {
    const post = source.slice(source.indexOf("export async function POST"));
    assert.ok(post.indexOf("sameOrigin(request)") < post.indexOf("await Promise.all"));
    assert.match(post, /same_origin_required/);
    assert.match(post, /parseEnrollRequest\(await readEnrollmentJson\(request\)\)/);
    assert.match(post, /startEnrollment\(/);
    assert.doesNotMatch(post, /affiliateReferralValid|shareClient|\.from\(|\.rpc\(/);
  });
});
