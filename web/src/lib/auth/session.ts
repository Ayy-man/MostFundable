import "server-only";

import { cache } from "react";
import { cookies, headers } from "next/headers";

import type { Database } from "@/lib/db/types";
import { AuthError } from "@/lib/auth/errors";
import type { OperatorMembership } from "@/lib/billing/types";
import { featureFlag } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type AppRole = Database["public"]["Enums"]["app_role"];
export type OrgRole = Database["public"]["Enums"]["org_role"];

export interface SessionProfile {
  disabledAt: string | null;
  id: string;
  orgMembership: OperatorMembership | null;
  role: AppRole;
  orgId: string | null;
  orgRole: OrgRole | null;
  manages: string[];
}

export type SessionProfileRow = {
  disabled_at: string | null;
  id: string;
  manages: string[];
  org_id: string | null;
  org_role: OrgRole | null;
  orgs:
    | { membership: OperatorMembership }
    | Array<{ membership: OperatorMembership }>
    | null;
  role: AppRole;
};

export const SESSION_PROFILE_SELECT =
  "id, role, org_id, org_role, manages, disabled_at, orgs!profiles_org_id_fkey(membership)";

export function mapSessionProfileRow(
  data: SessionProfileRow | null,
): SessionProfile | null {
  if (!data || data.disabled_at !== null) return null;
  const organization = Array.isArray(data.orgs) ? data.orgs[0] : data.orgs;

  return {
    disabledAt: null,
    id: data.id,
    orgId: data.org_id,
    orgMembership: organization?.membership ?? null,
    orgRole: data.org_role,
    manages: [...data.manages],
    role: data.role,
  };
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveDemoSession(): Promise<SessionProfile | null> {
  const requestHeaders = await headers();
  const cookieStore = await cookies();
  const selector =
    requestHeaders.get("x-mf-demo-profile-id") ??
    cookieStore.get("mf_demo_profile_id")?.value;
  const profileId = selector?.trim();

  if (!profileId || !UUID_PATTERN.test(profileId)) {
    return null;
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select(SESSION_PROFILE_SELECT)
    .eq("id", profileId)
    .maybeSingle();

  if (error) {
    throw new Error("Session profile lookup failed");
  }

  return mapSessionProfileRow(data as unknown as SessionProfileRow | null);
}

async function resolveRealSession(): Promise<SessionProfile | null> {
  const supabase = await createClient();
  let userId: string | undefined;

  // Our getSession() verifies Supabase auth through getClaims(); Supabase's
  // same-named getSession() must not be trusted in server code.
  try {
    const { data, error } = await supabase.auth.getClaims();

    if (error) {
      return null;
    }

    userId = data?.claims.sub;
  } catch {
    return null;
  }

  if (!userId) {
    return null;
  }

  const { data, error } = await supabase
    .from("profiles")
    .select(SESSION_PROFILE_SELECT)
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw new Error("Session profile lookup failed");
  }

  return mapSessionProfileRow(data as unknown as SessionProfileRow | null);
}

const resolveSession = cache(async (): Promise<SessionProfile | null> => {
  if (featureFlag("FEATURE_REAL_AUTH")) {
    return resolveRealSession();
  }

  return resolveDemoSession();
});

/** Server-only. null when unauthenticated. Never throws for "no session". */
export async function getSession(): Promise<SessionProfile | null> {
  return resolveSession();
}

/** Server-only. Throws an app error the route maps to 401/403. */
export async function requireRole(
  ...roles: AppRole[]
): Promise<SessionProfile> {
  const session = await getSession();

  if (!session) {
    throw new AuthError(
      401,
      "unauthenticated",
      "Authentication is required.",
    );
  }

  if (!roles.includes(session.role)) {
    throw new AuthError(403, "forbidden", "Role access is denied.");
  }

  return session;
}

/** Server-only. Same as requireRole('operator_member') plus org scoping; throws 403 when orgId is null. */
export async function requireOrgMember(): Promise<
  SessionProfile & { orgId: string }
> {
  const session = await requireRole("operator_member");

  if (session.orgId === null) {
    throw new AuthError(403, "forbidden", "Organization access is denied.");
  }

  return { ...session, orgId: session.orgId };
}
