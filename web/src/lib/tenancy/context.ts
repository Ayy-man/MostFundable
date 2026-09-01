import type { TenantRequestContext, TenantResolution } from "./types.ts";

export const TENANT_CONTEXT_HEADERS = Object.freeze([
  "x-mf-tenant-kind",
  "x-mf-org-id",
  "x-mf-org-slug",
] as const);

// Postgres `uuid` shape, not strict RFC-4122: seeded ids carry zero version/variant nibbles (GAPS G-3B-06/07).
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

export function writeTenantRequestContext(
  incoming: Headers,
  resolution: TenantResolution,
): Headers {
  const trusted = new Headers(incoming);
  for (const name of TENANT_CONTEXT_HEADERS) trusted.delete(name);

  if (resolution.kind === "platform_admin") {
    trusted.set("x-mf-tenant-kind", "platform_admin");
  } else if (resolution.kind === "organization") {
    trusted.set("x-mf-tenant-kind", "organization");
    trusted.set("x-mf-org-id", resolution.organization.id);
    trusted.set("x-mf-org-slug", resolution.organization.slug);
  }

  return trusted;
}

export function readTenantRequestContext(
  headers: Headers,
): TenantRequestContext | null {
  const kind = headers.get("x-mf-tenant-kind");
  if (kind === "platform_admin") {
    if (headers.has("x-mf-org-id") || headers.has("x-mf-org-slug")) return null;
    return { kind };
  }
  if (kind !== "organization") return null;

  const orgId = headers.get("x-mf-org-id");
  const slug = headers.get("x-mf-org-slug");
  if (!orgId || !UUID_PATTERN.test(orgId) || !slug || !SLUG_PATTERN.test(slug)) {
    return null;
  }
  return { kind, orgId, slug };
}

