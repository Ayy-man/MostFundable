import { recordRouteFailure, withCorrelationId } from "@/lib/diagnostics/route-failure";
import { featureFlag } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Actor = { id: string; role: "platform_admin" };
type SettlementRow = {
  ledger: "operator" | "referral";
  ledgerId: string;
  status: "accrued" | "exported" | "paid" | "reversed";
};
type SettlementInput = {
  actorId: string;
  expectedStatus: "accrued" | "exported";
  kind: "operator" | "referral";
  ledgerId: string;
  status: "exported" | "paid";
};
type Dependencies = {
  markSettlement(input: SettlementInput): Promise<SettlementRow>;
  requirePlatformAdmin(): Promise<Actor>;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const privateHeaders = { "Cache-Control": "private, no-store" };

function json(body: unknown, status = 200): Response {
  return Response.json(body, { headers: privateHeaders, status });
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parse(value: unknown): Omit<SettlementInput, "actorId"> | null {
  const body = record(value);
  if (!body || Object.keys(body).sort().join(",") !== "expectedStatus,ledger,ledgerId,status") return null;
  const kind = body.ledger;
  const ledgerId = body.ledgerId;
  const expectedStatus = body.expectedStatus;
  const status = body.status;
  if (
    (kind !== "operator" && kind !== "referral") ||
    typeof ledgerId !== "string" || !UUID_PATTERN.test(ledgerId) ||
    !(
      (expectedStatus === "accrued" && status === "exported") ||
      (expectedStatus === "exported" && status === "paid")
    )
  ) return null;
  return { expectedStatus, kind, ledgerId, status };
}

function failure(error: unknown): Response {
  if (error && typeof error === "object") {
    const status = (error as { status?: unknown }).status;
    const code = (error as { code?: unknown }).code;
    if (status === 401 || status === 403) {
      return json({ error: { code: status === 401 ? "unauthenticated" : "forbidden" } }, status);
    }
    if (
      (status === 400 || status === 404 || status === 409) &&
      (code === "SETTLEMENT_INPUT_INVALID" || code === "SETTLEMENT_NOT_FOUND" || code === "SETTLEMENT_STALE")
    ) {
      return json({ error: { code } }, status);
    }
  }
  // R5B-03. `settlement_failed` is the ledger's "we do not know", and it used to leave nothing
  // behind at all — a money-moving write could fail in production and the saved run held no cause.
  const correlationId = recordRouteFailure({
    cause: error,
    code: "settlement_failed",
    status: 500,
    surface: "api.revenue.settlement",
  });
  return json(withCorrelationId({ error: { code: "settlement_failed" } }, correlationId), 500);
}

export async function handlePatchSettlement(
  request: Request,
  dependencies: Dependencies,
): Promise<Response> {
  let actor: Actor;
  try {
    actor = await dependencies.requirePlatformAdmin();
  } catch (error) {
    return failure(error);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: { code: "SETTLEMENT_INPUT_INVALID" } }, 400);
  }
  const parsed = parse(body);
  if (!parsed) return json({ error: { code: "SETTLEMENT_INPUT_INVALID" } }, 400);
  try {
    const settlement = await dependencies.markSettlement({ ...parsed, actorId: actor.id });
    return json({ settlement });
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  if (!featureFlag("FEATURE_BILLING_OPS")) return new Response(null, { status: 404 });
  const [{ requireRole }, { markSettlement }] = await Promise.all([
    import("@/lib/auth/session"),
    import("@/lib/revenue/settlement"),
  ]);
  return handlePatchSettlement(request, {
    markSettlement,
    async requirePlatformAdmin() {
      const actor = await requireRole("platform_admin");
      return { id: actor.id, role: "platform_admin" };
    },
  });
}
