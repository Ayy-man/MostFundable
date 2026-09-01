import "server-only";

import { checksumSourceArticle, validateSourceArticle } from "./checksum.ts";
import { KbDomainError } from "./types.ts";
import type {
  EmbeddingDriver,
  KbErrorCode,
  KbImportCounts,
  KbImportRepository,
  KbImportResult,
  KbSourceDriver,
} from "./types.ts";

export interface RunKbImportInput {
  readonly subject: string;
  readonly window: string;
  readonly source: KbSourceDriver;
  readonly embedding: EmbeddingDriver;
  readonly repository: KbImportRepository;
}

const EMPTY_COUNTS: KbImportCounts = Object.freeze({ added: 0, changed: 0, restored: 0, unchanged: 0, tombstoned: 0, embedded: 0 });

function codeFor(error: unknown): KbErrorCode {
  return error instanceof KbDomainError ? error.code : "KB_SOURCE_FAILED";
}

export async function runKbImport(input: RunKbImportInput): Promise<KbImportResult> {
  if (!/^[a-z][a-z0-9:_-]{0,127}$/.test(input.subject) || !/^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/.test(input.window)) {
    return { status: "failed", rows: 0, code: "KB_INPUT_INVALID", counts: EMPTY_COUNTS };
  }
  let runId: string | null = null;
  let rows = 0;
  const counts = { ...EMPTY_COUNTS };
  try {
    const run = await input.repository.beginImport(input.source.driver, input.subject, input.window);
    runId = run.id;
    if (run.status === "succeeded") return { status: "skipped", rows: 0, counts: EMPTY_COUNTS };
    let cursor = run.cursor;
    for (;;) {
      const page = await input.source.fetchPage(cursor);
      for (let index = 0; index < page.articles.length; index += 1) {
        const article = validateSourceArticle(page.articles[index]);
        const checksum = checksumSourceArticle(article);
        const current = await input.repository.readArticleState(article.sourceArticleId);
        const shouldEmbed = current === null || current.checksum !== checksum;
        const vector = shouldEmbed ? await input.embedding.embed(`${article.title}\n${article.body}`) : null;
        const isLast = index === page.articles.length - 1;
        const outcome = await input.repository.applyArticle({
          runId,
          article,
          checksum,
          embedding: vector,
          embeddingVersion: input.embedding.version,
          nextCursor: isLast ? page.nextCursor : cursor,
        });
        counts[outcome] += 1;
        if (shouldEmbed) counts.embedded += 1;
        rows += 1;
      }
      if (page.nextCursor === null) break;
      if (page.articles.length === 0 || page.nextCursor === cursor) throw new KbDomainError("KB_SOURCE_FAILED");
      cursor = page.nextCursor;
    }
    const completion = await input.repository.completeImport(runId);
    counts.tombstoned = completion.tombstoned;
    return { status: "ok", rows, counts };
  } catch (error) {
    const code = codeFor(error);
    if (runId !== null) {
      try { await input.repository.failImport(runId, code); } catch { /* bounded result wins */ }
    }
    return { status: "failed", rows, code, counts };
  }
}
