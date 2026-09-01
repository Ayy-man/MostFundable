import { resolveDriver, type EnvSource } from "@/lib/env";

/**
 * A production purchase is safe only when both sides of the transaction are
 * real: Stripe can collect the add-on and CRS can fulfil the resulting pull.
 * Local and test environments may still exercise deterministic mock ports,
 * but a production flag can never charge a card for a mock analysis.
 */
export function paidRefreshPurchasesReady(env: EnvSource = process.env): boolean {
  if (env.NODE_ENV !== "production") return true;
  try {
    return resolveDriver("billing", env) === "stripe"
      && resolveDriver("crs", env) === "sandbox";
  } catch {
    return false;
  }
}

/** Historical mock requests are test evidence, not consumer payment history. */
export function paidRefreshDriverVisible(driver: unknown, env: EnvSource = process.env): boolean {
  return driver === "stripe" || (env.NODE_ENV !== "production" && driver === "mock");
}
