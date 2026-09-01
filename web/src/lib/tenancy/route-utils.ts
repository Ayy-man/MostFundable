import type { SessionProfile } from "@/lib/auth/session";

import { tenantErrorResponse } from "./errors.ts";
import type { InviteActor } from "./invites.ts";

export function noStore(response: Response): Response {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export function tenantDisabledResponse(): Response {
  return noStore(Response.json(
    { error: { code: "FEATURE_DISABLED", message: "The route is not available." } },
    { status: 404 },
  ));
}

export function tenantRouteFailure(error: unknown): Response {
  if (
    error instanceof Error &&
    error.name === "AuthError" &&
    "status" in error &&
    (error.status === 401 || error.status === 403)
  ) {
    return noStore(Response.json(
      {
        error: {
          code: error.status === 401 ? "unauthenticated" : "forbidden",
          message: error.status === 401 ? "Authentication is required." : "Access is denied.",
        },
      },
      { status: error.status },
    ));
  }
  return noStore(tenantErrorResponse(error));
}

export function toInviteActor(session: SessionProfile): InviteActor {
  const extended = session as SessionProfile & {
    disabledAt?: string | null;
    orgMembership?: InviteActor["orgMembership"];
  };
  return {
    disabledAt: extended.disabledAt ?? null,
    id: session.id,
    orgId: session.orgId,
    orgMembership: extended.orgMembership ?? null,
    orgRole: session.orgRole as InviteActor["orgRole"],
    role: session.role,
  };
}

