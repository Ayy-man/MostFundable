import "server-only";

import {
  DOCUMENT_TIMELINE_LABELS,
  STAGE_TIMELINE_LABELS,
  isTimelineAuditAction,
} from "./catalog";

import type { AppRole } from "../auth/session";
import type {
  AnalysisCompletedEvent,
  TimelineAudience,
  TimelineEvent,
  TimelineRead,
} from "./types";

type Row = Record<string, unknown>;

interface QueryError {
  readonly message?: string;
}

interface QueryResult {
  readonly data: unknown;
  readonly error: QueryError | null;
}

interface QueryBuilder extends PromiseLike<QueryResult> {
  select(columns: string): QueryBuilder;
  eq(column: string, value: unknown): QueryBuilder;
  in(column: string, values: readonly unknown[]): QueryBuilder;
  order(column: string, options?: { ascending?: boolean }): QueryBuilder;
}

interface TimelineDatabase {
  from(table: string): QueryBuilder;
  rpc(name: string, args: Record<string, unknown>): Promise<QueryResult>;
}

export interface TimelineViewer {
  readonly profileId: string;
  readonly role: AppRole;
}

export interface TimelineReadArgs {
  readonly clientId: string;
  readonly audience: TimelineAudience;
  readonly viewer: TimelineViewer;
}

export interface TimelineReadDependencies {
  readonly readSupport: (args: TimelineReadArgs) => Promise<readonly TimelineEvent[]>;
  readonly readStages: (args: TimelineReadArgs) => Promise<readonly TimelineEvent[]>;
  readonly readEnrollment: (args: TimelineReadArgs) => Promise<readonly TimelineEvent[]>;
  readonly readAnalysis: (args: TimelineReadArgs) => Promise<readonly TimelineEvent[]>;
  readonly readActions: (args: TimelineReadArgs) => Promise<readonly TimelineEvent[]>;
  readonly readDocuments: (args: TimelineReadArgs) => Promise<readonly TimelineEvent[]>;
  readonly readRefreshes: (args: TimelineReadArgs) => Promise<readonly TimelineEvent[]>;
  readonly readFees: (args: TimelineReadArgs) => Promise<readonly TimelineEvent[]>;
  readonly readApplications: (args: TimelineReadArgs) => Promise<readonly TimelineEvent[]>;
  readonly readAssignments: (args: TimelineReadArgs) => Promise<readonly TimelineEvent[]>;
}

function rows(result: QueryResult): Row[] {
  if (result.error) throw new Error(result.error.message ?? "TIMELINE_READ_FAILED");
  if (!Array.isArray(result.data)) return [];
  return result.data.filter((value): value is Row => value !== null && typeof value === "object");
}

function requiredString(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error("TIMELINE_SOURCE_INVALID");
  return value;
}

function optionalString(row: Row, key: string): string | undefined {
  const value = row[key];
  return typeof value === "string" ? value : undefined;
}

function requiredNumber(row: Row, key: string): number {
  const value = row[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  throw new Error("TIMELINE_SOURCE_INVALID");
}

function optionalNumber(row: Row, key: string): number | undefined {
  const value = row[key];
  if (value === null || value === undefined) return undefined;
  return requiredNumber(row, key);
}

function firstName(value: string): string {
  return value.trim().split(/\s+/, 1)[0] ?? value;
}

function dateOnly(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) throw new Error("TIMELINE_SOURCE_INVALID");
  return date.toISOString().slice(0, 10);
}

function stageLabel(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return STAGE_TIMELINE_LABELS[value as keyof typeof STAGE_TIMELINE_LABELS];
}

function namedFor(name: string): string {
  const lower = name.trim().toLowerCase();
  return `${/^[aeiou]/.test(lower) ? "an" : "a"} ${lower}`;
}

async function readClientName(db: TimelineDatabase, clientId: string): Promise<string | undefined> {
  const result = await db.from("clients").select("display_name").eq("id", clientId);
  const clientRows = rows(result);
  return clientRows[0] ? firstName(requiredString(clientRows[0], "display_name")) : undefined;
}

