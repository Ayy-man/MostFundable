import "server-only";

// repository-operator.ts — the only privileged door into operator billing.
//
// This is the billing tree's counterpart to `src/lib/enrollment/repository.ts`,
// and the reason it is a separate file rather than a few functions bolted onto
// the service is containment: `web/scripts/verify-source-gates.mjs` keeps a
// list of files allowed to import the service-role client, and one file per
// tree is what makes that list meaningful. Nothing else under `src/lib/billing/`
// may import `@/lib/supabase/admin`.
//
// Two further rules hold here and are worth stating because breaking either one
// would be invisible in a passing test:
//
//   * Every write goes through a security-definer function from migration 071
//     or 073. There is no `.insert()`, `.update()` or `.delete()` in this file,
//     which is why the functions exist at all — a direct table write would skip
//     the transaction-local marker migration 070's guard looks for.
//   * `readOperatorBillingState` deliberately does not use the admin client. It
//     takes the caller's session-scoped client so row-level security decides
//     what an operator may see about its own organization.
//
// Postgres error codes are mapped to a typed AppError. A provider or database
// message is never returned to a caller.

import { createAdminClient } from "@/lib/supabase/admin";

import { AppError } from "@/lib/enrollment/errors";
import type {
  OneOffPaymentSource,
  OperatorMembership,
  OperatorSubscriptionStatus,
} from "@/lib/billing/types";

// ---------------------------------------------------------------------------
// The narrow shape this file needs from a Supabase client.
//
// Cast structurally rather than typed against `Database`, because the generated
// types file is shared with every other lane and regenerating it here would put
// this phase's tables into a file it does not own. Lane B's repository casts the
// same way for the same reason.
// ---------------------------------------------------------------------------

type DatabaseFailure = { code?: string | null };
type DatabaseResponse<T> = PromiseLike<{
  count?: number | null;
  data: T | null;
  error: DatabaseFailure | null;
}>;

type BillingQuery = DatabaseResponse<unknown> & {
  eq(column: string, value: string): BillingQuery;
  limit(count: number): BillingQuery;
  maybeSingle(): DatabaseResponse<unknown>;
  select(
    columns: string,
    options?: { count?: "exact"; head?: boolean },
  ): BillingQuery;
};

type BillingClient = {
  from(table: string): BillingQuery;
  rpc(name: string, args: Record<string, unknown>): DatabaseResponse<unknown>;
};

/**
 * What a caller must hand to `readOperatorBillingState`: any Supabase client,
 * so long as it is the session-scoped one. Typed as a read-only surface so a
 * write cannot be smuggled through the read path.
 */
export type OperatorReadClient = {
  from(table: string): BillingQuery;
  rpc(name: string, args: Record<string, unknown>): DatabaseResponse<unknown>;
};

export type OperatorRepositoryResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: AppError };

export type OneOffPaymentSourceResult = OperatorRepositoryResult<OneOffPaymentSource | null>;

export type ClientCapRow = { activeCount: number; clientCap: number | null };
export type RaiseClientCapRow = {
  applied: boolean;
  clientCap: number;
  from: number | null;
  orgId: string;
};

// ---------------------------------------------------------------------------
// Row and verdict shapes
// ---------------------------------------------------------------------------

export type OperatorSubscriptionRow = {
  baseItemRef: string | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  customerRef: string | null;
  orgId: string;
  provider: string;
  seatItemRef: string | null;
  seatQuantity: number;
  status: OperatorSubscriptionStatus | null;
  subscriptionRef: string | null;
};

export type OperatorSeatSyncRow = {
  attempts: number;
  desiredQuantity: number;
  generation: string;
  orgId: string;
  status: string;
};

/**
 * Everything the start path needs about an organization in one read: the two
 * optional price columns, the tier the price reference may be selected by, and
 * the seat arithmetic. `seatCount` is the number of operator members, which is
 * the same population migration 072's trigger counts.
 */
export type OperatorOrgBillingProfile = {
  basePriceCents: number | null;
  name: string;
  ownerEmail: string | null;
  plan: string | null;
  seatCount: number;
  seatPriceCents: number | null;
  seatsIncluded: number | null;
};

export type OperatorBillingState = {
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  graceUntil: string | null;
  membership: OperatorMembership | null;
  clientMeter: { cap: number | null; count: number; label: string };
  plan: string | null;
  seatQuantity: number;
  seatSync: { attempts: number; desiredQuantity: number; status: string } | null;
  seatsIncluded: number | null;
  status: OperatorSubscriptionStatus | null;
  subscriptionRef: string | null;
};

