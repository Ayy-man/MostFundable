import "server-only";

import type { SessionProfile } from "@/lib/auth/session";
import { featureFlag } from "@/lib/env";
import type { FeatureFlagName } from "@/lib/env";
import type { Application, ReadOutcomeResult } from "@/lib/applications";
import type { AdminFundedVolume, AdminTenantRow } from "@/lib/admin/platform";
import type { OrgReceivable } from "@/lib/fees";
import type { GroundingDocument } from "@/lib/kb/chat-driver";
import type { RevenueKpis } from "@/lib/revenue/types";
import { trackerStageTimer } from "@/lib/tracker/timer";
import type { TrackerClient, TrackerReadFilters, TrackerStage } from "@/lib/tracker";
import type { BankListRow } from "@/lib/vault";

export const OPERATOR_WORKSPACE_TOOL_NAMES = [
  "client_readiness",
  "client_applications",
  "client_fees",
  "bank_catalog",
] as const;
export const ADMIN_WORKSPACE_TOOL_NAMES = [
  "platform_operators",
  "platform_rollups",
  "platform_revenue",
  "platform_audit",
  "bank_catalog",
] as const;
export const CONSUMER_WORKSPACE_TOOL_NAMES = [
  "client_readiness",
  "client_applications",
] as const;

export type WorkspaceToolName =
  | (typeof OPERATOR_WORKSPACE_TOOL_NAMES)[number]
  | (typeof ADMIN_WORKSPACE_TOOL_NAMES)[number]
  | (typeof CONSUMER_WORKSPACE_TOOL_NAMES)[number];

/** Closed, JSON-safe arguments. Organization and record identifiers are absent on purpose. */
export type WorkspaceToolArgs = Readonly<{
  from?: string;
  limit?: number;
  month?: string;
  query?: string;
  stage?: TrackerStage;
}>;

export type WorkspaceToolResult = {
  status: "records" | "no_matching" | "out_of_scope";
  documents: GroundingDocument[];
  /**
   * The authorized read found more rows than one grounded answer can carry.
   *
   * It exists because the alternative is invisible: a read that stops at its
   * limit returns a well-formed result the caller cannot distinguish from a
   * complete one, and the reader is shown part of the book as the whole book.
   */
  truncated?: boolean;
};

/** Fields that may exist in upstream rows but must never enter assistant grounding. */
export const WORKSPACE_ASSISTANT_DENIED_FIELDS = Object.freeze([
  "consumerProfileId",
  "assignedToId",
  "analysisPending",
  "monitoring",
  "monitoringConsentAt",
  "bureauPulls",
  "qualificationSummary",
  "creditReport",
  "creditScore",
  "tradelines",
  "utilization",
  "accounts",
  "snapshot",
] as const);
const DENIED_FIELD_SET: ReadonlySet<string> = new Set(WORKSPACE_ASSISTANT_DENIED_FIELDS);

type Rollups = {
  operatorCount: number;
  consumerCount: number;
  fundedCents: number | null;
  cashCents: number;
  platformMrrCents: number;
  fundedVolume: AdminFundedVolume;
};
type AuditRow = { action: string; occurredAt: string; subjectType: string };
type RevenueLedgerRead = {
  kpis: RevenueKpis;
  operatorEntries: readonly {
    operatorName: string;
    accrualMonth: string;
    baseAmountCents: number;
    pct: number | null;
    amountCents: number | null;
    complete: boolean;
    settlementStatus: string;
  }[];
  referralEntries: readonly {
    referrerName: string;
    referredName: string;
    accrualMonth: string;
    cycle: number;
    baseAmountCents: number;
    pct: number;
    amountCents: number;
    complete: boolean;
    settlementStatus: string;
  }[];
};

