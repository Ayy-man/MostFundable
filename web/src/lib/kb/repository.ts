import "server-only";

import { KbDomainError } from "./types.ts";
import type {
  KbApplyArticleInput,
  KbApplyOutcome,
  KbArticleState,
  KbErrorCode,
  KbImportRepository,
  KbImportRun,
} from "./types.ts";

interface DbResult<T> { data: T | null; error: unknown }
export interface KbDatabaseClient {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: unknown): {
        maybeSingle(): PromiseLike<DbResult<Record<string, unknown>>>;
      };
    };
  };
  rpc(name: string, args: Record<string, unknown>): PromiseLike<DbResult<unknown>>;
}

export type KbDatabaseFactory = () => Promise<KbDatabaseClient>;

async function defaultDatabase(): Promise<KbDatabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient() as unknown as KbDatabaseClient;
}

function row(value: unknown): Record<string, unknown> {
  const item = Array.isArray(value) ? value[0] : value;
  if (item === null || typeof item !== "object") throw new KbDomainError("KB_REPOSITORY_FAILED");
  return item as Record<string, unknown>;
}

export function createKbImportRepository(
  database: KbDatabaseFactory = defaultDatabase,
): KbImportRepository {
  const repository: KbImportRepository = {
    async beginImport(driver: string, subject: string, window: string): Promise<KbImportRun> {
      const result = await (await database()).rpc("kb_begin_import", { p_driver: driver, p_subject: subject, p_window: window });
      if (result.error) throw new KbDomainError("KB_REPOSITORY_FAILED");
      const item = row(result.data);
      return { id: String(item.id), status: item.status as KbImportRun["status"], cursor: typeof item.cursor === "string" ? item.cursor : null };
    },
    async readArticleState(sourceArticleId: string): Promise<KbArticleState | null> {
      const result = await (await database()).from("kb_articles").select("source_checksum,tombstoned_at").eq("source_article_id", sourceArticleId).maybeSingle();
      if (result.error) throw new KbDomainError("KB_REPOSITORY_FAILED");
      if (result.data === null) return null;
      return { checksum: String(result.data.source_checksum), tombstoned: result.data.tombstoned_at !== null };
    },
    async applyArticle(input: KbApplyArticleInput): Promise<KbApplyOutcome> {
      const result = await (await database()).rpc("kb_apply_article", {
        p_run_id: input.runId,
        p_source_article_id: input.article.sourceArticleId,
        p_title: input.article.title,
        p_body: input.article.body,
        p_source_url: input.article.sourceUrl,
        p_source_updated_at: input.article.sourceUpdatedAt,
        p_metadata: input.article.metadata,
        p_source_checksum: input.checksum,
        p_embedding: input.embedding,
        p_embedding_version: input.embeddingVersion,
        p_next_cursor: input.nextCursor,
      });
      if (result.error || !["added", "changed", "restored", "unchanged"].includes(String(result.data))) {
        throw new KbDomainError("KB_REPOSITORY_FAILED");
      }
      return String(result.data) as KbApplyOutcome;
    },
    async completeImport(runId: string) {
      const result = await (await database()).rpc("kb_complete_import", { p_run_id: runId });
      if (result.error) throw new KbDomainError("KB_REPOSITORY_FAILED");
      const item = row(result.data);
      return { tombstoned: Number(item.tombstoned_count ?? 0) };
    },
    async failImport(runId: string, code: KbErrorCode): Promise<void> {
      const result = await (await database()).rpc("kb_fail_import", { p_run_id: runId, p_error_code: code });
      if (result.error) throw new KbDomainError("KB_REPOSITORY_FAILED");
    },
  };
  return Object.freeze(repository);
}
