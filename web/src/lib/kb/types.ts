import "server-only";

export const KB_ERROR_CODES = [
  "KB_INPUT_INVALID",
  "KB_SOURCE_FAILED",
  "KB_SOURCE_SHAPE_UNVERIFIED",
  "KB_REPOSITORY_FAILED",
  "KB_EMBEDDING_FAILED",
] as const;

export type KbErrorCode = (typeof KB_ERROR_CODES)[number];

export interface SourceArticle {
  readonly sourceArticleId: string;
  readonly title: string;
  readonly body: string;
  readonly sourceUrl: string;
  readonly sourceUpdatedAt: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface SourcePage {
  readonly articles: readonly SourceArticle[];
  readonly nextCursor: string | null;
}

export interface KbSourceDriver {
  readonly driver: "fixture" | "supabase";
  readonly verification: "fixture" | "skipped" | "verified";
  fetchPage(cursor: string | null): Promise<SourcePage>;
}

export interface EmbeddingDriver {
  readonly version: string;
  embed(value: string): Promise<readonly number[]>;
}

export interface KbImportRun {
  readonly id: string;
  readonly status: "running" | "succeeded" | "failed";
  readonly cursor: string | null;
}

export interface KbArticleState {
  readonly checksum: string;
  readonly tombstoned: boolean;
}

export type KbApplyOutcome = "added" | "changed" | "restored" | "unchanged";

export interface KbApplyArticleInput {
  readonly runId: string;
  readonly article: SourceArticle;
  readonly checksum: string;
  readonly embedding: readonly number[] | null;
  readonly embeddingVersion: string;
  readonly nextCursor: string | null;
}

export interface KbImportRepository {
  beginImport(driver: string, subject: string, window: string): Promise<KbImportRun>;
  readArticleState(sourceArticleId: string): Promise<KbArticleState | null>;
  applyArticle(input: KbApplyArticleInput): Promise<KbApplyOutcome>;
  completeImport(runId: string): Promise<{ readonly tombstoned: number }>;
  failImport(runId: string, code: KbErrorCode): Promise<void>;
}

export interface KbImportCounts {
  readonly added: number;
  readonly changed: number;
  readonly restored: number;
  readonly unchanged: number;
  readonly tombstoned: number;
  readonly embedded: number;
}

export type KbImportResult =
  | { readonly status: "ok"; readonly rows: number; readonly counts: KbImportCounts }
  | { readonly status: "skipped"; readonly rows: 0; readonly counts: KbImportCounts }
  | { readonly status: "failed"; readonly rows: number; readonly code: KbErrorCode; readonly counts: KbImportCounts };

export class KbDomainError extends Error {
  readonly code: KbErrorCode;

  constructor(code: KbErrorCode) {
    super(code);
    this.name = "KbDomainError";
    this.code = code;
  }
}
