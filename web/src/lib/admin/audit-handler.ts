import "server-only";

import { adminError, adminFailure, adminJson } from "./http.ts";
import {
  ADMIN_AUDIT_DEFAULT_LIMIT,
  ADMIN_AUDIT_MAX_LIMIT,
  type AdminAuditEvent,
} from "./audit-types.ts";

type AdminSession = { id: string; role: "platform_admin" };

export interface AdminAuditHandlerDependencies {
  list(limit: number): Promise<readonly AdminAuditEvent[]>;
  requireAdmin(): Promise<AdminSession>;
}

const defaults: AdminAuditHandlerDependencies = {
  async list(limit) { return (await import("./audit-repository.ts")).createAuditRepository().list(limit); },
  async requireAdmin() {
    const { requireRole } = await import("@/lib/auth/session");
    return await requireRole("platform_admin") as AdminSession;
  },
};

function requestedLimit(request: Request): number | null {
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some((key) => key !== "limit")) return null;
  const values = params.getAll("limit");
  if (values.length === 0) return ADMIN_AUDIT_DEFAULT_LIMIT;
  if (values.length !== 1 || !/^[1-9]\d*$/.test(values[0])) return null;
  const value = Number(values[0]);
  return Number.isSafeInteger(value) && value <= ADMIN_AUDIT_MAX_LIMIT ? value : null;
}

export async function handleAdminAudit(
  request: Request,
  overrides: Partial<AdminAuditHandlerDependencies> = {},
): Promise<Response> {
  const dependencies = { ...defaults, ...overrides };
  try {
    // Authenticate before parsing filters so an unauthenticated caller cannot
    // use validation responses to probe a governed endpoint.
    await dependencies.requireAdmin();
  } catch (error) {
    return adminFailure(error);
  }

  const limit = requestedLimit(request);
  if (limit === null) return adminError("audit_filter_invalid", 400);
  try {
    const events = await dependencies.list(limit);
    // Re-project at the HTTP boundary as well as in the repository. This keeps
    // a future repository enrichment from silently widening the response.
    return adminJson({ events: events.map((event) => ({
      action: event.action,
      actorName: event.actorName,
      id: event.id,
      occurredAt: event.occurredAt,
      subjectId: event.subjectId,
      subjectType: event.subjectType,
    })) });
  } catch (error) {
    return adminFailure(error);
  }
}
