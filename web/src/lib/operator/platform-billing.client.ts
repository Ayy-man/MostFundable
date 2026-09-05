"use client";

// platform-billing.client.ts — the browser side of an operator's own subscription.
//
// Three routes, one read and two hosted-session starts, and every outcome the
// panel can show is named here so the panel renders a state rather than a
// status code. Nothing on this path invents a card, an invoice or an amount:
// the read returns exactly what `readOperatorBillingState` carries, and the
// two writes return only a provider-hosted URL the browser navigates to.

import type { OperatorMembership, OperatorSubscriptionStatus } from "@/lib/billing/types";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Mirrors `OperatorBillingState` in `lib/billing/repository-operator.ts`, field for field. */
export type PlatformBillingState = {
  cancelAtPeriodEnd: boolean;
  clientMeter: { cap: number | null; count: number; label: string };
  currentPeriodEnd: string | null;
  graceUntil: string | null;
  membership: OperatorMembership | null;
  plan: string | null;
  seatQuantity: number;
  seatSync: { attempts: number; desiredQuantity: number; status: string } | null;
  seatsIncluded: number | null;
  status: OperatorSubscriptionStatus | null;
  subscriptionRef: string | null;
};

export type PlatformBillingRead =
  /** `FEATURE_BILLING` is off; the route answered `{ enabled: false }`. */
  | { readonly state: "disabled" }
  /** 401: no session, or one that expired while the screen was open. */
  | { readonly state: "session_required" }
  /** 403: a member who is not an owner or admin of this workspace. */
  | { readonly state: "forbidden" }
  /** 402: the organization is deactivated. */
  | { readonly state: "deactivated" }
  /** 200 with a null record: the policies returned nothing for this workspace. */
  | { readonly state: "no_record" }
  /** 500, a network failure, or a payload this module does not recognise. */
  | { readonly state: "unavailable" }
  | { readonly billing: PlatformBillingState; readonly state: "ready" };

export class PlatformBillingActionError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.name = "PlatformBillingActionError";
    this.status = status;
  }
}

const MEMBERSHIPS = new Set<string>(["trial", "current", "past_due", "grace", "deactivated"]);
const STATUSES = new Set<string>([
  "trialing",
  "active",
  "incomplete",
  "incomplete_expired",
  "past_due",
  "canceled",
  "unpaid",
  "paused",
]);

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nullableText(value: unknown): string | null | undefined {
  return value === null || typeof value === "string" ? value : undefined;
}

function nullableInteger(value: unknown): number | null | undefined {
  return value === null || (typeof value === "number" && Number.isInteger(value)) ? value : undefined;
}

async function readBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function errorCode(body: unknown): string | null {
  const error = record(record(body)?.error);
  return error && typeof error.code === "string" ? error.code : null;
}

/**
 * Accepts only a payload shaped exactly like the repository's read. A field the
 * server did not send is a reason to show "unavailable", never a reason to
 * render zero seats or an empty plan as if that were the workspace's state.
 */
export function parsePlatformBillingState(value: unknown): PlatformBillingState | null {
  const source = record(value);
  if (!source) return null;
  const meter = record(source.clientMeter);
  const cap = meter ? nullableInteger(meter.cap) : undefined;
  const count = meter ? nullableInteger(meter.count) : undefined;
  const label = meter ? nullableText(meter.label) : undefined;
  if (!meter || cap === undefined || typeof count !== "number" || typeof label !== "string") return null;

  const currentPeriodEnd = nullableText(source.currentPeriodEnd);
  const graceUntil = nullableText(source.graceUntil);
  const membership = nullableText(source.membership);
  const plan = nullableText(source.plan);
  const seatsIncluded = nullableInteger(source.seatsIncluded);
  const status = nullableText(source.status);
  const subscriptionRef = nullableText(source.subscriptionRef);
  if (
    typeof source.cancelAtPeriodEnd !== "boolean"
    || currentPeriodEnd === undefined
    || graceUntil === undefined
    || membership === undefined
    || (membership !== null && !MEMBERSHIPS.has(membership))
    || plan === undefined
    || typeof source.seatQuantity !== "number" || !Number.isInteger(source.seatQuantity)
    || seatsIncluded === undefined
    || status === undefined
    || (status !== null && !STATUSES.has(status))
    || subscriptionRef === undefined
  ) return null;

  let seatSync: PlatformBillingState["seatSync"] = null;
  if (source.seatSync !== null) {
    const sync = record(source.seatSync);
    const attempts = sync ? nullableInteger(sync.attempts) : undefined;
    const desiredQuantity = sync ? nullableInteger(sync.desiredQuantity) : undefined;
    const syncStatus = sync ? nullableText(sync.status) : undefined;
    if (typeof attempts !== "number" || typeof desiredQuantity !== "number" || typeof syncStatus !== "string") {
      return null;
    }
    seatSync = { attempts, desiredQuantity, status: syncStatus };
  }

  return {
    cancelAtPeriodEnd: source.cancelAtPeriodEnd,
    clientMeter: { cap, count, label },
    currentPeriodEnd,
    graceUntil,
    membership: membership as OperatorMembership | null,
    plan,
    seatQuantity: source.seatQuantity,
    seatSync,
    seatsIncluded,
    status: status as OperatorSubscriptionStatus | null,
    subscriptionRef,
  };
}

