import "server-only";

import { createDeterministicEmbeddingDriver } from "./embedding.ts";
import { runKbImport } from "./import.ts";
import { createKbImportRepository } from "./repository.ts";
import { createKbSourceDriver } from "./source.ts";
import { KbDomainError } from "./types.ts";
import type { EmbeddingDriver, KbErrorCode, KbImportRepository, KbSourceDriver } from "./types.ts";

export const VAULT_REIMPORT_KB_JOB = "vault.reimport_kb";
/**
 * G-KB-01: `code` is not decoration. This handler used to answer every failure
 * with a bare `{status:"failed", rows:0}`, so a source that refused on every
 * single run — which is what `VAULT_DRIVER=supabase` did to it from Phase 8 —
 * was indistinguishable from a transient import error, both in the drainer's
 * log line and in the 503 body `POST /api/kb/admin/reimport` returns to a
 * platform admin. Naming the code is what makes one run of this job explain
 * itself.
 */
export type VaultReimportKbResult = {
  readonly status: "ok" | "skipped" | "failed";
  readonly rows?: number;
  readonly code?: KbErrorCode | "KB_JOB_TUPLE_INVALID";
};

export interface VaultReimportKbDependencies {
  readonly createSource: () => KbSourceDriver;
  readonly createEmbedding: () => EmbeddingDriver;
  readonly createRepository: () => KbImportRepository;
}

const DEFAULT_DEPENDENCIES: VaultReimportKbDependencies = {
  createSource: () => createKbSourceDriver(),
  createEmbedding: () => createDeterministicEmbeddingDriver(),
  createRepository: () => createKbImportRepository(),
};

export function createVaultReimportKbHandler(deps: VaultReimportKbDependencies): (subject: string, window: string) => Promise<VaultReimportKbResult> {
  return async function vaultReimportKb(subject: string, window: string): Promise<VaultReimportKbResult> {
    if (subject !== "global" || !/^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/.test(window)) {
      return { status: "failed", rows: 0, code: "KB_JOB_TUPLE_INVALID" };
    }
    try {
      const result = await runKbImport({ subject, window, source: deps.createSource(), embedding: deps.createEmbedding(), repository: deps.createRepository() });
      if (result.status === "failed") return { status: "failed", rows: result.rows, code: result.code };
      return { status: result.status, rows: result.rows };
    } catch (error) {
      // Constructing the source, the embedding driver or the repository happens
      // before `runKbImport` gets a chance to open an import run, so a refusal
      // here leaves no row in `kb_import_runs` and this result is the only
      // account of it that will ever exist. It carries the code.
      return {
        status: "failed",
        rows: 0,
        code: error instanceof KbDomainError ? error.code : "KB_SOURCE_FAILED",
      };
    }
  };
}

export const runVaultReimportKb = createVaultReimportKbHandler(DEFAULT_DEPENDENCIES);
