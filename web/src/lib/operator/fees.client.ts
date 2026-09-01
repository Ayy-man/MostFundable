"use client";

// The operator fee tracking table's durable rail (UI-WIRING-BACKLOG #7).
// It reads receivables, legal gates, agreements, balances and payment history,
// then writes agreement lifecycle changes or append-only bookkeeping payments.
// Money still moves off platform; these routes only maintain the fee ledger.

import type {
  ClientFees,
  FeeAgreement,
  FeeAgreementInput,
  FeeModel,
  FeePayment,
  FeePaymentMethod,
  OrgFeeDefault,
  OrgReceivable,
} from "@/lib/fees/types";

/**
 * What the receivables read can resolve to. `"disabled"` is the route's 404
 * with FEATURE_FEES off, which is a known state; `"failed"` is a 5xx, an auth
 * refusal, a network error, or a 200 whose body does not parse. Collapsing the
 * second into an empty list would render an outage as a workspace that owes
 * nothing (the G-HOST-14 class).
 */
export type ReceivablesRead =
  | { readonly state: "loading" }
  | { readonly state: "disabled" }
  | { readonly state: "failed" }
  | { readonly state: "ready"; readonly receivables: readonly OrgReceivable[] };

export type FeeWriteResult = { readonly ok: boolean };

export type FeeEntityWriteResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false };

export interface RecordFeePaymentInput {
  readonly amountCents: number;
  readonly receivedOn: string;
  readonly method: FeePaymentMethod;
  readonly reference: string | null;
  readonly note: string | null;
}

export type ClientFeesRead =
  | { readonly state: "loading" }
  | { readonly state: "disabled" }
  | { readonly state: "failed" }
  | { readonly fees: ClientFees; readonly state: "ready" };

/** One row of `GET /api/fees/models` — `modelAvailability()` in
 * `@/lib/fees/handlers` builds the list by asking `isGatedFeeChange` about the
 * smallest change that would select each entry, so this is the gate's own
 * answer rather than a second copy of the rule. */
export interface FeeOptionAvailability {
  readonly id: string;
  readonly available: boolean;
  readonly reason: string | null;
}

/**
 * What the fee-gate read can resolve to, with the same four states the
 * receivables read uses and for the same reason: `"disabled"` is the route's
 * 404 with FEATURE_FEES off, `"failed"` is anything that did not answer.
 *
 * `signoffRef` is the recorded legal sign-off the approval was filed under
 * (DEC-D7, and the ruling that set the flag true). It is what the surface shows
 * instead of asserting on its own that counsel cleared anything.
 */
export type FeeGateRead =
  | { readonly state: "loading" }
  | { readonly state: "disabled" }
  | { readonly state: "failed" }
  | {
      readonly state: "ready";
      readonly signoffRef: string | null;
      readonly options: readonly FeeOptionAvailability[];
    };

/** The org-default endpoint carries the gate and the saved arrangement in one
 * snapshot, so settings never presents constructor defaults as stored data. */
export type WorkspaceFeeDefaultsRead =
  | { readonly state: "loading" }
  | { readonly state: "disabled" }
  | { readonly state: "failed" }
  | {
      readonly state: "ready";
      readonly signoffRef: string | null;
      readonly options: readonly FeeOptionAvailability[];
      readonly orgDefault: OrgFeeDefault | null;
    };

