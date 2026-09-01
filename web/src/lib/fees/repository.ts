import { LEGAL_GATE_SQLSTATE } from "./legal-gate.ts";

import type {
  ClientFees,
  FeeAgreement,
  FeeAgreementInput,
  FeeAgreementSource,
  FeeAgreementStatus,
  FeeLedger,
  FeeModel,
  FeePayment,
  FeePaymentMethod,
  FeeResult,
  OrgFeeDefault,
  OrgReceivable,
  UpfrontGateState,
} from "./types.ts";

// Data access for the fee schema, over the *ordinary* server client.
//
// `@/lib/supabase/admin` is not imported here and must not be: the legal gate
// stops service_role too, but the tenancy rules around it are RLS policies, and
// a client that bypasses RLS would make every proof in plan 12-03 vacuous for
// the one caller that matters. `web/scripts/verify-source-gates.mjs` holds a
// three-entry allow-list and fails CI on a fourth importer; this is the same
// reasoning `web/src/app/api/org/settings/route.ts` records for AUTH-07.
//
// Every function takes an already-constructed client so callers stay testable
// without a database, following `web/src/lib/analysis/repository.ts`. The
// production client is loaded lazily inside `createFeesClient()` rather than
// imported at module scope, because `@/lib/supabase/server` pulls in
// `next/headers`, which has no meaning under `node --test`.

interface FeesSelectResult {
  data: unknown;
  error: unknown;
}

interface FeesSelectQuery {
  eq(column: string, value: unknown): FeesSelectQuery;
  maybeSingle(): PromiseLike<FeesSelectResult>;
}

/** The narrow methods this module needs. The generated `Database` type does not
 * know about the fee tables, so the concrete client is cast to this on the way
 * in — the house pattern from `web/src/lib/analysis/repository.ts`. */
export interface FeesRpcClient {
  from(table: "org_fee_defaults"): {
    select(columns: string): FeesSelectQuery;
  };
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: unknown }>;
}

const PERMISSION_DENIED_SQLSTATE = "42501";

export async function createFeesClient(): Promise<FeesRpcClient> {
  const { createClient } = await import("@/lib/supabase/server");
  const client = await createClient();
  return client as unknown as FeesRpcClient;
}

function errorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function errorMessage(error: unknown): string {
  if (typeof error !== "object" || error === null) return "unknown error";
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message : "unknown error";
}

/**
 * Runs one RPC and turns the two expected refusals into results.
 *
 * `LEGAL_GATE_SQLSTATE` is the legal gate — spelled as the constant rather than
 * as the code itself, so plan 12-07's scan for that string in `web/src` can
 * stay a plain grep with one legitimate hit. `42501` is either an RLS policy declining the
 * write or one of the RPCs raising it for a client the caller cannot see —
 * deliberately the same answer, because distinguishing them would tell a caller
 * whether a client id belonging to another tenant is real. Anything else throws
 * with the operation name, since an unexpected database fault should surface as
 * a 500 rather than as a plausible-looking refusal.
 */
async function callRpc(
  client: FeesRpcClient,
  name: string,
  args: Record<string, unknown>,
): Promise<FeeResult<unknown>> {
  const { data, error } = await client.rpc(name, args);

  if (error !== null && error !== undefined) {
    const code = errorCode(error);
    if (code === LEGAL_GATE_SQLSTATE || errorMessage(error) === "legal_gate") {
      return { ok: false, reason: "legal_gate" };
    }
    if (code === PERMISSION_DENIED_SQLSTATE) {
      return { ok: false, reason: "forbidden" };
    }
    throw new Error(`FEES_RPC_FAILED:${name}:${errorMessage(error)}`);
  }

  return { ok: true, value: data };
}

// ---------------------------------------------------------------------------
// Row mapping. PostgREST hands back the column names, so this is the one place
// the schema's snake_case meets the application's camelCase.
// ---------------------------------------------------------------------------

function record(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** int8 and numeric both arrive as JSON numbers from PostgREST, but a driver
 * configured to preserve precision hands back strings, and silently reading
 * `NaN` into a money field is worse than a loud failure. */
function toNumber(value: unknown, fallback: number | null = null): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (fallback !== null) return fallback;
  throw new Error("FEES_ROW_INVALID:expected a number");
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return toNumber(value);
}

function toText(value: unknown): string {
  if (typeof value !== "string") throw new Error("FEES_ROW_INVALID:expected a string");
  return value;
}

function toNullableText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return toText(value);
}

function mapAgreement(value: unknown): FeeAgreement | null {
  const row = record(value);
  if (row === null) return null;
  return {
    clientId: toText(row.client_id),
    orgId: toText(row.org_id),
    model: toText(row.model) as FeeModel,
    pct: toNullableNumber(row.pct),
    upfrontCents: toNullableNumber(row.upfront_cents),
    successCents: toNullableNumber(row.success_cents),
    triggerCents: toNullableNumber(row.trigger_cents),
    customTotalCents: toNullableNumber(row.custom_total_cents),
    status: toText(row.status) as FeeAgreementStatus,
    source: toText(row.source) as FeeAgreementSource,
    createdAt: toText(row.created_at),
    updatedAt: toText(row.updated_at),
  };
}

