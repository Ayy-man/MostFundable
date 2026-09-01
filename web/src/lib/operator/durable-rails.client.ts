"use client";

// Which durable rails are live behind the operator surface, and the one
// workspace write it owns (UI-WIRING-BACKLOG #8, #10, #17).
//
// The operator surface renders the fixture book — `DEMO_CLIENTS`, `AFFILIATES`
// and the feedback session's fixture applications — so its per-row ids are
// fixture handles like `cl-morgan`, not the UUIDs every durable route requires.
// That is why the application and affiliate controls here cannot simply be
// pointed at their APIs: the route would refuse the id, and there is no
// operator-facing endpoint that would hand back the durable one (there is no
// affiliate list route at all, and the client drawer is never opened with a
// tracker UUID).
//
// So the honest answer for those two is a disabled control with a reason, and
// the reason has to be true: it is only worth saying "this does not persist"
// when the rail behind it is actually live. These probes read that, each from
// the route's own flag-off answer rather than from a flag the surface would
// have to be told about:
//
//   * `/api/applications` with no query answers 503 `applications_disabled`
//     when FEATURE_APPLICATIONS is off, and 400 when it is on — the flag check
//     runs before the parameter check, so the 400 is proof the flag passed.
//   * `/api/affiliates/me` answers a bodiless 404 when FEATURE_AFFILIATES is
//     off, and an auth refusal for an operator session when it is on.

import { APPLICATIONS_DISABLED_CODE } from "@/lib/applications/types";

/** `"on"` means writes would reach a database; `"off"` means the route is not
 * there to reach. `"unknown"` is neither, and is treated as `"off"` by the
 * surface, because claiming a control does not persist is only honest when we
 * know the rail is live. */
export type RailState = "loading" | "off" | "on" | "unknown";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function classifyApplicationsProbe(
  status: number,
  body: unknown,
): RailState {
  if (status === 503 && asRecord(body)?.error === APPLICATIONS_DISABLED_CODE) {
    return "off";
  }
  // The route validates `clientId` only after the flag check passes, so a
  // complaint about the missing parameter is the flag answering "on".
  if (status === 400) return "on";
  return "unknown";
}

export function classifyAffiliatesProbe(status: number): RailState {
  if (status === 404) return "off";
  // 401 and 403 both mean the route ran: an operator session is not an
  // affiliate one, which is a refusal from a live rail.
  if (status === 401 || status === 403 || status === 200) return "on";
  return "unknown";
}

export async function readApplicationsRail(
  fetcher: typeof fetch = fetch,
): Promise<RailState> {
  try {
    const response = await fetcher("/api/applications", {
      cache: "no-store",
      credentials: "same-origin",
    });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return classifyApplicationsProbe(response.status, body);
  } catch {
    return "unknown";
  }
}

export async function readAffiliatesRail(
  fetcher: typeof fetch = fetch,
): Promise<RailState> {
  try {
    const response = await fetcher("/api/affiliates/me", {
      cache: "no-store",
      credentials: "same-origin",
    });
    return classifyAffiliatesProbe(response.status);
  } catch {
    return "unknown";
  }
}

/**
 * The workspace write behind "Save workspace" (#17).
 *
 * `PATCH /api/org/settings` takes an allow-list of three keys and the default
 * client funding goal is the only one this panel edits. The workspace name and
 * the support email are not on that list — `orgs` has no column either route
 * would write them to — so the surface disables those two inputs rather than
 * collecting text nothing reads.
 *
 * Success is the goal reading back off the returned row, not a 200. A zero-row
 * update is not an error in Postgres and PostgREST reports it as success; the
 * route already turns that into a 403, and this checks the value anyway
 * because "we sent it and nothing complained" is not the same claim as "it is
 * stored".
 */
export type WorkspaceSaveResult =
  | { readonly outcome: "saved"; readonly goalCents: number }
  | { readonly outcome: "unavailable" }
  | { readonly outcome: "failed" };

export type WorkspaceAccessSettings = {
  readonly assignmentMode: "manual" | "round-robin";
  readonly teamSeesAllClients: boolean;
};

export type WorkspaceAccessRead =
  | { readonly outcome: "ready"; readonly settings: WorkspaceAccessSettings }
  | { readonly outcome: "unavailable" }
  | { readonly outcome: "failed" };

function workspaceAccessFromBody(body: unknown): WorkspaceAccessSettings | null {
  const org = asRecord(asRecord(body)?.org);
  if (org === null || typeof org.team_sees_all_clients !== "boolean") return null;
  const assignmentMode = org.assignment_mode === "round_robin"
    ? "round-robin"
    : org.assignment_mode === "manual"
      ? "manual"
      : null;
  return assignmentMode === null
    ? null
    : { assignmentMode, teamSeesAllClients: org.team_sees_all_clients };
}

export async function readWorkspaceAccessSettings(
  fetcher: typeof fetch = fetch,
): Promise<WorkspaceAccessRead> {
  try {
    const response = await fetcher("/api/org/settings", {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (response.status === 404) return { outcome: "unavailable" };
    if (!response.ok) return { outcome: "failed" };
    const settings = workspaceAccessFromBody(await response.json());
    return settings === null
      ? { outcome: "failed" }
      : { outcome: "ready", settings };
  } catch {
    return { outcome: "failed" };
  }
}

export async function saveWorkspaceAccessSettings(
  settings: WorkspaceAccessSettings,
  fetcher: typeof fetch = fetch,
): Promise<WorkspaceAccessRead> {
  try {
    const response = await fetcher("/api/org/settings", {
      body: JSON.stringify({
        assignment_mode: settings.assignmentMode === "round-robin" ? "round_robin" : "manual",
        team_sees_all_clients: settings.teamSeesAllClients,
      }),
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    });
    if (response.status === 404) return { outcome: "unavailable" };
    if (!response.ok) return { outcome: "failed" };
    const stored = workspaceAccessFromBody(await response.json());
    if (
      stored === null
      || stored.assignmentMode !== settings.assignmentMode
      || stored.teamSeesAllClients !== settings.teamSeesAllClients
    ) {
      return { outcome: "failed" };
    }
    return { outcome: "ready", settings: stored };
  } catch {
    return { outcome: "failed" };
  }
}

export function readWorkspaceSaveResponse(
  status: number,
  body: unknown,
  expectedGoalCents: number,
): WorkspaceSaveResult {
  if (status === 404) return { outcome: "unavailable" };
  if (status !== 200) return { outcome: "failed" };
  const org = asRecord(asRecord(body)?.org);
  const goal = org?.default_client_goal_cents;
  if (typeof goal !== "number" || goal !== expectedGoalCents) {
    return { outcome: "failed" };
  }
  return { goalCents: goal, outcome: "saved" };
}

export async function saveWorkspaceGoal(
  goalCents: number,
  fetcher: typeof fetch = fetch,
): Promise<WorkspaceSaveResult> {
  try {
    const response = await fetcher("/api/org/settings", {
      body: JSON.stringify({ default_client_goal_cents: goalCents }),
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return readWorkspaceSaveResponse(response.status, body, goalCents);
  } catch {
    return { outcome: "failed" };
  }
}
