import { postJson, type ApiResult } from "@/lib/enrollment/client";
import type { EnrollmentView } from "@/lib/enrollment/types";

export const CANCELLATION_SUCCESS =
  "Subscription canceled. Pulls stopped and deletion is scheduled.";

/** What the consumer surface's three consent booleans should be for a given enrollment view. */
export type ConsentDisplayState = {
  analysisActive: boolean;
  canceled: boolean;
  monitoringActive: boolean;
};

/**
 * R5D-03. Cancellation deliberately *retains* both consent grants — they are the record of what the
 * consumer authorized, and `enrollment_cancel_sub` keeps them on purpose — so `cancelEnrollment`
 * returns a view with `monitoring=t, analysis=t` on a cancelled enrollment. A retained grant is
 * history, not a live permission: the server-side pull is blocked either way, and rendering Credit
 * Monitoring's active branch with a `Connected` tag against it is a false consumer state that
 * disagrees with what the same view shows after a reload.
 *
 * Bootstrap hydration applied the `!cancelled` mask; the cancel success callback, split from it by
 * Phase 9's hand-resolved ten-hunk merge in `consumer.tsx`, applied the returned grants raw. One
 * derivation, used by both, is the fix — a second copy of the mask is what rotted the first time.
 */
export function consentStateFromView(view: EnrollmentView): ConsentDisplayState {
  const canceled = view.status === "cancelled";
  const granted = (kind: "analysis" | "monitoring"): boolean =>
    view.consents.find((item) => item.kind === kind)?.authorized ?? false;
  return {
    analysisActive: !canceled && granted("analysis"),
    canceled,
    monitoringActive: !canceled && granted("monitoring"),
  };
}

type CancellationCallbacks = {
  apply(view: EnrollmentView): void;
  fail(message: string): void;
  succeed(message: string): void;
};

type CancellationRequest = (
  path: string,
  body: unknown,
) => Promise<ApiResult<EnrollmentView>>;

export async function cancelConsumerEnrollment(
  enrollmentId: string,
  callbacks: CancellationCallbacks,
  request: CancellationRequest = postJson<EnrollmentView>,
): Promise<void> {
  const result = await request(
    `/api/enrollments/${encodeURIComponent(enrollmentId)}/cancel`,
    {},
  );
  if (!result.ok) {
    callbacks.fail(result.message);
    return;
  }

  callbacks.apply(result.data);
  callbacks.succeed(CANCELLATION_SUCCESS);
}
