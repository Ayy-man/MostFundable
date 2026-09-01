import type { EnvSource } from "@/lib/env";

export type PricingSource = "env" | "config" | "placeholder" | "ruled_null";

export type PriceKey =
  | "consumer_monitoring"
  | "force_pull"
  | "operator_base"
  | "operator_seat";

export type ConfiguredPriceKey =
  | "fee_upfront"
  | "fee_success"
  | "fee_trigger"
  | "fee_custom_total";

export type PercentageKey =
  | "monitoring_split"
  | "saas_referral"
  | "fee_percentage";

export type ReferralBase = "platform_subscription" | "consumer_subscriptions";

export interface PricingOptions {
  env?: EnvSource;
  config?: number | null;
  configRef?: string | null;
  plan?: string | null;
}

export interface ResolvedPrice {
  readonly key: PriceKey | ConfiguredPriceKey;
  readonly valueCents: number;
  readonly currency: "usd";
  readonly source: Exclude<PricingSource, "ruled_null">;
  readonly priceRef: string | null;
  readonly priceRefSource: Exclude<PricingSource, "ruled_null"> | null;
}

export interface ResolvedPercentage {
  readonly key: PercentageKey;
  readonly value: number | null;
  readonly placeholder: number | null;
  readonly source: PricingSource;
}

export interface ResolvedReferralBase {
  readonly value: ReferralBase;
  readonly source: Exclude<PricingSource, "ruled_null">;
}
