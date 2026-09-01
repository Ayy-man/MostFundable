import { putAgreement } from "@/lib/fees/handlers";
import { featureFlag } from "@/lib/env";

export const runtime = "nodejs";

type RouteContext<Path extends "/api/fees/[clientId]/agreement"> = Path extends string
  ? { params: Promise<{ clientId: string }> }
  : never;

/**
 * PUT /api/fees/[clientId]/agreement — the route ROADMAP criterion 2 is about.
 *
 * "Package and upfront fee options return `403 legal_gate` until a platform
 * admin sets `org_flags.upfront_fee_approved`." Both halves of that sentence
 * are literal here: the status is 403 and `error.code` is exactly
 * `legal_gate`, and neither is a place to improvise.
 *
 * Two mechanisms produce it and they are indistinguishable to a caller. The
 * handler asks the service, which reads the gate state and refuses before the
 * write; and if the flag is revoked between that read and the write, the
 * database trigger raises `LEGAL_GATE_SQLSTATE` and the repository maps it
 * to the same reason. Deleting the pre-check would make this slower, not permissive.
 *
 * The body is validated against an explicit allow-list of keys. A spread would
 * let a caller set `source` or `org_id`, neither of which a request may claim.
 */
export async function PUT(
  request: Request,
  context: RouteContext<"/api/fees/[clientId]/agreement">,
): Promise<Response> {
  if (!featureFlag("FEATURE_FEES")) {
    return new Response(null, { status: 404 });
  }
  const { clientId } = await context.params;
  return putAgreement(request, clientId);
}
