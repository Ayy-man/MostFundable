import { normalizeTenantSlug } from "./slug.ts";
import { productionTenancyRepository, type TenancyRepository } from "./repository.ts";
import type { TenantResolution } from "./types.ts";

const UNKNOWN_TENANT = Object.freeze({ kind: "unknown" } as const);

function normalizedHostname(value: string): string {
  const host = value.trim().toLowerCase().replace(/\.$/, "");
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return end >= 0 ? host.slice(1, end) : host;
  }
  return host.replace(/:\d+$/, "");
}

export function createTenantHostResolver(repository: TenancyRepository) {
  return async function resolveTenantHost(input: {
    defaultOrgSlug?: string | null;
    hostname: string;
  }): Promise<TenantResolution> {
    const configured = input.defaultOrgSlug?.trim();
    if (configured) {
      const organization = await repository.findClaimedOrgBySlug(
        normalizeTenantSlug(configured),
      );
      return organization ? { kind: "organization", organization } : UNKNOWN_TENANT;
    }

    const label = normalizedHostname(input.hostname).split(".")[0] ?? "";
    if (label === "admin") return { kind: "platform_admin" };
    if (!label) return UNKNOWN_TENANT;

    const organization = await repository.findClaimedOrgBySlug(label);
    return organization ? { kind: "organization", organization } : UNKNOWN_TENANT;
  };
}

export async function resolveTenantHost(input: {
  defaultOrgSlug?: string | null;
  hostname: string;
}): Promise<TenantResolution> {
  const repository = await productionTenancyRepository();
  return createTenantHostResolver(repository)(input);
}