const FEE_MODELS = new Set<string>(["percentage", "package", "custom"]);
const AGREEMENT_STATUSES = new Set<string>(["draft", "active", "void"]);
const PAYMENT_METHODS = new Set<string>([
  "bank_transfer",
  "card",
  "check",
  "cash",
  "other",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isCents(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

export function parseReceivable(value: unknown): OrgReceivable | null {
  const row = asRecord(value);
  if (row === null) return null;
  if (
    typeof row.clientId !== "string"
    || typeof row.displayName !== "string"
    || !isCents(row.totalCents)
    || !isCents(row.paidCents)
    || !isCents(row.balanceCents)
    || !isCents(row.outcomeBasisCents)
  ) return null;
  if (row.model !== null && !(typeof row.model === "string" && FEE_MODELS.has(row.model))) {
    return null;
  }
  if (
    row.status !== null
    && !(typeof row.status === "string" && AGREEMENT_STATUSES.has(row.status))
  ) return null;
  if (row.lastPaymentOn !== null && typeof row.lastPaymentOn !== "string") return null;
  return {
    balanceCents: row.balanceCents,
    clientId: row.clientId,
    displayName: row.displayName,
    lastPaymentOn: row.lastPaymentOn as string | null,
    model: row.model as FeeModel | null,
    outcomeBasisCents: row.outcomeBasisCents,
    paidCents: row.paidCents,
    status: row.status as OrgReceivable["status"],
    totalCents: row.totalCents,
  };
}

export function parseReceivablesBody(value: unknown): readonly OrgReceivable[] | null {
  const body = asRecord(value);
  if (body === null || !Array.isArray(body.receivables)) return null;
  const rows: OrgReceivable[] = [];
  for (const entry of body.receivables) {
    const row = parseReceivable(entry);
    if (row === null) return null;
    rows.push(row);
  }
  return rows;
}

export async function readReceivables(
  fetcher: typeof fetch = fetch,
): Promise<ReceivablesRead> {
  try {
    const response = await fetcher("/api/fees?limit=200", {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (response.status === 404) return { state: "disabled" };
    if (!response.ok) return { state: "failed" };
    const receivables = parseReceivablesBody(await response.json());
    return receivables === null ? { state: "failed" } : { receivables, state: "ready" };
  } catch {
    return { state: "failed" };
  }
}

export function parseFeeGateBody(value: unknown): FeeGateRead | null {
  const body = asRecord(value);
  if (body === null || !Array.isArray(body.models)) return null;
  const gate = asRecord(body.gate);
  if (gate === null || typeof gate.approved !== "boolean") return null;
  if (gate.signoffRef !== null && typeof gate.signoffRef !== "string") return null;
  const options: FeeOptionAvailability[] = [];
  for (const entry of body.models) {
    const row = asRecord(entry);
    if (row === null) return null;
    if (typeof row.id !== "string" || typeof row.available !== "boolean") return null;
    if (row.reason !== null && typeof row.reason !== "string") return null;
    options.push({ available: row.available, id: row.id, reason: row.reason });
  }
  if (options.length === 0) return null;
  return { options, signoffRef: gate.signoffRef as string | null, state: "ready" };
}

function nullableFiniteNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function parseOrgFeeDefault(value: unknown): OrgFeeDefault | null {
  const row = asRecord(value);
  if (row === null) return null;
  const pct = nullableFiniteNumber(row.pct);
  const upfrontCents = nullableNumber(row.upfrontCents);
  const successCents = nullableNumber(row.successCents);
  const triggerCents = nullableNumber(row.triggerCents);
  const customTotalCents = nullableNumber(row.customTotalCents);
  const updatedBy = nullableString(row.updatedBy);
  if (
    typeof row.orgId !== "string"
    || typeof row.model !== "string"
    || !FEE_MODELS.has(row.model)
    || pct === undefined
    || upfrontCents === undefined
    || successCents === undefined
    || triggerCents === undefined
    || customTotalCents === undefined
    || updatedBy === undefined
    || typeof row.updatedAt !== "string"
  ) return null;
  return {
    customTotalCents,
    model: row.model as FeeModel,
    orgId: row.orgId,
    pct,
    successCents,
    triggerCents,
    upfrontCents,
    updatedAt: row.updatedAt,
    updatedBy,
  };
}

export function parseWorkspaceFeeDefaultsBody(
  value: unknown,
): WorkspaceFeeDefaultsRead | null {
  const body = asRecord(value);
  if (body === null || !("orgDefault" in body)) return null;
  const gate = parseFeeGateBody(body);
  if (gate === null || gate.state !== "ready") return null;
  const orgDefault = body.orgDefault === null
    ? null
    : parseOrgFeeDefault(body.orgDefault);
  if (body.orgDefault !== null && orgDefault === null) return null;
  return { ...gate, orgDefault };
}

/**
 * Which fee arrangements this org may use, and why not when it may not.
 *
 * The surface renders its pending-legal-review state from this response rather
 * than from a hardcoded condition, which is what T-CL-03 was about: the pill
 * and the upfront field stayed in a refusal the database had stopped issuing.
 */
export async function readFeeGate(
  fetcher: typeof fetch = fetch,
): Promise<FeeGateRead> {
  try {
    const response = await fetcher("/api/fees/models", {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (response.status === 404) return { state: "disabled" };
    if (!response.ok) return { state: "failed" };
    return parseFeeGateBody(await response.json()) ?? { state: "failed" };
  } catch {
    return { state: "failed" };
  }
}

export async function readWorkspaceFeeDefaults(
  fetcher: typeof fetch = fetch,
): Promise<WorkspaceFeeDefaultsRead> {
  try {
    const response = await fetcher("/api/fees/org-defaults", {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (response.status === 404) return { state: "disabled" };
    if (!response.ok) return { state: "failed" };
    return parseWorkspaceFeeDefaultsBody(await response.json()) ?? { state: "failed" };
  } catch {
    return { state: "failed" };
  }
}

/**
 * Whether one entry of that list is open to this org.
 *
 * A read that is loading, disabled, failed or missing the entry answers
 * `false`: the trigger in migration 091 refuses by default, so a surface that
 * cannot see the gate has to refuse the same way rather than guess open.
 */
export function feeOptionAvailable(read: FeeGateRead, id: string): boolean {
  if (read.state !== "ready") return false;
  return read.options.find((option) => option.id === id)?.available === true;
}

/** `YYYY-MM-DD` in the caller's own clock. The route refuses a future date. */
export function paymentDate(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Bookkeeping, not a transfer. Payouts happen off platform (BACKEND-SPEC §5),
 * so this records that money moved somewhere else; the row it creates is
 * append-only and can be reversed but never edited.
 */
export async function recordFeePayment(
  clientId: string,
  input: RecordFeePaymentInput,
  fetcher: typeof fetch = fetch,
): Promise<FeeEntityWriteResult<FeePayment>> {
  try {
    const response = await fetcher(
      `/api/fees/${encodeURIComponent(clientId)}/payments`,
      {
        body: JSON.stringify(input),
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      },
    );
    if (response.status !== 201) return { ok: false };
    const body = asRecord(await response.json());
    const payment = parsePayment(body?.payment);
    return payment !== null && payment.clientId === clientId
      ? { ok: true, value: payment }
      : { ok: false };
  } catch {
    return { ok: false };
  }
}

export async function reverseFeePayment(
  paymentId: string,
  fetcher: typeof fetch = fetch,
): Promise<FeeEntityWriteResult<FeePayment>> {
  try {
    const response = await fetcher(
      `/api/fees/payments/${encodeURIComponent(paymentId)}/reverse`,
      {
        cache: "no-store",
        credentials: "same-origin",
        method: "POST",
      },
    );
    if (!response.ok) return { ok: false };
    const body = asRecord(await response.json());
    const payment = parsePayment(body?.payment);
    return payment !== null && payment.id === paymentId && payment.reversedAt !== null
      ? { ok: true, value: payment }
      : { ok: false };
  } catch {
    return { ok: false };
  }
}

/**
 * The workspace default every client created afterwards inherits as a draft.
 *
 * The gated arrangements are refused by the route's own legal gate rather than
 * by a condition here — a second copy of that rule would eventually disagree
 * with the database, and the disagreement would be silent.
 */
export async function setWorkspaceFeeDefault(
  input: {
    readonly model: FeeModel;
    readonly pct: number | null;
    readonly customTotalCents: number | null;
    /** Only ever non-null once `feeOptionAvailable(read, "upfront")` is true;
     * the route refuses it with `legal_gate` otherwise, which is the check that
     * counts. */
    readonly upfrontCents?: number | null;
  },
  fetcher: typeof fetch = fetch,
): Promise<FeeWriteResult> {
  try {
    const response = await fetcher("/api/fees/org-defaults", {
      body: JSON.stringify({
        customTotalCents: input.customTotalCents,
        model: input.model,
        pct: input.pct,
        successCents: null,
        triggerCents: null,
        upfrontCents: input.upfrontCents ?? null,
      }),
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    });
    return { ok: response.ok };
  } catch {
    return { ok: false };
  }
}

function nullableNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  return isCents(value) ? value : undefined;
}

function nullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}

function parsePayment(value: unknown): FeePayment | null {
  const row = asRecord(value);
  if (row === null) return null;
  const reference = nullableString(row.reference);
  const note = nullableString(row.note);
  const recordedBy = nullableString(row.recordedBy);
  const reversedAt = nullableString(row.reversedAt);
  const reversedBy = nullableString(row.reversedBy);
  if (
    typeof row.id !== "string"
    || typeof row.clientId !== "string"
    || typeof row.orgId !== "string"
    || !isCents(row.amountCents)
    || typeof row.receivedOn !== "string"
    || typeof row.method !== "string"
    || !PAYMENT_METHODS.has(row.method)
    || typeof row.recordedAt !== "string"
    || reference === undefined
    || note === undefined
    || recordedBy === undefined
    || reversedAt === undefined
    || reversedBy === undefined
  ) return null;
  return {
    amountCents: row.amountCents,
    clientId: row.clientId,
    id: row.id,
    method: row.method as FeePayment["method"],
    note,
    orgId: row.orgId,
    receivedOn: row.receivedOn,
    recordedAt: row.recordedAt,
    recordedBy,
    reference,
    reversedAt,
    reversedBy,
  };
}

function parseAgreement(value: unknown): FeeAgreement | null {
  const row = asRecord(value);
  if (row === null) return null;
  const pct = row.pct === null
    ? null
    : typeof row.pct === "number" && Number.isFinite(row.pct)
      ? row.pct
      : undefined;
  const upfrontCents = nullableNumber(row.upfrontCents);
  const successCents = nullableNumber(row.successCents);
  const triggerCents = nullableNumber(row.triggerCents);
  const customTotalCents = nullableNumber(row.customTotalCents);
  if (
    typeof row.clientId !== "string"
    || typeof row.orgId !== "string"
    || typeof row.model !== "string"
    || !FEE_MODELS.has(row.model)
    || pct === undefined
    || upfrontCents === undefined
    || successCents === undefined
    || triggerCents === undefined
    || customTotalCents === undefined
    || typeof row.status !== "string"
    || !AGREEMENT_STATUSES.has(row.status)
    || typeof row.source !== "string"
    || typeof row.createdAt !== "string"
    || typeof row.updatedAt !== "string"
  ) return null;
  return {
    clientId: row.clientId,
    createdAt: row.createdAt,
    customTotalCents,
    model: row.model as FeeModel,
    orgId: row.orgId,
    pct,
    source: row.source as FeeAgreement["source"],
    status: row.status as FeeAgreement["status"],
    successCents,
    triggerCents,
    updatedAt: row.updatedAt,
    upfrontCents,
  };
}

export function parseClientFees(value: unknown): ClientFees | null {
  const body = asRecord(value);
  if (body === null || typeof body.clientId !== "string" || !Array.isArray(body.payments)) {
    return null;
  }
  const payments = body.payments.map(parsePayment);
  if (payments.some((payment) => payment === null)) return null;

  const agreementRow = body.agreement === null ? null : asRecord(body.agreement);
  const ledgerRow = body.ledger === null ? null : asRecord(body.ledger);
  if (body.agreement !== null && agreementRow === null) return null;
  if (body.ledger !== null && ledgerRow === null) return null;

  const agreement = agreementRow === null ? null : parseAgreement(agreementRow);
  if (agreementRow !== null && agreement === null) return null;

  const ledger = ledgerRow === null
    ? null
    : (() => {
        const outcomeBasisSource = nullableString(ledgerRow.outcomeBasisSource);
        if (
          typeof ledgerRow.clientId !== "string"
          || typeof ledgerRow.orgId !== "string"
          || !isCents(ledgerRow.totalCents)
          || !isCents(ledgerRow.paidCents)
          || !isCents(ledgerRow.outcomeBasisCents)
          || typeof ledgerRow.balanceCents !== "number"
          || !Number.isSafeInteger(ledgerRow.balanceCents)
          || outcomeBasisSource === undefined
          || typeof ledgerRow.updatedAt !== "string"
        ) return null;
        return {
          balanceCents: ledgerRow.balanceCents,
          clientId: ledgerRow.clientId,
          orgId: ledgerRow.orgId,
          outcomeBasisCents: ledgerRow.outcomeBasisCents,
          outcomeBasisSource,
          paidCents: ledgerRow.paidCents,
          totalCents: ledgerRow.totalCents,
          updatedAt: ledgerRow.updatedAt,
        };
      })();
  if (ledgerRow !== null && ledger === null) return null;

  return {
    agreement,
    clientId: body.clientId,
    ledger,
    payments: payments as FeePayment[],
  };
}

export async function readClientFeeDetails(
  clientId: string,
  fetcher: typeof fetch = fetch,
): Promise<ClientFeesRead> {
  try {
    const response = await fetcher(`/api/fees/${encodeURIComponent(clientId)}`, {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (response.status === 404) return { state: "disabled" };
    if (!response.ok) return { state: "failed" };
    const fees = parseClientFees(await response.json());
    return fees === null ? { state: "failed" } : { fees, state: "ready" };
  } catch {
    return { state: "failed" };
  }
}

export async function setClientFeeAgreement(
  clientId: string,
  input: FeeAgreementInput,
  fetcher: typeof fetch = fetch,
): Promise<FeeEntityWriteResult<FeeAgreement>> {
  try {
    const response = await fetcher(
      `/api/fees/${encodeURIComponent(clientId)}/agreement`,
      {
        body: JSON.stringify(input),
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "PUT",
      },
    );
    if (!response.ok) return { ok: false };
    const body = asRecord(await response.json());
    const agreement = parseAgreement(body?.agreement);
    return agreement !== null
      && agreement.clientId === clientId
      && agreement.status === input.status
      ? { ok: true, value: agreement }
      : { ok: false };
  } catch {
    return { ok: false };
  }
}
