import { createHash, randomBytes } from "node:crypto";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function createOpaqueReferralToken(): string {
  return randomBytes(32).toString("base64url");
}

export function parseReferralToken(value: string): string | null {
  return TOKEN_PATTERN.test(value) ? value : null;
}

export function digestReferralToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}