export interface WorkspaceToolDependencies {
  realAuthEnabled(): boolean;
  featureEnabled(name: FeatureFlagName): boolean;
  now(): Date;
  readClients(session: SessionProfile, filters: TrackerReadFilters): Promise<readonly TrackerClient[]>;
  readApplications(clientId: string): Promise<readonly Application[]>;
  readApplicationsByBank(bankRef: string): Promise<readonly Application[]>;
  readOutcomes(clientId: string): Promise<readonly ReadOutcomeResult[]>;
  readOutcomesByBank(bankRef: string): Promise<readonly ReadOutcomeResult[]>;
  readFees(orgId: string): Promise<readonly OrgReceivable[]>;
  readBanks(): Promise<readonly BankListRow[]>;
  readOperators(): Promise<readonly AdminTenantRow[]>;
  readRollups(today: string): Promise<Rollups>;
  readRevenue(month: string, operatorName?: string): Promise<RevenueLedgerRead>;
  readAudit(input: { from?: string; limit: number }): Promise<readonly AuditRow[]>;
  /** The caller's own workspace name, for the router's "another workspace" rule. Optional so older fakes still satisfy the contract; absent reads as unknown. */
  readWorkspaceName?(orgId: string): Promise<string | null>;
}

const MAX_DOCUMENTS = 30;
const DEFAULT_LIMIT = 20;
const STAGES: ReadonlySet<string> = new Set([
  "onboarding", "optimization", "ready", "applying", "funded", "graduate",
]);

function boundedLimit(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value)
    ? Math.min(MAX_DOCUMENTS, Math.max(1, value))
    : DEFAULT_LIMIT;
}

function validArgs(value: unknown): value is WorkspaceToolArgs {
  if (value === undefined) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const allowed = new Set(["from", "limit", "month", "query", "stage"]);
  if (Object.keys(row).some((key) => !allowed.has(key))) return false;
  if (row.limit !== undefined && (typeof row.limit !== "number" || !Number.isInteger(row.limit))) return false;
  for (const key of ["from", "month", "query"] as const) {
    if (row[key] !== undefined && typeof row[key] !== "string") return false;
  }
  return row.stage === undefined || (typeof row.stage === "string" && STAGES.has(row.stage));
}

/**
 * Money leaves the workspace as a formatted amount, never as a cents integer.
 *
 * A live operator answer read "Riley Funded Demo owes $1,000 (100,000 cents)":
 * the model was handed `totalCents: 100000`, correctly converted it, and then
 * printed the storage representation alongside the human one because nothing
 * told it that integer was not a fact about the client. Instructing the model
 * not to is the weak fix — it is one sentence away from being ignored, and a
 * new `*Cents` field added anywhere in this file would not be covered by it.
 * Rewriting the tree is the strong one: the raw integer never enters transport,
 * so there is nothing for a model to echo, in any scope and in any field a
 * later read starts emitting.
 *
 * A `null` amount stays `null` — that is the consumer visibility rule nulling a
 * figure the caller may not see, and it must survive as an absence rather than
 * becoming a formatted zero.
 */
const MONEY_KEY = /^(.*)Cents$/;
const MONEY = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function withFormattedMoney(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withFormattedMoney);
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const money = MONEY_KEY.exec(key);
    if (money === null) {
      output[key] = withFormattedMoney(child);
      continue;
    }
    // Collisions keep an explicit suffix rather than overwriting a sibling: two
    // keys silently becoming one would drop a figure from the answer.
    const renamed = money[1]! in output || money[1]! in (value as Record<string, unknown>) ? `${money[1]}Formatted` : money[1]!;
    output[renamed] = typeof child === "number" && Number.isFinite(child) ? MONEY.format(child / 100) : child === null ? null : withFormattedMoney(child);
  }
  return output;
}

/**
 * Machine values are presented the way a person would read them.
 *
 * All three admin questions on the live walk were declined by the supervisor,
 * whose rule is that every factual statement must be supported by the supplied
 * documents. The documents supplied `action: "client.stage_changed"`,
 * `occurredAt: "2026-08-22T00:00:00Z"` and `plan: "pro"` — values no readable
 * answer can quote verbatim, so any answer worth reading had to transform them,
 * and a transformation is exactly what a strict reading of "supported by the
 * supplied documents" refuses. The same pressure produced the operator answer
 * that hedged "$1,000 (100,000 cents)".
 *
 * The supervisor prompt is being widened to say a faithful restatement is
 * supported (v3), but a prompt is the weaker half of the fix. Handing over the
 * reader's form directly means there is nothing left to transform: the answer
 * can quote what it was given. The raw value is kept beside it under an
 * explicitly machine-named key, so ordering and filtering still have the exact
 * value and no reader mistakes it for the fact.
 *
 * `CODE_FIELDS` is the rule, not a list of the fields one walk happened to hit;
 * it is exported so a test derives its coverage from it.
 */
