import { featureFlag, type EnvSource } from "@/lib/env";

export type AncillaryConfigRole =
  | "platform_admin"
  | "operator_member"
  | "consumer"
  | "affiliate";

function text(env: EnvSource, key: string): string | null {
  const value = env[key]?.trim();
  return value ? value : null;
}

function httpsUrl(env: EnvSource, key: string): string | null {
  const value = text(env, key);
  if (value === null) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export interface AuthenticatedAncillaryConfig {
  enabled: boolean;
  consoleOpsEnabled: boolean;
  attestationAvailable: boolean;
  attestationText?: string;
  platformTrainingsUrl: string | null;
  northwestPartnerUrl: string | null;
}

export function getAuthenticatedAncillaryConfig(
  role: AncillaryConfigRole,
  env: EnvSource = process.env,
): AuthenticatedAncillaryConfig {
  const attestation = text(env, "TRAINING_ATTESTATION_TEXT");
  const privileged = role === "platform_admin" || role === "operator_member";
  const enabled = featureFlag("FEATURE_ANCILLARY", env);
  return {
    enabled,
    consoleOpsEnabled: enabled && featureFlag("FEATURE_CONSOLE_OPS", env),
    attestationAvailable: attestation !== null,
    ...(privileged && attestation !== null ? { attestationText: attestation } : {}),
    platformTrainingsUrl: httpsUrl(env, "PLATFORM_TRAININGS_URL"),
    northwestPartnerUrl: httpsUrl(env, "NORTHWEST_PARTNER_URL"),
  };
}

export function trainingAttestationText(env: EnvSource = process.env): string | null {
  return text(env, "TRAINING_ATTESTATION_TEXT");
}
