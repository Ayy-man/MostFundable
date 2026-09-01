import { LEGAL_GATE_CODE, isGatedFeeChange } from "./legal-gate.ts";
import * as service from "./service.ts";

import type { GatedFeeChange } from "./legal-gate.ts";
import type { FeesRpcClient } from "./repository.ts";
import type {
  FeeAgreementInput,
  FeeFailureReason,
  FeeModel,
  FeePaymentMethod,
  UpfrontGateState,
} from "./types.ts";
import type { AppRole, OrgRole } from "@/lib/auth/session";
import type { OperatorMembership } from "@/lib/billing/types";

// The bodies of the seven `/api/fees/*` handlers.
//
// They live here rather than in the route files for one reason: a Next route
// handler's signature is fixed, so anything it reaches for directly — the
// session, the Supabase client, the service — cannot be replaced in a test, and
// a route whose only test is "returns 404 with the flag off" is a route whose
// validation is untested. Everything below takes a `deps` object that defaults
// to the real thing, so `routes.test.ts` exercises the validation, the role
// narrowing and the gate mapping with no server and no database.
//
// The route files keep the parts that are genuinely theirs: the feature flag,
// awaiting `params`, and the method-to-handler mapping.

const privateHeaders = { "Cache-Control": "private, no-store" };

export function errorResponse(
  code: string,
  message: string,
  status: number,
  detail?: Record<string, unknown>,
): Response {
  return Response.json(
    { error: { code, message, ...detail } },
    { status, headers: privateHeaders },
  );
}

export function okResponse(body: unknown): Response {
  return Response.json(body, { status: 200, headers: privateHeaders });
}

/** Every fee route answers this before it touches a session or a database, so
 * an environment with no `FEATURE_FEES` value behaves as if the phase had not
 * shipped. Matches `web/src/app/api/org/settings/route.ts:122`. */
export function featureOffResponse(): Response {
  return new Response(null, { status: 404 });
}

/** One reason, one status. The routes never inspect a database error, and a
 * client that cannot be seen answers the same as one that does not exist. */
export function failureResponse(reason: FeeFailureReason): Response {
  if (reason === "legal_gate") {
    return errorResponse(
      LEGAL_GATE_CODE,
      "This organization has no recorded legal sign-off for that fee arrangement.",
      403,
    );
  }
  if (reason === "not_found") {
    return errorResponse("not_found", "That record was not found.", 404);
  }
  return errorResponse("forbidden", "Access is denied.", 403);
}

function isAuthErrorShape(error: unknown): error is { status: number; code: string } {
  if (typeof error !== "object" || error === null) return false;
  const status = (error as { status?: unknown }).status;
  return status === 401 || status === 402 || status === 403;
}

/** The same body for a wrong role and for an org that is not the caller's;
 * distinguishing them would tell a caller which orgs exist. */
export function authErrorResponse(error: unknown): Response | null {
  if (!isAuthErrorShape(error)) return null;
  if (error.status === 401) {
    return errorResponse("unauthenticated", "Authentication is required.", 401);
  }
  if (error.status === 402) {
    return errorResponse("ORG_DEACTIVATED", "This organization is deactivated.", 402);
  }
  return errorResponse("forbidden", "Access is denied.", 403);
}

// ---------------------------------------------------------------------------
// Injectable surface.
// ---------------------------------------------------------------------------

export interface HandlerSession {
  id: string;
  role: AppRole;
  orgId: string | null;
  orgMembership: OperatorMembership | null;
  orgRole: OrgRole | null;
}

export interface OrgMemberSession extends HandlerSession {
  orgId: string;
}

export interface FeeHandlerDeps {
  assertTenantWriteAllowed: (session: OrgMemberSession) => Promise<void>;
  requireOrgMember: () => Promise<OrgMemberSession>;
  requirePlatformAdmin: () => Promise<HandlerSession>;
  createClient: () => Promise<FeesRpcClient>;
  service: typeof service;
  /** Injected so the received-on bound is a fact rather than the clock. */
  today: () => string;
}

