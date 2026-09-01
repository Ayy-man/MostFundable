import { AppError, toHttpResponse } from "@/lib/enrollment/errors";
import { featureFlag } from "@/lib/env";

export const runtime = 'nodejs';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    if (!featureFlag("FEATURE_ENROLLMENT")) {
      throw new AppError("not_found", "Enrollment is unavailable.");
    }
    const [
      { getSession },
      { readEnrollmentJson },
      { revokeConsent },
      { parseEnrollmentId, parseRevokeConsentBody },
    ] = await Promise.all([
      import("@/lib/auth/session"),
      import("@/lib/enrollment/http"),
      import("@/lib/enrollment/service"),
      import("@/lib/enrollment/validate"),
    ]);
    const actor = await getSession();
    if (!actor) throw new AppError("unauthenticated", "Authentication is required.");
    const id = parseEnrollmentId((await context.params).id);
    const body = parseRevokeConsentBody(await readEnrollmentJson(request));
    // The RPC absorbs a 23505 replay and returns current server truth.
    return Response.json(await revokeConsent(id, body.kind, actor));
  } catch (error) {
    return toHttpResponse(error);
  }
}