export const CODE_FIELDS: ReadonlySet<string> = new Set([
  "action", "subjectType", "plan", "membership", "stage", "operatorStatus",
  "consumerStatus", "kind", "state", "reviewState", "model", "status",
  "settlementStatus", "health", "visibility",
]);

const DATE_KEY = /(?:At|On)$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ].*)?$/;
const READABLE_DATE = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
const READABLE_TIME = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" });

/** `client.stage_changed` reads as `Client stage changed`; `status_only` as `Status only`. */
export function readableCode(value: string): string {
  const words = value.replace(/[._-]+/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").trim().toLocaleLowerCase();
  return words.length === 0 ? value : words.charAt(0).toLocaleUpperCase() + words.slice(1);
}

function readableDate(value: string): string | null {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return value.includes("T") || value.includes(" ") ? READABLE_TIME.format(parsed) : READABLE_DATE.format(parsed);
}

export function withReadableValues(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withReadableValues);
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === "string" && CODE_FIELDS.has(key)) {
      output[key] = readableCode(child);
      output[`${key}Code`] = child;
      continue;
    }
    if (typeof child === "string" && DATE_KEY.test(key) && ISO_DATE.test(child)) {
      const readable = readableDate(child);
      if (readable !== null) {
        output[key] = readable;
        output[`${key}Iso`] = child;
        continue;
      }
    }
    output[key] = withReadableValues(child);
  }
  return output;
}

function document(index: number, kind: string, title: string, rawContent: object): GroundingDocument {
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (DENIED_FIELD_SET.has(key)) throw new Error("ASSISTANT_CONTEXT_DENIED_FIELD");
      visit(child);
    }
  };
  visit(rawContent);
  const content = withReadableValues(withFormattedMoney(rawContent)) as object;
  const prefix = kind === "client" ? "tracker" : kind === "bank" ? "lender" : kind;
  return {
    id: `${prefix}:${index}`,
    title,
    label: title,
    url: "",
    content: JSON.stringify(content),
    metadata: { kind },
  };
}

function matches(value: string, query: string | undefined): boolean {
  return !query?.trim() || value.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
}

function toolNames(session: SessionProfile): readonly WorkspaceToolName[] {
  if (session.role === "operator_member" && session.orgId) return OPERATOR_WORKSPACE_TOOL_NAMES;
  if (session.role === "platform_admin") return ADMIN_WORKSPACE_TOOL_NAMES;
  if (session.role === "consumer") return CONSUMER_WORKSPACE_TOOL_NAMES;
  return [];
}

