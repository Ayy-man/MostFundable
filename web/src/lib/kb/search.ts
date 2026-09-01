import "server-only";

export interface KbArticleMatch {
  readonly id: string;
  readonly sourceArticleId: string;
  readonly title: string;
  readonly body: string;
  readonly sourceUrl: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly similarity: number;
}

export interface KbSearchClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string } | null }>;
}

type SearchRow = { id: string; source_article_id: string; title: string; body: string; source_url: string; metadata: Record<string, unknown>; similarity: number };

function clampLimit(value: number): number {
  if (!Number.isFinite(value)) return 6;
  return Math.min(8, Math.max(1, Math.trunc(value)));
}

export class Float8ArrayEmbeddingIndex {
  private readonly supplied?: KbSearchClient;
  constructor(supplied?: KbSearchClient) { this.supplied = supplied; }

  async search(embedding: readonly number[], limit = 6): Promise<KbArticleMatch[]> {
    const client = this.supplied ?? (await import("../supabase/admin.ts")).createAdminClient() as unknown as KbSearchClient;
    const { data, error } = await client.rpc("search_kb_articles", { p_embedding: [...embedding], p_limit: clampLimit(limit) });
    if (error) throw new Error("KB_REPOSITORY_FAILED");
    if (!Array.isArray(data)) return [];
    return (data as SearchRow[]).map((row) => ({ id: row.id, sourceArticleId: row.source_article_id, title: row.title, body: row.body, sourceUrl: row.source_url, metadata: row.metadata, similarity: Number(row.similarity) }));
  }
}
