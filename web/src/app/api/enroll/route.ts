import { isIP } from "node:net";

import { enrollmentPrice } from "@/lib/enrollment/config";
import { AppError, toHttpResponse } from "@/lib/enrollment/errors";
import { readEnrollmentJson } from "@/lib/enrollment/http";
import type { EnrollConfig } from "@/lib/enrollment/types";
import { recordRouteFailure, withCorrelationId } from "@/lib/diagnostics/route-failure";
import { DEMO_CONSUMER_PERSONA_EMAILS } from "@/lib/demo/demo-session";
import { featureFlag } from "@/lib/env";
import { demoResetEnabled } from "@/lib/enrollment/demo-reset";
import { resolvedIdvDriver } from "@/lib/idv";
import { sameOrigin } from "@/lib/pricing/http";

export const runtime = 'nodejs';

/**
 * R5B-01. This route used to answer a configuration failure with the byte-identical envelope it
 * answers a deliberate flag-off with — 200 `{enabled:false, idvDriver:"mock"}`. `loadEnrollmentBootstrap`
 * reads that as `disabled`, the consumer surface selects its demo branch, and `confirmCancellation`
 * then displays "Subscription canceled" having sent no request at all while the database enrollment
 * and subscription stay active and still billing. The surface behaved correctly for the value it was
 * given; the server manufactured that value out of an outage, which is what defeated R4B-02's
 * four-state fix from underneath.
 *
 * So a configuration failure fails closed on a distinct status with a distinct code. 503 is what the
 * bootstrap's `!result.ok` arm maps to `unavailable`, which disables cancellation and claims no
 * durable effect — and it is not 200, so no path can mistake it for a flag-off.
 */
const ENROLLMENT_CONFIG_UNAVAILABLE = "enrollment_configuration_unavailable";

interface EnrollGetDependencies {
  /** Optional so the existing override suites need not know about the demo reset; absent means false. */
  consumerIsDemoPersona?: typeof import("@/lib/enrollment/repository").consumerIsDemoPersona;
  getSession: typeof import("@/lib/auth/session").getSession;
  listEnrollmentSummaries: typeof import("@/lib/enrollment/repository").listEnrollmentSummaries;
  readEnrollmentState: typeof import("@/lib/enrollment/repository").readEnrollmentState;
  resolveConsumerClient: typeof import("@/lib/enrollment/repository").resolveConsumerClient;
}

