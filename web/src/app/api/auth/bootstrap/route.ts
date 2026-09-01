import { AuthError, isAuthError } from "@/lib/auth/errors";
import { SURFACE_PATH_BY_ROLE } from "@/lib/auth/roles";
import type { AppRole } from "@/lib/auth/session";
import { recordRouteFailure, withCorrelationId } from "@/lib/diagnostics/route-failure";
import { featureFlag } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * AUTH-04 has two writers of `public.profiles` and they have different jobs.
 * The trigger from migration 010 is the guarantor: it runs inside GoTrue's
 * insert transaction, where it cannot make a network call or read anything
 * outside `auth.users`, so it can only fall back. This route is the corrector:
 * it runs after sign-in with a real session, so it can compare the fallback row
 * against what the account now claims and fix it.
 *
 * Those two are the ONLY writers, and that matters concretely: `auth.users.email`
 * carries a unique constraint but `profiles.email` does not, so anything that
 * inserted a profile directly could leave two rows sharing an address with
 * nothing to stop it.
 */

/**
 * The roles this route may assign to the caller's own row. It is deliberately
 * short. `user_metadata` is writable by the account it belongs to, so treating
 * it as a source of privilege would let anyone promote themselves; the RLS
 * `with check` on `profiles_self_bootstrap_update_lane_a` enforces the same two
 * values underneath, and this list exists so the route refuses out loud instead
 * of issuing an update the policy silently drops to zero rows.
 */
const SELF_ASSIGNABLE_ROLES: readonly AppRole[] = ["affiliate", "consumer"];

const ORG_BOUND_ROLE: AppRole = "operator_member";

interface ProfileShape {
  role: AppRole;
  orgId: string | null;
  orgRole: string | null;
}

interface BootstrapClaims {
  role: AppRole | null;
  orgId: string | null;
  orgRole: string | null;
}

/**
 * The recognized role set comes from `SURFACE_PATH_BY_ROLE`, which is already
 * the single-sourced `Record<AppRole, string>`, rather than from a fifth
 * hand-written copy of the enum that could drift from the other four.
 */
const KNOWN_ROLES = Object.keys(SURFACE_PATH_BY_ROLE) as AppRole[];

function readRole(value: unknown): AppRole | null {
  return typeof value === "string"
    ? (KNOWN_ROLES.find((candidate) => candidate === value) ?? null)
    : null;
}

