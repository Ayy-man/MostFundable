import { after } from "next/server";

import { AppError, toHttpResponse } from "@/lib/enrollment/errors";
import { featureFlag } from "@/lib/env";

export const runtime = 'nodejs';

type IdvRouteDependencies = {
  getSession: typeof import("@/lib/auth/session")["getSession"];
  parseEnrollmentId: typeof import("@/lib/enrollment/validate")["parseEnrollmentId"];
  parseIdvSubmitBody: typeof import("@/lib/enrollment/validate")["parseIdvSubmitBody"];
  readEnrollmentJson: typeof import("@/lib/enrollment/http")["readEnrollmentJson"];
  reconcile: typeof import("@/lib/enrollment/service")["reconcile"];
  submitIdvWithActivationTarget: typeof import("@/lib/enrollment/service")["submitIdvWithActivationTarget"];
  /** Test seam for Next's post-response callback. */
  after?: (callback: () => void | Promise<void>) => void;
  /** Test seam for the bounded post-activation analysis drain. */
  drainActivatedAnalysis?: (target: { analysisRunId: string; clientId: string }) => Promise<void>;
};

function scheduleActivatedAnalysis(
  schedule: (callback: () => void | Promise<void>) => void,
  drain: (target: { analysisRunId: string; clientId: string }) => Promise<void>,
  target: { analysisRunId: string; clientId: string },
): void {
  try {
    schedule(async () => {
      try {
        await drain(target);
      } catch {
        // Durable work remains queued for the scheduled analysis drain.
      }
    });
  } catch {
    // Scheduling is opportunistic; activation has already committed.
  }
}

async function drainOneActivatedAnalysis(target: { analysisRunId: string; clientId: string }): Promise<void> {
  const worker = await import("@/lib/analysis/worker");
  await worker.drainAnalysisQueue({
    maxJobs: 1,
    target,
    workerId: worker.getAnalysisWorkerId(),
  });
}

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
      submitIdvWithActivationTarget: service.submitIdvWithActivationTarget,
    }));
    const actor = await loaded.getSession();
    if (!actor) throw new AppError("unauthenticated", "Authentication is required.");
    const id = loaded.parseEnrollmentId((await context.params).id);
    const reconciled = await loaded.reconcile(id, actor);
    if (reconciled.needsOperatorAttention === "consent_withdrawn") {
      return Response.json(reconciled);
    }
    const body = loaded.parseIdvSubmitBody(await loaded.readEnrollmentJson(request));
    const result = await loaded.submitIdvWithActivationTarget(id, body, actor);
    if (result.view.status === "active" && result.analysisTarget) {
      scheduleActivatedAnalysis(
        loaded.after ?? after,
        loaded.drainActivatedAnalysis ?? drainOneActivatedAnalysis,
        result.analysisTarget,
      );
    }
    return Response.json(result.view);
  } catch (error) {
    return toHttpResponse(error);
  }
}
