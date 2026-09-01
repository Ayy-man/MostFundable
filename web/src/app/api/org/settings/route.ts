import { isAuthError } from "@/lib/auth/errors";
import { requireOrgMember } from "@/lib/auth/session";
import type { OrgRole } from "@/lib/auth/session";
import { recordRouteFailure, withCorrelationId } from "@/lib/diagnostics/route-failure";
import { featureFlag } from "@/lib/env";
import {
  NOTIFICATION_DIGEST_FREQUENCIES,
  PORTAL_APPLICATION_VISIBILITIES,
  type NotificationDigestFrequency,
  type PortalApplicationVisibility,
} from "@/lib/portal/preferences";
import { createClient } from "@/lib/supabase/server";
import { assertTenantWriteAllowed } from "@/lib/tenancy/wall";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/org/settings — the only user-supplied mutation payload this lane
 * owns, and the one place a missing policy would otherwise produce a cheerful
 * 200 that changed nothing. Postgres reports `UPDATE 0` for a row no policy
 * matches, PostgREST reports that as success, and there is no error anywhere in
 * the chain, so step five below is the requirement rather than a nicety.
 */

/** Route-layer narrowing (D-32). The RLS update policy is the actual boundary. */
const SETTINGS_ROLES: readonly OrgRole[] = ["admin", "owner"];

/**
 * Derived from the live schema rather than guessed, per D-52. `assignment_mode`
 * is not `text` with a trailing comment as BACKEND-SPEC reads — it is a real
 * enum type, so the values below come from
 *
 *   select enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid
 *   where t.typname = 'assignment_mode' order by enumsortorder;
 *
 * which returned exactly `manual` and `round_robin` on 2026-08-16, confirming
 * research assumption A5. A validator that accepted a value the type rejects
 * would turn a bad request into a 500 carrying a raw Postgres cast error.
 */
const ASSIGNMENT_MODES = ["manual", "round_robin"] as const;
const MAX_ORG_NAME_LENGTH = 120;

type AssignmentMode = (typeof ASSIGNMENT_MODES)[number];

interface Settings {
  assignment_mode?: AssignmentMode;
  default_client_goal_cents?: number;
  name?: string;
  notification_client_messages?: boolean;
  notification_digest_enabled?: boolean;
  notification_digest_frequency?: NotificationDigestFrequency;
  notification_email_holds?: boolean;
  notification_payment_failed?: boolean;
  notification_task_due?: boolean;
  portal_allow_document_uploads?: boolean;
  portal_application_visibility?: PortalApplicationVisibility;
  portal_show_funding_progress?: boolean;
  portal_show_trainings?: boolean;
  team_sees_all_clients?: boolean;
}

/**
 * An allow-list of KEYS, never a spread of the request body. `orgs` carries
 * `plan`, `seats_included`, `base_price_cents` and `monitoring_split_pct`,
 * every one of which is platform-governed and none of which an operator may set
 * from here; spreading the body would hand all of them over at once.
 */
const SETTABLE_KEYS = [
  "assignment_mode",
  "default_client_goal_cents",
  "name",
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
  "team_sees_all_clients",
] as const;

/** The same body for a wrong role and for an org that is not the caller's. */
const DENIED = { error: "forbidden" } as const;

const SETTINGS_COLUMNS = [
  "id",
  "name",
  "assignment_mode",
  "default_client_goal_cents",
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
  "team_sees_all_clients",
].join(",");

function privateJson(value: unknown, status = 200): Response {
  return Response.json(value, {
    headers: { "Cache-Control": "private, no-store" },
    status,
  });
}

/**
 * Reads the same row PATCH mutates, so setup controls hydrate from durable
 * tenant truth instead of resetting to component defaults after every reload.
 */
export async function GET(): Promise<Response> {
  if (!featureFlag("FEATURE_REAL_AUTH")) {
    return new Response(null, { status: 404 });
  }

  try {
    const session = await requireOrgMember();
    if (session.orgRole === null || !SETTINGS_ROLES.includes(session.orgRole)) {
      return privateJson(DENIED, 403);
    }

    const supabase = await createClient();
    const { data: org, error } = await supabase
      .from("orgs")
      .select(SETTINGS_COLUMNS)
      .eq("id", session.orgId)
      .maybeSingle();

    if (error) {
      const correlationId = recordRouteFailure({
        cause: error,
        code: "read_failed",
        status: 500,
        surface: "api.org.settings",
      });
      return privateJson(
        withCorrelationId({ error: "read_failed" }, correlationId),
        500,
      );
    }
    if (org === null) return privateJson(DENIED, 403);
    return privateJson({ org });
  } catch (error) {
    if (typeof error === "object" && error !== null && "status" in error && error.status === 402) {
      return privateJson({ error: "ORG_DEACTIVATED" }, 402);
    }
    if (isAuthError(error)) {
      return privateJson(
        error.status === 403 ? DENIED : { error: error.code },
        error.status,
      );
    }
    throw error;
  }
}

