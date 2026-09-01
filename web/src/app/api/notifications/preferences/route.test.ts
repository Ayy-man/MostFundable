import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

describe("consumer notification preferences route boundary", () => {
  it("keeps GET and PATCH behind the notification feature before loading server dependencies", () => {
    assert.equal(source.match(/featureFlag\("FEATURE_ANCILLARY"\)/g)?.length, 2);
    const imports = [...source.matchAll(/handleConsumerNotificationPreferences(?:Get|Patch)/g)]
      .map((match) => match.index ?? -1);
    const guards = [...source.matchAll(/featureFlag\("FEATURE_ANCILLARY"\)/g)]
      .map((match) => match.index ?? -1);
    assert.ok(guards[0] < imports[0]);
    assert.ok(guards[1] < imports[2]);
  });

  it("requires same-origin PATCH before importing the mutation handler", () => {
    assert.ok(source.indexOf("sameOrigin(request)")
      < source.indexOf("handleConsumerNotificationPreferencesPatch"));
    assert.match(source, /Cache-Control": "private, no-store"/);
  });
});
