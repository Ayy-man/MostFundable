import { resolvePrice } from "@/lib/pricing";

const DEFAULT_GRACE_DAYS = 7;

type Env = Readonly<Record<string, string | undefined>>;

/**
 * The subset of an `orgs` row that participates in pricing. Camel-cased because
 * the repository layer maps the row before it reaches here; nothing in this
 * module knows the database column names.
 */
export type OperatorPriceOrg = {
  basePriceCents?: number | null;
  plan?: string | null;
  seatPriceCents?: number | null;
};

export type OperatorPrices = {
  basePriceCents: number;
  basePriceRef: string;
  currency: "usd";
  seatPriceCents: number;
  seatPriceRef: string;
};

function positiveInteger(value: string | undefined): number | null {
  const parsed = Number.parseInt(value?.trim() ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/** Reads pricing lazily so an empty build environment remains valid. */
export function operatorPrices(
  env: Env = process.env,
  org?: OperatorPriceOrg,
): OperatorPrices {
  const base = resolvePrice("operator_base", {
    env,
    config: org?.basePriceCents,
    plan: org?.plan,
  });
  const seat = resolvePrice("operator_seat", {
    env,
    config: org?.seatPriceCents,
    plan: org?.plan,
  });
  return {
    basePriceCents: base.valueCents,
    basePriceRef: base.priceRef ?? "mock_price_operator_base",
    currency: base.currency,
    seatPriceCents: seat.valueCents,
    seatPriceRef: seat.priceRef ?? "mock_price_operator_seat",
  };
}

/**
 * How long a grace window stays open, in days. Nothing expires a window on a
 * timer — leaving grace still requires an event — so this only sizes the
 * `grace_until` the ladder records for a reader.
 */
export function operatorGraceDays(env: Env = process.env): number {
  return positiveInteger(env.OPERATOR_GRACE_DAYS) ?? DEFAULT_GRACE_DAYS;
}
