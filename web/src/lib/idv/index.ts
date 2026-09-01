import { resolveDriver } from "@/lib/env";
import { createCrsIdvAdapter } from "@/lib/idv/crs";
import { createMockIdvAdapter } from "@/lib/idv/mock";
import type { IdvAdapter, IdvDriver } from "@/lib/idv/types";

let cached: IdvAdapter | undefined;

function selectedDriver(): IdvDriver {
  const driver = resolveDriver("idv") as IdvDriver;
  if (driver === "crs" && resolveDriver("crs") !== "sandbox") {
    throw new Error("IDV_DRIVER=crs requires CRS_DRIVER=sandbox.");
  }
  return driver;
}

export function getIdvAdapter(): IdvAdapter {
  if (cached) return cached;

  const driver = selectedDriver();
  cached = driver === "crs" ? createCrsIdvAdapter() : createMockIdvAdapter();
  return cached;
}

export function resolvedIdvDriver(): IdvDriver {
  // The browser uses this name only to decide whether to render its demo hint;
  // enrollment behavior always goes through the adapter contract above.
  return selectedDriver();
}
