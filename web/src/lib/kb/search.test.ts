import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Float8ArrayEmbeddingIndex } from "./search.ts";

describe("KB search", () => {
  it("uses the search RPC, clamps the limit, and maps the closed projection", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const index = new Float8ArrayEmbeddingIndex({ async rpc(name, args) { calls.push({ name, args }); return { data: [{ id: "a", source_article_id: "s", title: "T", body: "B", source_url: "https://example.test/a", metadata: { category: "basics" }, similarity: "0.9" }], error: null }; } });
    assert.deepEqual(await index.search([1, 0], 99), [{ id: "a", sourceArticleId: "s", title: "T", body: "B", sourceUrl: "https://example.test/a", metadata: { category: "basics" }, similarity: 0.9 }]);
    assert.deepEqual(calls, [{ name: "search_kb_articles", args: { p_embedding: [1, 0], p_limit: 8 } }]);
  });

  it("fails closed on repository errors", async () => {
    const index = new Float8ArrayEmbeddingIndex({ async rpc() { return { data: null, error: { code: "XX000" } }; } });
    await assert.rejects(index.search([0], 0), /KB_REPOSITORY_FAILED/);
  });
});