async function defaultRequireOrgMember(): Promise<OrgMemberSession> {
  const { requireOrgMember } = await import("@/lib/auth/session");
  return requireOrgMember();
}

async function defaultRequirePlatformAdmin(): Promise<HandlerSession> {
  const { requireRole } = await import("@/lib/auth/session");
  return requireRole("platform_admin");
}

async function defaultCreateClient(): Promise<FeesRpcClient> {
  const { createFeesClient } = await import("./repository.ts");
  return createFeesClient();
}

function defaultToday(): string {
  return new Date().toISOString().slice(0, 10);
}

const DEFAULT_DEPS: FeeHandlerDeps = {
  async assertTenantWriteAllowed(session) {
    const { assertTenantWriteAllowed } = await import("@/lib/tenancy/wall");
    return assertTenantWriteAllowed(session);
  },
  requireOrgMember: defaultRequireOrgMember,
  requirePlatformAdmin: defaultRequirePlatformAdmin,
  createClient: defaultCreateClient,
  service,
  today: defaultToday,
};

export function withDefaults(overrides: Partial<FeeHandlerDeps> = {}): FeeHandlerDeps {
  return { ...DEFAULT_DEPS, ...overrides };
}

// ---------------------------------------------------------------------------
// Body validation. Allow-lists of KEYS, never a spread: the fee tables carry
// `source`, `org_id` and the derived ledger columns, none of which a request
// may set, and a spread would hand all of them over at once.
// ---------------------------------------------------------------------------

const FEE_MODELS: readonly FeeModel[] = ["percentage", "package", "custom"];
const PAYMENT_METHODS: readonly FeePaymentMethod[] = [
  "bank_transfer",
  "card",
  "check",
  "cash",
  "other",
];
const AGREEMENT_STATUSES = ["draft", "active", "void"] as const;
const WRITE_ORG_ROLES: readonly OrgRole[] = ["owner", "admin"];
const NOTE_MAX_LENGTH = 1000;
const SIGNOFF_REF_MAX_LENGTH = 200;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** Cents are integers. A bigint that arrives as a double has already lost the
 * precision it was sent with, so a non-safe integer is a bad request rather
 * than a number to round. */
function readCents(value: unknown): { ok: true; value: number | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return { ok: false };
  }
  return { ok: true, value };
}

function readPct(value: unknown): { ok: true; value: number | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    return { ok: false };
  }
  // numeric(5,2) in the column, so anything finer is a value the database would
  // silently round; refusing it keeps the stored figure the one that was sent.
  if (Math.round(value * 100) !== value * 100) return { ok: false };
  return { ok: true, value };
}

interface Validated<T> {
  value: T;
  fields: string[];
}

export function readAgreementBody(
  body: unknown,
): Validated<FeeAgreementInput> | { error: string } {
  const record = asRecord(body);
  if (record === null) return { error: "The request body must be a JSON object." };

  const model = record.model;
  if (typeof model !== "string" || !FEE_MODELS.includes(model as FeeModel)) {
    return { error: `model must be one of ${FEE_MODELS.join(", ")}.` };
  }

  const pct = readPct(record.pct);
  if (!pct.ok) return { error: "pct must be a percentage between 0 and 100 with at most two decimal places." };

  const upfront = readCents(record.upfrontCents);
  const success = readCents(record.successCents);
  const trigger = readCents(record.triggerCents);
  const custom = readCents(record.customTotalCents);
  if (!upfront.ok || !success.ok || !trigger.ok || !custom.ok) {
    return { error: "Amounts must be whole numbers of cents, zero or greater." };
  }

  const status = record.status ?? "draft";
  if (
    typeof status !== "string" ||
    !AGREEMENT_STATUSES.includes(status as (typeof AGREEMENT_STATUSES)[number])
  ) {
    return { error: `status must be one of ${AGREEMENT_STATUSES.join(", ")}.` };
  }

  // Shape rules mirrored from the CHECK constraints, so a caller gets a
  // sentence instead of a constraint violation surfacing as a 500.
  if (model === "percentage" && pct.value === null) {
    return { error: "A percentage agreement needs a pct." };
  }
  if (model === "custom" && custom.value === null) {
    return { error: "A custom agreement needs a customTotalCents." };
  }

  return {
    value: {
      model: model as FeeModel,
      pct: pct.value,
      upfrontCents: upfront.value,
      successCents: success.value,
      triggerCents: trigger.value,
      customTotalCents: custom.value,
      status: status as FeeAgreementInput["status"],
    },
    fields: [
      "model",
      "pct",
      "upfront_cents",
      "success_cents",
      "trigger_cents",
      "custom_total_cents",
      "status",
    ],
  };
}

