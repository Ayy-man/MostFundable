import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

describe("unbound consumer page", () => {
  it("renders a stable pending workspace instead of the not-found path", async () => {
    const page = await readFile(new URL("./page.tsx", import.meta.url), "utf8");
    assert.match(page, /applicationContext === null\) return <ConsumerPendingPage/);
    assert.doesNotMatch(page, /notFound\(/);

    const pending = await readFile(new URL("./pending.tsx", import.meta.url), "utf8");
    assert.match(pending, /Your workspace is being prepared/);
    assert.match(pending, /no client workspace has been assigned/);
  });
});
