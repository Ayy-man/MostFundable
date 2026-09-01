/**
 * Browser-safe contract for the consumer's durable on-demand refresh history.
 *
 * A status and a charge are deliberately separate facts. `paidAt` exists only when the server
 * found the immutable succeeded payment event; `completedAt` exists only when the linked analysis
 * job and its persisted run both completed. The UI must not infer either one from a request state.
 */
export type ConsumerPaidRefreshStatus =
  | "payment_pending"
  | "payment_action_required"
  | "payment_failed"
  | "payment_review"
  | "paid"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "unfulfillable"
  | "remediated";

export interface ConsumerPaidRefreshRecord {
  readonly amountCents: number;
  readonly completedAt: string | null;
  readonly currency: "usd";
  readonly paidAt: string | null;
  readonly requestId: string;
  readonly requestedAt: string;
  readonly status: ConsumerPaidRefreshStatus;
}

export type ConsumerPaidRefreshHistoryRead =
  | { readonly status: "ready"; readonly refreshes: readonly ConsumerPaidRefreshRecord[] }
  | { readonly status: "unavailable" };

const STATUSES = new Set<ConsumerPaidRefreshStatus>([
  "payment_pending",
  "payment_action_required",
  "payment_failed",
  "payment_review",
  "paid",
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
  "unfulfillable",
  "remediated",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInstant(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function parseRecord(value: unknown): ConsumerPaidRefreshRecord | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.requestId !== "string" || value.requestId.length === 0
    || !Number.isSafeInteger(value.amountCents) || (value.amountCents as number) <= 0
    || value.currency !== "usd"
    || !isInstant(value.requestedAt)
    || !(value.paidAt === null || isInstant(value.paidAt))
    || !(value.completedAt === null || isInstant(value.completedAt))
    || typeof value.status !== "string"
    || !STATUSES.has(value.status as ConsumerPaidRefreshStatus)
  ) return null;

  // Completion without durable payment evidence is an impossible consumer-facing assertion.
  if (value.status === "completed" && (value.paidAt === null || value.completedAt === null)) {
    return null;
  }

  return {
    amountCents: value.amountCents as number,
    completedAt: value.completedAt as string | null,
    currency: "usd",
    paidAt: value.paidAt as string | null,
    requestId: value.requestId,
    requestedAt: value.requestedAt,
    status: value.status as ConsumerPaidRefreshStatus,
  };
}

export function parseConsumerPaidRefreshHistory(value: unknown): readonly ConsumerPaidRefreshRecord[] | null {
  if (!isRecord(value) || !Array.isArray(value.refreshes)) return null;
  const parsed: ConsumerPaidRefreshRecord[] = [];
  for (const row of value.refreshes) {
    const record = parseRecord(row);
    if (record === null) return null;
    parsed.push(record);
  }
  return parsed;
}

export async function fetchConsumerPaidRefreshHistory(): Promise<ConsumerPaidRefreshHistoryRead> {
  try {
    const response = await fetch("/api/refresh-now/status", {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) return { status: "unavailable" };
    const body = await response.json().catch(() => null);
    const refreshes = parseConsumerPaidRefreshHistory(body);
    return refreshes === null ? { status: "unavailable" } : { refreshes, status: "ready" };
  } catch {
    return { status: "unavailable" };
  }
}

export function isPaidRefreshInProgress(status: ConsumerPaidRefreshStatus): boolean {
  return status === "payment_pending" || status === "paid" || status === "queued" || status === "running";
}

/** An exact-key replay may safely reconcile these states without creating a second purchase. */
export function paidRefreshCanResume(status: ConsumerPaidRefreshStatus): boolean {
  return status === "payment_pending"
    || status === "payment_action_required"
    || status === "paid";
}

/**
 * States that must prevent another purchase, including provider states that
 * are terminal for polling but still carry unresolved money or remediation.
 */
export function paidRefreshBlocksNewPurchase(status: ConsumerPaidRefreshStatus): boolean {
  return status === "payment_pending"
    || status === "payment_action_required"
    || status === "payment_review"
    || status === "paid"
    || status === "queued"
    || status === "running"
    || status === "unfulfillable";
}