async function productionDependencies(): Promise<WorkspaceToolDependencies> {
  const ordinaryClient = async () => {
    const { createClient } = await import("@/lib/supabase/server");
    return createClient();
  };
  return {
    realAuthEnabled: () => featureFlag("FEATURE_REAL_AUTH"),
    featureEnabled: (name) => featureFlag(name),
    now: () => new Date(),
    async readClients(session, filters) {
      return (await import("@/lib/tracker")).listAssistantTrackerClients(session, filters);
    },
    async readApplications(clientId) {
      return (await import("@/lib/applications")).listApplicationsBounded(clientId, MAX_DOCUMENTS + 1);
    },
    async readApplicationsByBank(bankRef) {
      return (await import("@/lib/applications")).listApplicationsByBankBounded(bankRef, MAX_DOCUMENTS + 1);
    },
    async readOutcomes(clientId) {
      return (await import("@/lib/applications")).listOutcomesWithReviewsBounded(clientId, MAX_DOCUMENTS + 1);
    },
    async readOutcomesByBank(bankRef) {
      return (await import("@/lib/applications")).listOutcomesWithReviewsByBankBounded(bankRef, MAX_DOCUMENTS + 1);
    },
    async readFees(orgId) {
      const fees = await import("@/lib/fees");
      const result = await fees.listOrgReceivables(await fees.createFeesClient(), orgId, MAX_DOCUMENTS, 0);
      if (!result.ok) throw new Error("ASSISTANT_FEE_READ_FAILED");
      return result.value;
    },
    async readBanks() {
      return (await import("@/lib/vault")).listBanks();
    },
    async readOperators() {
      const { createPlatformRepository } = await import("@/lib/admin/platform");
      const client = await ordinaryClient();
      return createPlatformRepository(() => client).readTenants();
    },
    async readRollups(today) {
      const [{ createOverviewRepository }, { createPlatformRepository }] = await Promise.all([
        import("@/lib/admin/overview"), import("@/lib/admin/platform"),
      ]);
      const client = await ordinaryClient();
      const overview = createOverviewRepository(() => client);
      const platform = createPlatformRepository(() => client);
      const [counts, fundedCents, cashCents, platformMrrCents, fundedVolume] = await Promise.all([
        overview.readCounts(), overview.readFundedCents(), overview.readCashCents(),
        platform.readPlatformMrrCents(), platform.readFundedVolume(today),
      ]);
      return { operatorCount: counts.operators, consumerCount: counts.consumers, fundedCents, cashCents, platformMrrCents, fundedVolume };
    },
    async readRevenue(month, operatorName) {
      const { readRevenueKpis } = await import("@/lib/revenue");
      const db = await ordinaryClient();
      const accrualMonth = `${month}-01`;
      const targetOrgResult = operatorName === undefined
        ? { data: null, error: null }
        : await db.from("orgs").select("id, name").eq("name", operatorName).limit(MAX_DOCUMENTS);
      if (targetOrgResult.error) throw new Error("ASSISTANT_REVENUE_ORG_READ_FAILED");
      const targetOrgIds = (targetOrgResult.data ?? []).map((row) => row.id);
      if (operatorName !== undefined && targetOrgIds.length === 0) {
        return { kpis: await readRevenueKpis(month, db), operatorEntries: [], referralEntries: [] };
      }

      let operatorQuery = db.from("operator_earnings_ledger")
        .select("operator_org_id, accrual_month, base_amount_cents, pct_snapshot, amount_cents, is_complete, settlement_status")
        .eq("accrual_month", accrualMonth)
        .order("created_at", { ascending: false });
      if (operatorName !== undefined) operatorQuery = operatorQuery.in("operator_org_id", targetOrgIds);
      const referralBase = () => db.from("referral_ledger")
        .select("referrer_org_id, referred_org_id, accrual_month, cycle_number, base_amount_cents, pct_snapshot, amount_cents, is_complete, settlement_status")
        .eq("accrual_month", accrualMonth)
        .order("created_at", { ascending: false });
      const referralReads = operatorName === undefined
        ? [referralBase().limit(MAX_DOCUMENTS)]
        : [referralBase().in("referrer_org_id", targetOrgIds).limit(MAX_DOCUMENTS), referralBase().in("referred_org_id", targetOrgIds).limit(MAX_DOCUMENTS)];
      const [kpis, operatorResult, ...referralResults] = await Promise.all([
        readRevenueKpis(month, db),
        operatorQuery.limit(MAX_DOCUMENTS),
        ...referralReads,
      ]);
      const referralError = referralResults.find((result) => result.error)?.error;
      const referralRows = [...new Map(referralResults.flatMap((result) => result.data ?? []).map((row) => [JSON.stringify(row), row])).values()]
        .slice(0, MAX_DOCUMENTS);
      if (operatorResult.error || referralError) throw new Error("ASSISTANT_REVENUE_LEDGER_READ_FAILED");
      const operatorRows = operatorResult.data ?? [];
      const orgIds = [...new Set([
        ...targetOrgIds,
        ...operatorRows.map((row) => row.operator_org_id),
        ...referralRows.flatMap((row) => [row.referrer_org_id, row.referred_org_id]),
      ])];
      const orgResult = orgIds.length === 0
        ? { data: [], error: null }
        : await db.from("orgs").select("id, name").in("id", orgIds);
      if (orgResult.error) throw new Error("ASSISTANT_REVENUE_ORG_READ_FAILED");
      const orgNames = new Map((orgResult.data ?? []).map((row) => [row.id, row.name]));
      return {
        kpis,
        operatorEntries: operatorRows.map((row) => ({
          operatorName: orgNames.get(row.operator_org_id) ?? "Operator name unavailable",
          accrualMonth: row.accrual_month,
          baseAmountCents: row.base_amount_cents,
          pct: row.pct_snapshot,
          amountCents: row.amount_cents,
          complete: row.is_complete,
          settlementStatus: row.settlement_status,
        })),
        referralEntries: referralRows.map((row) => ({
          referrerName: orgNames.get(row.referrer_org_id) ?? "Referrer name unavailable",
          referredName: orgNames.get(row.referred_org_id) ?? "Referred operator name unavailable",
          accrualMonth: row.accrual_month,
          cycle: row.cycle_number,
          baseAmountCents: row.base_amount_cents,
          pct: row.pct_snapshot,
          amountCents: row.amount_cents,
          complete: row.is_complete,
          settlementStatus: row.settlement_status,
        })),
      };
    },
    async readWorkspaceName(orgId) {
      const db = await ordinaryClient();
      const { data, error } = await db.from("orgs").select("name").eq("id", orgId).maybeSingle();
      if (error) throw new Error("ASSISTANT_WORKSPACE_NAME_READ_FAILED");
      return typeof data?.name === "string" && data.name.trim().length > 0 ? data.name : null;
    },
    async readAudit(input) {
      const db = await ordinaryClient();
      let query = db.from("audit_log").select("action, occurred_at, subject_type").order("occurred_at", { ascending: false }).limit(input.limit);
      if (input.from) query = query.gte("occurred_at", input.from);
      const { data, error } = await query;
      if (error) throw new Error("ASSISTANT_AUDIT_READ_FAILED");
      return (data ?? []).map((row) => ({ action: row.action, occurredAt: row.occurred_at, subjectType: row.subject_type }));
    },
  };
}

