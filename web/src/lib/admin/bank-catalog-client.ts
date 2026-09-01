"use client";

import {
  AdminBankCatalogError,
  type AdminBankCatalogContent,
  type AdminBankCatalogCreateInput,
  type AdminBankCatalogEntry,
  type AdminBankCatalogStatusAction,
} from "./bank-catalog-types.ts";
import {
  ADMIN_BANK_REF,
  parseAdminBankCatalogContent,
  parseAdminBankCatalogCreateInput,
  parseAdminBankCatalogEntry,
} from "./bank-catalog-validate.ts";
import { isExactRecord } from "./http.ts";

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

async function parsedBody(response: Response): Promise<Record<string, unknown>> {
  let value: unknown;
  try { value = await response.json(); } catch {
    throw new AdminBankCatalogError(response.status, "bank_catalog_response_invalid");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AdminBankCatalogError(response.status, "bank_catalog_response_invalid");
  }
  return value as Record<string, unknown>;
}

function responseError(response: Response, value: Record<string, unknown>): AdminBankCatalogError {
  const error = typeof value.error === "object" && value.error !== null && !Array.isArray(value.error)
    ? value.error as Record<string, unknown>
    : null;
  return new AdminBankCatalogError(
    response.status,
    typeof error?.code === "string" ? error.code : `http_${response.status}`,
  );
}

async function requestBank(path: string, init: RequestInit, fetcher: Fetcher): Promise<AdminBankCatalogEntry> {
  let response: Response;
  try {
    response = await fetcher(path, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      ...init,
    });
  } catch {
    throw new AdminBankCatalogError(0, "bank_catalog_network_unavailable");
  }
  const value = await parsedBody(response);
  if (!response.ok) throw responseError(response, value);
  if (!isExactRecord(value, ["bank"])) {
    throw new AdminBankCatalogError(response.status, "bank_catalog_response_invalid");
  }
  const bank = parseAdminBankCatalogEntry(value.bank);
  if (bank === null) throw new AdminBankCatalogError(response.status, "bank_catalog_response_invalid");
  return bank;
}

export async function loadAdminBankCatalog(
  fetcher: Fetcher = fetch,
): Promise<readonly AdminBankCatalogEntry[] | null> {
  let response: Response;
  try {
    response = await fetcher("/api/admin/banks", {
      cache: "no-store",
      credentials: "same-origin",
    });
  } catch {
    throw new AdminBankCatalogError(0, "bank_catalog_network_unavailable");
  }
  if (response.status === 404) return null;
  const value = await parsedBody(response);
  if (!response.ok) throw responseError(response, value);
  if (!isExactRecord(value, ["banks"]) || !Array.isArray(value.banks)) {
    throw new AdminBankCatalogError(response.status, "bank_catalog_response_invalid");
  }
  const banks = value.banks.map(parseAdminBankCatalogEntry);
  if (banks.some((bank) => bank === null)) {
    throw new AdminBankCatalogError(response.status, "bank_catalog_response_invalid");
  }
  return Object.freeze(banks as AdminBankCatalogEntry[]);
}

export async function createAdminBankCatalogEntry(
  input: AdminBankCatalogCreateInput,
  fetcher: Fetcher = fetch,
): Promise<AdminBankCatalogEntry> {
  const parsed = parseAdminBankCatalogCreateInput(input);
  if (parsed === null) throw new AdminBankCatalogError(0, "bank_catalog_input_invalid");
  return requestBank("/api/admin/banks", {
    body: JSON.stringify(parsed),
    method: "POST",
  }, fetcher);
}

export async function updateAdminBankCatalogEntry(
  bankRef: string,
  content: AdminBankCatalogContent,
  fetcher: Fetcher = fetch,
): Promise<AdminBankCatalogEntry> {
  const parsed = parseAdminBankCatalogContent(content);
  if (!ADMIN_BANK_REF.test(bankRef) || parsed === null) {
    throw new AdminBankCatalogError(0, "bank_catalog_input_invalid");
  }
  return requestBank(`/api/admin/banks/${bankRef}`, {
    body: JSON.stringify({ action: "update", content: parsed }),
    method: "PATCH",
  }, fetcher);
}

export async function changeAdminBankCatalogStatus(
  bankRef: string,
  action: AdminBankCatalogStatusAction,
  fetcher: Fetcher = fetch,
): Promise<AdminBankCatalogEntry> {
  if (!ADMIN_BANK_REF.test(bankRef) || (action !== "archive" && action !== "reactivate")) {
    throw new AdminBankCatalogError(0, "bank_catalog_input_invalid");
  }
  return requestBank(`/api/admin/banks/${bankRef}`, {
    body: JSON.stringify({ action }),
    method: "PATCH",
  }, fetcher);
}

export { AdminBankCatalogError };
export type {
  AdminBankCatalogContent,
  AdminBankCatalogCreateInput,
  AdminBankCatalogEntry,
  AdminBankCatalogStatusAction,
};
