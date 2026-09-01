import "server-only";

import {
  AdminBankCatalogError,
  type AdminBankCatalogContent,
  type AdminBankCatalogCreateInput,
  type AdminBankCatalogRepository,
  type AdminBankCatalogStatusAction,
} from "./bank-catalog-types.ts";
import {
  ADMIN_BANK_REF,
  parseAdminBankCatalogContent,
  parseAdminBankCatalogCreateInput,
} from "./bank-catalog-validate.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalid(): never {
  throw new AdminBankCatalogError(400, "bank_catalog_input_invalid");
}

async function productionRepository(): Promise<AdminBankCatalogRepository> {
  const { createAdminBankCatalogRepository } = await import("./bank-catalog-repository.ts");
  return createAdminBankCatalogRepository();
}

export function createAdminBankCatalogService(repository?: AdminBankCatalogRepository) {
  let repositoryPromise: Promise<AdminBankCatalogRepository> | null = null;
  const repo = () => (repositoryPromise ??= Promise.resolve(repository ?? productionRepository()));
  const actor = (actorId: string) => {
    if (!UUID.test(actorId)) invalid();
    return actorId;
  };
  const ref = (bankRef: string) => {
    if (!ADMIN_BANK_REF.test(bankRef)) invalid();
    return bankRef;
  };

  return {
    async list() {
      return (await repo()).list();
    },

    async create(actorId: string, value: unknown) {
      const input = parseAdminBankCatalogCreateInput(value);
      if (input === null) invalid();
      return (await repo()).create(actor(actorId), input as AdminBankCatalogCreateInput);
    },

    async update(actorId: string, bankRef: string, value: unknown) {
      const content = parseAdminBankCatalogContent(value);
      if (content === null) invalid();
      return (await repo()).update(
        actor(actorId),
        ref(bankRef),
        content as AdminBankCatalogContent,
      );
    },

    async setStatus(actorId: string, bankRef: string, action: AdminBankCatalogStatusAction) {
      if (action !== "archive" && action !== "reactivate") invalid();
      return (await repo()).setStatus(actor(actorId), ref(bankRef), action === "reactivate");
    },
  };
}

export type AdminBankCatalogService = ReturnType<typeof createAdminBankCatalogService>;
