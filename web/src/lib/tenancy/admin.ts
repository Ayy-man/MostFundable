import { resolveTrialDays } from "./config.ts";
import { TenantError } from "./errors.ts";
import { isTenantSlug, normalizeTenantSlug } from "./slug.ts";
import type { TenancyRepository } from "./repository.ts";
import type {
  ProvisionTenantResult,
  TenantAction,
  TenantActionResult,
} from "./types.ts";

type PlatformActor = { id: string; role: string };

export type TenantInviteSender = {
  send(input: { email: string; inviteId: string }): Promise<{ providerUserId: string }>;
};

export type ProvisionTenantBody = {
  email: string;
  fullName: string;
  name: string;
  slug: string;
};

export type TenantActionBody =
  | { action: "extend-trial"; trialDays: number }
  | { action: "deactivate" | "reactivate" }
  | { action: "raise-cap"; cap: number }
  | { action: "rename-slug"; slug: string };

export type TenantAdminDependencies = {
  clock?: () => Date;
  inviteSender: TenantInviteSender;
  repository: TenancyRepository;
  raiseClientCap?: (input: { actorId: string; cap: number; orgId: string }) => Promise<{ clientCap: number }>;
  trialDays?: () => number;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Postgres `uuid` shape, not strict RFC-4122: seeded ids carry zero version/variant nibbles (GAPS G-3B-06/07).
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hasOnly(source: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(source).every((key) => keys.includes(key)) &&
    keys.every((key) => Object.hasOwn(source, key));
}

function boundedText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length >= 1 && normalized.length <= max ? normalized : null;
}

export function parseProvisionTenantBody(value: unknown): ProvisionTenantBody {
  const source = object(value);
  if (!source || !hasOnly(source, ["email", "fullName", "name", "slug"])) {
    throw new TenantError(400, "INVALID_TENANT_INPUT", "The tenant input is invalid.");
  }
  const email = boundedText(source.email, 320)?.toLowerCase() ?? null;
  const fullName = boundedText(source.fullName, 120);
  const name = boundedText(source.name, 120);
  const slug = typeof source.slug === "string" ? normalizeTenantSlug(source.slug) : "";
  if (!email || !EMAIL_PATTERN.test(email) || !fullName || !name || !isTenantSlug(slug)) {
    throw new TenantError(400, "INVALID_TENANT_INPUT", "The tenant input is invalid.");
  }
  return { email, fullName, name, slug };
}

export function parseTenantActionBody(value: unknown): TenantActionBody {
  const source = object(value);
  const action = source?.action;
  if (!source || typeof action !== "string") {
    throw new TenantError(400, "INVALID_TENANT_INPUT", "The tenant action is invalid.");
  }
  if (action === "extend-trial") {
    if (
      !hasOnly(source, ["action", "trialDays"]) ||
      !Number.isInteger(source.trialDays) ||
      (source.trialDays as number) <= 0 ||
      (source.trialDays as number) > 3650
    ) {
      throw new TenantError(400, "INVALID_TENANT_INPUT", "The tenant action is invalid.");
    }
    return { action, trialDays: source.trialDays as number };
  }
  if (action === "rename-slug") {
    if (!hasOnly(source, ["action", "slug"]) || typeof source.slug !== "string") {
      throw new TenantError(400, "INVALID_TENANT_INPUT", "The tenant action is invalid.");
    }
    const slug = normalizeTenantSlug(source.slug);
    if (!isTenantSlug(slug)) {
      throw new TenantError(400, "INVALID_TENANT_INPUT", "The tenant action is invalid.");
    }
    return { action, slug };
  }
  if (action === "raise-cap") {
    if (
      !hasOnly(source, ["action", "cap"]) ||
      !Number.isInteger(source.cap) ||
      (source.cap as number) <= 0 ||
      (source.cap as number) > 2_147_483_647
    ) {
      throw new TenantError(400, "INVALID_TENANT_INPUT", "The tenant action is invalid.");
    }
    return { action, cap: source.cap as number };
  }
  if (["deactivate", "reactivate"].includes(action) && hasOnly(source, ["action"])) {
    return { action: action as "deactivate" | "reactivate" };
  }
  throw new TenantError(400, "INVALID_TENANT_INPUT", "The tenant action is invalid.");
}

