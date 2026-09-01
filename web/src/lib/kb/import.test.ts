import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { checksumSourceArticle } from "./checksum.ts";
import { createDeterministicEmbeddingDriver } from "./embedding.ts";
import { createFixtureKbSource, FIXTURE_KB_ARTICLES } from "./fixture-source.ts";
import { runKbImport } from "./import.ts";
import type { KbApplyArticleInput, KbArticleState, KbErrorCode, KbImportRepository, KbImportRun, SourceArticle } from "./types.ts";

class MemoryRepository implements KbImportRepository {
  readonly articles = new Map<string, { checksum: string; tombstoned: boolean }>();
  readonly runs = new Map<string, KbImportRun>();
  readonly seen = new Map<string, Set<string>>();
  failCode: KbErrorCode | null = null;
  applyCalls = 0;
  completeCalls = 0;
  failAfter: number | null = null;

  async beginImport(driver: string, subject: string, window: string) {
    const key = `${driver}|${subject}|${window}`;
    const prior = this.runs.get(key);
    if (prior?.status === "succeeded") return prior;
    const run = { id: prior?.id ?? key, status: "running" as const, cursor: prior?.cursor ?? null };
    this.runs.set(key, run);
    if (!this.seen.has(run.id)) this.seen.set(run.id, new Set());
    return run;
  }
  async readArticleState(id: string): Promise<KbArticleState | null> { return this.articles.get(id) ?? null; }
  async applyArticle(input: KbApplyArticleInput) {
    this.applyCalls += 1;
    if (this.failAfter !== null && this.applyCalls > this.failAfter) throw new Error("source interrupted");
    const current = this.articles.get(input.article.sourceArticleId);
    const outcome = current === undefined ? "added" : current.checksum !== input.checksum ? "changed" : current.tombstoned ? "restored" : "unchanged";
    this.articles.set(input.article.sourceArticleId, { checksum: input.checksum, tombstoned: false });
    this.seen.get(input.runId)?.add(input.article.sourceArticleId);
    const key = [...this.runs.keys()].find((item) => this.runs.get(item)?.id === input.runId)!;
    this.runs.set(key, { id: input.runId, status: "running", cursor: input.nextCursor });
    return outcome;
  }
  async completeImport(runId: string) {
    this.completeCalls += 1;
    let tombstoned = 0;
    const seen = this.seen.get(runId) ?? new Set<string>();
    for (const [id, article] of this.articles) {
      if (!article.tombstoned && !seen.has(id)) {
        this.articles.set(id, { ...article, tombstoned: true });
        tombstoned += 1;
      }
    }
    const key = [...this.runs.keys()].find((item) => this.runs.get(item)?.id === runId)!;
    this.runs.set(key, { id: runId, status: "succeeded", cursor: null });
    return { tombstoned };
  }
  async failImport(runId: string, code: KbErrorCode) {
    this.failCode = code;
    const key = [...this.runs.keys()].find((item) => this.runs.get(item)?.id === runId)!;
    const prior = this.runs.get(key)!;
    this.runs.set(key, { ...prior, status: "failed" });
  }
}

function countedEmbedding() {
  const driver = createDeterministicEmbeddingDriver();
  let calls = 0;
  return { driver: { ...driver, async embed(value: string) { calls += 1; return driver.embed(value); } }, calls: () => calls };
}

describe("KB import", () => {
  it("imports fixtures, embeds changed content only, and skips a repeated key", async () => {
    const repository = new MemoryRepository();
    const embedding = countedEmbedding();
    const first = await runKbImport({ subject: "global", window: "2026-W33", source: createFixtureKbSource(), embedding: embedding.driver, repository });
    assert.deepEqual(first, { status: "ok", rows: 6, counts: { added: 6, changed: 0, restored: 0, unchanged: 0, tombstoned: 0, embedded: 6 } });
    assert.equal(embedding.calls(), 6);
    const skipped = await runKbImport({ subject: "global", window: "2026-W33", source: createFixtureKbSource(), embedding: embedding.driver, repository });
    assert.equal(skipped.status, "skipped");
    assert.equal(repository.applyCalls, 6);

    const restored = FIXTURE_KB_ARTICLES[1];
    repository.articles.set(restored.sourceArticleId, { checksum: checksumSourceArticle(restored), tombstoned: true });
    const added: SourceArticle = { ...FIXTURE_KB_ARTICLES[2], sourceArticleId: "kb-new-document", title: "Current document review", sourceUrl: "https://kb.example.test/new-document" };
    const changed: readonly SourceArticle[] = [
      { ...FIXTURE_KB_ARTICLES[0], body: `${FIXTURE_KB_ARTICLES[0].body} Current records remain required.` },
      restored,
      ...FIXTURE_KB_ARTICLES.slice(3),
      added,
    ];
    const second = await runKbImport({ subject: "global", window: "2026-W34", source: createFixtureKbSource(changed), embedding: embedding.driver, repository });
    assert.equal(second.status, "ok");
    assert.deepEqual(second.counts, { added: 1, changed: 1, restored: 1, unchanged: 3, tombstoned: 1, embedded: 2 });
    assert.equal(embedding.calls(), 8);
  });

  it("persists a bounded failure and resumes from its cursor", async () => {
    const repository = new MemoryRepository();
    repository.failAfter = 3;
    const embedding = countedEmbedding();
    const failed = await runKbImport({ subject: "global", window: "2026-W35", source: createFixtureKbSource(), embedding: embedding.driver, repository });
    assert.equal(failed.status, "failed");
    assert.equal(repository.completeCalls, 0);
    assert.equal(repository.failCode, "KB_SOURCE_FAILED");
    repository.failAfter = null;
    const resumed = await runKbImport({ subject: "global", window: "2026-W35", source: createFixtureKbSource(), embedding: embedding.driver, repository });
    assert.equal(resumed.status, "ok");
    assert.equal(repository.completeCalls, 1);
  });

  it("rejects malformed input before touching dependencies", async () => {
    const repository = new MemoryRepository();
    const result = await runKbImport({ subject: "bad subject", window: "week", source: createFixtureKbSource(), embedding: createDeterministicEmbeddingDriver(), repository });
    assert.deepEqual(result, { status: "failed", rows: 0, code: "KB_INPUT_INVALID", counts: { added: 0, changed: 0, restored: 0, unchanged: 0, tombstoned: 0, embedded: 0 } });
    assert.equal(repository.runs.size, 0);
  });

  it("keeps checksum decisions stable", () => {
    assert.equal(checksumSourceArticle(FIXTURE_KB_ARTICLES[0]), checksumSourceArticle({ ...FIXTURE_KB_ARTICLES[0], metadata: { section: "foundation", tags: ["entity", "records"], category: "business" } }));
  });
});
