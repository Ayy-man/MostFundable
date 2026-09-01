import "server-only";

import { createHash } from "node:crypto";

import { KbDomainError, type EmbeddingDriver } from "./types.ts";

export const EMBEDDING_DIMENSION = 64;
export const FIXTURE_EMBEDDING_VERSION = "hash64-v1";

export function deterministicEmbedding(value: string): readonly number[] {
  const tokens = value.toLowerCase().normalize("NFKC").match(/[a-z0-9]+/g) ?? [];
  if (tokens.length === 0) throw new KbDomainError("KB_INPUT_INVALID");
  const vector = Array<number>(EMBEDDING_DIMENSION).fill(0);
  for (const token of tokens) {
    const digest = createHash("sha256").update(token).digest();
    const bucket = digest.readUInt16BE(0) % EMBEDDING_DIMENSION;
    const sign = (digest[2] & 1) === 0 ? 1 : -1;
    vector[bucket] += sign * (1 + Math.log1p(token.length));
  }
  const norm = Math.sqrt(vector.reduce((sum, item) => sum + item * item, 0));
  if (!Number.isFinite(norm) || norm === 0) throw new KbDomainError("KB_EMBEDDING_FAILED");
  return Object.freeze(vector.map((item) => item / norm));
}

export function createDeterministicEmbeddingDriver(): EmbeddingDriver {
  return Object.freeze({
    version: FIXTURE_EMBEDDING_VERSION,
    async embed(value: string): Promise<readonly number[]> {
      return deterministicEmbedding(value);
    },
  });
}