function mapLedger(value: unknown): FeeLedger | null {
  const row = record(value);
  if (row === null) return null;
  return {
    clientId: toText(row.client_id),
    orgId: toText(row.org_id),
    totalCents: toNumber(row.total_cents, 0),
    paidCents: toNumber(row.paid_cents, 0),
    outcomeBasisCents: toNumber(row.outcome_basis_cents, 0),
    outcomeBasisSource: toNullableText(row.outcome_basis_source),
    balanceCents: toNumber(row.balance_cents, 0),
    updatedAt: toText(row.updated_at),
  };
}

function mapPayment(value: unknown): FeePayment | null {
  const row = record(value);
  if (row === null) return null;
  return {
    id: toText(row.id),
    clientId: toText(row.client_id),
    orgId: toText(row.org_id),
    amountCents: toNumber(row.amount_cents),
    receivedOn: toText(row.received_on),
    method: toText(row.method) as FeePaymentMethod,
    reference: toNullableText(row.reference),
    note: toNullableText(row.note),
    recordedBy: toNullableText(row.recorded_by),
    recordedAt: toText(row.recorded_at),
    reversedAt: toNullableText(row.reversed_at),
    reversedBy: toNullableText(row.reversed_by),
  };
}

function mapOrgDefault(value: unknown): OrgFeeDefault | null {
  const row = record(value);
  if (row === null) return null;
  return {
    orgId: toText(row.org_id),
    model: toText(row.model) as FeeModel,
    pct: toNullableNumber(row.pct),
    upfrontCents: toNullableNumber(row.upfront_cents),
    successCents: toNullableNumber(row.success_cents),
    triggerCents: toNullableNumber(row.trigger_cents),
    customTotalCents: toNullableNumber(row.custom_total_cents),
    updatedBy: toNullableText(row.updated_by),
    updatedAt: toText(row.updated_at),
  };
}

function mapReceivable(value: unknown): OrgReceivable | null {
  const row = record(value);
  if (row === null) return null;
  const model = toNullableText(row.model);
  const status = toNullableText(row.status);
  return {
    clientId: toText(row.client_id),
    displayName: toText(row.display_name),
    model: model === null ? null : (model as FeeModel),
    status: status === null ? null : (status as FeeAgreementStatus),
    outcomeBasisCents: toNumber(row.outcome_basis_cents, 0),
    totalCents: toNumber(row.total_cents, 0),
    paidCents: toNumber(row.paid_cents, 0),
    balanceCents: toNumber(row.balance_cents, 0),
    lastPaymentOn: toNullableText(row.last_payment_on),
  };
}

/** A `returns table(...)` RPC arrives as an array; a composite arrives as an
 * object. `fees_upfront_gate_state` always returns exactly one row, so an empty
 * array means the shape changed rather than that the org is unapproved. */
function firstRow(value: unknown): unknown {
  if (Array.isArray(value)) return value.length > 0 ? value[0] : null;
  return value;
}

// ---------------------------------------------------------------------------
// One thin function per RPC. Argument names match the SQL parameter names
// exactly: PostgREST binds by name, so a typo produces a confusing
// function-not-found at runtime rather than a type error at build time.
// ---------------------------------------------------------------------------

export async function setUpfrontApproval(
  client: FeesRpcClient,
  orgId: string,
  approved: boolean,
  signoffRef: string | null,
): Promise<FeeResult<UpfrontGateState>> {
  const result = await callRpc(client, "org_flags_set_upfront_fee_approved", {
    p_org_id: orgId,
    p_approved: approved,
    p_signoff_ref: signoffRef,
  });
  if (!result.ok) return result;

  const row = record(firstRow(result.value));
  if (row === null) return { ok: false, reason: "forbidden" };
  return {
    ok: true,
    value: {
      approved: row.upfront_fee_approved === true,
      signoffRef: toNullableText(row.legal_signoff_ref),
      approvedAt: toNullableText(row.approved_at),
    },
  };
}

export async function readUpfrontGateState(
  client: FeesRpcClient,
  orgId: string,
): Promise<FeeResult<UpfrontGateState>> {
  const result = await callRpc(client, "fees_upfront_gate_state", { p_org_id: orgId });
  if (!result.ok) return result;

  const row = record(firstRow(result.value));
  if (row === null) {
    // Not a closed gate — the function is declared to return one row always, so
    // an empty result means the surface changed underneath us, and defaulting
    // to "approved: false" here would hide that behind a plausible answer.
    throw new Error("FEES_RPC_FAILED:fees_upfront_gate_state:empty result");
  }
  return {
    ok: true,
    value: {
      approved: row.approved === true,
      signoffRef: toNullableText(row.signoff_ref),
      approvedAt: toNullableText(row.approved_at),
    },
  };
}