function requirePlatformActor(actor: PlatformActor): void {
  if (actor.role !== "platform_admin") {
    throw new TenantError(403, "TENANT_REQUEST_FAILED", "The tenant request is not permitted.");
  }
}

function futureDate(now: Date, days: number): string {
  return new Date(now.getTime() + days * 86_400_000).toISOString();
}

export function createTenantAdminService(dependencies: TenantAdminDependencies) {
  const clock = dependencies.clock ?? (() => new Date());
  const trialDays = dependencies.trialDays ?? resolveTrialDays;

  return {
    async provision(input: {
      actor: PlatformActor;
      body: unknown;
      idempotencyKey: string;
    }): Promise<ProvisionTenantResult> {
      requirePlatformActor(input.actor);
      if (!UUID_PATTERN.test(input.idempotencyKey)) {
        throw new TenantError(400, "INVALID_TENANT_INPUT", "The idempotency key is invalid.");
      }
      const body = parseProvisionTenantBody(input.body);
      const now = clock();
      const provisioned = await dependencies.repository.provisionTenant({
        actorId: input.actor.id,
        ...body,
        idempotencyKey: input.idempotencyKey,
        trialEndsAt: futureDate(now, trialDays()),
      });

      let sent: { providerUserId: string };
      try {
        sent = await dependencies.inviteSender.send({
          email: body.email,
          inviteId: provisioned.tokenId,
        });
      } catch {
        await dependencies.repository.recordInviteDelivery({
          actorId: input.actor.id,
          errorCode: "provider_unavailable",
          inviteId: provisioned.inviteId,
          status: "failed",
        });
        throw new TenantError(
          502,
          "TENANT_INVITE_DELIVERY_FAILED",
          "The tenant was provisioned, but the invite could not be sent.",
        );
      }
      await dependencies.repository.recordInviteDelivery({
        actorId: input.actor.id,
        inviteId: provisioned.inviteId,
        providerUserId: sent.providerUserId,
        status: "sent",
      });
      return provisioned;
    },

    async act(input: {
      actor: PlatformActor;
      body: unknown;
      orgId: string;
    }): Promise<TenantActionResult> {
      requirePlatformActor(input.actor);
      if (!UUID_PATTERN.test(input.orgId)) {
        throw new TenantError(400, "INVALID_TENANT_INPUT", "The tenant id is invalid.");
      }
      const body = parseTenantActionBody(input.body);
      if (body.action === "raise-cap") {
        if (!dependencies.raiseClientCap) {
          throw new TenantError(501, "TENANT_ACTION_UNAVAILABLE", "This tenant action is not available.");
        }
        const raised = await dependencies.raiseClientCap({
          actorId: input.actor.id,
          cap: body.cap,
          orgId: input.orgId,
        });
        return {
          clientCap: raised.clientCap,
          membership: null,
          orgId: input.orgId,
          slug: null,
          trialEndsAt: null,
        };
      }

      const action: Exclude<TenantAction, "raise-cap"> = body.action;
      return dependencies.repository.runTenantAction({
        action,
        actorId: input.actor.id,
        orgId: input.orgId,
        slug: body.action === "rename-slug" ? body.slug : undefined,
        trialEndsAt: body.action === "extend-trial"
          ? futureDate(clock(), body.trialDays)
          : undefined,
      });
    },
  };
}

export async function productionTenantAdminService() {
  const [{ productionInviteMailSender }, { productionTenancyRepository }] = await Promise.all([
    import("./invite-mail.ts"),
    import("./repository.ts"),
  ]);
  const { featureFlag } = await import("@/lib/env");
  const raiseClientCap = featureFlag("FEATURE_BILLING_OPS")
    ? (await import("@/lib/billing/client-cap")).raiseClientCap
    : undefined;
  return createTenantAdminService({
    repository: await productionTenancyRepository(),
    inviteSender: await productionInviteMailSender(),
    raiseClientCap,
  });
}