export interface PaymentBody {
  amountCents: number;
  receivedOn: string;
  method: FeePaymentMethod;
  reference: string | null;
  note: string | null;
}

export function readPaymentBody(
  body: unknown,
  today: string,
): Validated<PaymentBody> | { error: string } {
  const record = asRecord(body);
  if (record === null) return { error: "The request body must be a JSON object." };

  const amount = record.amountCents;
  if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount <= 0) {
    return { error: "amountCents must be a whole number of cents greater than zero." };
  }

  const receivedOn = record.receivedOn;
  if (typeof receivedOn !== "string" || !ISO_DATE.test(receivedOn)) {
    return { error: "receivedOn must be a date in YYYY-MM-DD form." };
  }
  if (receivedOn > today) {
    // Cheap and correct: both sides are zero-padded ISO dates, so a string
    // comparison is a date comparison, and money cannot be recorded as having
    // arrived tomorrow.
    return { error: "receivedOn cannot be in the future." };
  }

  const method = record.method;
  if (typeof method !== "string" || !PAYMENT_METHODS.includes(method as FeePaymentMethod)) {
    return { error: `method must be one of ${PAYMENT_METHODS.join(", ")}.` };
  }

  const reference = record.reference ?? null;
  if (reference !== null && (typeof reference !== "string" || reference.length > 120)) {
    return { error: "reference must be a string of at most 120 characters." };
  }

  const note = record.note ?? null;
  if (note !== null && (typeof note !== "string" || note.length > NOTE_MAX_LENGTH)) {
    return { error: `note must be a string of at most ${NOTE_MAX_LENGTH} characters.` };
  }

  return {
    value: {
      amountCents: amount,
      receivedOn,
      method: method as FeePaymentMethod,
      reference: reference === null ? null : reference.trim() || null,
      note: note === null ? null : note.trim() || null,
    },
    fields: ["amount_cents", "received_on", "method", "reference", "note"],
  };
}

export function readOrgDefaultBody(
  body: unknown,
): Validated<Omit<FeeAgreementInput, "status">> | { error: string } {
  const parsed = readAgreementBody(body);
  if ("error" in parsed) return parsed;
  // A workspace default has no status of its own — every client that inherits
  // it lands as a draft — so the one key the agreement body carries and this
  // one does not is dropped rather than passed through.
  return {
    value: {
      model: parsed.value.model,
      pct: parsed.value.pct,
      upfrontCents: parsed.value.upfrontCents,
      successCents: parsed.value.successCents,
      triggerCents: parsed.value.triggerCents,
      customTotalCents: parsed.value.customTotalCents,
    },
    fields: parsed.fields.filter((field) => field !== "status"),
  };
}

export interface ApprovalBody {
  approved: boolean;
  signoffRef: string | null;
}

