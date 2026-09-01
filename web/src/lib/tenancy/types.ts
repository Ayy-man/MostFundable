import type { OperatorMembership } from "@/lib/billing/types";

export const TENANT_ACTIONS = [
  "extend-trial",
  "deactivate",
  "reactivate",
  "rename-slug",
  "raise-cap",
] as const;

export type TenantAction = (typeof TENANT_ACTIONS)[number];

export type PublishedBrand = {
  accentColor?: string;
  logoUrl?: string;
  portalName?: string;
  primaryColor?: string;
};

export type TenantBrandState = {
  brand: PublishedBrand;
  publishedAt: string | null;
  slug: string;
};

export type TrialExpiryResult = {
  rows: number;
  status: "ok";
};

export type TenantOrganization = {
  brandPublishedAt: string | null;
  id: string;
  membership: OperatorMembership;
  publishedBrand: PublishedBrand | null;
  slug: string;
};

export type TenantResolution =
  | { kind: "platform_admin" }
  | { kind: "organization"; organization: TenantOrganization }
  | { kind: "unknown" };

export type TenantRequestContext =
  | { kind: "platform_admin" }
  | { kind: "organization"; orgId: string; slug: string };

export type SessionContext = {
  orgMembership: OperatorMembership | null;
  role: "affiliate" | "consumer" | "operator_member" | "platform_admin";
};

export type TenantMember = {
  disabledAt: string | null;
  id: string;
  orgId: string | null;
  orgRole: "admin" | "member" | "owner" | null;
  role: SessionContext["role"];
};

export type ProvisionTenantInput = {
  actorId: string;
  email: string;
  fullName: string;
  idempotencyKey: string;
  name: string;
  slug: string;
  trialEndsAt: string;
};

export type ProvisionTenantResult = {
  inviteId: string;
  orgId: string;
  replayed: boolean;
  tokenId: string;
};

export type CreateTenantInviteInput = {
  actorId: string;
  email: string;
  expiresAt: string;
  fullName: string;
  idempotencyKey: string;
  kind: "affiliate" | "client" | "team";
  orgId: string;
  orgRole: "admin" | "member" | "owner" | null;
};

export type CreateTenantInviteResult = {
  inviteId: string;
  orgId: string;
  tokenId: string;
};

export type AcceptTenantInviteInput = {
  email: string;
  providerUserId: string;
  tokenId: string;
};

export type AcceptTenantInviteResult = {
  affiliateId: string | null;
  clientId: string | null;
  kind: "affiliate" | "client" | "team";
  orgId: string;
  profileId: string;
};

export type DeactivateTenantMemberResult = {
  applied: boolean;
  customerRef: string | null;
  orgId: string;
  profileId: string;
};

export type InviteDeliveryInput = {
  actorId: string;
  errorCode?: string;
  inviteId: string;
  providerUserId?: string;
  status: "failed" | "sent";
};

export type TenantActionInput = {
  action: Exclude<TenantAction, "raise-cap">;
  actorId: string;
  orgId: string;
  slug?: string;
  trialEndsAt?: string;
};

export type TenantActionResult = {
  clientCap?: number;
  membership: OperatorMembership | null;
  orgId: string;
  slug: string | null;
  trialEndsAt: string | null;
};
