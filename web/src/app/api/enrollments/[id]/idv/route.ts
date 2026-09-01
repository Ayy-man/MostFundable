import { AppError, toHttpResponse } from "@/lib/enrollment/errors";
import { featureFlag } from "@/lib/env";

export const runtime = 'nodejs';

type IdvRouteDependencies = {
  getSession: typeof import("@/lib/auth/session")["getSession"];
  parseEnrollmentId: typeof import("@/lib/enrollment/validate")["parseEnrollmentId"];
  parseIdvSubmitBody: typeof import("@/lib/enrollment/validate")["parseIdvSubmitBody"];
  readEnrollmentJson: typeof import("@/lib/enrollment/http")["readEnrollmentJson"];
  reconcile: typeof import("@/lib/enrollment/service")["reconcile"];
  submitIdv: typeof import("@/lib/enrollment/service")["submitIdv"];
};

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
  supplied?: IdvRouteDependencies,
): Promise<Response> {
  try {
    if (!featureFlag("FEATURE_ENROLLMENT")) {
      throw new AppError("not_found", "Enrollment is unavailable.");
    }
    const loaded: IdvRouteDependencies = supplied ?? await Promise.all([
      import("@/lib/auth/session"), import("@/lib/enrollment/http"),
      import("@/lib/enrollment/service"), import("@/lib/enrollment/validate"),
    ]).then(([auth, http, service, validate]): IdvRouteDependencies => ({
      getSession: auth.getSession,
      parseEnrollmentId: validate.parseEnrollmentId,
      parseIdvSubmitBody: validate.parseIdvSubmitBody,
      readEnrollmentJson: http.readEnrollmentJson,
      reconcile: service.reconcile,
      submitIdv: service.submitIdv,
    }));
    const actor = await loaded.getSession();
    if (!actor) throw new AppError("unauthenticated", "Authentication is required.");
    const id = loaded.parseEnrollmentId((await context.params).id);
    const reconciled = await loaded.reconcile(id, actor);
    if (reconciled.needsOperatorAttention === "consent_withdrawn") {
      return Response.json(reconciled);
    }
    const body = loaded.parseIdvSubmitBody(await loaded.readEnrollmentJson(request));
    return Response.json(await loaded.submitIdv(id, body, actor));
  } catch (error) {
    return toHttpResponse(error);
  }
}
