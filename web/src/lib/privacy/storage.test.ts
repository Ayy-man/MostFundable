import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createPrivacyStorage } from "./storage.ts";

const PATH = "41600000-0000-4000-8000-000000000010/41600000-0000-4000-8000-000000000011/41600000-0000-4000-8000-000000000012/source.pdf";

describe("privacy storage", () => {
  it("uses only the server-selected private bucket and exact object path", async () => {
    const calls: unknown[] = [];
    const storage = createPrivacyStorage(() => ({
      storage: { from(bucket) { return {
        async list(path, options) { calls.push(["list", bucket, path, options]); return { data: [{ name: "source.pdf" }], error: null }; },
        async remove(paths) { calls.push(["remove", bucket, paths]); return { data: {}, error: null }; },
      }; } },
    }));
    const target = { bucket: "credit-reports" as const, objectPath: PATH };
    await storage.remove(target);
    assert.equal(await storage.exists(target), true);
    assert.deepEqual(calls, [
      ["remove", "credit-reports", [PATH]],
      ["list", "credit-reports", PATH.slice(0, PATH.lastIndexOf("/")), { limit: 2, search: "source.pdf" }],
    ]);
  });
});