export type ApplyBillingEventInput = {
  attemptCount: number | null;
  currentPeriodEnd: string | null;
  eventId: string;
  eventType: string;
  nextAttemptAt: string | null;
  occurredAt: string;
  orgId: string;
  source: string;
  status: string | null;
  subscriptionRef: string | null;
};

export type ApplyBillingEventVerdict = {
  applied: boolean;
  fromMembership: OperatorMembership | null;
  reasonCode: string;
  toMembership: OperatorMembership | null;
};

export type UpsertSubscriptionInput = {
  baseItemRef: string | null;
  basePriceRef: string;
  currentPeriodEnd: string | null;
  customerRef: string | null;
  orgId: string;
  provider: string;
  seatItemRef: string | null;
  seatPriceRef: string;
  status: string;
  subscriptionRef: string | null;
};

export type UpsertSubscriptionVerdict = {
  applied: boolean;
  created: boolean;
  reasonCode: string;
  status: string | null;
  subscriptionRef: string | null;
};

export type SetSeatQuantityVerdict = {
  applied: boolean;
  outboxStatus: string | null;
  reasonCode: string;
  seatQuantity: number | null;
};

export type SeatSyncFailureVerdict = {
  applied: boolean;
  attempts: number | null;
  reasonCode: string;
  status: string | null;
};

export type SubscriptionCreationPath = "checkout" | "direct";

export type SubscriptionCreationIntentVerdict = {
  claimed: boolean;
  /**
   * When the intent was first opened, surfaced by migration 358 because the age
   * of a recovered intent is what decides whether the provider may still be
   * deduplicating its idempotency key (R4C-09).
   */
  createdAt: string | null;
  operationId: string | null;
  providerRef: string | null;
  reasonCode: string;
  status: string | null;
};

/** Why a pending intent was parked for a human. Matches migration 358's check. */
export type SubscriptionIntentReviewReason =
  | "ambiguous_provider_match"
  | "unreconciled_past_retention";

export type CompleteSubscriptionCreationIntentVerdict = {
  applied: boolean;
  reasonCode: string;
};

/** R5C-06: metadata only. No provider reference — the reconciler must ask the provider. */
export type StaleSubscriptionCreationIntent = {
  createdAt: string;
  creationPath: SubscriptionCreationPath;
  operationId: string;
  orgId: string;
};

export interface OperatorBillingRepository {
  applyBillingEvent(
    input: ApplyBillingEventInput,
  ): Promise<OperatorRepositoryResult<ApplyBillingEventVerdict>>;
  claimSubscriptionCreationIntent(
    orgId: string,
    creationPath: SubscriptionCreationPath,
  ): Promise<OperatorRepositoryResult<SubscriptionCreationIntentVerdict>>;
  completeSubscriptionCreationIntent(
    orgId: string,
    operationId: string,
    creationPath: SubscriptionCreationPath,
    providerRef: string,
  ): Promise<OperatorRepositoryResult<CompleteSubscriptionCreationIntentVerdict>>;
  failExpiredCheckoutIntent(
    orgId: string,
    operationId: string,
    providerRef: string,
  ): Promise<OperatorRepositoryResult<CompleteSubscriptionCreationIntentVerdict>>;
  readOperatorSubscriptionByRef(input: {
    customerRef: string | null;
    subscriptionRef: string | null;
  }): Promise<OperatorRepositoryResult<OperatorSubscriptionRow | null>>;
  reviewSubscriptionCreationIntent(
    orgId: string,
    operationId: string,
    reason: SubscriptionIntentReviewReason,
  ): Promise<OperatorRepositoryResult<CompleteSubscriptionCreationIntentVerdict>>;
  /** R5C-06: pending intents no live request still owns, so a tick can finish them. */
  listStaleSubscriptionCreationIntents(
    staleBefore: string,
    limit?: number,
  ): Promise<OperatorRepositoryResult<readonly StaleSubscriptionCreationIntent[]>>;
  readOperatorSubscriptionForOrg(
    orgId: string,
  ): Promise<OperatorRepositoryResult<OperatorSubscriptionRow | null>>;
  readOrgBillingProfile(
    orgId: string,
  ): Promise<OperatorRepositoryResult<OperatorOrgBillingProfile | null>>;
  readPendingSeatSync(
    orgId: string,
  ): Promise<OperatorRepositoryResult<OperatorSeatSyncRow | null>>;
  recordSeatSyncFailure(
    orgId: string,
    generation: string,
    errorCode: string,
  ): Promise<OperatorRepositoryResult<SeatSyncFailureVerdict>>;
  setSeatQuantity(
    orgId: string,
    quantity: number,
    generation: string,
    source: string,
  ): Promise<OperatorRepositoryResult<SetSeatQuantityVerdict>>;
  upsertSubscription(
    input: UpsertSubscriptionInput,
  ): Promise<OperatorRepositoryResult<UpsertSubscriptionVerdict>>;
}