async function readProfileNames(db: TimelineDatabase, profileIds: readonly string[]): Promise<Map<string, string>> {
  const ids = [...new Set(profileIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  const result = await db.from("profiles").select("id, full_name").in("id", ids);
  return new Map(rows(result).map((row) => [requiredString(row, "id"), firstName(requiredString(row, "full_name"))]));
}

function withClient<T extends TimelineEvent>(event: T, client: string | undefined): T {
  return (client === undefined ? event : { ...event, client }) as T;
}

/** Small consumer-safe stage helper: it selects only the transition fields. */
export async function readConsumerStageHistory(
  db: TimelineDatabase,
  clientId: string,
): Promise<readonly Row[]> {
  return rows(await db.from("stage_history")
    .select("id, from_stage, to_stage, changed_at, changed_by")
    .eq("client_id", clientId)
    .order("changed_at", { ascending: true }));
}

/** Small consumer-safe analysis helper: no derived column is selected. */
export async function readConsumerAnalysisRuns(
  db: TimelineDatabase,
  clientId: string,
): Promise<readonly Row[]> {
  return rows(await db.from("analysis_runs")
    .select("id, ran_at, trigger, readiness_score")
    .eq("client_id", clientId)
    .order("ran_at", { ascending: true }));
}

function createProductionDependencies(db: TimelineDatabase): TimelineReadDependencies {
  return {
    async readSupport(args) {
      const [auditRows, client] = await Promise.all([
        db.from("audit_log")
          .select("id, action, actor_profile_id, occurred_at, meta")
          .eq("client_id", args.clientId)
          .in("action", ["support.thread_opened", "support.thread_status_changed"])
          .order("occurred_at", { ascending: true })
          .then(rows),
        readClientName(db, args.clientId),
      ]);
      const names = await readProfileNames(db, auditRows.map((row) => optionalString(row, "actor_profile_id") ?? ""));

      return auditRows.flatMap((row): TimelineEvent[] => {
        const action = requiredString(row, "action");
        if (!isTimelineAuditAction(action)) return [];
        const base = {
          ref: `audit:${requiredString(row, "id")}`,
          at: requiredString(row, "occurred_at"),
          actor: names.get(optionalString(row, "actor_profile_id") ?? ""),
        };
        if (action === "support.thread_opened") {
          return [withClient({ ...base, kind: "thread_opened" }, client)];
        }
        const meta = row.meta;
        if (meta === null || typeof meta !== "object") return [];
        const toState = optionalString(meta as Row, "to_state");
        if (toState !== "resolved" && toState !== "open") return [];
        return [withClient({ ...base, kind: "thread_status", to: toState }, client)];
      });
    },

    async readStages(args) {
      const [stageRows, client] = await Promise.all([
        readConsumerStageHistory(db, args.clientId),
        readClientName(db, args.clientId),
      ]);
      const names = await readProfileNames(db, stageRows.map((row) => optionalString(row, "changed_by") ?? ""));
      return stageRows.flatMap((row): TimelineEvent[] => {
        const to = stageLabel(requiredString(row, "to_stage"));
        if (!to) return [];
        return [withClient({
          ref: `stage:${requiredString(row, "id")}`,
          kind: "stage_changed",
          at: requiredString(row, "changed_at"),
          from: stageLabel(optionalString(row, "from_stage")),
          to,
          actor: names.get(optionalString(row, "changed_by") ?? ""),
        }, client)];
      });
    },

    async readEnrollment(args) {
      const [consentRows, signatureRows, idvRows, subscriptionRows, revocationRows, client] = await Promise.all([
        db.from("consents").select("id, kind, action, signed_at").eq("client_id", args.clientId).order("signed_at", { ascending: true }).then(rows),
        db.from("esignatures").select("id, signed_at").eq("client_id", args.clientId).order("signed_at", { ascending: true }).then(rows),
        db.from("idv_sessions").select("id, state, outcome, updated_at").eq("client_id", args.clientId).order("updated_at", { ascending: true }).then(rows),
        db.from("consumer_subscriptions").select("id, status, activated_at, cancelled_at").eq("client_id", args.clientId).order("created_at", { ascending: true }).then(rows),
        db.from("consent_revocations").select("id, kind, revoked_at, revoked_by").eq("client_id", args.clientId).order("revoked_at", { ascending: true }).then(rows),
        readClientName(db, args.clientId),
      ]);
      const names = await readProfileNames(db, revocationRows.map((row) => optionalString(row, "revoked_by") ?? ""));
      const events: TimelineEvent[] = [];
      const granted = consentRows.filter((row) => row.action === "granted");
      const monitoring = granted.find((row) => row.kind === "monitoring");
      const analysis = granted.find((row) => row.kind === "analysis");
      if (monitoring && analysis) {
        const at = [requiredString(monitoring, "signed_at"), requiredString(analysis, "signed_at")].sort().at(-1)!;
        events.push(withClient({ ref: `enrollment:consents:${args.clientId}`, kind: "enrollment_milestone", at, milestone: "consents" }, client));
      }
      for (const row of signatureRows.slice(0, 1)) {
        events.push(withClient({ ref: `esign:${requiredString(row, "id")}`, kind: "enrollment_milestone", at: requiredString(row, "signed_at"), milestone: "esign" }, client));
      }
      for (const row of idvRows.filter((value) => value.state === "passed" || value.outcome === "pass").slice(0, 1)) {
        events.push(withClient({ ref: `idv:${requiredString(row, "id")}`, kind: "enrollment_milestone", at: requiredString(row, "updated_at"), milestone: "idv" }, client));
      }
      for (const row of subscriptionRows) {
        const activatedAt = optionalString(row, "activated_at");
        if (activatedAt) {
          events.push(withClient({ ref: `subscription:${requiredString(row, "id")}:milestone`, kind: "enrollment_milestone", at: activatedAt, milestone: "active", firstChargeOn: dateOnly(activatedAt) }, client));
          events.push(withClient({ ref: `subscription:${requiredString(row, "id")}:active`, kind: "subscription", at: activatedAt, state: "active" }, client));
        }
        const cancelledAt = optionalString(row, "cancelled_at");
        if (cancelledAt) events.push(withClient({ ref: `subscription:${requiredString(row, "id")}:cancelled`, kind: "subscription", at: cancelledAt, state: "cancelled", endsOn: dateOnly(cancelledAt) }, client));
      }
      for (const row of revocationRows) {
        const kind = requiredString(row, "kind");
        if (kind !== "monitoring" && kind !== "analysis") continue;
        events.push(withClient({
          ref: `consent:${requiredString(row, "id")}`,
          kind: "consent_revoked",
          at: requiredString(row, "revoked_at"),
          which: kind,
          actor: names.get(optionalString(row, "revoked_by") ?? ""),
        }, client));
      }
      return events;
    },

    async readAnalysis(args) {
      const [runRows, client] = await Promise.all([
        readConsumerAnalysisRuns(db, args.clientId),
        readClientName(db, args.clientId),
      ]);
      return runRows.map((row, index): TimelineEvent => {
        const prior = index > 0 ? runRows[index - 1] : undefined;
        const trigger = requiredString(row, "trigger");
        return withClient({
          ref: `analysis:${requiredString(row, "id")}`,
          kind: "analysis_completed",
          at: requiredString(row, "ran_at"),
          readiness: requiredNumber(row, "readiness_score"),
          prev: prior ? requiredNumber(prior, "readiness_score") : undefined,
          prevAt: prior ? requiredString(prior, "ran_at") : undefined,
          trigger: trigger === "force_pull" ? "refresh" : trigger === "upload" ? "manual" : "scheduled",
          superseded: index < runRows.length - 1 || undefined,
        }, client);
      });
    },

    async readActions(args) {
      const [itemRows, stateRows, client] = await Promise.all([
        db.from("checklist_items").select("id, title, blocking, created_at").eq("client_id", args.clientId).order("created_at", { ascending: true }).then(rows),
        db.from("checklist_item_state").select("checklist_item_id, state, reported_at, verified_at").eq("client_id", args.clientId).then(rows),
        readClientName(db, args.clientId),
      ]);
      const states = new Map(stateRows.map((row) => [requiredString(row, "checklist_item_id"), row]));
      return itemRows.map((row): TimelineEvent => {
        const state = states.get(requiredString(row, "id"));
        const sourceState = state ? requiredString(state, "state") : "todo";
        return withClient({
          ref: `action:${requiredString(row, "id")}`,
          kind: "action",
          at: requiredString(row, "created_at"),
          title: requiredString(row, "title"),
          state: sourceState === "verified" ? "verified" : sourceState === "reported" || sourceState === "verifying" ? "reported" : "todo",
          blocking: row.blocking === true,
          reportedAt: state ? optionalString(state, "reported_at") : undefined,
          verifiedAt: state ? optionalString(state, "verified_at") : undefined,
        }, client);
      });
    },

    async readDocuments(args) {
      const [uploadRows, requestRows, reviewRows, client] = await Promise.all([
        db.from("document_uploads").select("id, kind, section, lifecycle, uploaded_by, created_at").eq("client_id", args.clientId).order("created_at", { ascending: true }).then(rows),
        db.from("document_requests").select("id, name, why, requested_by, fulfilled_at, fulfilled_upload_id, created_at").eq("client_id", args.clientId).order("created_at", { ascending: true }).then(rows),
        args.audience === "operator" ? db.from("document_reviews").select("id, upload_id, reviewed_by, reviewed_at").eq("org_id", optionalString((await db.from("clients").select("org_id").eq("id", args.clientId).then(rows))[0] ?? {}, "org_id") ?? "").then(rows) : Promise.resolve([]),
        readClientName(db, args.clientId),
      ]);
      const visibleUploads = uploadRows.filter((row) =>
        (row.kind === "company" && row.lifecycle === "stored")
        || (row.kind === "credit_report" && row.lifecycle === "parsed"));
      const relevantUploadIds = new Set(visibleUploads.map((row) => requiredString(row, "id")));
      const relevantReviews = reviewRows.filter((row) => relevantUploadIds.has(requiredString(row, "upload_id")));
      const profileIds = [
        ...visibleUploads.map((row) => optionalString(row, "uploaded_by") ?? ""),
        ...requestRows.map((row) => optionalString(row, "requested_by") ?? ""),
        ...relevantReviews.map((row) => optionalString(row, "reviewed_by") ?? ""),
      ];
      const names = await readProfileNames(db, profileIds);
      const reviews = new Map(relevantReviews.map((row) => [requiredString(row, "upload_id"), row]));
      const events: TimelineEvent[] = [];
      for (const row of visibleUploads) {
        const section = optionalString(row, "section") ?? "other";
        const label = row.kind === "credit_report"
          ? { name: "Credit report", named: "a credit report", section: "Analysis" }
          : DOCUMENT_TIMELINE_LABELS[section as keyof typeof DOCUMENT_TIMELINE_LABELS] ?? DOCUMENT_TIMELINE_LABELS.other;
        const review = reviews.get(requiredString(row, "id"));
        events.push(withClient({
          ref: `document:${requiredString(row, "id")}`,
          kind: "document_filed",
          at: requiredString(row, "created_at"),
          uploadId: requiredString(row, "id"),
          name: label.name,
          named: label.named,
          section: label.section,
          actor: names.get(optionalString(row, "uploaded_by") ?? ""),
          reviewedBy: review ? names.get(optionalString(review, "reviewed_by") ?? "") : undefined,
        }, client));
      }
      for (const row of requestRows) {
        const name = requiredString(row, "name");
        const fulfilledUploadId = optionalString(row, "fulfilled_upload_id");
        const review = fulfilledUploadId ? reviews.get(fulfilledUploadId) : undefined;
        events.push(withClient({
          ref: `document-request:${requiredString(row, "id")}`,
          kind: "document_requested",
          at: requiredString(row, "created_at"),
          requestId: requiredString(row, "id"),
          uploadId: fulfilledUploadId,
          name,
          named: namedFor(name),
          why: requiredString(row, "why"),
          actor: names.get(optionalString(row, "requested_by") ?? ""),
          fulfilledAt: optionalString(row, "fulfilled_at"),
          reviewedBy: review ? names.get(optionalString(review, "reviewed_by") ?? "") : undefined,
        }, client));
      }
      return events;
    },

    async readRefreshes(args) {
      const [refreshRows, runRows, auditRows, client] = await Promise.all([
        db.rpc("timeline_paid_refreshes", { p_client_id: args.clientId }).then(rows),
        readConsumerAnalysisRuns(db, args.clientId),
        db.from("audit_log")
          .select("subject_id, action, occurred_at")
          .eq("client_id", args.clientId)
          .in("action", ["paid_refresh.transition", "pull.blocked"])
          .order("occurred_at", { ascending: true })
          .then(rows),
        readClientName(db, args.clientId),
      ]);
      const runs = new Map(runRows.map((row) => [requiredString(row, "id"), row]));
      const refreshAuditIds = new Set(auditRows.filter((row) => row.action === "paid_refresh.transition").map((row) => requiredString(row, "subject_id")));
      const blockAuditIds = new Set(auditRows.filter((row) => row.action === "pull.blocked").map((row) => requiredString(row, "subject_id")));
      const events: TimelineEvent[] = refreshRows.filter((row) => refreshAuditIds.has(requiredString(row, "id"))).map((row) => {
        const runId = optionalString(row, "analysis_run_id");
        const run = runId ? runs.get(runId) : undefined;
        return withClient({
          ref: `refresh:${requiredString(row, "id")}`,
          kind: "refresh",
          at: requiredString(row, "created_at"),
          amountCents: requiredNumber(row, "amount_cents"),
          completedAt: run ? requiredString(run, "ran_at") : undefined,
          readiness: run ? requiredNumber(run, "readiness_score") : undefined,
        }, client);
      });
      if (args.audience === "operator") {
        const blockRows = rows(await db.rpc("timeline_pull_blocks", { p_client_id: args.clientId }));
        const latest = runRows.at(-1);
        if (latest) {
          for (const row of blockRows.filter((value) => blockAuditIds.has(requiredString(value, "id")))) {
            const resetsOn = optionalString(row, "resets_on");
            if (!resetsOn) continue;
            events.push(withClient({
              ref: `refresh-block:${requiredString(row, "id")}`,
              kind: "refresh_blocked",
              at: requiredString(row, "decided_at"),
              operatorOnly: true,
              resetsOn,
              lastReadiness: requiredNumber(latest, "readiness_score"),
              lastRunAt: requiredString(latest, "ran_at"),
            }, client));
          }
        }
      }
      return events;
    },

    async readFees(args) {
      const [paymentRows, ledgerRows, client] = await Promise.all([
        db.from("fee_payments").select("id, amount_cents, received_on, method, recorded_by, recorded_at, reversed_at").eq("client_id", args.clientId).order("recorded_at", { ascending: true }).then(rows),
        args.audience === "operator" ? db.from("fee_ledger").select("balance_cents").eq("client_id", args.clientId).then(rows) : Promise.resolve([]),
        readClientName(db, args.clientId),
      ]);
      const names = await readProfileNames(db, paymentRows.map((row) => optionalString(row, "recorded_by") ?? ""));
      const currentBalance = ledgerRows[0] ? optionalNumber(ledgerRows[0], "balance_cents") : undefined;
      return paymentRows.filter((row) => row.reversed_at === null).map((row): TimelineEvent => withClient({
        ref: `fee-payment:${requiredString(row, "id")}`,
        kind: "fee_payment",
        at: requiredString(row, "recorded_at"),
        amountCents: requiredNumber(row, "amount_cents"),
        balanceCents: currentBalance,
        method: requiredString(row, "method"),
        receivedOn: requiredString(row, "received_on"),
        actor: names.get(optionalString(row, "recorded_by") ?? ""),
      }, client));
    },

    async readApplications(args) {
      const [outcomeRows, applicationRows, bankRows, client] = await Promise.all([
        db.from("outcomes").select("id, application_id, bank_ref, kind, amount_cents, decided_on, recorded_by, created_at, state").eq("client_id", args.clientId).order("created_at", { ascending: true }).then(rows),
        db.from("applications").select("id, consumer_status, visibility, updated_at").eq("client_id", args.clientId).then(rows),
        args.audience === "operator" ? db.from("banks_cache").select("bank_ref, name").eq("is_active", true).then(rows) : Promise.resolve([]),
        readClientName(db, args.clientId),
      ]);
      const names = await readProfileNames(db, outcomeRows.map((row) => optionalString(row, "recorded_by") ?? ""));
      const applications = new Map(applicationRows.map((row) => [requiredString(row, "id"), row]));
      const banks = new Map(bankRows.map((row) => [requiredString(row, "bank_ref"), requiredString(row, "name")]));
      return outcomeRows.flatMap((row): TimelineEvent[] => {
        if (row.state !== "counted") return [];
        const kind = requiredString(row, "kind");
        const kindWord = kind === "approved" ? "funded" : kind === "denied" ? "declined" : kind === "withdrawn" ? "withdrawn" : undefined;
        if (!kindWord) return [];
        const application = applications.get(requiredString(row, "application_id"));
        const releasedOn = application
          && application.consumer_status !== "pending"
          && application.visibility !== "inherit"
          ? dateOnly(requiredString(application, "updated_at"))
          : undefined;
        return [withClient({
          ref: `outcome:${requiredString(row, "id")}`,
          kind: "application_outcome",
          at: requiredString(row, "created_at"),
          kindWord,
          bank: banks.get(requiredString(row, "bank_ref")) ?? requiredString(row, "bank_ref"),
          amountCents: kindWord === "funded" ? requiredNumber(row, "amount_cents") : undefined,
          decidedOn: requiredString(row, "decided_on"),
          releasedOn,
          actor: names.get(optionalString(row, "recorded_by") ?? ""),
        }, client)];
      });
    },

    async readAssignments(args) {
      if (args.audience !== "operator") return [];
      const [historyRows, client] = await Promise.all([
        db.from("client_assignment_history").select("id, from_user, to_user, changed_by, changed_at").eq("client_id", args.clientId).order("changed_at", { ascending: true }).then(rows),
        readClientName(db, args.clientId),
      ]);
      const names = await readProfileNames(db, historyRows.flatMap((row) => [optionalString(row, "from_user") ?? "", optionalString(row, "to_user") ?? "", optionalString(row, "changed_by") ?? ""]));
      return historyRows.flatMap((row): TimelineEvent[] => {
        const to = names.get(optionalString(row, "to_user") ?? "");
        if (!to) return [];
        return [withClient({
          ref: `assignment:${requiredString(row, "id")}`,
          kind: "assignment",
          at: requiredString(row, "changed_at"),
          operatorOnly: true,
          from: names.get(optionalString(row, "from_user") ?? ""),
          to,
          actor: names.get(optionalString(row, "changed_by") ?? ""),
        }, client)];
      });
    },
  };
}

function projectEvent(event: TimelineEvent, audience: TimelineAudience): TimelineEvent | null {
  if (audience === "operator") return event;
  if (event.operatorOnly) return null;
  if (event.kind === "application_outcome" && event.releasedOn === undefined) return null;
  const { client: _client, ...withoutClient } = event;
  void _client;
  if (withoutClient.kind === "thread_status") {
    const { actor: _actor, ...withoutActor } = withoutClient;
    void _actor;
    return withoutActor;
  }
  if (withoutClient.kind === "fee_payment") {
    const { balanceCents: _balance, ...withoutBalance } = withoutClient;
    void _balance;
    return withoutBalance;
  }
  return withoutClient;
}

function markSuperseded(events: readonly TimelineEvent[]): TimelineEvent[] {
  const analyses = events.filter((event): event is AnalysisCompletedEvent => event.kind === "analysis_completed");
  if (analyses.length < 2) return [...events];
  const latest = [...analyses].sort((left, right) => right.at.localeCompare(left.at))[0];
  return events.map((event) => event.kind === "analysis_completed" && event.ref !== latest.ref
    ? { ...event, superseded: true }
    : event);
}

export async function readTimeline(
  deps: TimelineReadDependencies | undefined,
  args: TimelineReadArgs,
): Promise<TimelineRead> {
  let readers = deps;
  if (readers === undefined) {
    try {
      const { createClient } = await import("../supabase/server");
      readers = createProductionDependencies(await createClient() as unknown as TimelineDatabase);
    } catch {
      return { events: [], readFailed: true };
    }
  }

  const settled = await Promise.allSettled([
    readers.readSupport(args),
    readers.readStages(args),
    readers.readEnrollment(args),
    readers.readAnalysis(args),
    readers.readActions(args),
    readers.readDocuments(args),
    readers.readRefreshes(args),
    readers.readFees(args),
    readers.readApplications(args),
    readers.readAssignments(args),
  ]);
  const combined = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  const events = markSuperseded(combined)
    .map((event) => projectEvent(event, args.audience))
    .filter((event): event is TimelineEvent => event !== null)
    .sort((left, right) => left.at.localeCompare(right.at) || left.ref.localeCompare(right.ref));

  return {
    events,
    ...(settled.some((result) => result.status === "rejected") ? { readFailed: true } : {}),
  };
}