/**
 * Whether the record was written by the mock driver. The mock prefixes every
 * reference it mints with `mock_`, which is the same test the service uses
 * when it records a snapshot's provider. With no subscription there is nothing
 * to read the prefix from, so the answer is honestly unknown.
 */
export function platformBillingProvider(
  billing: Pick<PlatformBillingState, "subscriptionRef">,
): "mock" | "stripe" | null {
  if (billing.subscriptionRef === null) return null;
  return billing.subscriptionRef.startsWith("mock_") ? "mock" : "stripe";
}

export async function loadPlatformBilling(fetcher: Fetcher = fetch): Promise<PlatformBillingRead> {
  let response: Response;
  try {
    response = await fetcher("/api/billing/subscription", {
      cache: "no-store",
      credentials: "same-origin",
    });
  } catch {
    return { state: "unavailable" };
  }
  const body = await readBody(response);
  if (response.status === 401) return { state: "session_required" };
  if (response.status === 403) return { state: "forbidden" };
  if (response.status === 402) return { state: "deactivated" };
  if (!response.ok) return { state: "unavailable" };

  const payload = record(body);
  if (!payload) return { state: "unavailable" };
  if (payload.enabled === false) return { state: "disabled" };
  if (payload.enabled !== true || !("billing" in payload)) return { state: "unavailable" };
  if (payload.billing === null) return { state: "no_record" };
  const billing = parsePlatformBillingState(payload.billing);
  return billing ? { billing, state: "ready" } : { state: "unavailable" };
}

function actionFailure(kind: "checkout" | "portal", status: number, code: string | null): PlatformBillingActionError {
  const resolved = code ?? (status === 404 ? "billing_ops_disabled" : "billing_unavailable");
  const noun = kind === "checkout" ? "checkout" : "billing portal";
  const message = status === 404
    ? "Hosted billing sessions are not turned on for this deployment."
    : resolved === "billing_unconfigured"
      ? "The billing provider is not configured, so no hosted session can be opened."
      : resolved === "unauthenticated"
        ? "Sign in again to continue."
        : resolved === "forbidden"
          ? "Only workspace owners and admins can change billing."
          : resolved === "ORG_DEACTIVATED"
            ? "This workspace is deactivated, so billing cannot be changed from here."
            : resolved === "BILLING_CUSTOMER_REQUIRED"
              ? "No billing customer exists for this workspace yet. Start a subscription first."
              : resolved === "BILLING_SUBSCRIPTION_INTENT_CONFLICT"
                ? "A subscription start is already in progress for this workspace. Reload in a moment."
                : resolved === "BILLING_PROVIDER_UNAVAILABLE"
                  ? "The billing provider did not answer. Try again shortly."
                  : `The ${noun} could not be opened.`;
  return new PlatformBillingActionError(resolved, message, status);
}

async function hostedSession(kind: "checkout" | "portal", fetcher: Fetcher): Promise<string> {
  let response: Response;
  try {
    response = await fetcher(`/api/billing/${kind}`, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
  } catch {
    throw actionFailure(kind, 0, "network");
  }
  const body = await readBody(response);
  if (!response.ok) throw actionFailure(kind, response.status, errorCode(body));
  const url = record(body)?.url;
  if (typeof url !== "string" || !/^https?:\/\//.test(url)) {
    throw new PlatformBillingActionError("invalid_response", `The ${kind === "checkout" ? "checkout" : "billing portal"} link was not returned.`, response.status);
  }
  return url;
}

/** Starts a hosted checkout for the signed-in workspace and returns the provider URL. */
export function startPlatformCheckout(fetcher: Fetcher = fetch): Promise<string> {
  return hostedSession("checkout", fetcher);
}

/** Opens a hosted billing portal session for the signed-in workspace and returns the provider URL. */
export function openPlatformBillingPortal(fetcher: Fetcher = fetch): Promise<string> {
  return hostedSession("portal", fetcher);
}