export function readApprovalBody(body: unknown): Validated<ApprovalBody> | { error: string } {
  const record = asRecord(body);
  if (record === null) return { error: "The request body must be a JSON object." };

  const approved = record.approved;
  if (typeof approved !== "boolean") {
    return { error: "approved must be true or false." };
  }

  // Deliberately absent: an approver id. The RPC takes `approved_by` from the
  // session, which is what makes the attribution unforgeable, and a field for
  // it here would undo that.
  const signoffRef = record.signoffRef ?? null;
  if (signoffRef !== null && typeof signoffRef !== "string") {
    return { error: "signoffRef must be a string." };
  }
  const trimmed = signoffRef === null ? "" : signoffRef.trim();

  if (approved && trimmed === "") {
    return { error: "Approving this fee arrangement requires a written legal sign-off reference." };
  }
  if (trimmed.length > SIGNOFF_REF_MAX_LENGTH) {
    return { error: `signoffRef must be at most ${SIGNOFF_REF_MAX_LENGTH} characters.` };
  }

  return {
    value: { approved, signoffRef: trimmed === "" ? null : trimmed },
    fields: ["upfront_fee_approved", "legal_signoff_ref"],
  };
}

// ---------------------------------------------------------------------------
// The handlers.
// ---------------------------------------------------------------------------

function readWindow(request: Request): { limit: number; offset: number } {
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? service.RECEIVABLES_DEFAULT_LIMIT);
  const offset = Number(url.searchParams.get("offset") ?? 0);
  return {
    limit: Number.isFinite(limit) ? limit : service.RECEIVABLES_DEFAULT_LIMIT,
    offset: Number.isFinite(offset) ? offset : 0,
  };
}

export async function listReceivables(
  request: Request,
  overrides: Partial<FeeHandlerDeps> = {},
): Promise<Response> {
  const deps = withDefaults(overrides);
  try {
    const session = await deps.requireOrgMember();
    const client = await deps.createClient();
    const { limit, offset } = readWindow(request);
    const result = await deps.service.listOrgReceivables(client, session.orgId, limit, offset);
    if (!result.ok) return failureResponse(result.reason);
    return okResponse({ receivables: result.value, limit, offset });
  } catch (error) {
    return authErrorResponse(error) ?? unexpected(error, "fees.receivables");
  }
}

export interface ModelAvailability {
  id: string;
  kind: "model" | "option";
  available: boolean;
  reason: string | null;
}

/** The gate as data, so the surface renders a pending-legal-review state from
 * a response rather than from a hardcoded condition it would have to keep in
 * step with the database.
 *
 * Each row asks `isGatedFeeChange` about the smallest change that would select
 * it rather than restating which ones are gated. What this list says is
 * available and what a write actually earns have to agree, and the only
 * reliable way to keep two copies of a rule in agreement is to not have two. */
export function modelAvailability(gate: UpfrontGateState): ModelAvailability[] {
  const gatedReason = gate.approved ? null : LEGAL_GATE_CODE;
  const rows: { id: string; kind: "model" | "option"; change: GatedFeeChange }[] = [
    { id: "percentage", kind: "model", change: { model: "percentage" } },
    { id: "custom", kind: "model", change: { model: "custom" } },
    { id: "package", kind: "model", change: { model: "package" } },
    { id: "upfront", kind: "option", change: { model: "percentage", upfrontCents: 1 } },
    { id: "trigger", kind: "option", change: { model: "percentage", triggerCents: 1 } },
  ];
  return rows.map(({ id, kind, change }) => {
    const gated = isGatedFeeChange(change);
    return {
      id,
      kind,
      available: gate.approved || !gated,
      reason: gated ? gatedReason : null,
    };
  });
}

export async function listModels(
  _request: Request,
  overrides: Partial<FeeHandlerDeps> = {},
): Promise<Response> {
  const deps = withDefaults(overrides);
  try {
    const session = await deps.requireOrgMember();
    const client = await deps.createClient();
    const gate = await deps.service.readUpfrontGateState(client, session.orgId);
    if (!gate.ok) return failureResponse(gate.reason);
    return okResponse({ gate: gate.value, models: modelAvailability(gate.value) });
  } catch (error) {
    return authErrorResponse(error) ?? unexpected(error, "fees.models");
  }
}

