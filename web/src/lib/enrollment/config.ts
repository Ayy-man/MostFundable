import { resolvePrice } from "@/lib/pricing";

export type EnrollmentPrice = {
  currency: "usd";
  priceCents: number;
  priceRef: string;
};

/** Reads pricing lazily so an empty build environment remains valid. */
export function enrollmentPrice(
  env: Readonly<Record<string, string | undefined>> = process.env,
): EnrollmentPrice {
  const resolved = resolvePrice("consumer_monitoring", { env });

  return {
    currency: resolved.currency,
    priceCents: resolved.valueCents,
    priceRef: resolved.priceRef ?? "mock_price_monitoring",
  };
}
