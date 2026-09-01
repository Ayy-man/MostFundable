import "server-only";

import { getBillingAdapter } from "@/lib/billing";
import { getCrsAdapter } from "@/lib/crs/adapter";

import type { BillingAdapter } from "@/lib/billing/types";
import type { CrsAdapter, CrsMemberRef } from "@/lib/crs/types";

const SUBJECT = /^enrollment:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const WINDOW = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// R4D-03: the same age guard `purge.uploaded_reports` uses, so the tuple a worker is
// executing right now is not re-enqueued under a fresh window alongside it.
const STALE_AFTER_MS = 15 * 60 * 1000;

export type DerivedPurgeTarget = {
  clientId: string;
  enrollmentId: string;
  memberRef: CrsMemberRef | null;
};

export interface DerivedPurgeRepository {
  /** Metadata only: enrollment ids whose purge obligation is due and still outstanding. */
  listOutstanding(staleBefore: string): Promise<readonly string[]>;
  readTarget(enrollmentId: string): Promise<DerivedPurgeTarget | null>;
  /** R4C-07: the open provider-cancellation obligation, or null. */
  readPendingProviderCancel(enrollmentId: string): Promise<string | null>;
  completeProviderCancel(enrollmentId: string, subscriptionRef: string): Promise<void>;
  purge(enrollmentId: string, closedMemberRef: CrsMemberRef | null): Promise<number>;
}

type QueryResult = PromiseLike<{ data: unknown; error: unknown }>;
type Query = QueryResult & {
  eq(column: string, value: string): Query;
  maybeSingle(): QueryResult;
};
type AdminClient = {
  from(table: string): { select(columns: string): Query };
  rpc(name: string, args: Record<string, unknown>): QueryResult;
};

async function productionClient(): Promise<AdminClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient() as unknown as AdminClient;
}

export function createDerivedPurgeRepository(
  createClient: () => AdminClient | Promise<AdminClient> = productionClient,
): DerivedPurgeRepository {
  let clientPromise: Promise<AdminClient> | null = null;
  const client = () => (clientPromise ??= Promise.resolve(createClient()));
  return {
    async listOutstanding(staleBefore) {
      const { data, error } = await (await client()).rpc("list_derived_purge_targets", {
        p_stale_before: staleBefore,
      });
      if (error || !Array.isArray(data)) throw new Error("DERIVED_PURGE_TARGETS_READ_FAILED");
      return data.map((row) => {
        const id = (row as Record<string, unknown> | null)?.enrollment_id;
        if (typeof id !== "string" || !UUID.test(id)) throw new Error("DERIVED_PURGE_TARGETS_INVALID");
        return id;
      });
    },
    async readTarget(enrollmentId) {
      const { data, error } = await (await client()).from("enrollments")
        .select("id,client_id,crs_member_ref").eq("id", enrollmentId).maybeSingle();
      if (error) throw new Error("DERIVED_PURGE_READ_FAILED");
      if (data === null) return null;
      if (typeof data !== "object" || Array.isArray(data)) throw new Error("DERIVED_PURGE_RESULT_INVALID");
      const row = data as Record<string, unknown>;
      if (row.id !== enrollmentId || typeof row.client_id !== "string" ||
          !(row.crs_member_ref === null || typeof row.crs_member_ref === "string")) {
        throw new Error("DERIVED_PURGE_RESULT_INVALID");
      }
      return { enrollmentId, clientId: row.client_id, memberRef: row.crs_member_ref as CrsMemberRef | null };
    },
    async readPendingProviderCancel(enrollmentId) {
      const { data, error } = await (await client()).rpc("consumer_subscription_pending_provider_cancel", {
        p_enrollment_id: enrollmentId,
      });
      if (error) throw new Error("PROVIDER_CANCEL_READ_FAILED");
      const row = data as { subscription_ref?: unknown } | null;
      return typeof row?.subscription_ref === "string" ? row.subscription_ref : null;
    },
    async completeProviderCancel(enrollmentId, subscriptionRef) {
      const { data, error } = await (await client()).rpc("consumer_subscription_provider_cancel_completed", {
        p_enrollment_id: enrollmentId,
        p_subscription_ref: subscriptionRef,
      });
      if (error || (data as { completed?: unknown } | null)?.completed !== true) {
        throw new Error("PROVIDER_CANCEL_WRITE_FAILED");
      }
    },
    async purge(enrollmentId, closedMemberRef) {
      const { data, error } = await (await client()).rpc("purge_derived_enrollment", {
        p_enrollment_id: enrollmentId,
        p_closed_member_ref: closedMemberRef,
      });
      if (error || !Number.isInteger(data) || (data as number) < 0) {
        throw new Error("DERIVED_PURGE_WRITE_FAILED");
      }
      return data as number;
    },
  };
}

export type DerivedPurgeDependencies = {
  repository: DerivedPurgeRepository;
  getAdapter(): CrsAdapter;
  getBilling(): Pick<BillingAdapter, "cancel">;
};

export async function runDerivedPurge(
  subject: string,
  window: string,
  overrides: Partial<DerivedPurgeDependencies> = {},
): Promise<{ status: "ok" | "skipped" | "failed"; rows?: number }> {
  const enrollmentId = SUBJECT.exec(subject)?.[1];
  if (!enrollmentId || !WINDOW.test(window)) return { status: "failed" };
  const deps: DerivedPurgeDependencies = {
    repository: createDerivedPurgeRepository(),
    getAdapter: getCrsAdapter,
    getBilling: getBillingAdapter,
    ...overrides,
  };
  try {
    const target = await deps.repository.readTarget(enrollmentId);
    if (!target) return { status: "skipped", rows: 0 };
    // R4C-07: the billing subscription is the other provider-side resource this
    // close step owns. It completes only on provider confirmation, so a
    // provider failure leaves the obligation open for the next tuple.
    const providerCancelRef = await deps.repository.readPendingProviderCancel(enrollmentId);
    if (providerCancelRef) {
      await deps.getBilling().cancel({ atPeriodEnd: false, subscriptionRef: providerCancelRef });
      await deps.repository.completeProviderCancel(enrollmentId, providerCancelRef);
    }
    if (target.memberRef) await deps.getAdapter().closeMember(target.memberRef);
    const rows = await deps.repository.purge(enrollmentId, target.memberRef);
    return { status: "ok", rows };
  } catch {
    return { status: "failed" };
  }
}

/**
 * R4D-03: the daily rediscovery `purge.derived` declares a cadence for. A tuple's three
 * attempts bound that tuple; they must not bound the obligation, so every tick re-reads the
 * cancellations and due revocations that still hold a provider member reference or a bounded
 * derived graph and emits a fresh window for them.
 */
export async function listDerivedPurgeTargets(
  window: string,
  now: Date = new Date(),
  repository: DerivedPurgeRepository = createDerivedPurgeRepository(),
): Promise<Array<{ subject: string; window: string }>> {
  if (!WINDOW.test(window)) throw new Error("PURGE_WINDOW_INVALID");
  const staleBefore = new Date(now.getTime() - STALE_AFTER_MS).toISOString();
  const enrollmentIds = await repository.listOutstanding(staleBefore);
  return enrollmentIds.map((enrollmentId) => ({ subject: `enrollment:${enrollmentId}`, window }));
}
