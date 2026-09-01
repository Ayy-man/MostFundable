"use client";

import {
  parseAdminTenants,
  type AdminTenantView,
} from "./platform-client.ts";
import { isTenantSlug, normalizeTenantSlug } from "../tenancy/slug.ts";

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MEMBERSHIPS = new Set(["trial", "current", "past_due", "grace", "deactivated"]);
const PLANS = new Set(["trial", "pro", "agency"]);

export type AdminWorkspace = Omit<AdminTenantView, "membership" | "plan"> & {
  membership: "trial" | "current" | "past_due" | "grace" | "deactivated";
  plan: "trial" | "pro" | "agency";
};

/**
 * Provisioning is intentionally narrower than the roster's plan union.
 * `/api/admin/tenants` creates a trial and accepts no paid-plan field; keeping
 * the literal here prevents a caller from displaying Pro while silently
 * sending the same trial request.
 */
export type AdminWorkspaceProvisionInput = {
  email: string;
  fullName: string;
  name: string;
  plan: "trial";
  slug: string;
};

export type AdminWorkspaceProvisionResult = {
  inviteId: string;
  orgId: string;
  replayed: boolean;
};

export type AdminWorkspaceLifecycleAction = "deactivate" | "reactivate";

export type AdminWorkspaceLifecycleResult = {
  membership: AdminWorkspace["membership"];
  orgId: string;
  slug: string | null;
  trialEndsAt: string | null;
};

export class AdminWorkspaceClientError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "AdminWorkspaceClientError";
    this.status = status;
    this.code = code;
  }
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new AdminWorkspaceClientError(
      response.status,
      "INVALID_RESPONSE",
      "The workspace response was invalid.",
    );
  }
  if (!record(value)) {
    throw new AdminWorkspaceClientError(
      response.status,
      "INVALID_RESPONSE",
      "The workspace response was invalid.",
    );
  }
  return value;
}

function responseFailure(response: Response, body: Record<string, unknown>): AdminWorkspaceClientError {
  const error = record(body.error) ? body.error : null;
  return new AdminWorkspaceClientError(
    response.status,
    typeof error?.code === "string" ? error.code : `HTTP_${response.status}`,
    typeof error?.message === "string"
      ? error.message
      : "The workspace request could not be completed.",
  );
}

async function request(
  path: string,
  init: RequestInit,
  fetcher: Fetcher,
): Promise<{ body: Record<string, unknown>; response: Response }> {
  let response: Response;
  try {
    response = await fetcher(path, {
      cache: "no-store",
      credentials: "same-origin",
      ...init,
    });
  } catch {
    throw new AdminWorkspaceClientError(
      0,
      "NETWORK_UNAVAILABLE",
      "The workspace request could not be completed.",
    );
  }
  const body = await responseBody(response);
  if (!response.ok) throw responseFailure(response, body);
  return { body, response };
}

function invalidInput(): never {
  throw new AdminWorkspaceClientError(
    0,
    "INVALID_WORKSPACE_INPUT",
    "The workspace input is invalid.",
  );
}

function normalizedProvisionInput(input: AdminWorkspaceProvisionInput): Omit<AdminWorkspaceProvisionInput, "plan"> {
  if (!record(input) || Object.keys(input).sort().join(",") !== "email,fullName,name,plan,slug") {
    return invalidInput();
  }
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const fullName = typeof input.fullName === "string" ? input.fullName.trim() : "";
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const slug = typeof input.slug === "string" ? normalizeTenantSlug(input.slug) : "";
  if (
    input.plan !== "trial"
    || !EMAIL_PATTERN.test(email)
    || email.length > 320
    || fullName.length < 1
    || fullName.length > 120
    || name.length < 1
    || name.length > 120
    || !isTenantSlug(slug)
  ) return invalidInput();
  return { email, fullName, name, slug };
}

