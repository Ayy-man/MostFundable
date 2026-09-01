import { resolveDriver, type EnvSource } from "@/lib/env";

import { createMockEmailDriver } from "./mock-driver.ts";
import { createEmailReceiptRepository, type EmailReceiptRepository } from "./repository.ts";
import { createResendEmailDriver } from "./resend-driver.ts";
import type { EmailDriver } from "./types.ts";

const selectedEmailDriver = resolveDriver("email");

export interface EmailBootstrapDependencies {
  readonly repository?: EmailReceiptRepository;
  readonly fetch?: typeof globalThis.fetch;
  readonly resolveOrgDisplayName?: (orgId: string) => Promise<string>;
}

async function productionDisplayName(orgId: string): Promise<string> {
  const { readOrgBillingProfile } = await import("@/lib/billing/repository-operator");
  const result = await readOrgBillingProfile(orgId);
  if (!result.ok || result.value === null || result.value.name.trim() === "") {
    throw new Error("EMAIL_ORG_PROFILE_UNAVAILABLE");
  }
  return result.value.name;
}

export function createEmailDriver(
  env: EnvSource = process.env,
  dependencies: EmailBootstrapDependencies = {},
): EmailDriver {
  const repository = dependencies.repository ?? createEmailReceiptRepository();
  if (selectedEmailDriver === "mock") return createMockEmailDriver({ repository });
  return createResendEmailDriver({
    apiKey: env.RESEND_API_KEY,
    fromAddress: env.EMAIL_FROM_ADDRESS,
    repository,
    fetch: dependencies.fetch,
    resolveOrgDisplayName: dependencies.resolveOrgDisplayName ?? productionDisplayName,
  });
}

let cached: EmailDriver | null = null;

export function getEmailDriver(): EmailDriver {
  if (cached === null) cached = createEmailDriver();
  return cached;
}
