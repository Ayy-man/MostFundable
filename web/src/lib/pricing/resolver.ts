import type {
  ConfiguredPriceKey,
  PercentageKey,
  PriceKey,
  PricingOptions,
  PricingSource,
  ReferralBase,
  ResolvedPercentage,
  ResolvedPrice,
  ResolvedReferralBase,
} from "./types.ts";

const MAX_CENTS = 100_000_000;
const CENTS_PATTERN = /^[1-9]\d*$/;
const PERCENT_PATTERN = /^(?:100(?:\.0{1,2})?|(?:\d|[1-9]\d)(?:\.\d{1,2})?)$/;

const PRICE_SPECS = {
  consumer_monitoring: {
    centsEnv: "CONSUMER_MONITORING_PRICE_CENTS",
    defaultCents: 4_900,
    defaultRef: "mock_price_monitoring",
    refEnv: "CONSUMER_MONITORING_PRICE_REF",
  },
  force_pull: {
    centsEnv: "FORCE_PULL_PRICE_CENTS",
    defaultCents: 1_900,
    defaultRef: null,
    refEnv: null,
  },
  operator_base: {
    centsEnv: "OPERATOR_BASE_PRICE_CENTS",
    defaultCents: 49_700,
    defaultRef: "mock_price_operator_base",
    refEnv: "STRIPE_PRICE_OPERATOR_BASE",
  },
  operator_seat: {
    centsEnv: "OPERATOR_SEAT_PRICE_CENTS",
    defaultCents: 2_900,
    defaultRef: "mock_price_operator_seat",
    refEnv: "STRIPE_PRICE_OPERATOR_SEAT",
  },
} as const satisfies Record<PriceKey, {
  centsEnv: string;
  defaultCents: number;
  defaultRef: string | null;
  refEnv: string | null;
}>;

function configuredCents(value: number | null | undefined, allowZero: boolean): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > MAX_CENTS) {
    throw new Error("PRICING_CENTS_INVALID");
  }
  return value;
}

function envCents(raw: string | undefined): number | null {
  const value = raw?.trim();
  if (!value) return null;
  if (!CENTS_PATTERN.test(value)) throw new Error("PRICING_CENTS_INVALID");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > MAX_CENTS) {
    throw new Error("PRICING_CENTS_INVALID");
  }
  return parsed;
}

function boundedReference(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized) return null;
  if (normalized.length > 255 || /[\r\n]/.test(normalized)) {
    throw new Error("PRICING_REFERENCE_INVALID");
  }
  return normalized;
}

function tierReference(raw: string | null, plan: string | null | undefined): string | null {
  if (!raw || !raw.includes("=")) return raw;
  const tier = plan?.trim();
  if (!tier) return null;
  for (const entry of raw.split(",")) {
    const separator = entry.indexOf("=");
    if (separator < 1) continue;
    const name = entry.slice(0, separator).trim();
    const reference = boundedReference(entry.slice(separator + 1));
    if (name === tier && reference) return reference;
  }
  return null;
}

function referenceFor(
  refEnv: string | null,
  defaultRef: string | null,
  options: PricingOptions,
): Pick<ResolvedPrice, "priceRef" | "priceRefSource"> {
  const env = options.env ?? process.env;
  const selected = refEnv ? tierReference(boundedReference(env[refEnv]), options.plan) : null;
  if (selected) return { priceRef: selected, priceRefSource: "env" };
  const config = boundedReference(options.configRef);
  if (config) return { priceRef: config, priceRefSource: "config" };
  return {
    priceRef: defaultRef,
    priceRefSource: defaultRef === null ? null : "placeholder",
  };
}

export function resolvePrice(key: PriceKey, options: PricingOptions = {}): ResolvedPrice {
  const spec = PRICE_SPECS[key];
  if (!spec) throw new Error("PRICING_KEY_INVALID");
  const env = options.env ?? process.env;
  const fromEnv = envCents(env[spec.centsEnv]);
  const fromConfig = configuredCents(options.config, false);
  const valueCents = fromEnv ?? fromConfig ?? spec.defaultCents;
  const source: Exclude<PricingSource, "ruled_null"> = fromEnv !== null
    ? "env"
    : fromConfig !== null
      ? "config"
      : "placeholder";
  return Object.freeze({
    key,
    valueCents,
    currency: "usd" as const,
    source,
    ...referenceFor(spec.refEnv, spec.defaultRef, options),
  });
}

export function resolveConfiguredPrice(
  key: ConfiguredPriceKey,
  valueCents: number,
): ResolvedPrice {
  const value = configuredCents(valueCents, true);
  if (value === null) throw new Error("PRICING_CONFIG_REQUIRED");
  return Object.freeze({
    key,
    valueCents: value,
    currency: "usd" as const,
    source: "config" as const,
    priceRef: null,
    priceRefSource: null,
  });
}

function configuredPercentage(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value < 0 || value > 100 || Math.round(value * 100) !== value * 100) {
    throw new Error("PRICING_PERCENT_INVALID");
  }
  return value;
}

function envPercentage(raw: string | undefined): number | null {
  const value = raw?.trim();
  if (!value) return null;
  if (!PERCENT_PATTERN.test(value)) throw new Error("PRICING_PERCENT_INVALID");
  return configuredPercentage(Number(value));
}

export function resolvePercentage(
  key: PercentageKey,
  options: PricingOptions = {},
): ResolvedPercentage {
  const env = options.env ?? process.env;
  if (key === "monitoring_split") {
    const fromEnv = envPercentage(env.MONITORING_SPLIT_PCT);
    const fromConfig = configuredPercentage(options.config);
    if (fromEnv !== null) {
      return Object.freeze({ key, value: fromEnv, placeholder: 40, source: "env" as const });
    }
    if (fromConfig !== null) {
      return Object.freeze({ key, value: fromConfig, placeholder: 40, source: "config" as const });
    }
    return Object.freeze({ key, value: null, placeholder: 40, source: "ruled_null" as const });
  }
  const configured = configuredPercentage(options.config);
  if (configured === null) throw new Error("PRICING_CONFIG_REQUIRED");
  return Object.freeze({ key, value: configured, placeholder: null, source: "config" as const });
}

export function resolveReferralBase(options: PricingOptions = {}): ResolvedReferralBase {
  const raw = (options.env ?? process.env).SAAS_REFERRAL_BASE?.trim();
  const fromEnv = raw || null;
  const fromConfig = typeof options.configRef === "string" ? options.configRef.trim() : "";
  const selected = fromEnv || fromConfig || "platform_subscription";
  if (selected !== "platform_subscription" && selected !== "consumer_subscriptions") {
    throw new Error("PRICING_REFERRAL_BASE_INVALID");
  }
  const value = selected as ReferralBase;
  return Object.freeze({
    value,
    source: fromEnv ? "env" : fromConfig ? "config" : "placeholder",
  });
}
