import "server-only";

import { createHash } from "node:crypto";

import { KbDomainError, type SourceArticle } from "./types.ts";

const SOURCE_KEYS = [
  "sourceArticleId",
  "title",
  "body",
  "sourceUrl",
  "sourceUpdatedAt",
  "metadata",
] as const;

function normalizeLines(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return typeof value === "string" ? normalizeLines(value) : value;
}

export function validateSourceArticle(value: unknown): SourceArticle {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new KbDomainError("KB_INPUT_INVALID");
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join("|") !== [...SOURCE_KEYS].sort().join("|")
    || typeof record.sourceArticleId !== "string"
    || record.sourceArticleId.trim() !== record.sourceArticleId
    || record.sourceArticleId.length < 1
    || record.sourceArticleId.length > 200
    || typeof record.title !== "string"
    || record.title.trim().length < 1
    || record.title.length > 240
    || typeof record.body !== "string"
    || record.body.trim().length < 1
    || record.body.length > 40_000
    || typeof record.sourceUrl !== "string"
    || record.sourceUrl.length > 2_048
    || !/^https?:\/\//.test(record.sourceUrl)
    || !(record.sourceUpdatedAt === null || typeof record.sourceUpdatedAt === "string")
    || record.metadata === null
    || typeof record.metadata !== "object"
    || Array.isArray(record.metadata)
  ) {
    throw new KbDomainError("KB_INPUT_INVALID");
  }
  return Object.freeze({
    sourceArticleId: record.sourceArticleId,
    title: normalizeLines(record.title),
    body: normalizeLines(record.body),
    sourceUrl: record.sourceUrl,
    sourceUpdatedAt: record.sourceUpdatedAt,
    metadata: Object.freeze(stableValue(record.metadata) as Record<string, unknown>),
  });
}

export function canonicalizeSourceArticle(value: SourceArticle): string {
  const article = validateSourceArticle(value);
  return JSON.stringify({
    sourceArticleId: article.sourceArticleId,
    title: article.title,
    body: article.body,
    sourceUrl: article.sourceUrl,
    sourceUpdatedAt: article.sourceUpdatedAt,
    metadata: stableValue(article.metadata),
  });
}

export function checksumSourceArticle(value: SourceArticle): string {
  return createHash("sha256").update(canonicalizeSourceArticle(value)).digest("hex");
}
