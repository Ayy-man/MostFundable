import {
  AFFILIATE_PAYMENT_STATUSES,
  AffiliateError,
  type AffiliateLifecyclePatch,
  type AffiliatePaymentStatus,
  type ShareClientBody,
  type UpdateShareBody,
} from "@/lib/affiliates/types";

// Postgres `uuid` shape, not strict RFC-4122: the seeded affiliate/client ids
// (`a2000000-…-0001`, `a3000000-…-0002`) carry zero version/variant nibbles and
// the database accepts them, so a version check here 400s every seeded row
// (same class as the admin lane's G-3B-06 finding).
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_MAX_LENGTH = 255;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function parseAffiliateId(value: unknown): string {
  if (!isUuid(value)) invalid();
  return value;
}

export function parseAffiliateSlug(value: unknown): string {
  if (typeof value !== "string") invalid();
  const slug = value.trim();
  if (slug.length === 0 || slug.length > SLUG_MAX_LENGTH) invalid();
  return slug;
}

export function parseShareClientBody(input: unknown): ShareClientBody {
  const value = record(input);
  if (!onlyKeys(value, ["clientId"]) || !isUuid(value.clientId)) invalid();
  return { clientId: value.clientId };
}

export function parseUpdateShareBody(input: unknown): UpdateShareBody {
  const value = record(input);
  if (!onlyKeys(value, ["expectedCommissionCents", "paymentStatus"])) invalid();
  if (!("expectedCommissionCents" in value) && !("paymentStatus" in value)) invalid();

  const patch: UpdateShareBody = {};
  if ("expectedCommissionCents" in value) {
    const cents = value.expectedCommissionCents;
    if (cents !== null && (!Number.isSafeInteger(cents) || (cents as number) < 0)) invalid();
    patch.expectedCommissionCents = cents as number | null;
  }
  if ("paymentStatus" in value) {
    if (
      typeof value.paymentStatus !== "string" ||
      !AFFILIATE_PAYMENT_STATUSES.includes(value.paymentStatus as AffiliatePaymentStatus)
    ) invalid();
    patch.paymentStatus = value.paymentStatus as AffiliatePaymentStatus;
  }
  return patch;
}

export function parseAffiliateLifecyclePatch(input: unknown): AffiliateLifecyclePatch {
  const value = record(input);
  if (!onlyKeys(value, ["active", "defaultCommissionBps"])) invalid();
  if (!("active" in value) && !("defaultCommissionBps" in value)) invalid();

  const patch: AffiliateLifecyclePatch = {};
  if ("active" in value) {
    if (typeof value.active !== "boolean") invalid();
    patch.active = value.active;
  }
  if ("defaultCommissionBps" in value) {
    const bps = value.defaultCommissionBps;
    if (!Number.isSafeInteger(bps) || (bps as number) < 0 || (bps as number) > 10_000) invalid();
    patch.defaultCommissionBps = bps as number;
  }
  return patch;
}

function record(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) invalid();
  return input as Record<string, unknown>;
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function invalid(): never {
  throw new AffiliateError("invalid_payload", "The request payload is invalid.");
}
