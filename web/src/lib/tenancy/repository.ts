import type {
  AcceptTenantInviteInput,
  AcceptTenantInviteResult,
  CreateTenantInviteInput,
  CreateTenantInviteResult,
  DeactivateTenantMemberResult,
  InviteDeliveryInput,
  PublishedBrand,
  ProvisionTenantInput,
  ProvisionTenantResult,
  TenantActionInput,
  TenantActionResult,
  TenantBrandState,
  TenantMember,
  TenantOrganization,
  TrialExpiryResult,
} from "./types.ts";
import { TenantError } from "./errors.ts";

type DbFailure = { code?: string | null; message?: string | null };
type DbResponse = PromiseLike<{ data: unknown; error: DbFailure | null }>;
type DbQuery = DbResponse & {
  eq(column: string, value: string): DbQuery;
  maybeSingle(): DbResponse;
  select(columns: string): DbQuery;
};
type DbClient = {
  from(table: string): DbQuery;
  rpc(name: string, args: Record<string, unknown>): DbResponse;
};

type Row = Record<string, unknown>;

export interface TenancyRepository {
  acceptInvite(input: AcceptTenantInviteInput): Promise<AcceptTenantInviteResult>;
  createInvite(input: CreateTenantInviteInput): Promise<CreateTenantInviteResult>;
  deactivateMember(input: { actorId: string; targetId: string }): Promise<DeactivateTenantMemberResult>;
  expireTrials(window: string): Promise<TrialExpiryResult>;
  findClaimedOrgBySlug(slug: string): Promise<TenantOrganization | null>;
  findMember(profileId: string): Promise<TenantMember | null>;
  publishBrand(input: { actorId: string; orgId: string }): Promise<{ publishedAt: string }>;
  provisionTenant(input: ProvisionTenantInput): Promise<ProvisionTenantResult>;
  recordInviteDelivery(input: InviteDeliveryInput): Promise<void>;
  runTenantAction(input: TenantActionInput): Promise<TenantActionResult>;
  readBrand(orgId: string): Promise<TenantBrandState | null>;
  readPublishedBrand(orgId: string): Promise<TenantOrganization["publishedBrand"]>;
  updateBrand(input: { actorId: string; brand: PublishedBrand; orgId: string }): Promise<PublishedBrand>;
}

function row(value: unknown): Row | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Row)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function databaseError(error: DbFailure): TenantError {
  if (error.message === "TENANT_INVITE_INVALID" || error.code === "P0001") {
    return new TenantError(409, "TENANT_INVITE_INVALID", "The invitation is invalid.");
  }
  if (error.message === "TENANT_REACTIVATION_REQUIRES_TRIAL_EXTENSION") {
    return new TenantError(
      409,
      "TENANT_REACTIVATION_REQUIRES_TRIAL_EXTENSION",
      "Extend the tenant trial before reactivation.",
    );
  }
  if (error.message === "TENANT_ACTION_UNAVAILABLE" || error.code === "0A000") {
    return new TenantError(501, "TENANT_ACTION_UNAVAILABLE", "This tenant action is not available.");
  }
  if (error.code === "23505") {
    return new TenantError(409, "TENANT_CONFLICT", "The tenant already exists.");
  }
  if (error.code === "P0002") {
    return new TenantError(404, "TENANT_NOT_FOUND", "The tenant was not found.");
  }
  if (error.code === "42501") {
    return new TenantError(403, "TENANT_REQUEST_FAILED", "The tenant request is not permitted.");
  }
  if (error.code === "23514" || error.code === "22023" || error.code === "55000") {
    return new TenantError(409, "TENANT_CONFLICT", "The tenant change is not permitted.");
  }
  return new TenantError(500, "TENANT_REQUEST_FAILED", "The tenant request could not be completed.");
}

function requiredText(source: Row, key: string): string {
  const value = text(source[key]);
  if (!value) throw new TenantError(500, "TENANT_REQUEST_FAILED", "The tenant response was invalid.");
  return value;
}

