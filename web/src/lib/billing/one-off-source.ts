import "server-only";

import { readConsumerOneOffPaymentSource } from "./repository-operator.ts";

import type { OneOffPaymentSource } from "./types.ts";

// Postgres `uuid` shape, not strict RFC-4122: seeded ids carry zero version/variant nibbles (GAPS G-3B-06/07).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SourceReader = typeof readConsumerOneOffPaymentSource;

export async function readOneOffPaymentSource(
  clientId: string,
  options: { reader?: SourceReader } = {},
): Promise<OneOffPaymentSource> {
  if (!UUID.test(clientId)) throw new Error("ONE_OFF_PAYMENT_SOURCE_CLIENT_INVALID");
  const result = await (options.reader ?? readConsumerOneOffPaymentSource)(clientId);
  if (!result.ok || !result.value) throw new Error("ONE_OFF_PAYMENT_SOURCE_UNAVAILABLE");
  return Object.freeze({ ...result.value });
}