function readSettings(
  value: unknown,
): { settings: Settings; fields: string[] } | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const body = value as Record<string, unknown>;
  const unknownKey = Object.keys(body).find(
    (key) => !(SETTABLE_KEYS as readonly string[]).includes(key),
  );

  if (unknownKey !== undefined) {
    return null;
  }

  const settings: Settings = {};
  const fields: string[] = [];

  if ("assignment_mode" in body) {
    const mode = ASSIGNMENT_MODES.find(
      (candidate) => candidate === body.assignment_mode,
    );

    if (mode === undefined) {
      return null;
    }

    settings.assignment_mode = mode;
    fields.push("assignment_mode");
  }

  if ("name" in body) {
    if (typeof body.name !== "string") return null;
    const name = body.name.trim();
    if (name.length < 1 || name.length > MAX_ORG_NAME_LENGTH) return null;
    settings.name = name;
    fields.push("name");
  }

  if ("team_sees_all_clients" in body) {
    if (typeof body.team_sees_all_clients !== "boolean") {
      return null;
    }

    settings.team_sees_all_clients = body.team_sees_all_clients;
    fields.push("team_sees_all_clients");
  }

  const booleanKeys = [
    "notification_client_messages",
    "notification_digest_enabled",
    "notification_email_holds",
    "notification_payment_failed",
    "notification_task_due",
    "portal_allow_document_uploads",
    "portal_show_funding_progress",
    "portal_show_trainings",
  ] as const;
  for (const key of booleanKeys) {
    if (!(key in body)) continue;
    if (typeof body[key] !== "boolean") return null;
    settings[key] = body[key];
    fields.push(key);
  }

  if ("portal_application_visibility" in body) {
    const visibility = PORTAL_APPLICATION_VISIBILITIES.find(
      (candidate) => candidate === body.portal_application_visibility,
    );
    if (visibility === undefined) return null;
    settings.portal_application_visibility = visibility;
    fields.push("portal_application_visibility");
  }

  if ("notification_digest_frequency" in body) {
    const frequency = NOTIFICATION_DIGEST_FREQUENCIES.find(
      (candidate) => candidate === body.notification_digest_frequency,
    );
    if (frequency === undefined) return null;
    settings.notification_digest_frequency = frequency;
    fields.push("notification_digest_frequency");
  }

  if ("default_client_goal_cents" in body) {
    const goal = body.default_client_goal_cents;

    // The column is bigint and `orgs_default_goal_positive` checks `> 0`, not
    // `>= 0` as the plan reads. Accepting zero would send a request the
    // constraint rejects, which reaches the caller as a 500 rather than a 400.
    // Number.isSafeInteger is the JSON side of the same point: a bigint that
    // arrives as a double has already lost the precision it was sent with.
    if (typeof goal !== "number" || !Number.isSafeInteger(goal) || goal <= 0) {
      return null;
    }

    settings.default_client_goal_cents = goal;
    fields.push("default_client_goal_cents");
  }

  if (fields.length === 0) {
    return null;
  }

  return { fields, settings };
}

export async function PATCH(request: Request): Promise<Response> {
  if (!featureFlag("FEATURE_REAL_AUTH")) {
    return new Response(null, { status: 404 });
  }

  try {
    // 1. Throws 401 when there is no session, 403 for a non-operator and 403
    //    for an operator whose org binding is null.
    const session = await requireOrgMember();
    await assertTenantWriteAllowed(session);

    // 2. Route-layer narrowing. INTERFACES §3.1 is explicit that the helper
    //    narrows and does not authorise; the policy underneath is what decides.
    if (session.orgRole === null || !SETTINGS_ROLES.includes(session.orgRole)) {
      console.error("org settings denied", {
        orgRole: session.orgRole,
        profileId: session.id,
      });
      return Response.json(DENIED, { status: 403 });
    }

    // 3. Validate an allow-list of keys.
    let parsed: unknown;

    try {
      parsed = await request.json();
    } catch {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }

    const validated = readSettings(parsed);

    if (validated === null) {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }

    // 4. The ordinary server client, so RLS is the boundary. The service-role
    //    client would make every one of these tests pass and prove nothing,
    //    because it bypasses the policy AUTH-07 exists to demonstrate.
    const supabase = await createClient();
    const { data: updated, error: updateError } = await supabase
      .from("orgs")
      .update(validated.settings)
      .eq("id", session.orgId)
      .select(SETTINGS_COLUMNS);

    if (updateError) {
      // R5B-04. The loose `console.error` here recorded a code but nothing a caller could quote
      // back, so a support report and a log line could not be joined. The structured record carries
      // the same SQLSTATE and the caller now carries its id.
      const correlationId = recordRouteFailure({
        cause: updateError,
        code: "update_failed",
        status: 500,
        surface: "api.org.settings",
      });
      return Response.json(
        withCorrelationId({ error: "update_failed" }, correlationId),
        { status: 500 },
      );
    }

    // 5. Assert the update matched a row. This is the whole point: a zero-row
    //    update is not an error, PostgREST reports it as success, and a handler
    //    trusting the status code alone reports a happy result having changed
    //    nothing.
    if (!updated || updated.length !== 1) {
      console.error("org settings update matched no row", {
        matched: updated?.length ?? 0,
        orgId: session.orgId,
      });
      return Response.json(DENIED, { status: 403 });
    }

    // The database trigger appends the fixed audit event in this update's
    // transaction, so a successful row is already attributed here.
    return Response.json({ org: updated[0] }, { status: 200 });
  } catch (error) {
    if (typeof error === "object" && error !== null && "status" in error && error.status === 402) {
      return Response.json({ error: "ORG_DEACTIVATED" }, { status: 402 });
    }
    if (isAuthError(error)) {
      // Both "wrong role" and "not your org" answer 403 with the same body;
      // distinguishing them would tell an attacker which orgs exist (ASVS V7).
      return Response.json(
        error.status === 403 ? DENIED : { error: error.code },
        { status: error.status },
      );
    }

    throw error;
  }
}
