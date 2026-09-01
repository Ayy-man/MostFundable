import type { SessionProfile } from "@/lib/auth/session";
import type { ConsumerPaidRefreshRecord } from "@/lib/pricing/paid-refresh-read.ts";

const privateHeaders = { "Cache-Control": "private, no-store" };

export interface PaidRefreshStatusDependencies {
  read(session: SessionProfile): Promise<readonly ConsumerPaidRefreshRecord[]>;
  recordFailure(input: { cause: unknown; code: string; status: number; surface: string }): string;
  requireConsumer(): Promise<SessionProfile>;
}

function accessStatus(error: unknown): 401 | 403 | null {
  if (typeof error !== "object" || error === null || !("status" in error)) return null;
  return error.status === 401 ? 401 : error.status === 403 ? 403 : null;
}

export async function handlePaidRefreshStatusGet(
  dependencies: PaidRefreshStatusDependencies,
): Promise<Response> {
  let session: SessionProfile;
  try {
    session = await dependencies.requireConsumer();
  } catch (error) {
    const status = accessStatus(error);
    return Response.json(
      { error: status === 403 ? "forbidden" : "unauthorized" },
      { headers: privateHeaders, status: status ?? 401 },
    );
  }

  try {
    const refreshes = await dependencies.read(session);
    return Response.json({ refreshes }, { headers: privateHeaders, status: 200 });
  } catch (error) {
    const correlationId = dependencies.recordFailure({
      cause: error,
      code: "paid_refresh_status_unavailable",
      status: 503,
      surface: "api.refresh_now.status",
    });
    return Response.json(
      { correlationId, error: "paid_refresh_status_unavailable" },
      { headers: privateHeaders, status: 503 },
    );
  }
}
