import { TenantError } from "./errors.ts";
import { assertTenantWriteAllowed } from "./wall.ts";
import type { TenantInviteSender } from "./admin.ts";
import type { TenancyRepository } from "./repository.ts";
import type {
  AcceptTenantInviteResult,
  CreateTenantInviteResult,
  SessionContext,
} from "./types.ts";

export type InviteActor = SessionContext & {
  disabledAt: string | null;
  id: string;
  orgId: string | null;
  orgRole: "admin" | "member" | "owner" | null;
};

export type InviteBody = {
  email: string;
  expiresInDays: number;
  fullName: string;
  kind: "affiliate" | "client" | "team";
  orgRole: "admin" | "member" | "owner" | null;
};

export type InviteIdentityVerifier = {
  verify(input: { tokenHash: string }): Promise<{
    email: string;
    metadataInviteId: string;
    providerUserId: string;
  }>;
};

export type SeatSynchronizer = {
  sync(orgId: string): Promise<{ reason: string }>;
};

export type InviteServiceDependencies = {
  clock?: () => Date;
  inviteSender: TenantInviteSender;
  repository: TenancyRepository;
  seatSynchronizer: SeatSynchronizer;
  verifier: InviteIdentityVerifier;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Postgres `uuid` shape, not strict RFC-4122: seeded ids carry zero version/variant nibbles (GAPS G-3B-06/07).
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= max ? normalized : null;
}

export function parseInviteBody(value: unknown): InviteBody {
  const source = object(value);
  if (!source) throw new TenantError(400, "INVALID_TENANT_INPUT", "The invitation input is invalid.");
  const allowed = new Set(["email", "expiresInDays", "fullName", "kind", "orgRole"]);
  if (Object.keys(source).some((key) => !allowed.has(key))) {
    throw new TenantError(400, "INVALID_TENANT_INPUT", "The invitation input is invalid.");
  }
  const email = boundedText(source.email, 320)?.toLowerCase() ?? null;
  const fullName = boundedText(source.fullName, 120);
  const kind = source.kind;
  const expiresInDays = source.expiresInDays === undefined ? 7 : source.expiresInDays;
  if (
    !email || !EMAIL_PATTERN.test(email) || !fullName ||
    (kind !== "team" && kind !== "affiliate" && kind !== "client") ||
    !Number.isInteger(expiresInDays) || (expiresInDays as number) < 1 || (expiresInDays as number) > 30
  ) {
    throw new TenantError(400, "INVALID_TENANT_INPUT", "The invitation input is invalid.");
  }
  const orgRole = source.orgRole;
  if (
    (kind === "team" && !["owner", "admin", "member"].includes(orgRole as string)) ||
    ((kind === "affiliate" || kind === "client") && orgRole !== undefined && orgRole !== null)
  ) {
    throw new TenantError(400, "INVALID_TENANT_INPUT", "The invitation input is invalid.");
  }
  return {
    email,
    expiresInDays: expiresInDays as number,
    fullName,
    kind,
    orgRole: kind === "team" ? orgRole as InviteBody["orgRole"] : null,
  };
}

function requireOrgManager(actor: InviteActor): asserts actor is InviteActor & { orgId: string } {
  if (
    actor.role !== "operator_member" ||
    actor.disabledAt !== null ||
    !actor.orgId ||
    (actor.orgRole !== "owner" && actor.orgRole !== "admin")
  ) {
    throw new TenantError(403, "TENANT_REQUEST_FAILED", "The tenant request is not permitted.");
  }
}

function futureDate(now: Date, days: number): string {
  return new Date(now.getTime() + days * 86_400_000).toISOString();
}

async function syncAfterCommit(
  synchronizer: SeatSynchronizer,
  orgId: string,
): Promise<void> {
  try {
    const outcome = await synchronizer.sync(orgId);
    if (outcome.reason === "driver_rejected") throw new Error("seat sync refused");
  } catch {
    throw new TenantError(
      502,
      "TENANT_SEAT_SYNC_FAILED",
      "The membership change is saved and its seat update is queued.",
    );
  }
}

