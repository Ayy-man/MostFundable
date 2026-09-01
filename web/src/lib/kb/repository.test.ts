import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FIXTURE_KB_ARTICLES } from "./fixture-source.ts";
import { createKbImportRepository, type KbDatabaseClient } from "./repository.ts";

describe("KB repository", () => {
  it("maps only the owned table and RPC contract", async () => {
    const calls: Array<[string, unknown]> = [];
    const database: KbDatabaseClient = {
      from(table) {
        calls.push(["from", table]);
        return { select(columns) { calls.push(["select", columns]); return { eq(column, value) { calls.push([column, value]); return { async maybeSingle() { return { data: { source_checksum: "a".repeat(64), tombstoned_at: null }, error: null }; } }; } }; } };
      },
      async rpc(name, args) {
        calls.push([name, args]);
        if (name === "kb_begin_import") return { data: { id: "run-1", status: "running", cursor: null }, error: null };
        if (name === "kb_apply_article") return { data: "added", error: null };
        if (name === "kb_complete_import") return { data: { tombstoned_count: 2 }, error: null };
        return { data: { id: "run-1" }, error: null };
      },
    };
    const repository = createKbImportRepository(async () => database);
    assert.deepEqual(await repository.beginImport("fixture", "global", "2026-W33"), { id: "run-1", status: "running", cursor: null });
    assert.deepEqual(await repository.readArticleState("article-a"), { checksum: "a".repeat(64), tombstoned: false });
    assert.equal(await repository.applyArticle({ runId: "run-1", article: FIXTURE_KB_ARTICLES[0], checksum: "a".repeat(64), embedding: null, embeddingVersion: "hash64-v1", nextCursor: null }), "added");
    assert.deepEqual(await repository.completeImport("run-1"), { tombstoned: 2 });
    await repository.failImport("run-1", "KB_SOURCE_FAILED");
    assert.deepEqual(calls.filter(([kind]) => kind === "from"), [["from", "kb_articles"]]);
    assert.deepEqual(calls.filter(([kind]) => String(kind).startsWith("kb_" )).map(([kind]) => kind), ["kb_begin_import", "kb_apply_article", "kb_complete_import", "kb_fail_import"]);
  });

  it("maps database details to one bounded error", async () => {
    const repository = createKbImportRepository(async () => ({
      from() { throw new Error("not used"); },
      async rpc() { return { data: null, error: { message: "sensitive database detail" } }; },
    }));
    await assert.rejects(repository.beginImport("fixture", "global", "2026-W33"), { code: "KB_REPOSITORY_FAILED", message: "KB_REPOSITORY_FAILED" });
  });
});