export async function readClientFees(
  clientId: string,
  overrides: Partial<FeeHandlerDeps> = {},
): Promise<Response> {
  const deps = withDefaults(overrides);
  if (!isUuid(clientId)) {
    return errorResponse("invalid_request", "The client id must be a UUID.", 400);
  }
  try {
    await deps.requireOrgMember();
    const client = await deps.createClient();
    const result = await deps.service.readClientFees(client, clientId);
    if (!result.ok) return failureResponse(result.reason);
    return okResponse(result.value);
  } catch (error) {
    return authErrorResponse(error) ?? unexpected(error, "fees.client");
  }
}

export async function putAgreement(
  request: Request,
  clientId: string,
  overrides: Partial<FeeHandlerDeps> = {},
): Promise<Response> {
  const deps = withDefaults(overrides);
  if (!isUuid(clientId)) {
    return errorResponse("invalid_request", "The client id must be a UUID.", 400);
  }
  try {
    const session = await deps.requireOrgMember();
    await deps.assertTenantWriteAllowed(session);
    if (session.orgRole === null || !WRITE_ORG_ROLES.includes(session.orgRole)) {
      return errorResponse("forbidden", "Access is denied.", 403);
    }

    const body = await readJson(request);
    if (body === undefined) {
      return errorResponse("invalid_request", "The request body must be valid JSON.", 400);
    }
    const parsed = readAgreementBody(body);
    if ("error" in parsed) return errorResponse("invalid_request", parsed.error, 400);

    const client = await deps.createClient();
    // The service checks the gate before the write and maps the trigger's
    // refusal after it, so a pre-check that went stale between the two still
    // answers 403 legal_gate rather than a 500.
    const result = await deps.service.setAgreement(client, clientId, session.orgId, parsed.value);
    if (!result.ok) return failureResponse(result.reason);

    return okResponse({ agreement: result.value });
  } catch (error) {
    return authErrorResponse(error) ?? unexpected(error, "fees.agreement");
  }
}

export async function postPayment(
  request: Request,
  clientId: string,
  overrides: Partial<FeeHandlerDeps> = {},
): Promise<Response> {
  const deps = withDefaults(overrides);
  if (!isUuid(clientId)) {
    return errorResponse("invalid_request", "The client id must be a UUID.", 400);
  }
  try {
    const session = await deps.requireOrgMember();
    await deps.assertTenantWriteAllowed(session);

    const body = await readJson(request);
    if (body === undefined) {
      return errorResponse("invalid_request", "The request body must be valid JSON.", 400);
    }
    const parsed = readPaymentBody(body, deps.today());
    if ("error" in parsed) return errorResponse("invalid_request", parsed.error, 400);

    const client = await deps.createClient();
    const result = await deps.service.recordPayment(client, clientId, parsed.value);
    if (!result.ok) return failureResponse(result.reason);

    return Response.json({ payment: result.value }, { status: 201, headers: privateHeaders });
  } catch (error) {
    return authErrorResponse(error) ?? unexpected(error, "fees.payment");
  }
}

export async function postPaymentReversal(
  paymentId: string,
  overrides: Partial<FeeHandlerDeps> = {},
): Promise<Response> {
  const deps = withDefaults(overrides);
  if (!isUuid(paymentId)) {
    return errorResponse("invalid_request", "The payment id must be a UUID.", 400);
  }
  try {
    const session = await deps.requireOrgMember();
    await deps.assertTenantWriteAllowed(session);
    const client = await deps.createClient();
    const result = await deps.service.reversePayment(client, paymentId);
    if (!result.ok) return failureResponse(result.reason);
    return okResponse({ payment: result.value });
  } catch (error) {
    return authErrorResponse(error) ?? unexpected(error, "fees.payment_reversal");
  }
}

