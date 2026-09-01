import { MisconfiguredDriverError, type EnvSource } from "@/lib/env";

const PROHIBITED = /[<>\\'"*]/;

export function readStatementDescriptor(
  source: EnvSource = process.env,
): string | null {
  const descriptor = source.STRIPE_STATEMENT_DESCRIPTOR?.trim();
  if (!descriptor) return null;
  if (
    descriptor.length < 5 ||
    descriptor.length > 22 ||
    !/[A-Za-z]/.test(descriptor) ||
    !/^[\x20-\x7E]+$/.test(descriptor) ||
    PROHIBITED.test(descriptor)
  ) {
    throw new MisconfiguredDriverError(
      "The Stripe statement descriptor is invalid.",
      "billing",
      "STRIPE_STATEMENT_DESCRIPTOR",
      ["STRIPE_STATEMENT_DESCRIPTOR"],
    );
  }
  return descriptor;
}
