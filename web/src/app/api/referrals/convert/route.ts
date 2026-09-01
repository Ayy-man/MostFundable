import { cookies } from "next/headers";

import { isAuthError } from "@/lib/auth/errors";
import { recordRouteFailure } from "@/lib/diagnostics/route-failure";
import { ReferralError } from "@/lib/referrals";

export const runtime = "nodejs";

function response(body: { error: string } | { referralId: string; status: string }, status: number): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  try {
    const [{ requireRole }, referrals] = await Promise.all([
      import("@/lib/auth/session"),
      import("@/lib/referrals"),
    ]);
    if (!(await referrals.resolveReferralAvailability())) return response({ error: "not_found" }, 404);

    const actor = await requireRole("consumer");
    const body = await request.json().catch(() => null) as { clientId?: unknown } | null;
    if (typeof body?.clientId !== "string") return response({ error: "invalid_request" }, 400);

    const cookieStore = await cookies();
    const token = cookieStore.get("mf_referral_token")?.value;
    if (!token) return response({ error: "not_found" }, 404);

    const result = await referrals.completeConsumerReferral({
      token,
      clientId: body.clientId,
      actorId: actor.id,
    });
    cookieStore.delete("mf_referral_token");
    return response(result, 200);
  } catch (error) {
    if (isAuthError(error)) return response({ error: error.code }, error.status);
    if (error instanceof ReferralError) {
      const status = error.code === "invalid_conversion" ? 400 : 404;
      return response({ error: status === 400 ? "invalid_request" : "not_found" }, status);
    }
    // R5B-04: the unknown arm records its classification before answering.
    recordRouteFailure({
      cause: error,
      code: "unavailable",
      status: 500,
      surface: "api.referrals.convert",
    });
    return response({ error: "unavailable" }, 500);
  }
}
