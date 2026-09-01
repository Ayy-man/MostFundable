import "server-only";

import { recordRouteFailure } from "@/lib/diagnostics/route-failure";

import { AppError } from "./errors.ts";

type RpcClient = {
  rpc(
    name: "tenancy_email_registered_elsewhere",
    args: { p_actor_id: string; p_email: string },
  ): PromiseLike<{ data: boolean | null; error: unknown }>;
};

export type EmailAvailabilityReader = {
  registeredElsewhere(input: { actorId: string; email: string }): Promise<boolean>;
};

export function createEmailAvailabilityReader(client: RpcClient): EmailAvailabilityReader {
  return {
    async registeredElsewhere(input) {
      const { data, error } = await client.rpc("tenancy_email_registered_elsewhere", {
        p_actor_id: input.actorId,
        p_email: input.email.trim().toLowerCase(),
      });
      // This used to `throw new Error(...)`, and a bare Error is the one thing `toHttpResponse`
      // cannot map: it is not an AppError and not a SessionAccessError, so it fell through to
      // `unknownEnrollmentFailure` and the caller got 500 "The request could not be completed."
      // That is the answer this route reserves for a cause nobody recognised, and it is the wrong
      // one here — the cause is recognised exactly. The tenancy guard could not be read, which is a
      // dependency outage, not a defect in the request.
      //
      // 503 is the same call `route.ts` already made for `ENROLLMENT_CONFIG_UNAVAILABLE`, and for
      // the same reason: a configuration or dependency failure must fail closed on a status that
      // says "not now" rather than one that says "broken". Answering 500 makes an unavailable guard
      // look like a broken enrollment, and there is nothing the client can do with it.
      //
      // Failing closed is deliberate and unchanged — nothing enrolls while the guard is unreadable.
      // What changes is only how that refusal is reported.
      if (error || typeof data !== "boolean") {
        // Recorded here rather than at the boundary, because mapping to an AppError takes this off
        // `unknownEnrollmentFailure`'s path — which was the only thing writing a correlation id for
        // this failure. Losing the status was worth fixing; losing the diagnosis with it was not.
        const correlationId = recordRouteFailure({
          cause: error ?? new Error(`EMAIL_AVAILABILITY_UNEXPECTED_SHAPE: ${typeof data}`),
          code: "driver_unavailable",
          status: 503,
          surface: "enrollment.email_availability",
        });
        throw new AppError(
          "driver_unavailable",
          "The registration check is unavailable, so nothing was enrolled and nothing was charged.",
          undefined,
          correlationId,
        );
      }
      return data;
    },
  };
}

export async function productionEmailAvailabilityReader(): Promise<EmailAvailabilityReader> {
  const { createAdminClient } = await import("../supabase/admin.ts");
  return createEmailAvailabilityReader(createAdminClient() as unknown as RpcClient);
}

