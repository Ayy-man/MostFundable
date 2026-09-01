import "server-only";

import { workspacePreferencesFromRow, type WorkspacePreferences } from "./preferences.ts";

interface PortalSession {
  readonly id: string;
  readonly orgId: string | null;
  readonly role: string;
}

export interface PortalPreferencesDependencies {
  read(orgId: string): Promise<WorkspacePreferences>;
  requireSession(): Promise<PortalSession>;
}

const COLUMNS = [
  "notification_client_messages",
  "notification_digest_enabled",
  "notification_digest_frequency",
  "notification_email_holds",
  "notification_payment_failed",
  "notification_task_due",
  "portal_allow_document_uploads",
  "portal_application_visibility",
  "portal_show_funding_progress",
  "portal_show_trainings",
].join(",");

async function read(orgId: string): Promise<WorkspacePreferences> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { data, error } = await createAdminClient()
    .from("orgs")
    .select(COLUMNS)
    .eq("id", orgId)
    .maybeSingle();
  if (error || data === null) throw new Error("PORTAL_PREFERENCES_READ_FAILED");
  const preferences = workspacePreferencesFromRow(data);
  if (preferences === null) throw new Error("PORTAL_PREFERENCES_INVALID");
  return preferences;
}

export async function readPortalPreferencesForOrg(orgId: string): Promise<WorkspacePreferences> {
  return read(orgId);
}

async function defaults(): Promise<PortalPreferencesDependencies> {
  const { getSession } = await import("@/lib/auth/session");
  return {
    read,
    async requireSession() {
      const session = await getSession();
      if (session === null) throw Object.assign(new Error("SESSION_REQUIRED"), { status: 401 });
      return session;
    },
  };
}

function status(error: unknown): 401 | 403 | null {
  if (typeof error !== "object" || error === null || !("status" in error)) return null;
  return error.status === 401 || error.status === 403 ? error.status : null;
}

function json(value: unknown, responseStatus = 200): Response {
  return Response.json(value, {
    headers: { "Cache-Control": "private, no-store" },
    status: responseStatus,
  });
}

export async function handlePortalPreferences(
  supplied?: PortalPreferencesDependencies,
): Promise<Response> {
  const dependencies = supplied ?? await defaults();
  try {
    const session = await dependencies.requireSession();
    if (!session.orgId || (session.role !== "consumer" && session.role !== "operator_member")) {
      return json({ error: { code: "role_forbidden", message: "This account cannot read workspace portal preferences." } }, 403);
    }
    return json({ preferences: await dependencies.read(session.orgId) });
  } catch (error) {
    const accessStatus = status(error);
    if (accessStatus !== null) {
      return json({ error: { code: accessStatus === 401 ? "session_required" : "role_forbidden" } }, accessStatus);
    }
    return json({ error: { code: "portal_preferences_unavailable" } }, 500);
  }
}