export interface WorkspaceToolRegistry {
  namesFor(session: SessionProfile): readonly WorkspaceToolName[];
  /** The caller's own workspace name, or null when the caller has none, the read is not wired, or it fails — routing must not fail on it. */
  workspaceName?(session: SessionProfile): Promise<string | null>;
  run(toolName: string, session: SessionProfile, args?: WorkspaceToolArgs): Promise<WorkspaceToolResult>;
}

export function createWorkspaceToolRegistry(supplied?: WorkspaceToolDependencies): WorkspaceToolRegistry {
  const deps = async () => supplied ?? productionDependencies();
  return {
    namesFor: toolNames,
    async workspaceName(session) {
      if (session.role === "platform_admin" || !session.orgId) return null;
      try {
        const d = await deps();
        return d.readWorkspaceName === undefined ? null : await d.readWorkspaceName(session.orgId);
      } catch {
        return null;
      }
    },
    async run(toolName, session, rawArgs) {
      if (!toolNames(session).includes(toolName as WorkspaceToolName) || !validArgs(rawArgs)) {
        return { status: "out_of_scope", documents: [] };
      }
      const d = await deps();
      if (!d.realAuthEnabled()) return { status: "out_of_scope", documents: [] };
      const requiredFlags: Partial<Record<WorkspaceToolName, readonly FeatureFlagName[]>> = {
        client_readiness: ["FEATURE_TRACKER"],
        client_applications: ["FEATURE_TRACKER", "FEATURE_APPLICATIONS"],
        client_fees: ["FEATURE_FEES"],
        bank_catalog: ["FEATURE_VAULT"],
        platform_operators: ["FEATURE_ADMIN"],
        platform_rollups: ["FEATURE_ADMIN"],
        platform_revenue: ["FEATURE_ADMIN", "FEATURE_REVENUE"],
        platform_audit: ["FEATURE_ADMIN"],
      };
      if ((requiredFlags[toolName as WorkspaceToolName] ?? []).some((flag) => !d.featureEnabled(flag))) {
        return { status: "out_of_scope", documents: [] };
      }
      const args = rawArgs ?? {};
      const limit = boundedLimit(args.limit);
      let documents: GroundingDocument[] = [];

      if (toolName === "client_readiness") {
        const clients = await d.readClients(session, { scope: "all", ...(args.stage ? { stage: args.stage } : {}) });
        documents = clients
          .filter((client) => matches(`${client.displayName} ${client.businessName ?? ""} ${client.stage}`, args.query))
          .sort((left, right) => (right.readiness ?? -1) - (left.readiness ?? -1) || left.displayName.localeCompare(right.displayName))
          .slice(0, limit)
          .map((client, index) => {
          const timer = trackerStageTimer(client.stage, client.stageEnteredAt, d.now());
          return document(index, "client", `Client · ${client.displayName}`, {
            clientName: client.displayName, businessName: client.businessName, stage: client.stage,
            readiness: client.readiness, stageTimer: timer, openActionCount: client.openActionCount,
            // "null" is not a word a reader uses; the live walk saw "(assigned
            // to null)" echoed straight into a consumer's answer.
            assignedTo: client.assignedToName ?? "Unassigned", lastActivityAt: client.lastActivityAt,
          });
        });
      } else if (toolName === "client_applications") {
        // `limit` is the model's own argument and stays a filter it asked for.
        // With no argument the ceiling is the answer ceiling, not the default
        // page size, because "where does each application stand" must not
        // silently become "where do the first twenty stand".
        const applicationLimit = args.limit === undefined ? MAX_DOCUMENTS : limit;
        const visibleClients = await d.readClients(session, { scope: "all" });
        const banks = session.role === "consumer" ? [] : await d.readBanks();
        const bankNames = new Map(banks.map((bank) => [bank.bankRef, bank.name]));
        const matchingClients = visibleClients.filter((client) => matches(`${client.displayName} ${client.businessName ?? ""}`, args.query));
        const matchingBank = args.query === undefined ? undefined : banks.find((bank) => matches(`${bank.name} ${bank.products.join(" ")}`, args.query));
        const clientsById = new Map(visibleClients.map((client) => [client.id, client]));
        const sets = await (matchingClients.length > 0 || matchingBank === undefined
          // Every matching client, not the first page of them. The slice that
          // used to be here cut the book before a single application was read,
          // so a twenty-first client's open application was missing from an
          // answer that claimed to cover the workspace.
          ? Promise.all(matchingClients.map(async (client) => ({ client, applications: await d.readApplications(client.id), outcomes: await d.readOutcomes(client.id) })))
          : (() => {
              return Promise.all([d.readApplicationsByBank(matchingBank.bankRef), d.readOutcomesByBank(matchingBank.bankRef)]).then(([applications, outcomes]) => {
                const applicationsByClient = new Map<string, Application[]>();
                for (const application of applications) {
                  if (!clientsById.has(application.clientId)) continue;
                  const rows = applicationsByClient.get(application.clientId) ?? [];
                  rows.push(application);
                  applicationsByClient.set(application.clientId, rows);
                }
                return [...applicationsByClient].map(([clientId, clientApplications]) => ({
                  client: clientsById.get(clientId)!,
                  applications: clientApplications,
                  outcomes: outcomes.filter((item) => item.outcome.clientId === clientId),
                }));
              });
            })());
        // Each read asked for one row past its ceiling. Getting it back means
        // the source itself had more than this answer can carry.
        const sourceTruncated = sets.some(({ applications, outcomes }) =>
          applications.length > MAX_DOCUMENTS || outcomes.length > MAX_DOCUMENTS);
        for (const { client, applications, outcomes } of sets) {
          const outcomesByApplication = new Map<string, ReadOutcomeResult[]>();
          for (const item of outcomes) {
            const rows = outcomesByApplication.get(item.outcome.applicationId) ?? [];
            rows.push(item);
            outcomesByApplication.set(item.outcome.applicationId, rows);
          }
          const orderedApplications = [...applications].sort((left, right) =>
            left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
          const lenderCounts = new Map<string, number>();
          for (const application of orderedApplications) {
            lenderCounts.set(application.bankRef, (lenderCounts.get(application.bankRef) ?? 0) + 1);
          }
          const lenderOrdinals = new Map<string, number>();
          for (const [applicationIndex, application] of orderedApplications.entries()) {
            const consumer = session.role === "consumer";
            const lenderName = bankNames.get(application.bankRef) ?? null;
            const ordinal = (lenderOrdinals.get(application.bankRef) ?? 0) + 1;
            lenderOrdinals.set(application.bankRef, ordinal);
            const totalForLender = lenderCounts.get(application.bankRef) ?? 1;
            const applicationLabel = lenderName === null
              ? `Application ${applicationIndex + 1}`
              : `${lenderName}${totalForLender > 1 ? ` · Application ${ordinal}` : ""}`;
            const applicationOutcomes = (outcomesByApplication.get(application.id) ?? [])
              .sort((left, right) => left.outcome.decidedOn.localeCompare(right.outcome.decidedOn) || left.outcome.id.localeCompare(right.outcome.id))
              .map((item) => ({
                kind: item.outcome.kind,
                amountCents: consumer && application.visibility !== "details" ? null : item.outcome.amountCents,
                decidedOn: item.outcome.decidedOn,
                state: item.outcome.state,
                reviewState: item.review?.state ?? null,
              }));
            documents.push(document(documents.length, "application", `Application · ${client.displayName} · ${applicationLabel}`, {
              clientName: client.displayName,
              lenderName,
              status: consumer ? application.consumerStatus : { operator: application.operatorStatus, consumer: application.consumerStatus },
              amountCents: consumer && application.visibility !== "details" ? null : application.amountCents,
              createdAt: application.createdAt,
              updatedAt: application.updatedAt,
              outcomes: applicationOutcomes,
            }));
          }
        }
        if (documents.length > applicationLimit || sourceTruncated) {
          return { status: "records", documents: documents.slice(0, applicationLimit), truncated: true };
        }
      } else if (toolName === "client_fees" && session.orgId) {
        documents = (await d.readFees(session.orgId)).filter((row) => matches(row.displayName, args.query)).slice(0, limit).map((row, index) => document(index, "client", `Fees · ${row.displayName}`, {
          clientName: row.displayName, model: row.model, status: row.status, totalCents: row.totalCents,
          paidCents: row.paidCents, feeOutstandingCents: row.balanceCents, lastPaymentOn: row.lastPaymentOn,
        }));
      } else if (toolName === "bank_catalog") {
        documents = (await d.readBanks()).filter((bank) => matches(`${bank.name} ${bank.products.join(" ")}`, args.query)).slice(0, limit)
          .map((bank, index) => document(index, "bank", `Bank · ${bank.name}`, { bankName: bank.name, products: bank.products }));
      } else if (toolName === "platform_operators") {
        documents = (await d.readOperators()).filter((row) => matches(row.name, args.query)).slice(0, limit).map((row, index) => document(index, "operator", `Operator · ${row.name}`, {
          operatorName: row.name, plan: row.plan, membership: row.membership, startedAt: row.startedAt,
          clientCount: row.clients, fundedYtdCents: row.fundedYtdCents, fundedAllTimeCents: row.fundedAllTimeCents,
          fundingReadyDays: row.fundingReadyDays,
        }));
      } else if (toolName === "platform_rollups") {
        const today = d.now().toISOString().slice(0, 10);
        const rollups = await d.readRollups(today);
        documents = [document(0, "metric", "Platform rollups", rollups)];
      } else if (toolName === "platform_revenue") {
        const month = args.month && /^\d{4}-\d{2}$/.test(args.month) ? args.month : d.now().toISOString().slice(0, 7);
        const revenue = await d.readRevenue(month, args.query);
        documents = args.query ? [] : [document(0, "metric", `Revenue · ${month}`, {
          month, complete: revenue.kpis.complete, operatorEarningsTotalCents: revenue.kpis.monitoringShareTotalCents,
          referralTotalCents: revenue.kpis.saasReferralTotalCents,
        })];
        for (const row of revenue.operatorEntries.filter((entry) => matches(entry.operatorName, args.query))) {
          documents.push(document(documents.length, "metric", `Operator earnings · ${row.operatorName} · ${row.accrualMonth}`, row));
        }
        for (const row of revenue.referralEntries.filter((entry) => matches(`${entry.referrerName} ${entry.referredName}`, args.query))) {
          documents.push(document(documents.length, "metric", `Referral earnings · ${row.referrerName} · ${row.referredName} · ${row.accrualMonth}`, row));
        }
      } else if (toolName === "platform_audit") {
        documents = (await d.readAudit({ from: args.from, limit })).map((row, index) =>
          document(index, "metric", `Audit · ${readableCode(row.action)} · ${readableDate(row.occurredAt) ?? row.occurredAt}`, row));
      }

      return documents.length > 0 ? { status: "records", documents } : { status: "no_matching", documents: [] };
    },
  };
}
