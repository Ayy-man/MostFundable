import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deterministicEmbedding, EMBEDDING_DIMENSION } from "./embedding.ts";

describe("KB embedding", () => {
  it("returns a repeatable finite unit vector", () => {
    const first = deterministicEmbedding("current business records and bank statements");
    const second = deterministicEmbedding("current business records and bank statements");
    assert.deepEqual(first, second);
    assert.equal(first.length, EMBEDDING_DIMENSION);
    assert.ok(first.every(Number.isFinite));
    assert.ok(Math.abs(Math.sqrt(first.reduce((sum, item) => sum + item * item, 0)) - 1) < 1e-12);
  });

  it("pins a stable vector prefix and rejects empty text", () => {
    assert.deepEqual(deterministicEmbedding("alpha beta").slice(0, 8), [0, 0, 0, 0, 0, 0, 0, 0]);
    assert.throws(() => deterministicEmbedding(" \n "), { code: "KB_INPUT_INVALID" });
  });
});
