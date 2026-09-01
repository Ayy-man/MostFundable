import "server-only";

import { createClient } from "@/lib/supabase/server";

import { featureFlag } from "@/lib/env";
import { parseConsumerPaidRefreshHistory } from "./paid-refresh-read.ts";

import type { SessionProfile } from "@/lib/auth/session";
import type { ConsumerPaidRefreshRecord } from "./paid-refresh-read.ts";

interface PaidRefreshHistoryRpcClient {
  rpc(
    name: "consumer_paid_refresh_history",
    args: { p_actor_id: string | null; p_include_mock: boolean },
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

const RPC_ROW_KEYS = [
  "amount_cents",
  "completed_at",
  "currency",
  "paid_at",
  "request_id",
  "requested_at",
  "status",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactRpcRow(value: unknown): value is Record<(typeof RPC_ROW_KEYS)[number], unknown> {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === RPC_ROW_KEYS.length
    && keys.every((key, index) => key === RPC_ROW_KEYS[index]);
}

async function historyRpcClient(
  session: SessionProfile,
): Promise<{ actorId: string | null; db: PaidRefreshHistoryRpcClient }> {
  if (featureFlag("FEATURE_REAL_AUTH")) {
    return {
      actorId: null,
      db: await createClient() as unknown as PaidRefreshHistoryRpcClient,
    };
  }

  // The frozen demo selector has no Supabase JWT. Its server-only service client may name only the
  // already-resolved demo consumer; the database repeats the active consumer/client scope checks.
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return {
    actorId: session.id,
    db: createAdminClient() as unknown as PaidRefreshHistoryRpcClient,
  };
}

/**
 * Read the consumer's durable refresh history through one database projection. Real-auth calls
 * derive the actor from auth.uid(); the frozen demo server supplies its already-resolved actor.
 * Both paths require one active owned client and expose only provider-free status fields.
 */
export async function readConsumerPaidRefreshHistory(
  session: SessionProfile,
): Promise<readonly ConsumerPaidRefreshRecord[]> {
  if (session.role !== "consumer" || session.orgId === null) {
    throw new Error("PAID_REFRESH_HISTORY_FORBIDDEN");
  }

  const { actorId, db } = await historyRpcClient(session);
  const result = await db.rpc("consumer_paid_refresh_history", {
    p_actor_id: actorId,
    p_include_mock: process.env.NODE_ENV !== "production",
  });
  if (result.error || !Array.isArray(result.data) || result.data.length > 100) {
    throw new Error("PAID_REFRESH_HISTORY_READ_FAILED");
  }

  const history: ConsumerPaidRefreshRecord[] = [];
  const requestIds = new Set<string>();
  for (const row of result.data) {
    if (!exactRpcRow(row)) {
      throw new Error("PAID_REFRESH_HISTORY_INVALID");
    }
    const parsed = parseConsumerPaidRefreshHistory({
      refreshes: [{
        amountCents: row.amount_cents,
        completedAt: row.completed_at,
        currency: row.currency,
        paidAt: row.paid_at,
        requestId: row.request_id,
        requestedAt: row.requested_at,
        status: row.status,
      }],
    });
    if (parsed === null || requestIds.has(parsed[0].requestId)) {
      throw new Error("PAID_REFRESH_HISTORY_INVALID");
    }
    requestIds.add(parsed[0].requestId);
    history.push(parsed[0]);
  }
  return history;
}
