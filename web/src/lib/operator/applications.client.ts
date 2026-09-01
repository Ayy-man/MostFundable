"use client";

import {
  APPLICATIONS_DISABLED_CODE,
  APPLICATION_CONSUMER_STATUS_VALUES,
  APPLICATION_OPERATOR_STATUS_VALUES,
  APPLICATION_VISIBILITY_VALUES,
  OUTCOME_KIND_VALUES,
  type Application,
  type ApplicationConsumerStatus,
  type ApplicationOperatorStatus,
  type ApplicationVisibility,
  type Outcome,
  type OutcomeKind,
} from "@/lib/applications/types";

export interface ApplicationLender {
  readonly bankRef: string;
  readonly name: string;
  readonly products: readonly string[];
}

export type ApplicationsRead =
  | { readonly state: "disabled" }
  | { readonly message: string; readonly state: "failed" }
  | { readonly applications: readonly Application[]; readonly state: "ready" };

export type ApplicationLendersRead =
  | { readonly state: "disabled" }
  | { readonly message: string; readonly state: "failed" }
  | { readonly lenders: readonly ApplicationLender[]; readonly state: "ready" };

export type ApplicationMutationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly message: string; readonly ok: false };

export interface ApplicationFields {
  readonly amountCents: number | null;
  readonly consumerStatus: ApplicationConsumerStatus;
  readonly operatorStatus: ApplicationOperatorStatus;
  readonly visibility: ApplicationVisibility;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isCents(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

export function parseApplication(value: unknown): Application | null {
  const row = asRecord(value);
  if (row === null) return null;
  if (
    typeof row.id !== "string"
    || typeof row.clientId !== "string"
    || typeof row.bankRef !== "string"
    || !APPLICATION_OPERATOR_STATUS_VALUES.includes(
      row.operatorStatus as ApplicationOperatorStatus,
    )
    || !APPLICATION_CONSUMER_STATUS_VALUES.includes(
      row.consumerStatus as ApplicationConsumerStatus,
    )
    || (row.amountCents !== null && !isCents(row.amountCents))
    || !APPLICATION_VISIBILITY_VALUES.includes(
      row.visibility as ApplicationVisibility,
    )
    || typeof row.createdAt !== "string"
    || typeof row.updatedAt !== "string"
  ) return null;
  return {
    amountCents: row.amountCents as number | null,
    bankRef: row.bankRef,
    clientId: row.clientId,
    consumerStatus: row.consumerStatus as ApplicationConsumerStatus,
    createdAt: row.createdAt,
    id: row.id,
    operatorStatus: row.operatorStatus as ApplicationOperatorStatus,
    updatedAt: row.updatedAt,
    visibility: row.visibility as ApplicationVisibility,
  };
}

export function parseApplicationsBody(value: unknown): readonly Application[] | null {
  const body = asRecord(value);
  if (body === null || !Array.isArray(body.applications)) return null;
  const applications: Application[] = [];
  for (const entry of body.applications) {
    const application = parseApplication(entry);
    if (application === null) return null;
    applications.push(application);
  }
  return applications;
}

export function parseApplicationLendersBody(
  value: unknown,
): readonly ApplicationLender[] | null {
  const body = asRecord(value);
  if (body === null || !Array.isArray(body.banks)) return null;
  const lenders: ApplicationLender[] = [];
  for (const entry of body.banks) {
    const row = asRecord(entry);
    if (
      row === null
      || typeof row.bankRef !== "string"
      || typeof row.name !== "string"
      || !Array.isArray(row.products)
      || !row.products.every((product) => typeof product === "string")
    ) return null;
    lenders.push({
      bankRef: row.bankRef,
      name: row.name,
      products: row.products as string[],
    });
  }
  return lenders;
}

function parseOutcome(value: unknown): Outcome | null {
  const row = asRecord(value);
  if (row === null) return null;
  if (
    typeof row.id !== "string"
    || typeof row.applicationId !== "string"
    || typeof row.bankRef !== "string"
    || typeof row.clientId !== "string"
    || !OUTCOME_KIND_VALUES.includes(row.kind as OutcomeKind)
    || (row.amountCents !== null && !isCents(row.amountCents))
    || (row.state !== "counted" && row.state !== "removed")
    || (row.recordedByKind !== "consumer" && row.recordedByKind !== "operator")
    || typeof row.decidedOn !== "string"
    || typeof row.createdAt !== "string"
  ) return null;
  return {
    amountCents: row.amountCents as number | null,
    applicationId: row.applicationId,
    bankRef: row.bankRef,
    clientId: row.clientId,
    createdAt: row.createdAt,
    decidedOn: row.decidedOn,
    id: row.id,
    kind: row.kind as OutcomeKind,
    recordedByKind: row.recordedByKind,
    state: row.state,
  };
}

async function responseBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function responseCode(value: unknown): string | null {
  const code = asRecord(value)?.error;
  return typeof code === "string" ? code : null;
}

function responseMessage(value: unknown, fallback: string): string {
  const message = asRecord(value)?.message;
  return typeof message === "string" && message.trim() !== "" ? message : fallback;
}

export async function readClientApplications(
  clientId: string,
  fetcher: typeof fetch = fetch,
): Promise<ApplicationsRead> {
  try {
    const response = await fetcher(
      `/api/applications?clientId=${encodeURIComponent(clientId)}`,
      { cache: "no-store", credentials: "same-origin" },
    );
    const body = await responseBody(response);
    if (response.status === 503 && responseCode(body) === APPLICATIONS_DISABLED_CODE) {
      return { state: "disabled" };
    }
    if (!response.ok) {
      return {
        message: responseMessage(body, "Applications could not be loaded."),
        state: "failed",
      };
    }
    const applications = parseApplicationsBody(body);
    return applications === null
      ? { message: "Applications returned an unreadable response.", state: "failed" }
      : { applications, state: "ready" };
  } catch {
    return { message: "Applications could not be loaded.", state: "failed" };
  }
}

export async function readApplicationLenders(
  fetcher: typeof fetch = fetch,
): Promise<ApplicationLendersRead> {
  try {
    const response = await fetcher("/api/banks", {
      cache: "no-store",
      credentials: "same-origin",
    });
    const body = await responseBody(response);
    if (response.status === 503 && responseCode(body) === "vault_disabled") {
      return { state: "disabled" };
    }
    if (!response.ok) {
      return {
        message: responseMessage(body, "The lender catalog could not be loaded."),
        state: "failed",
      };
    }
    const lenders = parseApplicationLendersBody(body);
    return lenders === null
      ? { message: "The lender catalog returned an unreadable response.", state: "failed" }
      : { lenders, state: "ready" };
  } catch {
    return { message: "The lender catalog could not be loaded.", state: "failed" };
  }
}

async function mutationResponse<T>(
  request: () => Promise<Response>,
  parse: (body: unknown) => T | null,
  fallback: string,
): Promise<ApplicationMutationResult<T>> {
  try {
    const response = await request();
    const body = await responseBody(response);
    if (!response.ok) {
      return { message: responseMessage(body, fallback), ok: false };
    }
    const value = parse(body);
    return value === null
      ? { message: `${fallback} The server response was unreadable.`, ok: false }
      : { ok: true, value };
  } catch {
    return { message: fallback, ok: false };
  }
}

export async function createClientApplication(
  input: { readonly bankRef: string; readonly clientId: string; readonly amountCents: number | null },
  fetcher: typeof fetch = fetch,
): Promise<ApplicationMutationResult<Application>> {
  return mutationResponse(
    () => fetcher("/api/applications", {
      body: JSON.stringify(input),
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
    (body) => parseApplication(asRecord(body)?.application),
    "The application could not be created.",
  );
}

export async function updateClientApplication(
  applicationId: string,
  fields: ApplicationFields,
  fetcher: typeof fetch = fetch,
): Promise<ApplicationMutationResult<Application>> {
  return mutationResponse(
    () => fetcher(`/api/applications/${encodeURIComponent(applicationId)}`, {
      body: JSON.stringify(fields),
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    }),
    (body) => parseApplication(asRecord(body)?.application),
    "The application changes could not be saved.",
  );
}

export async function recordClientApplicationOutcome(
  applicationId: string,
  input: {
    readonly amountCents: number | null;
    readonly decidedOn: string | null;
    readonly kind: OutcomeKind;
  },
  fetcher: typeof fetch = fetch,
): Promise<ApplicationMutationResult<Outcome>> {
  const body = {
    amountCents: input.kind === "approved" ? input.amountCents : null,
    kind: input.kind,
    ...(input.decidedOn === null ? {} : { decidedOn: input.decidedOn }),
  };
  return mutationResponse(
    () => fetcher(
      `/api/applications/${encodeURIComponent(applicationId)}/outcomes`,
      {
        body: JSON.stringify(body),
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      },
    ),
    (value) => parseOutcome(asRecord(value)?.outcome),
    "The funding outcome could not be recorded.",
  );
}

export type DollarInputResult =
  | { readonly cents: number | null; readonly ok: true }
  | { readonly message: string; readonly ok: false };

export function parseDollarInput(
  value: string,
  requirement: "optional" | "positive",
): DollarInputResult {
  const normalized = value.trim();
  if (normalized === "") {
    return requirement === "optional"
      ? { cents: null, ok: true }
      : { message: "Enter an approved amount greater than zero.", ok: false };
  }
  if (!/^\d+(?:\.\d{0,2})?$/.test(normalized)) {
    return { message: "Enter a non-negative amount with no more than two decimal places.", ok: false };
  }
  const dollars = Number(normalized);
  const cents = Math.round(dollars * 100);
  if (!Number.isSafeInteger(cents)) {
    return { message: "The amount is too large to record.", ok: false };
  }
  if (requirement === "positive" && cents <= 0) {
    return { message: "Enter an approved amount greater than zero.", ok: false };
  }
  return { cents, ok: true };
}

export function isApplicationDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`));
}