function parseWorkspaceRoster(value: unknown): readonly AdminWorkspace[] | null {
  const parsed = parseAdminTenants(value);
  if (!parsed) return null;
  const workspaces: AdminWorkspace[] = [];
  for (const workspace of parsed) {
    if (
      !UUID_PATTERN.test(workspace.id)
      || !workspace.name.trim()
      || !isTenantSlug(workspace.slug)
      || !PLANS.has(workspace.plan)
      || !MEMBERSHIPS.has(workspace.membership)
      || !/^\d{4}-\d{2}-\d{2}$/.test(workspace.startedAt)
    ) return null;
    workspaces.push({
      ...workspace,
      membership: workspace.membership as AdminWorkspace["membership"],
      plan: workspace.plan as AdminWorkspace["plan"],
    });
  }
  return workspaces;
}

export async function loadAdminWorkspaceRoster(
  fetcher: Fetcher = fetch,
): Promise<readonly AdminWorkspace[] | null> {
  let response: Response;
  try {
    response = await fetcher("/api/admin/tenants", {
      cache: "no-store",
      credentials: "same-origin",
    });
  } catch {
    throw new AdminWorkspaceClientError(
      0,
      "NETWORK_UNAVAILABLE",
      "The workspace roster could not be loaded.",
    );
  }
  // GET uses FEATURE_ADMIN and returns 404 only when that read surface is off.
  if (response.status === 404) return null;
  const body = await responseBody(response);
  if (!response.ok) throw responseFailure(response, body);
  const workspaces = parseWorkspaceRoster(body);
  if (!workspaces) {
    throw new AdminWorkspaceClientError(
      response.status,
      "INVALID_RESPONSE",
      "The workspace roster response was invalid.",
    );
  }
  return workspaces;
}

export async function provisionAdminWorkspace(
  input: AdminWorkspaceProvisionInput,
  idempotencyKey: string,
  fetcher: Fetcher = fetch,
): Promise<AdminWorkspaceProvisionResult> {
  if (!UUID_PATTERN.test(idempotencyKey)) return invalidInput();
  const body = normalizedProvisionInput(input);
  const result = await request("/api/admin/tenants", {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    method: "POST",
  }, fetcher);
  const tenant = record(result.body.tenant) ? result.body.tenant : null;
  if (
    !tenant
    || !UUID_PATTERN.test(typeof tenant.inviteId === "string" ? tenant.inviteId : "")
    || !UUID_PATTERN.test(typeof tenant.orgId === "string" ? tenant.orgId : "")
    || typeof tenant.replayed !== "boolean"
  ) {
    throw new AdminWorkspaceClientError(
      result.response.status,
      "INVALID_RESPONSE",
      "The workspace provision response was invalid.",
    );
  }
  return {
    inviteId: tenant.inviteId as string,
    orgId: tenant.orgId as string,
    replayed: tenant.replayed,
  };
}

export async function changeAdminWorkspaceLifecycle(
  orgId: string,
  action: AdminWorkspaceLifecycleAction,
  fetcher: Fetcher = fetch,
): Promise<AdminWorkspaceLifecycleResult> {
  if (!UUID_PATTERN.test(orgId) || (action !== "deactivate" && action !== "reactivate")) {
    return invalidInput();
  }
  const result = await request(`/api/admin/tenants/${orgId}`, {
    body: JSON.stringify({ action }),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  }, fetcher);
  const tenant = record(result.body.tenant) ? result.body.tenant : null;
  const membership = tenant?.membership;
  if (
    !tenant
    || tenant.orgId !== orgId
    || typeof membership !== "string"
    || !MEMBERSHIPS.has(membership)
    || !(tenant.slug === null || typeof tenant.slug === "string")
    || !(tenant.trialEndsAt === null || typeof tenant.trialEndsAt === "string")
    || (action === "deactivate" && membership !== "deactivated")
    || (action === "reactivate" && !["trial", "current"].includes(membership))
  ) {
    throw new AdminWorkspaceClientError(
      result.response.status,
      "INVALID_RESPONSE",
      "The workspace lifecycle response was invalid.",
    );
  }
  return {
    membership: membership as AdminWorkspace["membership"],
    orgId,
    slug: tenant.slug as string | null,
    trialEndsAt: tenant.trialEndsAt as string | null,
  };
}