export async function getOrgDefaults(
  overrides: Partial<FeeHandlerDeps> = {},
): Promise<Response> {
  const deps = withDefaults(overrides);
  try {
    const session = await deps.requireOrgMember();
    const client = await deps.createClient();
    const [gate, orgDefault] = await Promise.all([
      deps.service.readUpfrontGateState(client, session.orgId),
      deps.service.readOrgDefault(client, session.orgId),
    ]);
    if (!gate.ok) return failureResponse(gate.reason);
    if (!orgDefault.ok) return failureResponse(orgDefault.reason);
    return okResponse({
      gate: gate.value,
      models: modelAvailability(gate.value),
      orgDefault: orgDefault.value,
    });
  } catch (error) {
    return authErrorResponse(error) ?? unexpected(error, "fees.org-defaults.read");
  }
}

export async function patchOrgDefaults(
  request: Request,
  overrides: Partial<FeeHandlerDeps> = {},
): Promise<Response> {
  const deps = withDefaults(overrides);
  try {
    const session = await deps.requireOrgMember();
    await deps.assertTenantWriteAllowed(session);
    if (session.orgRole === null || !WRITE_ORG_ROLES.includes(session.orgRole)) {
      return errorResponse("forbidden", "Access is denied.", 403);
    }

    const body = await readJson(request);
    if (body === undefined) {
      return errorResponse("invalid_request", "The request body must be valid JSON.", 400);
    }
    const parsed = readOrgDefaultBody(body);
    if ("error" in parsed) return errorResponse("invalid_request", parsed.error, 400);

    const client = await deps.createClient();
    // A workspace default is the scaled version of a per-client write, so it
    // meets the same gate — otherwise the gated arrangement could be pre-loaded
    // once and inherited by every client created afterwards.
    const result = await deps.service.setOrgDefault(client, session.orgId, parsed.value);
    if (!result.ok) return failureResponse(result.reason);

    return okResponse({ orgDefault: result.value });
  } catch (error) {
    return authErrorResponse(error) ?? unexpected(error, "fees.org-defaults.write");
  }
}

export async function patchUpfrontApproval(
  request: Request,
  orgId: string,
  overrides: Partial<FeeHandlerDeps> = {},
): Promise<Response> {
  const deps = withDefaults(overrides);
  if (!isUuid(orgId)) {
    return errorResponse("invalid_request", "The organization id must be a UUID.", 400);
  }
  try {
    // 403 rather than 404 for a non-admin: the route's existence is not the
    // secret, the authority to use it is.
    await deps.requirePlatformAdmin();

    const body = await readJson(request);
    if (body === undefined) {
      return errorResponse("invalid_request", "The request body must be valid JSON.", 400);
    }
    const parsed = readApprovalBody(body);
    if ("error" in parsed) return errorResponse("invalid_request", parsed.error, 400);

    const client = await deps.createClient();
    const result = await deps.service.setUpfrontApproval(
      client,
      orgId,
      parsed.value.approved,
      parsed.value.signoffRef,
    );
    if (!result.ok) return failureResponse(result.reason);

    // No audit write here on purpose. `private.org_flags_audit()` already emits
    // exactly one row per real change, and it emits it for writers that never
    // came through this route; a second row from here would double-count the
    // one change the compliance record is about.
    return okResponse({ gate: result.value });
  } catch (error) {
    return authErrorResponse(error) ?? unexpected(error, "fees.upfront-approval");
  }
}

async function readJson(request: Request): Promise<unknown | undefined> {
  try {
    return (await request.json()) as unknown;
  } catch {
    return undefined;
  }
}

function unexpected(error: unknown, scope: string): Response {
  console.error(`${scope} failed`, {
    message: error instanceof Error ? error.message : "unknown",
  });
  return errorResponse("server_error", "The request could not be completed.", 500);
}
