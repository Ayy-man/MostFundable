import "server-only";

import { readTenantRequestContext } from "./context.ts";
import {
  productionTenancyRepository,
  type TenancyRepository,
} from "./repository.ts";
import type { PublishedBrand } from "./types.ts";

export async function readOperatorPublishedBrand(input: {
  enabled: boolean;
  headers: Headers;
  repository?: Pick<TenancyRepository, "readPublishedBrand">;
}): Promise<PublishedBrand | null> {
  if (!input.enabled) return null;
  const context = readTenantRequestContext(input.headers);
  if (context?.kind !== "organization") return null;

  const repository = input.repository ?? await productionTenancyRepository();
  return repository.readPublishedBrand(context.orgId);
}
