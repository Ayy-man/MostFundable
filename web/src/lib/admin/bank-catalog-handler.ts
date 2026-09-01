import "server-only";

import { adminError, adminFailure, adminJson, isExactRecord } from "./http.ts";
import { AdminBankCatalogError } from "./bank-catalog-types.ts";
import type { AdminBankCatalogService } from "./bank-catalog-service.ts";

type AdminSession = { id: string; role: "platform_admin" };

export interface AdminBankCatalogHandlerDependencies {
  requireAdmin(): Promise<AdminSession>;
  service(): Promise<AdminBankCatalogService>;
}

const defaults: AdminBankCatalogHandlerDependencies = {
  async requireAdmin() {
    const { requireRole } = await import("@/lib/auth/session");
    return await requireRole("platform_admin") as AdminSession;
  },
  async service() {
    const { createAdminBankCatalogService } = await import("./bank-catalog-service.ts");
    return createAdminBankCatalogService();
  },
};

function dependencies(overrides: Partial<AdminBankCatalogHandlerDependencies>) {
  return { ...defaults, ...overrides };
}

function failure(error: unknown): Response {
  if (error instanceof AdminBankCatalogError) return adminError(error.code, error.status);
  return adminFailure(error);
}

async function body(request: Request): Promise<unknown> {
  try { return await request.json(); } catch { return null; }
}

export async function handleAdminBankCatalogList(
  overrides: Partial<AdminBankCatalogHandlerDependencies> = {},
): Promise<Response> {
  const deps = dependencies(overrides);
  try {
    await deps.requireAdmin();
    const banks = await (await deps.service()).list();
    return adminJson({ banks });
  } catch (error) { return failure(error); }
}

export async function handleAdminBankCatalogCreate(
  request: Request,
  overrides: Partial<AdminBankCatalogHandlerDependencies> = {},
): Promise<Response> {
  const deps = dependencies(overrides);
  try {
    const actor = await deps.requireAdmin();
    const bank = await (await deps.service()).create(actor.id, await body(request));
    return adminJson({ bank }, 201);
  } catch (error) { return failure(error); }
}

export async function handleAdminBankCatalogMutation(
  request: Request,
  bankRef: string,
  overrides: Partial<AdminBankCatalogHandlerDependencies> = {},
): Promise<Response> {
  const deps = dependencies(overrides);
  try {
    const actor = await deps.requireAdmin();
    const value = await body(request);
    const service = await deps.service();
    const bank = isExactRecord(value, ["action", "content"]) && value.action === "update"
      ? await service.update(actor.id, bankRef, value.content)
      : isExactRecord(value, ["action"])
        && (value.action === "archive" || value.action === "reactivate")
        ? await service.setStatus(actor.id, bankRef, value.action)
        : null;
    if (bank === null) return adminError("bank_catalog_input_invalid", 400);
    return adminJson({ bank });
  } catch (error) { return failure(error); }
}