export interface OperatorBillingStateReader {
  readOperatorBillingState(
    orgId: string,
  ): Promise<OperatorRepositoryResult<OperatorBillingState | null>>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function adminClient(): BillingClient {
  return createAdminClient() as unknown as BillingClient;
}

/**
 * A database code becomes a typed application code. The message is written here
 * and never taken from the driver, so nothing a third party controls reaches a
 * response body or a log line through this path.
 */
function databaseError(error: DatabaseFailure): AppError {
  if (error.code === "23505") {
    return new AppError("conflict", "The requested record already exists.");
  }
  if (error.code === "23514") {
    return new AppError("conflict", "The requested billing change is not permitted.");
  }
  if (error.code === "42501") {
    return new AppError("forbidden", "The requested write is not permitted.");
  }
  return new AppError("unexpected", "The database request could not be completed.");
}

type Row = Record<string, unknown>;

function asRow(value: unknown): Row | null {
  return value && typeof value === "object" ? (value as Row) : null;
}

function text(row: Row, key: string): string | null {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

function integer(row: Row, key: string): number | null {
  const value = row[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function firstRow(value: unknown): Row | null {
  if (Array.isArray(value)) return asRow(value[0]);
  return asRow(value);
}

function clientCapRow(value: unknown): ClientCapRow | null {
  const row = firstRow(value);
  if (!row) return null;
  const activeCount = integer(row, "active_count");
  const capValue = row.client_cap;
  if (
    activeCount === null || !Number.isInteger(activeCount) || activeCount < 0 ||
    !(capValue === null || (typeof capValue === "number" && Number.isInteger(capValue) && capValue >= 0))
  ) return null;
  return { activeCount, clientCap: capValue as number | null };
}

function flag(row: Row, key: string): boolean {
  return row[key] === true;
}

const MEMBERSHIPS: readonly string[] = [
  "trial",
  "current",
  "past_due",
  "grace",
  "deactivated",
];

function membership(value: string | null): OperatorMembership | null {
  return value && MEMBERSHIPS.includes(value) ? (value as OperatorMembership) : null;
}

const STATUSES: readonly string[] = [
  "active",
  "canceled",
  "incomplete",
  "incomplete_expired",
  "past_due",
  "paused",
  "trialing",
  "unpaid",
];

function subscriptionStatus(value: string | null): OperatorSubscriptionStatus | null {
  return value && STATUSES.includes(value)
    ? (value as OperatorSubscriptionStatus)
    : null;
}

function subscriptionRow(row: Row): OperatorSubscriptionRow {
  return {
    baseItemRef: text(row, "base_item_ref"),
    cancelAtPeriodEnd: flag(row, "cancel_at_period_end"),
    currentPeriodEnd: text(row, "current_period_end"),
    customerRef: text(row, "customer_ref"),
    orgId: text(row, "org_id") ?? "",
    provider: text(row, "provider") ?? "stripe",
    seatItemRef: text(row, "seat_item_ref"),
    seatQuantity: integer(row, "seat_quantity") ?? 0,
    status: subscriptionStatus(text(row, "status")),
    subscriptionRef: text(row, "subscription_ref"),
  };
}

const SUBSCRIPTION_COLUMNS =
  "org_id, provider, customer_ref, subscription_ref, base_item_ref, seat_item_ref, " +
  "seat_quantity, status, current_period_end, cancel_at_period_end, grace_until";

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function operatorSubscriptionLookupKeys(input: {
  customerRef: string | null;
  subscriptionRef: string | null;
}): Array<{ column: "customer_ref" | "subscription_ref"; value: string }> {
  // The subscription reference is preferred because it identifies exactly one
  // row. A stored customer binding is the second lookup because hosted
  // Checkout persists it before Stripe assigns the subscription reference.
  return [
    ...(input.subscriptionRef ? [{ column: "subscription_ref" as const, value: input.subscriptionRef }] : []),
    ...(input.customerRef ? [{ column: "customer_ref" as const, value: input.customerRef }] : []),
  ];
}

export async function readOperatorSubscriptionByRef(input: {
  customerRef: string | null;
  subscriptionRef: string | null;
}): Promise<OperatorRepositoryResult<OperatorSubscriptionRow | null>> {
  const database = adminClient();
  for (const lookup of operatorSubscriptionLookupKeys(input)) {
    const { data, error } = await database
      .from("operator_subscriptions")
      .select(SUBSCRIPTION_COLUMNS)
      .eq(lookup.column, lookup.value)
      .limit(1)
      .maybeSingle();

    if (error) return { ok: false, error: databaseError(error) };
    const row = asRow(data);
    if (row) return { ok: true, value: subscriptionRow(row) };
  }
  return { ok: true, value: null };
}

export async function readConsumerOneOffPaymentSource(
  clientId: string,
): Promise<OneOffPaymentSourceResult> {
  const { data, error } = await adminClient()
    .from("consumer_subscriptions")
    .select("customer_ref, payment_method_ref")
    .eq("client_id", clientId)
    .eq("status", "active")
    .maybeSingle();

  if (error) return { ok: false, error: databaseError(error) };
  const row = asRow(data);
  if (!row) return { ok: true, value: null };
  const customerRef = text(row, "customer_ref")?.trim();
  const paymentMethodRef = text(row, "payment_method_ref")?.trim();
  return customerRef && paymentMethodRef
    ? { ok: true, value: { customerRef, paymentMethodRef } }
    : { ok: true, value: null };
}

export async function readOperatorSubscriptionForOrg(
  orgId: string,
): Promise<OperatorRepositoryResult<OperatorSubscriptionRow | null>> {
  const { data, error } = await adminClient()
    .from("operator_subscriptions")
    .select(SUBSCRIPTION_COLUMNS)
    .eq("org_id", orgId)
    .maybeSingle();

  if (error) return { ok: false, error: databaseError(error) };
  const row = asRow(data);
  return { ok: true, value: row ? subscriptionRow(row) : null };
}

export async function listStaleSubscriptionCreationIntents(
  staleBefore: string,
  limit = 100,
): Promise<OperatorRepositoryResult<readonly StaleSubscriptionCreationIntent[]>> {
  const { data, error } = await adminClient().rpc(
    "list_stale_operator_subscription_intents",
    { p_limit: limit, p_stale_before: staleBefore },
  );
  if (error) return { ok: false, error: databaseError(error) };
  if (!Array.isArray(data)) return { ok: true, value: [] };
  const rows: StaleSubscriptionCreationIntent[] = [];
  for (const entry of data) {
    const row = asRow(entry);
    if (!row) continue;
    const orgId = text(row, "org_id");
    const operationId = text(row, "operation_id");
    const createdAt = text(row, "created_at");
    const creationPath = text(row, "creation_path");
    if (!orgId || !operationId || !createdAt) continue;
    if (creationPath !== "checkout" && creationPath !== "direct") continue;
    rows.push({ createdAt, creationPath, operationId, orgId });
  }
  return { ok: true, value: rows };
}

export async function claimSubscriptionCreationIntent(
  orgId: string,
  creationPath: SubscriptionCreationPath,
): Promise<OperatorRepositoryResult<SubscriptionCreationIntentVerdict>> {
  const { data, error } = await adminClient().rpc(
    "operator_billing_claim_subscription_intent",
    { p_creation_path: creationPath, p_org_id: orgId },
  );
  if (error) return { ok: false, error: databaseError(error) };
  const verdict = asRow(data) ?? {};
  return {
    ok: true,
    value: {
      claimed: verdict.claimed === true,
      createdAt: text(verdict, "created_at"),
      operationId: text(verdict, "operation_id"),
      providerRef: text(verdict, "provider_ref"),
      reasonCode: text(verdict, "reason_code") ?? "unexpected",
      status: text(verdict, "status"),
    },
  };
}

export async function completeSubscriptionCreationIntent(
  orgId: string,
  operationId: string,
  creationPath: SubscriptionCreationPath,
  providerRef: string,
): Promise<OperatorRepositoryResult<CompleteSubscriptionCreationIntentVerdict>> {
  const { data, error } = await adminClient().rpc(
    "operator_billing_complete_subscription_intent",
    {
      p_creation_path: creationPath,
      p_operation_id: operationId,
      p_org_id: orgId,
      p_provider_ref: providerRef,
    },
  );
  if (error) return { ok: false, error: databaseError(error) };
  const verdict = asRow(data) ?? {};
  return {
    ok: true,
    value: {
      applied: verdict.applied === true,
      reasonCode: text(verdict, "reason_code") ?? "unexpected",
    },
  };
}

export async function failExpiredCheckoutIntent(
  orgId: string,
  operationId: string,
  providerRef: string,
): Promise<OperatorRepositoryResult<CompleteSubscriptionCreationIntentVerdict>> {
  const { data, error } = await adminClient().rpc("operator_billing_fail_expired_checkout_intent", {
    p_operation_id: operationId,
    p_org_id: orgId,
    p_provider_ref: providerRef,
  });
  if (error) return { ok: false, error: databaseError(error) };
  const verdict = asRow(data) ?? {};
  return { ok: true, value: { applied: verdict.applied === true, reasonCode: text(verdict, "reason_code") ?? "unexpected" } };
}

export async function reviewSubscriptionCreationIntent(
  orgId: string,
  operationId: string,
  reason: SubscriptionIntentReviewReason,
): Promise<OperatorRepositoryResult<CompleteSubscriptionCreationIntentVerdict>> {
  const { data, error } = await adminClient().rpc("operator_billing_review_subscription_intent", {
    p_operation_id: operationId,
    p_org_id: orgId,
    p_reason_code: reason,
  });
  if (error) return { ok: false, error: databaseError(error) };
  const verdict = asRow(data) ?? {};
  return { ok: true, value: { applied: verdict.applied === true, reasonCode: text(verdict, "reason_code") ?? "unexpected" } };
}

export async function readPendingSeatSync(
  orgId: string,
): Promise<OperatorRepositoryResult<OperatorSeatSyncRow | null>> {
  const { data, error } = await adminClient().rpc("operator_seat_sync_prepare", {
    p_org_id: orgId,
  });

  if (error) return { ok: false, error: databaseError(error) };
  const row = asRow(Array.isArray(data) ? data[0] : data);
  if (!row) return { ok: true, value: null };

  return {
    ok: true,
    value: {
      attempts: integer(row, "attempts") ?? 0,
      desiredQuantity: integer(row, "desired_quantity") ?? 0,
      generation: text(row, "generation") ?? "",
      orgId: text(row, "org_id") ?? orgId,
      status: text(row, "status") ?? "pending",
    },
  };
}

export async function readOrgBillingProfile(
  orgId: string,
): Promise<OperatorRepositoryResult<OperatorOrgBillingProfile | null>> {
  const database = adminClient();

  const organization = await database
    .from("orgs")
    .select("id, name, plan, seats_included, seat_price_cents, base_price_cents")
    .eq("id", orgId)
    .maybeSingle();

  if (organization.error) {
    return { ok: false, error: databaseError(organization.error) };
  }
  const orgRow = asRow(organization.data);
  if (!orgRow) return { ok: true, value: null };

  // Counted rather than read from a column, so the number the provider is asked
  // to bill is derived from the same population migration 072's trigger counts.
  const seats = await database
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("role", "operator_member");

  if (seats.error) return { ok: false, error: databaseError(seats.error) };

  const owner = await database
    .from("profiles")
    .select("email")
    .eq("org_id", orgId)
    .eq("org_role", "owner")
    .limit(1)
    .maybeSingle();

  if (owner.error) return { ok: false, error: databaseError(owner.error) };
  const ownerRow = asRow(owner.data);

  return {
    ok: true,
    value: {
      basePriceCents: integer(orgRow, "base_price_cents"),
      name: text(orgRow, "name") ?? "",
      ownerEmail: ownerRow ? text(ownerRow, "email") : null,
      plan: text(orgRow, "plan"),
      seatCount: seats.count ?? 0,
      seatPriceCents: integer(orgRow, "seat_price_cents"),
      seatsIncluded: integer(orgRow, "seats_included"),
    },
  };
}

/**
 * The one read that must not use the admin client. The caller supplies its
 * session-scoped client, so the scoped select policies from migration 070
 * decide what comes back and an operator cannot read another tenant's billing
 * state by asking for its id.
 */
export async function readOperatorBillingState(
  orgId: string,
  client: OperatorReadClient,
): Promise<OperatorRepositoryResult<OperatorBillingState | null>> {
  const organization = await client
    .from("orgs")
    .select("id, plan, membership, seats_included")
    .eq("id", orgId)
    .maybeSingle();

  if (organization.error) {
    return { ok: false, error: databaseError(organization.error) };
  }
  const orgRow = asRow(organization.data);
  if (!orgRow) return { ok: true, value: null };

  const capResponse = await client.rpc("billing_read_client_cap", { p_org_id: orgId });
  if (capResponse.error) return { ok: false, error: databaseError(capResponse.error) };
  const cap = clientCapRow(capResponse.data);
  if (!cap) {
    return { ok: false, error: new AppError("unexpected", "The client cap meter is unavailable.") };
  }

  const subscription = await client
    .from("operator_subscriptions")
    .select(SUBSCRIPTION_COLUMNS)
    .eq("org_id", orgId)
    .maybeSingle();

  if (subscription.error) {
    return { ok: false, error: databaseError(subscription.error) };
  }
  const subscriptionData = asRow(subscription.data);

  const outbox = await client
    .from("operator_seat_sync_outbox")
    .select("desired_quantity, status, attempts")
    .eq("org_id", orgId)
    .maybeSingle();

  if (outbox.error) return { ok: false, error: databaseError(outbox.error) };
  const outboxRow = asRow(outbox.data);

  return {
    ok: true,
    value: {
      cancelAtPeriodEnd: subscriptionData
        ? flag(subscriptionData, "cancel_at_period_end")
        : false,
      currentPeriodEnd: subscriptionData
        ? text(subscriptionData, "current_period_end")
        : null,
      graceUntil: subscriptionData ? text(subscriptionData, "grace_until") : null,
      clientMeter: {
        cap: cap.clientCap,
        count: cap.activeCount,
        label: cap.clientCap === null ? "no cap set" : `${cap.activeCount}/${cap.clientCap}`,
      },
      membership: membership(text(orgRow, "membership")),
      plan: text(orgRow, "plan"),
      seatQuantity: subscriptionData
        ? (integer(subscriptionData, "seat_quantity") ?? 0)
        : 0,
      seatSync: outboxRow
        ? {
            attempts: integer(outboxRow, "attempts") ?? 0,
            desiredQuantity: integer(outboxRow, "desired_quantity") ?? 0,
            status: text(outboxRow, "status") ?? "pending",
          }
        : null,
      seatsIncluded: integer(orgRow, "seats_included"),
      status: subscriptionData
        ? subscriptionStatus(text(subscriptionData, "status"))
        : null,
      subscriptionRef: subscriptionData
        ? text(subscriptionData, "subscription_ref")
        : null,
    },
  };
}

export async function readClientCapForOrg(
  orgId: string,
): Promise<OperatorRepositoryResult<ClientCapRow | null>> {
  const { data, error } = await adminClient().rpc("billing_read_client_cap", { p_org_id: orgId });
  if (error) return { ok: false, error: databaseError(error) };
  if (data === null) return { ok: true, value: null };
  const value = clientCapRow(data);
  return value
    ? { ok: true, value }
    : { ok: false, error: new AppError("unexpected", "The client cap meter is unavailable.") };
}

export async function raiseClientCapForOrg(input: {
  actorId: string;
  cap: number;
  orgId: string;
}): Promise<OperatorRepositoryResult<RaiseClientCapRow>> {
  const { data, error } = await adminClient().rpc("billing_raise_client_cap", {
    p_actor_profile_id: input.actorId,
    p_cap: input.cap,
    p_org_id: input.orgId,
  });
  if (error) return { ok: false, error: databaseError(error) };
  const row = asRow(data);
  const cap = row ? integer(row, "client_cap") : null;
  const from = row?.from;
  const orgId = row ? text(row, "org_id") : null;
  if (
    !row || row.applied !== true || cap === null || !Number.isInteger(cap) || cap <= 0 || !orgId ||
    !(from === null || (typeof from === "number" && Number.isInteger(from) && from >= 0))
  ) return { ok: false, error: new AppError("unexpected", "The client cap change could not be confirmed.") };
  return { ok: true, value: { applied: true, clientCap: cap, from: from as number | null, orgId } };
}

// ---------------------------------------------------------------------------
// Writes — every one of them a security-definer function
// ---------------------------------------------------------------------------

export async function applyBillingEvent(
  input: ApplyBillingEventInput,
): Promise<OperatorRepositoryResult<ApplyBillingEventVerdict>> {
  const { data, error } = await adminClient().rpc("operator_billing_apply_event_convergent", {
    p_attempt_count: input.attemptCount,
    p_current_period_end: input.currentPeriodEnd,
    p_event_id: input.eventId,
    p_event_type: input.eventType,
    p_next_attempt_at: input.nextAttemptAt,
    p_occurred_at: input.occurredAt,
    p_org_id: input.orgId,
    p_source: input.source,
    p_status: input.status,
    p_subscription_ref: input.subscriptionRef,
  });

  if (error) return { ok: false, error: databaseError(error) };
  const verdict = asRow(data) ?? {};

  return {
    ok: true,
    value: {
      applied: verdict.applied === true,
      fromMembership: membership(text(verdict, "from_membership")),
      reasonCode: text(verdict, "reason_code") ?? "unexpected",
      toMembership: membership(text(verdict, "to_membership")),
    },
  };
}

export async function upsertSubscription(
  input: UpsertSubscriptionInput,
): Promise<OperatorRepositoryResult<UpsertSubscriptionVerdict>> {
  const { data, error } = await adminClient().rpc(
    "operator_billing_upsert_subscription",
    {
      p_base_item_ref: input.baseItemRef,
      p_base_price_ref: input.basePriceRef,
      p_current_period_end: input.currentPeriodEnd,
      p_customer_ref: input.customerRef,
      p_org_id: input.orgId,
      p_provider: input.provider,
      p_seat_item_ref: input.seatItemRef,
      p_seat_price_ref: input.seatPriceRef,
      p_status: input.status,
      p_subscription_ref: input.subscriptionRef,
    },
  );

  if (error) return { ok: false, error: databaseError(error) };
  const verdict = asRow(data) ?? {};

  return {
    ok: true,
    value: {
      applied: verdict.applied === true,
      created: verdict.created === true,
      reasonCode: text(verdict, "reason_code") ?? "unexpected",
      status: text(verdict, "status"),
      subscriptionRef: text(verdict, "subscription_ref"),
    },
  };
}

export async function setSeatQuantity(
  orgId: string,
  quantity: number,
  generation: string,
  source: string,
): Promise<OperatorRepositoryResult<SetSeatQuantityVerdict>> {
  const { data, error } = await adminClient().rpc(
    "operator_billing_set_seat_quantity",
    { p_generation: generation, p_org_id: orgId, p_quantity: quantity, p_source: source },
  );

  if (error) return { ok: false, error: databaseError(error) };
  const verdict = asRow(data) ?? {};

  return {
    ok: true,
    value: {
      applied: verdict.applied === true,
      outboxStatus: text(verdict, "outbox_status"),
      reasonCode: text(verdict, "reason_code") ?? "unexpected",
      seatQuantity: integer(verdict, "seat_quantity"),
    },
  };
}

export async function recordSeatSyncFailure(
  orgId: string,
  generation: string,
  errorCode: string,
): Promise<OperatorRepositoryResult<SeatSyncFailureVerdict>> {
  const { data, error } = await adminClient().rpc(
    "operator_seat_sync_record_failure",
    { p_error_code: errorCode, p_generation: generation, p_org_id: orgId },
  );

  if (error) return { ok: false, error: databaseError(error) };
  const verdict = asRow(data) ?? {};

  return {
    ok: true,
    value: {
      applied: verdict.applied === true,
      attempts: integer(verdict, "attempts"),
      reasonCode: text(verdict, "reason_code") ?? "unexpected",
      status: text(verdict, "status"),
    },
  };
}

export const operatorBillingRepository: OperatorBillingRepository = {
  applyBillingEvent,
  claimSubscriptionCreationIntent,
  completeSubscriptionCreationIntent,
  failExpiredCheckoutIntent,
  listStaleSubscriptionCreationIntents,
  readOperatorSubscriptionByRef,
  readOperatorSubscriptionForOrg,
  readOrgBillingProfile,
  readPendingSeatSync,
  recordSeatSyncFailure,
  reviewSubscriptionCreationIntent,
  setSeatQuantity,
  upsertSubscription,
};
