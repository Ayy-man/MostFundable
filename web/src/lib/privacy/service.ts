import "server-only";

import { createPrivacyProviderAuth, type PrivacyProviderAuth } from "./provider-auth.ts";
import { createPrivacyRepository, type PrivacyRepository } from "./repository.ts";
import { createPrivacyStorage, type PrivacyStorage } from "./storage.ts";
import {
  PRIVACY_REQUEST_KINDS,
  PrivacyWorkflowError,
  type PrivacyAction,
  type PrivacyRequest,
  type PrivacyRequestKind,
} from "./types.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PrivacyServiceDependencies = Readonly<{
  auth: PrivacyProviderAuth;
  repository: PrivacyRepository;
  storage: PrivacyStorage;
}>;

function defaults(): PrivacyServiceDependencies {
  return {
    auth: createPrivacyProviderAuth(),
    repository: createPrivacyRepository(),
    storage: createPrivacyStorage(),
  };
}

function actor(value: string): void {
  if (!UUID.test(value)) throw new PrivacyWorkflowError("invalid_request");
}

function requestId(value: string): void {
  if (!UUID.test(value)) throw new PrivacyWorkflowError("invalid_request");
}

async function removeAndVerify(target: Parameters<PrivacyStorage["remove"]>[0], storage: PrivacyStorage) {
  try { await storage.remove(target); } catch { /* verified absence is authoritative */ }
  let present: boolean;
  try { present = await storage.exists(target); } catch {
    throw new PrivacyWorkflowError("storage_cleanup_failed");
  }
  if (present) throw new PrivacyWorkflowError("storage_cleanup_failed");
}

export async function listPrivacyRequests(
  actorId: string,
  supplied?: Partial<PrivacyServiceDependencies>,
): Promise<readonly PrivacyRequest[]> {
  actor(actorId);
  const dependencies = { ...defaults(), ...supplied };
  return dependencies.repository.list(actorId);
}

export async function submitPrivacyRequest(
  actorId: string,
  kind: PrivacyRequestKind,
  supplied?: Partial<PrivacyServiceDependencies>,
): Promise<PrivacyRequest> {
  actor(actorId);
  if (!PRIVACY_REQUEST_KINDS.includes(kind)) throw new PrivacyWorkflowError("invalid_request");
  const dependencies = { ...defaults(), ...supplied };
  return dependencies.repository.submit(actorId, kind);
}

export async function administerPrivacyRequest(
  actorId: string,
  id: string,
  action: PrivacyAction,
  supplied?: Partial<PrivacyServiceDependencies>,
): Promise<PrivacyRequest> {
  actor(actorId);
  requestId(id);
  const dependencies = { ...defaults(), ...supplied };
  if (action.action === "review") return dependencies.repository.review(id, actorId);
  if (action.action === "deny") {
    const reason = action.reason.trim();
    if (!reason || reason.length > 500) throw new PrivacyWorkflowError("invalid_request");
    return dependencies.repository.deny(id, actorId, reason);
  }
  if (action.action !== "complete") throw new PrivacyWorkflowError("invalid_request");

  const current = await dependencies.repository.get(actorId, id);
  if (!current) throw new PrivacyWorkflowError("not_found");
  if (current.status !== "in_review") throw new PrivacyWorkflowError("invalid_state");
  if (current.kind === "access") {
    const note = action.completionNote?.trim() ?? "";
    if (!note || note.length > 1000) throw new PrivacyWorkflowError("invalid_request");
    return dependencies.repository.completeAccess(id, actorId, note);
  }
  if (action.completionNote !== null) throw new PrivacyWorkflowError("invalid_request");

  const plan = await dependencies.repository.erasurePlan(id, actorId);
  if (plan.blockers.length) throw new PrivacyWorkflowError("erasure_blocked", plan.blockers);
  for (const target of plan.targets) await removeAndVerify(target, dependencies.storage);
  try {
    await dependencies.auth.disable(plan.profileId, plan.pseudonymEmail);
  } catch {
    throw new PrivacyWorkflowError("auth_disable_failed");
  }
  const completed = await dependencies.repository.completeDeletion(id, actorId);
  if (completed.status !== "completed") throw new PrivacyWorkflowError("write_failed");
  return completed;
}