function parseBrand(value: unknown): TenantOrganization["publishedBrand"] {
  const source = row(value);
  if (!source) return null;
  const brand: NonNullable<TenantOrganization["publishedBrand"]> = {};
  const logoUrl = text(source.logoUrl ?? source.logo_url);
  const portalName = text(source.portalName ?? source.portal_name);
  const primaryColor = text(source.primaryColor ?? source.primary_color);
  const accentColor = text(source.accentColor ?? source.accent_color);
  if (logoUrl) brand.logoUrl = logoUrl;
  if (portalName) brand.portalName = portalName;
  if (primaryColor) brand.primaryColor = primaryColor;
  if (accentColor) brand.accentColor = accentColor;
  return Object.keys(brand).length ? brand : null;
}

export function createTenancyRepository(client: DbClient): TenancyRepository {
  return {
    async acceptInvite(input) {
      const lookup = await client
        .from("invites")
        .select("id")
        .eq("token_id", input.tokenId)
        .maybeSingle();
      if (lookup.error) throw databaseError(lookup.error);
      const invite = row(lookup.data);
      if (!invite) {
        throw new TenantError(409, "TENANT_INVITE_INVALID", "The invitation is invalid.");
      }
      const { data, error } = await client.rpc("tenancy_accept_invite", {
        p_email: input.email,
        p_invite_id: requiredText(invite, "id"),
        p_provider_user_id: input.providerUserId,
        p_token_id: input.tokenId,
      });
      if (error) throw databaseError(error);
      const source = row(data);
      if (!source) throw databaseError({});
      const kind = text(source.kind);
      if (kind !== "team" && kind !== "affiliate" && kind !== "client") {
        throw databaseError({});
      }
      return {
        affiliateId: text(source.affiliate_id),
        clientId: text(source.client_id),
        kind,
        orgId: requiredText(source, "org_id"),
        profileId: requiredText(source, "profile_id"),
      };
    },

    async createInvite(input) {
      const { data, error } = await client.rpc("tenancy_create_invite", {
        p_actor_id: input.actorId,
        p_email: input.email,
        p_expires_at: input.expiresAt,
        p_full_name: input.fullName,
        p_idempotency_key: input.idempotencyKey,
        p_kind: input.kind,
        p_org_id: input.orgId,
        p_org_role: input.orgRole,
      });
      if (error) throw databaseError(error);
      const source = row(data);
      if (!source) throw databaseError({});
      return {
        inviteId: requiredText(source, "invite_id"),
        orgId: requiredText(source, "org_id"),
        tokenId: requiredText(source, "token_id"),
      };
    },

    async deactivateMember(input) {
      const { data, error } = await client.rpc("tenancy_deactivate_member", {
        p_actor_id: input.actorId,
        p_target_id: input.targetId,
      });
      if (error) throw databaseError(error);
      const source = row(data);
      if (!source) throw databaseError({});
      return {
        applied: source.applied === true,
        customerRef: text(source.customer_ref),
        orgId: requiredText(source, "org_id"),
        profileId: requiredText(source, "profile_id"),
      };
    },

    async expireTrials(window) {
      const { data, error } = await client.rpc("tenancy_expire_trials", {
        p_window: window,
      });
      if (error) throw databaseError(error);
      const source = row(data);
      if (!source || source.status !== "ok" || typeof source.rows !== "number") {
        throw databaseError({});
      }
      return { rows: source.rows, status: "ok" };
    },

    async findClaimedOrgBySlug(slug) {
      const { data, error } = await client
        .from("orgs")
        .select("id, slug, membership, brand, brand_published_at")
        .eq("slug", slug)
        .maybeSingle();
      if (error) throw databaseError(error);
      const source = row(data);
      if (!source) return null;
      const membership = text(source.membership);
      if (!membership || !["trial", "current", "past_due", "grace", "deactivated"].includes(membership)) {
        throw new TenantError(500, "TENANT_REQUEST_FAILED", "The tenant response was invalid.");
      }
      const brandPublishedAt = text(source.brand_published_at);
      return {
        brandPublishedAt,
        id: requiredText(source, "id"),
        membership: membership as TenantOrganization["membership"],
        publishedBrand: brandPublishedAt ? parseBrand(source.brand) : null,
        slug: requiredText(source, "slug"),
      };
    },

    async findMember(profileId) {
      const { data, error } = await client
        .from("profiles")
        .select("id, role, org_id, org_role, disabled_at")
        .eq("id", profileId)
        .maybeSingle();
      if (error) throw databaseError(error);
      const source = row(data);
      if (!source) return null;
      return {
        disabledAt: text(source.disabled_at),
        id: requiredText(source, "id"),
        orgId: text(source.org_id),
        orgRole: text(source.org_role) as TenantMember["orgRole"],
        role: requiredText(source, "role") as TenantMember["role"],
      };
    },

    async publishBrand(input) {
      const { data, error } = await client.rpc("tenancy_publish_brand", {
        p_actor_id: input.actorId,
        p_org_id: input.orgId,
      });
      if (error) throw databaseError(error);
      const source = row(data);
      if (!source) throw databaseError({});
      return { publishedAt: requiredText(source, "published_at") };
    },

    async provisionTenant(input) {
      const { data, error } = await client.rpc("tenancy_provision_org", {
        p_actor_id: input.actorId,
        p_email: input.email,
        p_full_name: input.fullName,
        p_idempotency_key: input.idempotencyKey,
        p_name: input.name,
        p_slug: input.slug,
        p_trial_ends_at: input.trialEndsAt,
      });
      if (error) throw databaseError(error);
      const source = row(data);
      if (!source) throw databaseError({});
      return {
        inviteId: requiredText(source, "invite_id"),
        orgId: requiredText(source, "org_id"),
        replayed: source.applied !== true,
        tokenId: requiredText(source, "token_id"),
      };
    },

    async recordInviteDelivery(input) {
      const { error } = await client.rpc("tenancy_mark_invite_delivery", {
        p_failure_code: input.errorCode ?? null,
        p_invite_id: input.inviteId,
        p_provider_user_id: input.providerUserId ?? null,
        p_sent: input.status === "sent",
      });
      if (error) throw databaseError(error);
    },

    async readBrand(orgId) {
      const { data, error } = await client
        .from("orgs")
        .select("slug, brand, brand_published_at")
        .eq("id", orgId)
        .maybeSingle();
      if (error) throw databaseError(error);
      const source = row(data);
      if (!source) return null;
      return {
        brand: parseBrand(source.brand) ?? {},
        publishedAt: text(source.brand_published_at),
        slug: requiredText(source, "slug"),
      };
    },

    async readPublishedBrand(orgId) {
      const state = await this.readBrand(orgId);
      return state?.publishedAt ? state.brand : null;
    },

    async runTenantAction(input) {
      const functionName = input.action === "rename-slug"
        ? "tenancy_rename_org_slug"
        : "tenancy_apply_org_action";
      const args = input.action === "rename-slug"
        ? { p_actor_id: input.actorId, p_org_id: input.orgId, p_slug: input.slug }
        : {
            p_action: input.action,
            p_actor_id: input.actorId,
            p_org_id: input.orgId,
            p_trial_ends_at: input.trialEndsAt ?? null,
          };
      const { data, error } = await client.rpc(functionName, args);
      if (error) throw databaseError(error);
      const source = row(data);
      if (!source) throw databaseError({});
      const membership = text(source.membership) ?? text(source.to_membership);
      return {
        membership: membership
          ? membership as TenantActionResult["membership"]
          : null,
        orgId: input.orgId,
        slug: input.action === "rename-slug" ? text(source.to) : null,
        trialEndsAt: text(source.trial_ends_at),
      };
    },

    async updateBrand(input) {
      const { data, error } = await client.rpc("tenancy_update_brand", {
        p_actor_id: input.actorId,
        p_brand: input.brand,
        p_org_id: input.orgId,
      });
      if (error) throw databaseError(error);
      return parseBrand(data) ?? {};
    },
  };
}

export async function productionTenancyRepository(): Promise<TenancyRepository> {
  const { createAdminClient } = await import("../supabase/admin.ts");
  return createTenancyRepository(createAdminClient() as unknown as DbClient);
}
