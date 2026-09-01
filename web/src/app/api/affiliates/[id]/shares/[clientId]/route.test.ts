import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { PATCH } from "./route.ts";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const id = "21000000-0000-4000-8000-000000000001";

describe("affiliate annotation route", () => {
  it("returns an empty flag-off 404 before reading input or loading dependencies", async () => {
    const response = await PATCH(
      new Request("https://mf.test/api/affiliates/id/shares/client", {
        method: "PATCH",
        body: "not json",
      }),
      { params: Promise.resolve({ id, clientId: id }) },
    );
    assert.equal(response.status, 404);
    assert.equal(await response.text(), "");
    const gate = source.indexOf('featureFlag("FEATURE_AFFILIATES"');
    assert.ok(gate < source.indexOf("request.json()"));
    assert.ok(gate < source.indexOf('import("@/lib/auth/session")'));
  });

  it("awaits both ids and uses only the closed patch service", () => {
    assert.match(source, /params: Promise<\{ id: string; clientId: string \}>/);
    assert.match(source, /await context\.params/);
    assert.match(source, /requireRole\("operator_member"\)/);
    assert.match(source, /parseUpdateShareBody\(body\)/);
    assert.match(source, /updateShare\(affiliateId, parsedClientId, patch\)/);
    assert.doesNotMatch(source, /RouteContext|\.from\(|\.rpc\(/);
  });
});
