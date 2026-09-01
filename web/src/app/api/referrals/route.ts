import { isAuthError } from "@/lib/auth/errors";
import { recordRouteFailure, withCorrelationId } from "@/lib/diagnostics/route-failure";
import { ReferralError } from "@/lib/referrals";

export const runtime = "nodejs";

function noStore(response: Response): Response {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function POST(): Promise<Response> {
  try {
    const [{ requireRole }, referrals] = await Promise.all([
      import("@/lib/auth/session"),
      import("@/lib/referrals"),
    ]);
    if (!(await referrals.resolveReferralAvailability())) {
      return noStore(Response.json({ error: "not_found" }, { status: 404 }));
    }
    const actor = await requireRole("consumer");
    const result = await referrals.createConsumerReferral(actor);
    return noStore(Response.json(result, { status: 201 }));
  } catch (error) {
    if (isAuthError(error)) {
      return noStore(Response.json({ error: error.code }, { status: error.status }));
    }
    if (error instanceof ReferralError) {
      const status = error.code === "conflict" ? 409 : 404;
      return noStore(Response.json({ error: status === 409 ? "conflict" : "not_found" }, { status }));
    }
    // R5B-04: an auth answer and a `ReferralError` are decisions; this is the arm that is not.
    const correlationId = recordRouteFailure({
      cause: error,
      code: "unavailable",
      status: 500,
      surface: "api.referrals.create",
    });
    return noStore(Response.json(
      withCorrelationId({ error: "unavailable" }, correlationId),
      { status: 500 },
    ));
  }
}
