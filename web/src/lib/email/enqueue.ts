import "server-only";

import { featureFlag, type EnvSource } from "@/lib/env";

export type OperatorCardFailureEnqueueResult = Readonly<{
  deliveryId: string;
  inserted: boolean;
}>;

export interface OperatorCardFailureEmailRepository {
  enqueue(orgId: string, eventId: string): Promise<OperatorCardFailureEnqueueResult>;
}

interface RpcResult {
  readonly data: unknown;
  readonly error: unknown;
}

export interface OperatorCardFailureRpcClient {
  rpc(name: string, args: Readonly<Record<string, unknown>>): PromiseLike<RpcResult>;
}

// Postgres `uuid` shape, not strict RFC-4122: seeded ids carry zero version/variant nibbles (GAPS G-3B-06/07).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVENT_ID = /^[A-Za-z0-9._:-]{1,255}$/;

async function defaultClient(): Promise<OperatorCardFailureRpcClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient() as unknown as OperatorCardFailureRpcClient;
}

function mapResult(value: unknown): OperatorCardFailureEnqueueResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("EMAIL_ENQUEUE_RESULT_INVALID");
  }
  const row = value as Record<string, unknown>;
  if (typeof row.delivery_id !== "string" || typeof row.inserted !== "boolean") {
    throw new Error("EMAIL_ENQUEUE_RESULT_INVALID");
  }
  return { deliveryId: row.delivery_id, inserted: row.inserted };
}

export function createOperatorCardFailureEmailRepository(
  injectedClient?: OperatorCardFailureRpcClient,
): OperatorCardFailureEmailRepository {
  return {
    async enqueue(orgId, eventId) {
      const client = injectedClient ?? await defaultClient();
      const result = await client.rpc("enqueue_operator_card_failure_email", {
        p_billing_event_id: eventId,
        p_org_id: orgId,
      });
      if (result.error || !Array.isArray(result.data) || result.data.length !== 1) {
        throw new Error("EMAIL_ENQUEUE_WRITE_FAILED");
      }
      return mapResult(result.data[0]);
    },
  };
}

export async function enqueueOperatorCardFailureEmail(
  input: Readonly<{ orgId: string; eventId: string }>,
  options: Readonly<{
    env?: EnvSource;
    repository?: OperatorCardFailureEmailRepository;
  }> = {},
): Promise<OperatorCardFailureEnqueueResult | null> {
  if (!UUID.test(input.orgId)) throw new Error("EMAIL_ENQUEUE_ORG_ID_INVALID");
  if (!EVENT_ID.test(input.eventId)) throw new Error("EMAIL_ENQUEUE_EVENT_ID_INVALID");

  if (!featureFlag("FEATURE_EMAIL", options.env)) return null;

  const repository = options.repository ?? createOperatorCardFailureEmailRepository();
  return repository.enqueue(input.orgId, input.eventId);
}
