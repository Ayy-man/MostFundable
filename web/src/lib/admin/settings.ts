import { featureFlag, type EnvSource } from "@/lib/env";

import {
  GOVERNED_SETTING_KEYS,
  type GovernedIntegerKey,
  type GovernedSettingKey,
  type GovernedSettingValue,
  type SettingRow,
  type SettingsReadRepository,
  type SettingsRepository,
} from "./settings-types.ts";

// Postgres `uuid` shape (seeded demo actors are not RFC-4122); see ADMIN_UUID.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY_SET = new Set<string>(GOVERNED_SETTING_KEYS);

function ownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validValue(key: GovernedSettingKey, value: unknown): value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  if (key === "SUPPORT_DRAFT_CONFIDENCE_THRESHOLD") return value > 0 && value <= 1;
  if (!Number.isSafeInteger(value)) return false;
  if (key === "TRIAL_DAYS" || key === "OPERATOR_GRACE_DAYS") {
    return value >= 1 && value <= 365;
  }
  return value >= 1 && value <= 100_000_000;
}

export function parseSettingRow(value: unknown): SettingRow {
  if (!ownRecord(value)) throw new Error("ADMIN_SETTINGS_RESULT_INVALID");
  const key = value.key;
  const updatedBy = "updated_by" in value ? value.updated_by : value.updatedBy;
  const updatedAt = "updated_at" in value ? value.updated_at : value.updatedAt;
  if (
    typeof key !== "string" || !KEY_SET.has(key) ||
    !validValue(key as GovernedSettingKey, value.value) ||
    !(updatedBy === null || (typeof updatedBy === "string" && UUID.test(updatedBy))) ||
    typeof updatedAt !== "string" || !Number.isFinite(Date.parse(updatedAt))
  ) {
    throw new Error("ADMIN_SETTINGS_RESULT_INVALID");
  }
  return Object.freeze({
    key: key as GovernedSettingKey,
    value: value.value,
    updatedBy,
    updatedAt,
  });
}

async function productionRepository(): Promise<SettingsRepository> {
  const { createSettingsRepository } = await import("./settings-repository.ts");
  return createSettingsRepository();
}

export async function resolveGovernedEnv(
  keys: readonly GovernedSettingKey[],
  fallback: EnvSource = process.env,
  repository?: SettingsReadRepository,
): Promise<EnvSource> {
  if (!featureFlag("FEATURE_ADMIN", fallback)) return fallback;
  const unique = [...new Set(keys)];
  if (unique.some((key) => !KEY_SET.has(key))) throw new Error("ADMIN_SETTING_KEY_INVALID");
  const rows = await (repository ?? await productionRepository()).read(unique);
  const requested = new Set(unique);
  const seen = new Set<GovernedSettingKey>();
  const overlay: Record<string, string | undefined> = { ...fallback };
  for (const candidate of rows) {
    const row = parseSettingRow(candidate);
    if (!requested.has(row.key) || seen.has(row.key)) throw new Error("ADMIN_SETTINGS_RESULT_INVALID");
    seen.add(row.key);
    overlay[row.key] = String(row.value);
  }
  return Object.freeze(overlay);
}

export async function resolveGovernedInteger(
  key: GovernedIntegerKey,
  fallback: EnvSource = process.env,
  repository?: SettingsReadRepository,
): Promise<number> {
  const env = await resolveGovernedEnv([key], fallback, repository);
  const raw = env[key]?.trim();
  if (!raw || !/^\d+$/.test(raw)) throw new Error("ADMIN_SETTING_INTEGER_UNAVAILABLE");
  const parsed = Number(raw);
  if (!validValue(key, parsed)) throw new Error("ADMIN_SETTING_INTEGER_INVALID");
  return parsed;
}

export async function resolveGovernedForcePullPrice(
  fallback: EnvSource = process.env,
  repository?: SettingsReadRepository,
): Promise<EnvSource> {
  return resolveGovernedEnv(["FORCE_PULL_PRICE_CENTS"], fallback, repository);
}

export async function getSetting(
  key: GovernedSettingKey,
  repository?: SettingsReadRepository,
): Promise<SettingRow | null> {
  const rows = await (repository ?? await productionRepository()).read([key]);
  if (rows.length === 0) return null;
  if (rows.length !== 1) throw new Error("ADMIN_SETTINGS_RESULT_INVALID");
  return parseSettingRow(rows[0]);
}

export async function setSetting(
  key: GovernedSettingKey,
  value: GovernedSettingValue,
  actorId: string,
  repository?: SettingsRepository,
): Promise<SettingRow> {
  if (!UUID.test(actorId)) throw new Error("ADMIN_SETTING_ACTOR_INVALID");
  if (!validValue(key, value)) throw new Error("ADMIN_SETTING_VALUE_INVALID");
  return (repository ?? await productionRepository()).write(key, value, actorId);
}

export { GOVERNED_SETTING_KEYS } from "./settings-types.ts";
export type {
  GovernedIntegerKey,
  GovernedSettingKey,
  GovernedSettingValue,
  SettingRow,
  SettingsReadRepository,
  SettingsRepository,
  SettingsWriteRepository,
} from "./settings-types.ts";
