import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { canonicalizeSourceArticle, checksumSourceArticle, validateSourceArticle } from "./checksum.ts";
import { FIXTURE_KB_ARTICLES } from "./fixture-source.ts";

describe("KB checksum", () => {
  it("canonicalizes line endings and metadata order deterministically", () => {
    const source = FIXTURE_KB_ARTICLES[0];
    const reordered = { ...source, body: source.body.replace(/ /, "\r\n"), metadata: { tags: ["entity", "records"], section: "foundation", category: "business" } };
    const normalized = { ...source, body: source.body.replace(/ /, "\n") };
    assert.equal(canonicalizeSourceArticle(reordered), canonicalizeSourceArticle(normalized));
    assert.equal(checksumSourceArticle(reordered), checksumSourceArticle(normalized));
    assert.match(checksumSourceArticle(source), /^[0-9a-f]{64}$/);
  });

  it("changes the checksum when source content changes", () => {
    const source = FIXTURE_KB_ARTICLES[0];
    assert.notEqual(checksumSourceArticle(source), checksumSourceArticle({ ...source, title: `${source.title} updated` }));
  });

  it("rejects extra keys and invalid source values", () => {
    assert.throws(() => validateSourceArticle({ ...FIXTURE_KB_ARTICLES[0], clientId: "x" }), { code: "KB_INPUT_INVALID" });
    assert.throws(() => validateSourceArticle({ ...FIXTURE_KB_ARTICLES[0], sourceUrl: "javascript:bad" }), { code: "KB_INPUT_INVALID" });
  });
});
