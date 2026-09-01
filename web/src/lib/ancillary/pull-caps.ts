import { featureFlag, type EnvSource } from "@/lib/env";
import { createSupabaseAncillaryRepository, type AncillaryRepository, type PullCap } from "./repository.ts";

export type PullCause = "scheduled" | "alert" | "upload" | "force_pull";
export type PullCapReason = "minimum_interval" | "count_window";
export interface PullAllowance { allowed: boolean; reason?: PullCapReason }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CAUSES: readonly PullCause[] = ["scheduled", "alert", "upload", "force_pull"];

export async function assertPullAllowed(
  clientId: string,
  cause: PullCause,
  sourceId: string,
  options: { env?: EnvSource; repository?: AncillaryRepository } = {},
): Promise<PullAllowance> {
  if (!UUID.test(clientId)) throw new Error("PULL_CAP_CLIENT_INVALID");
  if (!CAUSES.includes(cause)) throw new Error("PULL_CAP_CAUSE_INVALID");
  if (!UUID.test(sourceId)) throw new Error("PULL_CAP_SOURCE_INVALID");
  if (!featureFlag("FEATURE_ANCILLARY", options.env ?? process.env)) return { allowed: true };
  const result = await (options.repository ?? createSupabaseAncillaryRepository()).assertPullAllowed(clientId, cause, sourceId);
  if (result.allowed && result.reason === null) return { allowed: true };
  if (!result.allowed && (result.reason === "minimum_interval" || result.reason === "count_window")) return { allowed: false, reason: result.reason };
  throw new Error("PULL_CAP_RESULT_INVALID");
}

export async function getPullCap(actorRole: string, clientId: string, repository: AncillaryRepository = createSupabaseAncillaryRepository()): Promise<PullCap | null> {
  if (actorRole !== "platform_admin") throw new Error("PULL_CAP_FORBIDDEN");
  if (!UUID.test(clientId)) throw new Error("PULL_CAP_CLIENT_INVALID");
  return repository.getPullCap(clientId);
}

export async function setPullCap(actor: { id: string; role: string }, input: { clientId: string; minIntervalSeconds: number | null; maxCount: number | null; countWindowSeconds: number | null }, repository: AncillaryRepository = createSupabaseAncillaryRepository()): Promise<PullCap> {
  if (actor.role !== "platform_admin" || !UUID.test(actor.id) || !UUID.test(input.clientId)) throw new Error("PULL_CAP_FORBIDDEN");
  const positive = (value: number | null) => value === null || (Number.isInteger(value) && value > 0);
  if (!positive(input.minIntervalSeconds) || !positive(input.maxCount) || !positive(input.countWindowSeconds) || ((input.maxCount === null) !== (input.countWindowSeconds === null))) throw new Error("PULL_CAP_INPUT_INVALID");
  return repository.setPullCap({ ...input, updatedBy: actor.id });
}

export async function clearPullCap(actor: { id: string; role: string }, clientId: string, repository: AncillaryRepository = createSupabaseAncillaryRepository()): Promise<boolean> {
  if (actor.role !== "platform_admin" || !UUID.test(actor.id) || !UUID.test(clientId)) throw new Error("PULL_CAP_FORBIDDEN");
  return repository.clearPullCap(clientId, actor.id);
}
