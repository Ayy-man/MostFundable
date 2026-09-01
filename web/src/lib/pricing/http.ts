import { recordRouteFailure, withCorrelationId } from "@/lib/diagnostics/route-failure";
import type { EnvSource } from "@/lib/env";
import type { PaidRefreshResult } from "./paid-refresh.ts";
import { resolvePercentage, resolvePrice } from "./resolver.ts";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store" } as const;

export interface ConsumerPricingCatalog {
  enabled: true;
  currency: "usd";
  monitoring: { amountCents: number };
  forcePull: { amountCents: number };
}

export interface OperatorPricingCatalog {
  enabled: true;
  monitoringSplit: { percent: number; configured: boolean };
}

export interface AdminPricingCatalog {
  enabled: true;
  currency: "usd";
  forcePull: { amountCents: number };
  monitoringSplit: { percent: number; configured: boolean };
}

export type PricingCatalog =
  | ConsumerPricingCatalog
  | OperatorPricingCatalog
  | AdminPricingCatalog;

export type PaidRefreshHttpResponse =
  | {
      requestId: string;
      analysisRunId: string;
      status: "queued";
      amountCents: number;
      currency: "usd";
    }
  | { error: string };

export function privateJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: PRIVATE_HEADERS });
}

export function resolveConsumerPricingCatalog(
  env: EnvSource = process.env,
): ConsumerPricingCatalog {
  const monitoring = resolvePrice("consumer_monitoring", { env });
  const forcePull = resolvePrice("force_pull", { env });
  return {
    enabled: true,
    currency: "usd",
    monitoring: { amountCents: monitoring.valueCents },
    forcePull: { amountCents: forcePull.valueCents },
  };
}

function monitoringSplit(env: EnvSource): { percent: number; configured: boolean } {
  const split = resolvePercentage("monitoring_split", { env });
  const percent = split.value ?? split.placeholder;
  if (percent === null) throw new Error("PRICING_HTTP_SPLIT_UNAVAILABLE");
  return { percent, configured: split.value !== null };
}

export function resolveOperatorPricingCatalog(
  env: EnvSource = process.env,
): OperatorPricingCatalog {
  return { enabled: true, monitoringSplit: monitoringSplit(env) };
}

export function resolveAdminPricingCatalog(
  env: EnvSource = process.env,
): AdminPricingCatalog {
  const forcePull = resolvePrice("force_pull", { env });
  return {
    enabled: true,
    currency: "usd",
    forcePull: { amountCents: forcePull.valueCents },
    monitoringSplit: monitoringSplit(env),
  };
}

type PricingRole = "consumer" | "operator_member" | "platform_admin";

export async function handlePricingCatalog<T extends PricingCatalog>(
  role: PricingRole,
  dependencies: {
    requireRole(role: PricingRole): Promise<unknown>;
    resolveCatalog(): T | Promise<T>;
  },
): Promise<Response> {
  try {
    await dependencies.requireRole(role);
    return privateJson(await dependencies.resolveCatalog());
  } catch (error) {
    const status = authStatus(error);
    if (status !== null) {
      return privateJson({ error: status === 401 ? "unauthenticated" : "forbidden" }, status);
    }
    return unknownFailure("pricing.catalog", "pricing_unavailable", 500, error);
  }
}

/**
 * The one shape every unknown-cause pricing failure answers with: the code the caller already got,
 * plus the correlation id that ties it to the recorded line. R5B-03 / R5C-07.
 */
function unknownFailure(
  surface: string,
  code: string,
  status: number,
  cause: unknown,
): Response {
  const id = recordRouteFailure({ cause, code, status, surface });
  return privateJson(withCorrelationId({ error: code }, id), status);
}

function authStatus(error: unknown): 401 | 403 | null {
  if (typeof error !== "object" || error === null || !("status" in error)) return null;
  const status = (error as { status?: unknown }).status;
  return status === 401 || status === 403 ? status : null;
}

export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function mapPaidRefreshResult(result: PaidRefreshResult): Response {
  if (result.ok) {
    return privateJson({
      requestId: result.requestId,
      analysisRunId: result.analysisRunId,
      status: result.status,
      amountCents: result.amountCents,
      currency: result.currency,
    } satisfies PaidRefreshHttpResponse, 202);
  }
  // `price_changed` shares the route's own 409: the service comparison is the
  // authoritative one (R4B-01), so a drift caught there has to reach the
  // browser as the same answer a drift caught at the route does.
  const status = result.reason === "cap_denied"
    ? 429
    : result.reason === "payment_failed" || result.reason === "payment_requires_action"
      ? 402
      : result.reason === "payment_source_unavailable"
          || result.reason === "price_changed"
          || result.reason === "request_in_progress"
        ? 409
        : 503;
  return privateJson({ error: result.reason } satisfies PaidRefreshHttpResponse, status);
}

export function mapPaidRefreshFailure(error: unknown): Response {
  const status = authStatus(error);
  if (status !== null) {
    return privateJson({ error: status === 401 ? "unauthenticated" : "forbidden" }, status);
  }
  // R5C-07. This is the mapper whose zero-evidence 500 is very likely why the cross-suite
  // paid-refresh flake could not be narrowed to a shared dependency: the response carried no id, no
  // stage and no cause, so a saved run preserved nothing to correlate.
  return unknownFailure("pricing.paid_refresh", "paid_refresh_unavailable", 500, error);
}