export async function handleEnrollmentGet(
  request: Request,
  overrides?: EnrollGetDependencies,
): Promise<Response> {
  let config: EnrollConfig;
  try {
    // `enrollmentPrice()` is inside the try as well: a price resolution failure is the same class
    // of configuration outage as a driver one, and answering it differently would put a second
    // silent shape back on the route the moment the first is closed.
    const price = enrollmentPrice();
    config = {
      currency: price.currency,
      enabled: featureFlag("FEATURE_ENROLLMENT"),
      idvDriver: resolvedIdvDriver(),
      priceCents: price.priceCents,
    };
  } catch (error) {
    const correlationId = recordRouteFailure({
      cause: error,
      code: ENROLLMENT_CONFIG_UNAVAILABLE,
      status: 503,
      surface: "api.enroll.config",
    });
    return Response.json(
      withCorrelationId(
        {
          error: {
            code: ENROLLMENT_CONFIG_UNAVAILABLE,
            message: "Enrollment is not configured, so nothing was loaded and nothing was changed.",
          },
        },
        correlationId,
      ),
      { status: 503 },
    );
  }

  if (featureFlag("FEATURE_AFFILIATES")) {
    const supplied = new URL(request.url).searchParams.get("aff");
    if (supplied === null) {
      config = { ...config, affiliate: null };
    } else {
      const code = supplied.trim();
      let valid = false;
      if (code.length > 0 && code.length <= 255) {
        try {
          const { affiliateReferralValid } = await import("@/lib/affiliates");
          valid = await affiliateReferralValid(code);
        } catch {
          valid = false;
        }
      }
      config = { ...config, affiliate: { code, valid } };
    }
  }

  if (!config.enabled) return Response.json(config);

  try {
    const dependencies = overrides ?? await (async () => {
      const [{ getSession }, repository] = await Promise.all([
        import("@/lib/auth/session"),
        import("@/lib/enrollment/repository"),
      ]);
      return {
        consumerIsDemoPersona: repository.consumerIsDemoPersona,
        getSession,
        listEnrollmentSummaries: repository.listEnrollmentSummaries,
        readEnrollmentState: repository.readEnrollmentState,
        resolveConsumerClient: repository.resolveConsumerClient,
      };
    })();
    const actor = await dependencies.getSession();
    if (!actor) return Response.json(config);
    const summaries = await dependencies.listEnrollmentSummaries(actor);
    if (!summaries.ok) return Response.json(config);
    // R3B-01 asks that a consumer session bound to no workspace refuse rather than render, and that
    // still holds. What changed is how the question is asked: this used to test `summaries.length === 0`,
    // which conflates "no workspace" with "has a workspace and has not enrolled yet" — and the second is
    // the normal pre-enrollment state every consumer starts in. G-3B-10 made that visible by removing the
    // demo consumer's seeded enrollment so the Milestone-2 beat is repeatable; the persona then answered
    // 404, the bootstrap's `!ok` arm mapped it to `unavailable`, and `onboarding1.tsx` disables the
    // signature, payment, IDV-verify and quiz controls on exactly that state. So refusal now keys on the
    // client binding, which is what "workspace assigned" means.
    if (actor.role === "consumer") {
      const workspace = await dependencies.resolveConsumerClient(actor);
      if (!workspace.ok) {
        throw new AppError("not_found", "No enrollment workspace is assigned to this account.");
      }
    }

    let currentEnrollment = null;
    if (actor.role === "consumer" && summaries.value[0]) {
      const current = await dependencies.readEnrollmentState(
        summaries.value[0].enrollmentId,
        actor,
      );
      if (current.ok) currentEnrollment = current.value.view;
    }

    // The reset button renders only when the server would accept the reset: same three gates as
    // `POST /api/enroll/reset`, decided here so the surface never shows a control that 404s.
    const demoResetAvailable =
      actor.role === "consumer" &&
      demoResetEnabled() &&
      dependencies.consumerIsDemoPersona !== undefined &&
      await dependencies.consumerIsDemoPersona(actor, DEMO_CONSUMER_PERSONA_EMAILS);

    return Response.json({
      ...config,
      currentEnrollment,
      demoResetAvailable,
      enrollments: summaries.value,
    } satisfies EnrollConfig);
  } catch (error) {
    if (error instanceof AppError) return toHttpResponse(error);
    return Response.json(config);
  }
}

export async function GET(request: Request): Promise<Response> {
  return handleEnrollmentGet(request);
}

export async function POST(request: Request): Promise<Response> {
  try {
    if (!featureFlag("FEATURE_ENROLLMENT")) {
      throw new AppError("not_found", "Enrollment is unavailable.");
    }
    if (!sameOrigin(request)) {
      return Response.json(
        { error: { code: "same_origin_required" } },
        { headers: { "Cache-Control": "private, no-store" }, status: 403 },
      );
    }

    const [{ getSession }, { startEnrollment }, { parseEnrollRequest }] =
      await Promise.all([
        import("@/lib/auth/session"),
        import("@/lib/enrollment/service"),
        import("@/lib/enrollment/validate"),
      ]);
    const actor = await getSession();
    if (!actor) {
      throw new AppError("unauthenticated", "Authentication is required.");
    }

    const input = parseEnrollRequest(await readEnrollmentJson(request));
    const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    const ip = forwarded && isIP(forwarded) ? forwarded : "127.0.0.1";
    const view = await startEnrollment(
      {
        ip,
        request: input,
        userAgent: request.headers.get("user-agent")?.slice(0, 512) ?? "unknown",
      },
      actor,
    );
    return Response.json(view);
  } catch (error) {
    return toHttpResponse(error);
  }
}
