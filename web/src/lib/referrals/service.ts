import type { SessionProfile } from "@/lib/auth/session";
import type { EnvSource } from "@/lib/env";
import { parseReferralConfiguration } from "./config.ts";
import { ReferralError } from "./errors.ts";
import { createOpaqueReferralToken, digestReferralToken, parseReferralToken } from "./token.ts";
import type { ReferralRepository } from "./types.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function defaultRepository(): Promise<ReferralRepository> {
  return (await import("./repository.ts")).referralRepository;
}

async function configured(
  repository: ReferralRepository,
  env: EnvSource,
): Promise<{ intakeOrigin: string; platformOrgId: string }> {
  const config = parseReferralConfiguration(env);
  if (!config.enabled) {
    throw new ReferralError(
      config.explicitlyEnabled ? "unavailable" : "disabled",
      "Referrals are unavailable.",
    );
  }
  if (!(await repository.platformOrgIsMarked(config.platformOrgId))) {
    throw new ReferralError("unavailable", "Referrals are unavailable.");
  }
  return config;
}

export function createReferralService(
  repository: ReferralRepository,
  env: EnvSource,
) {
  return {
    async availability(): Promise<boolean> {
      const config = parseReferralConfiguration(env);
      if (!config.enabled) return false;
      try {
        return await repository.platformOrgIsMarked(config.platformOrgId);
      } catch {
        return false;
      }
    },

    async createConsumerReferral(actor: SessionProfile) {
      const config = await configured(repository, env);
      const source = await repository.resolveSourceClient(actor.id);
      if (source.orgId === config.platformOrgId) {
        throw new ReferralError("forbidden", "Referral routing is unavailable.");
      }
      const token = createOpaqueReferralToken();
      const row = await repository.createReferral({
        consumerId: actor.id,
        sourceClientId: source.clientId,
        platformOrgId: config.platformOrgId,
        tokenDigest: digestReferralToken(token),
      });
      return {
        referralId: row.referralId,
        url: `${config.intakeOrigin}/api/referrals/resolve/${token}`,
      };
    },

    async resolveConsumerReferral(token: string) {
      const config = await configured(repository, env);
      const parsed = parseReferralToken(token);
      if (!parsed) throw new ReferralError("invalid_token", "Referral not found.");
      const row = await repository.markClicked(digestReferralToken(parsed));
      if (row.platformOrgId !== config.platformOrgId) {
        throw new ReferralError("not_found", "Referral not found.");
      }
      return {
        referralId: row.referralId,
        platformOrgId: row.platformOrgId,
        intakeUrl: new URL("/consumer?intake=referral", config.intakeOrigin).toString(),
      };
    },

    async completeConsumerReferral(input: {
      token: string;
      clientId: string;
      actorId: string;
    }) {
      await configured(repository, env);
      const token = parseReferralToken(input.token);
      if (!token || !UUID_PATTERN.test(input.clientId) || !UUID_PATTERN.test(input.actorId)) {
        throw new ReferralError("invalid_conversion", "Referral conversion is invalid.");
      }
      const row = await repository.markConverted({
        tokenDigest: digestReferralToken(token),
        convertedClientId: input.clientId,
        actorId: input.actorId,
      });
      return { referralId: row.referralId, status: row.status };
    },
  };
}

export async function resolveReferralAvailability(
  env: EnvSource = process.env,
): Promise<boolean> {
  return createReferralService(await defaultRepository(), env).availability();
}

export async function createConsumerReferral(actor: SessionProfile) {
  return createReferralService(await defaultRepository(), process.env).createConsumerReferral(actor);
}

export async function resolveConsumerReferral(token: string) {
  return createReferralService(await defaultRepository(), process.env).resolveConsumerReferral(token);
}

export async function completeConsumerReferral(input: {
  token: string;
  clientId: string;
  actorId: string;
}) {
  return createReferralService(await defaultRepository(), process.env).completeConsumerReferral(input);
}
