import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { GET as roster } from "./route.ts";
import { PATCH as update } from "./[id]/route.ts";
import { GET as statement } from "./[id]/statement/route.ts";

const ID = "21000000-0000-4000-8000-000000000101";
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("operator affiliate lifecycle routes", () => {
  it("keeps all three routes opaque before the affiliate feature is enabled", async () => {
    const responses = await Promise.all([
      roster(),
      update(new Request(`https://mf.test/api/affiliates/${ID}`, {
        body: "not json",
        method: "PATCH",
      }), { params: Promise.resolve({ id: ID }) }),
      statement(new Request(`https://mf.test/api/affiliates/${ID}/statement`), {
        params: Promise.resolve({ id: ID }),
      }),
    ]);
    for (const response of responses) {
      assert.equal(response.status, 404);
      assert.equal(await response.text(), "");
    }
  });

  it("requires an operator and the tenant wall before any roster or statement read", () => {
    for (const source of [read("./route.ts"), read("./[id]/statement/route.ts")]) {
      assert.match(source, /requireRole\("operator_member"\)/);
      assert.match(source, /assertTenantAccessAllowed\(session, "own-book-read"\)/);
      assert.ok(source.indexOf("requireRole") < source.indexOf("getOperatorAffiliate"));
      assert.doesNotMatch(source, /\.from\(|\.rpc\(/);
    }
  });

  it("limits commercial and lifecycle changes to owner/admin through the write wall", () => {
    const source = read("./[id]/route.ts");
    assert.match(source, /assertTenantWriteAllowed\(session\)/);
    assert.match(source, /session\.orgRole !== "owner" && session\.orgRole !== "admin"/);
    assert.match(source, /parseAffiliateLifecyclePatch\(body\)/);
    assert.match(source, /updateOperatorAffiliate\(affiliateId, patch\)/);
    assert.doesNotMatch(source, /\.from\(|\.rpc\(/);
  });
});
