import "server-only";

import type { KbSourceDriver, SourceArticle } from "./types.ts";

export const FIXTURE_KB_ARTICLES: readonly SourceArticle[] = Object.freeze([
  { sourceArticleId: "kb-business-entity", title: "Business entity readiness", body: "Keep the registered entity name, address, and tax identity consistent across current business records before applying for business funding.", sourceUrl: "https://kb.example.test/business-entity", sourceUpdatedAt: "2026-08-01T00:00:00.000Z", metadata: { category: "business", section: "foundation", tags: ["entity", "records"] } },
  { sourceArticleId: "kb-bank-statements", title: "Bank statement readiness", body: "Maintain complete current business bank statements and reconcile deposits, balances, and recurring obligations before a funding review.", sourceUrl: "https://kb.example.test/bank-statements", sourceUpdatedAt: "2026-08-02T00:00:00.000Z", metadata: { category: "documents", section: "banking", tags: ["statements", "cash-flow"] } },
  { sourceArticleId: "kb-cash-flow", title: "Cash flow documentation", body: "Prepare a clear view of monthly revenue, operating expenses, and existing payment commitments using current financial records.", sourceUrl: "https://kb.example.test/cash-flow", sourceUpdatedAt: "2026-08-03T00:00:00.000Z", metadata: { category: "finance", section: "cash-flow", tags: ["revenue", "expenses"] } },
  { sourceArticleId: "kb-lender-fit", title: "Lender fit review", body: "Compare the lender product, documented eligibility rules, requested amount, and intended use of funds before selecting an application path.", sourceUrl: "https://kb.example.test/lender-fit", sourceUpdatedAt: "2026-08-04T00:00:00.000Z", metadata: { category: "lenders", section: "fit", tags: ["eligibility", "product"] } },
  { sourceArticleId: "kb-application-file", title: "Application file checklist", body: "Collect current formation records, ownership details, bank statements, and supporting financial documents in one reviewable application file.", sourceUrl: "https://kb.example.test/application-file", sourceUpdatedAt: "2026-08-05T00:00:00.000Z", metadata: { category: "applications", section: "documents", tags: ["checklist", "records"] } },
  { sourceArticleId: "kb-readiness-review", title: "Funding readiness review", body: "Review business records for consistency, confirm the intended funding use, and resolve missing documentation before submitting an application.", sourceUrl: "https://kb.example.test/readiness-review", sourceUpdatedAt: "2026-08-06T00:00:00.000Z", metadata: { category: "readiness", section: "review", tags: ["consistency", "documentation"] } },
]);

const PAGE_SIZE = 3;

export function createFixtureKbSource(
  articles: readonly SourceArticle[] = FIXTURE_KB_ARTICLES,
): KbSourceDriver {
  return Object.freeze({
    driver: "fixture" as const,
    verification: "fixture" as const,
    async fetchPage(cursor: string | null) {
      const offset = cursor === null ? 0 : Number.parseInt(cursor, 10);
      const start = Number.isInteger(offset) && offset >= 0 ? offset : 0;
      const page = articles.slice(start, start + PAGE_SIZE);
      const next = start + page.length;
      return Object.freeze({
        articles: Object.freeze(page),
        nextCursor: next < articles.length ? String(next) : null,
      });
    },
  });
}
