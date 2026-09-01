export const RESERVED_TENANT_SLUGS = Object.freeze([
  "www",
  "admin",
  "app",
  "api",
  "mail",
  "platform",
  "help",
  "status",
  "docs",
] as const);

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

export function normalizeTenantSlug(value: string): string {
  return value.trim().toLowerCase();
}

export function isTenantSlug(value: string): boolean {
  return SLUG_PATTERN.test(value) && !RESERVED_TENANT_SLUGS.includes(
    value as (typeof RESERVED_TENANT_SLUGS)[number],
  );
}