function readText(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

export function readBootstrapClaims(
  appMetadata: Record<string, unknown> | null | undefined,
): BootstrapClaims {
  const metadata = appMetadata ?? {};
  return {
    orgId: readText(metadata.org_id),
    orgRole: readText(metadata.org_role),
    role: readRole(metadata.app_role),
  };
}

function sameShape(left: ProfileShape, right: ProfileShape): boolean {
  return (
    left.role === right.role &&
    left.orgId === right.orgId &&
    left.orgRole === right.orgRole
  );
}

export async function POST(): Promise<Response> {
  if (!featureFlag("FEATURE_REAL_AUTH")) {
    return new Response(null, { status: 404 });
  }

  try {
    const supabase = await createClient();
    // getUser() round-trips to the auth server, so the identity is verified
    // rather than decoded from a cookie the browser could have edited.
    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError || !userData.user) {
      throw new AuthError(401, "unauthenticated", "Authentication is required.");
    }

    const user = userData.user;
    const { data: current, error: readError } = await supabase
      .from("profiles")
      .select("id, role, org_id, org_role")
      .eq("id", user.id)
      .maybeSingle();

    if (readError) {
      const correlationId = recordRouteFailure({
        cause: readError,
        code: "profile_unreadable",
        status: 500,
        surface: "api.auth.bootstrap.read",
      });
      return Response.json(
        withCorrelationId({ error: "profile_unreadable" }, correlationId),
        { status: 500 },
      );
    }

    if (!current) {
      // The trigger guarantees a row, so a missing one means the trigger did
      // not run for this account rather than that the caller is unknown.
      const correlationId = recordRouteFailure({
        cause: null,
        code: "profile_missing",
        status: 500,
        surface: "api.auth.bootstrap.missing",
      });
      return Response.json(
        withCorrelationId({ error: "profile_missing" }, correlationId),
        { status: 500 },
      );
    }

    const stored: ProfileShape = {
      orgId: current.org_id,
      orgRole: current.org_role,
      role: current.role,
    };

    // Role and tenant claims come only from the server-controlled app metadata
    // that the signup trigger already trusts. Caller-writable user metadata is
    // display data and never participates in this authorization correction.
    const claims = readBootstrapClaims(user.app_metadata);

    // Metadata may fill a binding in; it may never clear one. A stored value
    // was written by the trigger or by a privileged path, and letting the
    // account blank it by editing its own metadata would be a downgrade attack
    // on its own tenancy.
    const desired: ProfileShape = {
      orgId: stored.orgId ?? claims.orgId,
      orgRole: stored.orgRole ?? claims.orgRole,
      role: claims.role ?? stored.role,
    };

    if (sameShape(stored, desired)) {
      return Response.json({ corrected: false }, { status: 200 });
    }

    if (
      desired.role === ORG_BOUND_ROLE &&
      (desired.orgId === null || desired.orgRole === null)
    ) {
      // The code half of interface ask-1. Nothing in the DDL forbids this row,
      // and `requireOrgMember()` throwing 403 on a null org is its runtime
      // companion, so refusing here is what keeps the shape from ever existing.
      return Response.json(
        { error: "incomplete_org_binding" },
        { status: 422 },
      );
    }

    if (
      desired.role !== stored.role &&
      !SELF_ASSIGNABLE_ROLES.includes(desired.role)
    ) {
      return Response.json(
        { error: "role_not_self_assignable" },
        { status: 403 },
      );
    }

    if (
      SELF_ASSIGNABLE_ROLES.includes(desired.role) &&
      desired.orgRole !== null
    ) {
      // `profiles_role_shape_check` requires a null org_role for these roles,
      // and the policy's `with check` repeats it. Refuse rather than send a
      // write the constraint will reject with a 500-shaped error.
      return Response.json({ error: "invalid_org_binding" }, { status: 422 });
    }

    // org_role is never in the payload: the self-bootstrap policy's `with
    // check` requires it to stay null, so the only writers that can set one are
    // the trigger and the privileged operator paths.
    const { data: updated, error: updateError } = await supabase
      .from("profiles")
      .update({ org_id: desired.orgId, role: desired.role })
      .eq("id", user.id)
      .select("id, role, org_id, org_role")
      .maybeSingle();

    if (updateError) {
      // 23503 is the orgs foreign key. The caller cannot read `public.orgs` for
      // an organization it is not yet bound to — `orgs_select_authenticated`
      // filters on `id = auth_org_id()`, which is null for an unbound row — so
      // the foreign key, not a pre-read, is what validates the target.
      // 422 is the named answer — the caller named an organization it cannot be bound to. Only the
      // 500 arm is a failure nobody named, so only that one records. R5B-04.
      const status = updateError.code === "23503" ? 422 : 500;
      if (status === 422) return Response.json({ error: "correction_rejected" }, { status });
      const correlationId = recordRouteFailure({
        cause: updateError,
        code: "correction_rejected",
        status: 500,
        surface: "api.auth.bootstrap.correction",
      });
      return Response.json(
        withCorrelationId({ error: "correction_rejected" }, correlationId),
        { status: 500 },
      );
    }

    if (!updated) {
      // An UPDATE with no matching policy row reports success and changes
      // nothing, so the absent returning row is the only signal that RLS
      // refused the write.
      return Response.json({ error: "forbidden" }, { status: 403 });
    }

    return Response.json({ corrected: true }, { status: 200 });
  } catch (error) {
    if (isAuthError(error)) {
      return Response.json({ error: error.code }, { status: error.status });
    }

    throw error;
  }
}
