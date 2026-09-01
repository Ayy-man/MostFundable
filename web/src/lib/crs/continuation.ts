import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

import { CrsDriverError } from "./errors.ts";

import type { CrsIdvContinuation, CrsMemberRef, IdvChallengeState } from "./types.ts";

const VERSION = "v1";
const IV_BYTES = 12;

type ContinuationState = {
  challenge: IdvChallengeState;
  memberRef: string;
  smfaToken: string;
};

function keyFor(secret: string): Buffer {
  return createHash("sha256")
    .update("mostfundable:crs-idv-continuation:v1\0", "utf8")
    .update(secret, "utf8")
    .digest();
}

export function sealCrsIdvContinuation(
  continuationState: ContinuationState,
  secret: string,
): CrsIdvContinuation {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", keyFor(secret), iv);
  cipher.setAAD(Buffer.from(VERSION, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(continuationState), "utf8"),
    cipher.final(),
  ]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")]
    .join(".") as CrsIdvContinuation;
}

export function openCrsIdvContinuation(input: {
  continuation: CrsIdvContinuation;
  memberRef: CrsMemberRef;
  now: Date;
  secret: string;
}): ContinuationState {
  try {
    const [version, ivValue, tagValue, ciphertextValue, extra] = input.continuation.split(".");
    if (version !== VERSION || !ivValue || !tagValue || !ciphertextValue || extra !== undefined) {
      throw new Error("shape");
    }
    const decipher = createDecipheriv("aes-256-gcm", keyFor(input.secret), Buffer.from(ivValue, "base64url"));
    decipher.setAAD(Buffer.from(VERSION, "utf8"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    const decoded = JSON.parse(Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, "base64url")),
      decipher.final(),
    ]).toString("utf8")) as unknown;
    if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) throw new Error("decoded");
    const continuationState = decoded as Partial<ContinuationState>;
    const expiresAtMs = Date.parse(continuationState.challenge?.expiresAt ?? "");
    if (
      continuationState.memberRef !== input.memberRef ||
      typeof continuationState.smfaToken !== "string" ||
      continuationState.smfaToken.length === 0 ||
      typeof continuationState.challenge !== "object" ||
      continuationState.challenge === null ||
      continuationState.challenge.kind !== "smfa_link" ||
      typeof continuationState.challenge.expiresAt !== "string" ||
      !Number.isFinite(expiresAtMs) ||
      expiresAtMs <= input.now.getTime()
    ) throw new Error("invalid");
    return continuationState as ContinuationState;
  } catch {
    throw new CrsDriverError("sandbox", "submitIdvStep", 400);
  }
}
