import "server-only";

import type { SessionProfile } from "@/lib/auth/session";
import { TenantError } from "./errors.ts";

export const OPERATOR_MEMBER_ROLES = [
  "owner",
  "admin",
  "prep_specialist",
  "funding_specialist",
  "commando",
  "manager",
  "member",
] as const;

export type OperatorMemberRole = (typeof OPERATOR_MEMBER_ROLES)[number];
export type OperatorMemberRoleUpdate = {
  applied: boolean;
  orgId: string;
  profileId: string;
  orgRole: OperatorMemberRole;
};

type RpcResult = { data: unknown; error: { code?: string | null; message?: string | null } | null };
type RpcClient = { rpc(name: string, args: Record<string, unknown>): Promise<RpcResult> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function parseOperatorMemberRoleBody(value: unknown): { orgRole: OperatorMemberRole } {
  const source = object(value);
  if (!source || Object.keys(source).length !== 1 || typeof source.orgRole !== "string"
    || !OPERATOR_MEMBER_ROLES.includes(source.orgRole as OperatorMemberRole)) {
    throw new TenantError(400, "INVALID_TENANT_INPUT", "The member role is invalid.");
  }
  return { orgRole: source.orgRole as OperatorMemberRole };
}

function mapFailure(error: RpcResult["error"]): never {
  if (error?.message === "TENANT_LAST_OWNER_ROLE_FORBIDDEN") {
    throw new TenantError(409, "TENANT_CONFLICT", "Assign another active owner before changing this role.");
  }
  if (error?.code === "42501") {
    throw new TenantError(404, "TENANT_NOT_FOUND", "The member was not found.");
  }
  if (error?.code === "22023") {
    throw new TenantError(409, "TENANT_CONFLICT", "The member role cannot be changed.");
  }
  throw new TenantError(500, "TENANT_REQUEST_FAILED", "The member role could not be changed.");
}

export function createMemberRoleService(client: RpcClient) {
  return {
    async update(input: {
      actor: SessionProfile;
      body: unknown;
      targetId: string;
    }): Promise<OperatorMemberRoleUpdate> {
      if (
        input.actor.role !== "operator_member" ||
        input.actor.disabledAt !== null ||
        !input.actor.orgId ||
        (input.actor.orgRole !== "owner" && input.actor.orgRole !== "admin")
      ) {
        throw new TenantError(403, "TENANT_REQUEST_FAILED", "The tenant request is not permitted.");
      }
      if (!UUID.test(input.targetId)) {
        throw new TenantError(400, "INVALID_TENANT_INPUT", "The member id is invalid.");
      }
      const { orgRole } = parseOperatorMemberRoleBody(input.body);
      const { data, error } = await client.rpc("tenancy_update_member_role", {
        p_actor_id: input.actor.id,
        p_org_role: orgRole,
        p_target_id: input.targetId,
      });
      if (error) mapFailure(error);
      const row = object(data);
      if (!row || typeof row.applied !== "boolean" || row.org_id !== input.actor.orgId
        || row.profile_id !== input.targetId || row.org_role !== orgRole) mapFailure(null);
      return {
        applied: row.applied as boolean,
        orgId: row.org_id as string,
        orgRole,
        profileId: row.profile_id as string,
      };
    },
  };
}

export async function productionMemberRoleService() {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createMemberRoleService(createAdminClient() as unknown as RpcClient);
}
