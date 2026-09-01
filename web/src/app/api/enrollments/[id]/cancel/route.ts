import { AppError, toHttpResponse } from "@/lib/enrollment/errors";
import { featureFlag } from "@/lib/env";

export const runtime = 'nodejs';

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    if (!featureFlag("FEATURE_ENROLLMENT")) {
      throw new AppError("not_found", "Enrollment is unavailable.");
    }
    const [{ getSession }, { cancelEnrollment }, { parseEnrollmentId }] =
      await Promise.all([
        import("@/lib/auth/session"),
        import("@/lib/enrollment/service"),
        import("@/lib/enrollment/validate"),
      ]);
    const actor = await getSession();
    if (!actor) throw new AppError("unauthenticated", "Authentication is required.");
    const id = parseEnrollmentId((await context.params).id);
    return Response.json(await cancelEnrollment(id, actor));
  } catch (error) {
    return toHttpResponse(error);
  }
}
