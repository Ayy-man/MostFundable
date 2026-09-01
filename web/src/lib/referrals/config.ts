import type { EnvSource } from "@/lib/env";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ReferralConfiguration =
  | { enabled: false; explicitlyEnabled: boolean }
  | {
      enabled: true;
      explicitlyEnabled: true;
      intakeOrigin: string;
      platformOrgId: string;
    };

function flagEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "1" || value?.trim().toLowerCase() === "true";
}

function canonicalOrigin(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

export function parseReferralConfiguration(
  env: EnvSource = process.env,
): ReferralConfiguration {
  const explicitlyEnabled = flagEnabled(env.FEATURE_REFERRALS);
  if (!explicitlyEnabled) return { enabled: false, explicitlyEnabled: false };

  const platformOrgId = env.REFERRAL_PLATFORM_ORG_ID?.trim();
  const intakeOrigin = canonicalOrigin(env.REFERRAL_INTAKE_ORIGIN);
  if (!platformOrgId || !UUID_PATTERN.test(platformOrgId) || !intakeOrigin) {
    return { enabled: false, explicitlyEnabled: true };
  }

  return {
    enabled: true,
    explicitlyEnabled: true,
    intakeOrigin,
    platformOrgId: platformOrgId.toLowerCase(),
  };
}
