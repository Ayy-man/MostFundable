import type { ConsentKind } from "@/lib/enrollment/types";

// These narrow read shapes intentionally stand in for the generated database
// types. Replace them with the generated projections after Phase 1 lands.
export type ConsentRow = {
  id: string;
  kind: ConsentKind;
  textVersion: string;
  signedAt: string;
};

export type RevocationRow = {
  consentId: string;
  kind: ConsentKind;
  revokedAt: string;
};

const CONSENT_KINDS: readonly ConsentKind[] = ["monitoring", "analysis"];

export function currentlyAuthorized(
  consents: readonly ConsentRow[],
  revocations: readonly RevocationRow[],
): readonly ConsentKind[] {
  return CONSENT_KINDS.filter((kind) =>
    isAuthorized(kind, consents, revocations),
  );
}

export function isAuthorized(
  kind: ConsentKind,
  consents: readonly ConsentRow[],
  revocations: readonly RevocationRow[],
): boolean {
  const latest = consents
    .filter((consent) => consent.kind === kind)
    .toSorted((left, right) => right.signedAt.localeCompare(left.signedAt))[0];

  if (!latest) return false;
  return !revocations.some(
    (revocation) =>
      revocation.kind === kind && revocation.consentId === latest.id,
  );
}
