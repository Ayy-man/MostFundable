import { isIP } from "node:net";

import { AppError, toHttpResponse } from "@/lib/enrollment/errors";
import { featureFlag } from "@/lib/env";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    if (!featureFlag("FEATURE_ENROLLMENT")) {
      throw new AppError("not_found", "Enrollment is unavailable.");
    }
    const [
      { requireRole },
      { readEnrollmentJson },
      { reauthorizeConsent },
      { parseEnrollmentId, parseReauthorizeConsentBody },
    ] = await Promise.all([
      import("@/lib/auth/session"),
      import("@/lib/enrollment/http"),
      import("@/lib/enrollment/service"),
      import("@/lib/enrollment/validate"),
    ]);
    const actor = await requireRole("consumer");
    const id = parseEnrollmentId((await context.params).id);
    const body = parseReauthorizeConsentBody(await readEnrollmentJson(request));
    const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    const ip = forwarded && isIP(forwarded) ? forwarded : "127.0.0.1";
    const view = await reauthorizeConsent(
      id,
      {
        ...body,
        ip,
        userAgent: request.headers.get("user-agent")?.slice(0, 512) ?? "unknown",
      },
      actor,
    );
    return Response.json(view, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return toHttpResponse(error);
  }
}
