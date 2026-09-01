import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { ReferralError } from "./errors.ts";
import type {
  ReferralConversionRow,
  ReferralCreateInput,
  ReferralEvidence,
  ReferralLifecycleRow,
  ReferralRepository,
} from "./types.ts";

type Failure = { code?: string; message?: string };
type QueryResult = { data: unknown; error: Failure | null };
type Query = PromiseLike<QueryResult> & {
  contains(column: string, value: Record<string, unknown>): Query;
  eq(column: string, value: string): Query;
  maybeSingle(): Promise<QueryResult>;
  order(column: string, options: { ascending: boolean }): Promise<QueryResult>;
  select(columns: string): Query;
};
type Admin = {
  from(table: string): Query;
  rpc(name: string, input: Record<string, unknown>): Promise<QueryResult>;
};

function adminClient(): Admin {
  return createAdminClient() as unknown as Admin;
}

function databaseError(error: Failure): ReferralError {
  if (error.code === "23505") return new ReferralError("conflict", "Referral state conflicts with an existing record.");
  if (error.code === "42501") return new ReferralError("forbidden", "Referral access is denied.");
  if (error.code === "P0002") return new ReferralError("not_found", "Referral not found.");
  if (error.code === "22023" || error.code === "23514") {
    return new ReferralError("invalid_conversion", "Referral state does not permit this operation.");
  }
  return new ReferralError("unexpected", "The referral request could not be completed.");
}

function rpcRow(data: unknown): Record<string, unknown> | null {
  const row = Array.isArray(data) ? data[0] : data;
  return row && typeof row === "object" ? (row as Record<string, unknown>) : null;
}

function stringValue(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new ReferralError("unexpected", "The referral response was incomplete.");
  return value;
}

function nullableString(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== "string") throw new ReferralError("unexpected", "The referral response was incomplete.");
  return value;
}

function lifecycle(data: unknown): ReferralLifecycleRow {
  const row = rpcRow(data);
  if (!row) throw new ReferralError("unexpected", "The referral response was empty.");
  return {
    referralId: stringValue(row, "referral_id"),
    sourceOrgId: stringValue(row, "source_org_id"),
    platformOrgId: stringValue(row, "platform_org_id"),
    createdAt: stringValue(row, "created_at"),
    clickedAt: nullableString(row, "clicked_at"),
    convertedAt: nullableString(row, "converted_at"),
    convertedClientId: nullableString(row, "converted_client_id"),
  };
}

export const referralRepository: ReferralRepository = {
  async resolveSourceClient(consumerId) {
    const { data, error } = await adminClient()
      .from("clients")
      .select("id, org_id")
      .eq("consumer_profile_id", consumerId)
      .maybeSingle();
    if (error) throw databaseError(error);
    const row = data as { id?: unknown; org_id?: unknown } | null;
    if (typeof row?.id !== "string" || typeof row.org_id !== "string") {
      throw new ReferralError("not_found", "Consumer client not found.");
    }
    return { clientId: row.id, orgId: row.org_id };
  },

  async platformOrgIsMarked(platformOrgId) {
    const { data, error } = await adminClient()
      .from("orgs")
      .select("id, brand")
      .eq("id", platformOrgId)
      .contains("brand", { platform_intake: true })
      .maybeSingle();
    if (error) throw databaseError(error);
    return (data as { id?: unknown } | null)?.id === platformOrgId;
  },

  async createReferral(input: ReferralCreateInput) {
    const { data, error } = await adminClient().rpc("referral_create", {
      p_consumer_id: input.consumerId,
      p_source_client_id: input.sourceClientId,
      p_platform_org_id: input.platformOrgId,
      p_token_hash: `\\x${input.tokenDigest.toString("hex")}`,
    });
    if (error) throw databaseError(error);
    return lifecycle(data);
  },

  async markClicked(tokenDigest) {
    const { data, error } = await adminClient().rpc("referral_mark_clicked", {
      p_token_hash: `\\x${tokenDigest.toString("hex")}`,
    });
    if (error) throw databaseError(error);
    return lifecycle(data);
  },

  async markConverted(input) {
    const { data, error } = await adminClient().rpc("referral_mark_converted", {
      p_actor_id: input.actorId,
      p_converted_client_id: input.convertedClientId,
      p_token_hash: `\\x${input.tokenDigest.toString("hex")}`,
    });
    if (error) throw databaseError(error);
    const row = lifecycle(data) as ReferralConversionRow;
    const raw = rpcRow(data);
    const status = raw?.status;
    if (status !== "converted" && status !== "already_converted") {
      throw new ReferralError("unexpected", "The referral response was incomplete.");
    }
    row.status = status;
    return row;
  },

  async readEvidence(referralId): Promise<ReferralEvidence | null> {
    const { data, error } = await adminClient()
      .from("consumer_referrals")
      .select("id, source_client_id, source_org_id, platform_org_id, created_at, clicked_at, converted_at, converted_client_id")
      .eq("id", referralId)
      .maybeSingle();
    if (error) throw databaseError(error);
    if (!data) return null;
    const row = data as Record<string, unknown>;
    const audit = await adminClient()
      .from("audit_log")
      .select("action")
      .eq("subject_type", "consumer_referral")
      .eq("subject_id", referralId)
      .order("occurred_at", { ascending: true });
    if (audit.error) throw databaseError(audit.error);
    return {
      referralId: stringValue(row, "id"),
      sourceClientId: stringValue(row, "source_client_id"),
      sourceOrgId: stringValue(row, "source_org_id"),
      platformOrgId: stringValue(row, "platform_org_id"),
      createdAt: stringValue(row, "created_at"),
      clickedAt: nullableString(row, "clicked_at"),
      convertedAt: nullableString(row, "converted_at"),
      convertedClientId: nullableString(row, "converted_client_id"),
      auditActions: Array.isArray(audit.data)
        ? audit.data.flatMap((item: { action?: unknown }) => typeof item.action === "string" ? [item.action] : [])
        : [],
    };
  },
};
