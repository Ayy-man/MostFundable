import type { EnvSource } from "@/lib/env";

export const GOVERNED_SETTING_KEYS = [
  "SUPPORT_DRAFT_CONFIDENCE_THRESHOLD",
  "TRIAL_DAYS",
  "OPERATOR_GRACE_DAYS",
  "FORCE_PULL_PRICE_CENTS",
] as const;

export type GovernedSettingKey = (typeof GOVERNED_SETTING_KEYS)[number];
export type GovernedIntegerKey = Exclude<GovernedSettingKey, "SUPPORT_DRAFT_CONFIDENCE_THRESHOLD">;
export type GovernedSettingValue = number;

export type SettingRow = Readonly<{
  key: GovernedSettingKey;
  value: GovernedSettingValue;
  updatedBy: string | null;
  updatedAt: string;
}>;

export interface SettingsReadRepository {
  read(keys: readonly GovernedSettingKey[]): Promise<readonly SettingRow[]>;
}

export interface SettingsWriteRepository {
  write(key: GovernedSettingKey, value: GovernedSettingValue, actorId: string): Promise<SettingRow>;
}

export type SettingsRepository = SettingsReadRepository & SettingsWriteRepository;

export type GovernedEnvSource = EnvSource;