export function createInviteService(dependencies: InviteServiceDependencies) {
  const clock = dependencies.clock ?? (() => new Date());
  return {
    async create(input: {
      actor: InviteActor;
      body: unknown;
      idempotencyKey: string;
    }): Promise<CreateTenantInviteResult> {
      requireOrgManager(input.actor);
      await assertTenantWriteAllowed(input.actor);
      if (!UUID_PATTERN.test(input.idempotencyKey)) {
        throw new TenantError(400, "INVALID_TENANT_INPUT", "The idempotency key is invalid.");
      }
      const body = parseInviteBody(input.body);
      const created = await dependencies.repository.createInvite({
        actorId: input.actor.id,
        email: body.email,
        expiresAt: futureDate(clock(), body.expiresInDays),
        fullName: body.fullName,
        idempotencyKey: input.idempotencyKey,
        kind: body.kind,
        orgId: input.actor.orgId,
        orgRole: body.orgRole,
      });

      let sent: { providerUserId: string };
      try {
        sent = await dependencies.inviteSender.send({
          email: body.email,
          inviteId: created.tokenId,
        });
      } catch {
        await dependencies.repository.recordInviteDelivery({
          actorId: input.actor.id,
          errorCode: "provider_unavailable",
          inviteId: created.inviteId,
          status: "failed",
        });
        throw new TenantError(
          502,
          "TENANT_INVITE_DELIVERY_FAILED",
          "The invitation could not be sent.",
        );
      }
      await dependencies.repository.recordInviteDelivery({
        actorId: input.actor.id,
        inviteId: created.inviteId,
        providerUserId: sent.providerUserId,
        status: "sent",
      });
      return created;
    },

    async accept(input: {
      tokenHash: string;
      tokenId: string;
    }): Promise<AcceptTenantInviteResult> {
      if (!input.tokenHash || !UUID_PATTERN.test(input.tokenId)) {
        throw new TenantError(409, "TENANT_INVITE_INVALID", "The invitation is invalid.");
      }
      let identity: Awaited<ReturnType<InviteIdentityVerifier["verify"]>>;
      try {
        identity = await dependencies.verifier.verify({ tokenHash: input.tokenHash });
      } catch {
        throw new TenantError(409, "TENANT_INVITE_INVALID", "The invitation is invalid.");
      }
      if (identity.metadataInviteId !== input.tokenId) {
        throw new TenantError(409, "TENANT_INVITE_INVALID", "The invitation is invalid.");
      }
      const accepted = await dependencies.repository.acceptInvite({
        email: identity.email.toLowerCase(),
        providerUserId: identity.providerUserId,
        tokenId: input.tokenId,
      });
      if (accepted.kind === "team") {
        await syncAfterCommit(dependencies.seatSynchronizer, accepted.orgId);
      }
      return accepted;
    },

    async deactivate(input: {
      actor: InviteActor;
      targetId: string;
    }) {
      requireOrgManager(input.actor);
      await assertTenantWriteAllowed(input.actor);
      if (!UUID_PATTERN.test(input.targetId)) {
        throw new TenantError(400, "INVALID_TENANT_INPUT", "The member id is invalid.");
      }
      const result = await dependencies.repository.deactivateMember({
        actorId: input.actor.id,
        targetId: input.targetId,
      });
      await syncAfterCommit(dependencies.seatSynchronizer, result.orgId);
      return result;
    },
  };
}

export async function productionInviteService() {
  const [repositoryModule, mailModule, serverModule, billingModule] = await Promise.all([
    import("./repository.ts"),
    import("./invite-mail.ts"),
    import("../supabase/server.ts"),
    import("../billing/service-operator.ts"),
  ]);
  return createInviteService({
    repository: await repositoryModule.productionTenancyRepository(),
    inviteSender: await mailModule.productionInviteMailSender(),
    verifier: {
      async verify({ tokenHash }) {
        const client = await serverModule.createClient();
        const { data, error } = await client.auth.verifyOtp({
          token_hash: tokenHash,
          type: "invite",
        });
        const inviteId = data.user?.user_metadata?.invite_id;
        if (error || !data.user?.id || !data.user.email || typeof inviteId !== "string") {
          throw new Error("TENANT_INVITE_INVALID");
        }
        return {
          email: data.user.email,
          metadataInviteId: inviteId,
          providerUserId: data.user.id,
        };
      },
    },
    seatSynchronizer: {
      async sync(orgId) {
        return billingModule.syncOperatorSeats(orgId);
      },
    },
  });
}
