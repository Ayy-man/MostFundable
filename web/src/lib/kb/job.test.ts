import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createDeterministicEmbeddingDriver } from "./embedding.ts";
import { createFixtureKbSource } from "./fixture-source.ts";
import { createVaultReimportKbHandler, runVaultReimportKb, VAULT_REIMPORT_KB_JOB } from "./job.ts";
import { createKbSourceDriver, KB_SOURCE_DRIVERS } from "./source.ts";
import { DRIVERS } from "@/lib/env";
import type { KbImportRepository } from "./types.ts";

function repository(status: "running" | "succeeded" = "running"): KbImportRepository {
  return {
    async beginImport() { return { id: "run-1", status, cursor: null }; },
    async readArticleState() { return null; },
    async applyArticle() { return "added"; },
    async completeImport() { return { tombstoned: 0 }; },
    async failImport() {},
  };
}

describe("KB job", () => {
  it("exports the exact registry name and two-argument production seam", () => {
    assert.equal(VAULT_REIMPORT_KB_JOB, "vault.reimport_kb");
    assert.equal(runVaultReimportKb.length, 2);
  });

  it("validates subject and weekly window before constructing dependencies", async () => {
    let constructions = 0;
    const handler = createVaultReimportKbHandler({ createSource() { constructions += 1; return createFixtureKbSource(); }, createEmbedding() { constructions += 1; return createDeterministicEmbeddingDriver(); }, createRepository() { constructions += 1; return repository(); } });
    assert.deepEqual(await handler("client", "2026-W33"), { status: "failed", rows: 0, code: "KB_JOB_TUPLE_INVALID" });
    assert.deepEqual(await handler("global", "2026-33"), { status: "failed", rows: 0, code: "KB_JOB_TUPLE_INVALID" });
    assert.equal(constructions, 0);
  });

  it("maps fixture completion and repeated weekly work", async () => {
    const completed = createVaultReimportKbHandler({ createSource: createFixtureKbSource, createEmbedding: createDeterministicEmbeddingDriver, createRepository: () => repository() });
    assert.deepEqual(await completed("global", "2026-W33"), { status: "ok", rows: 6 });
    const repeated = createVaultReimportKbHandler({ createSource: createFixtureKbSource, createEmbedding: createDeterministicEmbeddingDriver, createRepository: () => repository("succeeded") });
    assert.deepEqual(await repeated("global", "2026-W33"), { status: "skipped", rows: 0 });
  });

  it("bounds source and explicit real-selector failures without fixture fallback", async () => {
    let repositoryCalls = 0;
    const sourceFailure = createVaultReimportKbHandler({ createSource: () => ({ driver: "fixture", verification: "fixture", async fetchPage() { throw new Error("provider detail"); } }), createEmbedding: createDeterministicEmbeddingDriver, createRepository() { repositoryCalls += 1; return repository(); } });
    // The thrown provider text stays out of the result; the domain code replaces it (G-KB-01).
    const bounded = await sourceFailure("global", "2026-W33");
    assert.deepEqual(bounded, { status: "failed", rows: 0, code: "KB_SOURCE_FAILED" });
    assert.equal(JSON.stringify(bounded).includes("provider detail"), false);
    const missingKey = createVaultReimportKbHandler({ createSource: () => createKbSourceDriver({ [KB_SOURCE_DRIVERS.selector]: "vault_supabase" }), createEmbedding: createDeterministicEmbeddingDriver, createRepository() { repositoryCalls += 1; return repository(); } });
    // MisconfiguredDriverError is not a KbDomainError, so the handler bounds it as a source failure.
    assert.deepEqual(await missingKey("global", "2026-W33"), { status: "failed", rows: 0, code: "KB_SOURCE_FAILED" });
    assert.equal(repositoryCalls, 1);
  });

  /**
   * G-KB-01: the failure that ran unnoticed for weeks. A source that refuses
   * before `runKbImport` opens an import run leaves no `kb_import_runs` row, so
   * this result is the only account of it that exists — it has to name the code.
   */
  it("G-KB-01: an unverified source shape names itself in the job result", async () => {
    const handler = createVaultReimportKbHandler({
      createSource: () => createKbSourceDriver({
        [KB_SOURCE_DRIVERS.selector]: "vault_supabase",
        VAULT_SUPABASE_URL: "https://vault.example.test",
        VAULT_SERVICE_KEY: "present",
      }),
      createEmbedding: createDeterministicEmbeddingDriver,
      createRepository: () => repository(),
    });
    assert.deepEqual(await handler("global", "2026-W33"), {
      status: "failed",
      rows: 0,
      code: "KB_SOURCE_SHAPE_UNVERIFIED",
    });
  });

  it("G-KB-01: the production handler is not reconfigured by VAULT_DRIVER", async () => {
    // The default dependency reads the ambient environment, so this is the arm
    // that would have failed on the deployment from Phase 8 onwards.
    const previous = process.env[DRIVERS.vault.selector];
    process.env[DRIVERS.vault.selector] = "fixture";
    try {
      for (const driver of DRIVERS.vault.values) {
        process.env[DRIVERS.vault.selector] = driver;
        assert.equal(
          createKbSourceDriver().driver,
          "fixture",
          `${DRIVERS.vault.selector}=${driver} must leave the production KB source on fixture`,
        );
      }
    } finally {
      if (previous === undefined) delete process.env[DRIVERS.vault.selector];
      else process.env[DRIVERS.vault.selector] = previous;
    }
  });
});
