import { notFound } from "next/navigation";

import { featureFlag } from "@/lib/env";
import { paidRefreshPurchasesReady } from "@/lib/pricing/paid-refresh-availability";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface AuthorizedSession { id: string }

interface RefreshDependencies {
  create(input: { actorId: string; clientId: string; expectedAmountCents: number; idempotencyKey: string }): Promise<import("@/lib/pricing").PaidRefreshResult>;
  currentAmountCents(): Promise<number>;
  listClients(session: AuthorizedSession): Promise<Array<{ id: string }>>;
  mapResult(result: import("@/lib/pricing").PaidRefreshResult): Response;
  privateJson(body: unknown, status?: number): Response;
}

function expectedAmount(body: unknown): number | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || !Number.isSafeInteger(record.expectedAmountCents)) {
    return null;
  }
  const amount = record.expectedAmountCents as number;
  return amount > 0 ? amount : null;
}

export async function handleAuthorizedRefresh(
  request: Request,
  session: AuthorizedSession,
  dependencies: RefreshDependencies,
): Promise<Response> {
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
  if (!UUID.test(idempotencyKey)) {
    return dependencies.privateJson({ error: "invalid_idempotency_key" }, 400);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return dependencies.privateJson({ error: "request_body_invalid" }, 400);
  }
  const expectedAmountCents = expectedAmount(body);
  if (expectedAmountCents === null) {
    return dependencies.privateJson({ error: "request_body_invalid" }, 400);
  }
  const clients = await dependencies.listClients(session);
  if (clients.length !== 1) {
    return dependencies.privateJson({ error: "client_scope_unavailable" }, 409);
  }
  // A cheap early rejection, and nothing more. The governed price this reads
  // is not the one that gets persisted, so the authoritative comparison lives
  // inside `createPaidRefresh` against its own single resolution (R4B-01);
  // keeping this one only spares the service a round trip on an obviously
  // stale quote.
  if (expectedAmountCents !== await dependencies.currentAmountCents()) {
    return dependencies.privateJson({ error: "price_changed" }, 409);
  }
  return dependencies.mapResult(await dependencies.create({
    actorId: session.id,
    clientId: clients[0].id,
    expectedAmountCents,
    idempotencyKey,
  }));
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (!featureFlag("FEATURE_PAID_REFRESH")) notFound();
  const pricingHttp = await import("@/lib/pricing/http");
  if (!pricingHttp.sameOrigin(request)) {
    return pricingHttp.privateJson({ error: "same_origin_required" }, 403);
  }
  if (!paidRefreshPurchasesReady()) {
    return pricingHttp.privateJson({ error: "paid_refresh_provider_unavailable" }, 503);
  }

  try {
    const [{ requireRole }, { listTrackerClients }, pricing, { resolveGovernedForcePullPrice }] = await Promise.all([
      import("@/lib/auth/session"),
      import("@/lib/tracker"),
      import("@/lib/pricing"),
      import("@/lib/admin/settings"),
    ]);
    const session = await requireRole("consumer");
    return await handleAuthorizedRefresh(request, session, {
      create: pricing.createPaidRefresh,
      async currentAmountCents() {
        const env = await resolveGovernedForcePullPrice();
        return pricing.resolvePrice("force_pull", { env }).valueCents;
      },
      listClients: (actor) => listTrackerClients(actor as typeof session, { scope: "all" }),
      mapResult: pricingHttp.mapPaidRefreshResult,
      privateJson: pricingHttp.privateJson,
    });
  } catch (error) {
    return pricingHttp.mapPaidRefreshFailure(error);
  }
}