export async function setAgreement(
  client: FeesRpcClient,
  clientId: string,
  input: FeeAgreementInput,
): Promise<FeeResult<FeeAgreement>> {
  const result = await callRpc(client, "fees_set_agreement", {
    p_client_id: clientId,
    p_model: input.model,
    p_pct: input.pct,
    p_upfront_cents: input.upfrontCents,
    p_success_cents: input.successCents,
    p_trigger_cents: input.triggerCents,
    p_custom_total_cents: input.customTotalCents,
    p_status: input.status,
  });
  if (!result.ok) return result;

  const agreement = mapAgreement(firstRow(result.value));
  if (agreement === null) return { ok: false, reason: "forbidden" };
  return { ok: true, value: agreement };
}

export async function setOrgDefault(
  client: FeesRpcClient,
  orgId: string,
  input: Omit<FeeAgreementInput, "status">,
): Promise<FeeResult<OrgFeeDefault>> {
  const result = await callRpc(client, "fees_set_org_default", {
    p_org_id: orgId,
    p_model: input.model,
    p_pct: input.pct,
    p_upfront_cents: input.upfrontCents,
    p_success_cents: input.successCents,
    p_trigger_cents: input.triggerCents,
    p_custom_total_cents: input.customTotalCents,
  });
  if (!result.ok) return result;

  const orgDefault = mapOrgDefault(firstRow(result.value));
  if (orgDefault === null) return { ok: false, reason: "forbidden" };
  return { ok: true, value: orgDefault };
}

/** Reads the workspace default through the caller's ordinary session client.
 * Migration 320's RLS policy limits an operator to their own organization, so
 * this must remain a table read rather than an admin-client shortcut. */
export async function readOrgDefault(
  client: FeesRpcClient,
  orgId: string,
): Promise<FeeResult<OrgFeeDefault | null>> {
  const { data, error } = await client
    .from("org_fee_defaults")
    .select(
      "org_id,model,pct,upfront_cents,success_cents,trigger_cents,custom_total_cents,updated_by,updated_at",
    )
    .eq("org_id", orgId)
    .maybeSingle();

  if (error !== null && error !== undefined) {
    if (errorCode(error) === PERMISSION_DENIED_SQLSTATE) {
      return { ok: false, reason: "forbidden" };
    }
    throw new Error(`FEES_READ_FAILED:org_fee_defaults:${errorMessage(error)}`);
  }

  if (data === null || data === undefined) return { ok: true, value: null };
  const orgDefault = mapOrgDefault(data);
  if (orgDefault === null) {
    throw new Error("FEES_READ_FAILED:org_fee_defaults:invalid row");
  }
  return { ok: true, value: orgDefault };
}

export interface RecordPaymentInput {
  amountCents: number;
  receivedOn: string;
  method: FeePaymentMethod;
  reference: string | null;
  note: string | null;
}

export async function recordPayment(
  client: FeesRpcClient,
  clientId: string,
  input: RecordPaymentInput,
): Promise<FeeResult<FeePayment>> {
  const result = await callRpc(client, "fees_record_payment", {
    p_client_id: clientId,
    p_amount_cents: input.amountCents,
    p_received_on: input.receivedOn,
    p_method: input.method,
    p_reference: input.reference,
    p_note: input.note,
  });
  if (!result.ok) return result;

  const payment = mapPayment(firstRow(result.value));
  if (payment === null) return { ok: false, reason: "forbidden" };
  return { ok: true, value: payment };
}

export async function reversePayment(
  client: FeesRpcClient,
  paymentId: string,
): Promise<FeeResult<FeePayment>> {
  const result = await callRpc(client, "fees_reverse_payment", {
    p_payment_id: paymentId,
  });
  if (!result.ok) return result;

  const payment = mapPayment(firstRow(result.value));
  // The RPC returns null for a payment that does not exist, belongs to another
  // tenant, or was already reversed. One answer for all three on purpose: three
  // would tell a caller whether an id they guessed is real.
  if (payment === null) return { ok: false, reason: "not_found" };
  return { ok: true, value: payment };
}

export async function readClientFees(
  client: FeesRpcClient,
  clientId: string,
): Promise<FeeResult<ClientFees>> {
  const result = await callRpc(client, "fees_read_client_fees", {
    p_client_id: clientId,
  });
  if (!result.ok) return result;

  const row = record(firstRow(result.value));
  if (row === null) throw new Error("FEES_RPC_FAILED:fees_read_client_fees:empty result");

  const payments = Array.isArray(row.payments) ? row.payments : [];
  return {
    ok: true,
    value: {
      clientId,
      agreement: mapAgreement(row.agreement),
      ledger: mapLedger(row.ledger),
      payments: payments
        .map(mapPayment)
        .filter((payment): payment is FeePayment => payment !== null),
    },
  };
}

export async function listOrgReceivables(
  client: FeesRpcClient,
  orgId: string,
  limit: number,
  offset: number,
): Promise<FeeResult<OrgReceivable[]>> {
  const result = await callRpc(client, "fees_list_org_receivables", {
    p_org_id: orgId,
    p_limit: limit,
    p_offset: offset,
  });
  if (!result.ok) return result;

  const rows = Array.isArray(result.value) ? result.value : [];
  return {
    ok: true,
    value: rows
      .map(mapReceivable)
      .filter((receivable): receivable is OrgReceivable => receivable !== null),
  };
}
