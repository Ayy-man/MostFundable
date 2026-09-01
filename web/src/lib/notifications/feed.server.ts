import "server-only";

import { featureFlag } from "@/lib/env";

import {
  analysisCompleteCopy,
  applicationUpdateCopy,
  CONSENT_LABELS,
  documentCopy,
  enrollmentMilestoneCopy,
  ENROLLMENT_MILESTONE_LABELS,
  monitoringAlertCopy,
  refreshResultCopy,
  stageChangeCopy,
  teamMessageCopy,
} from "./copy.ts";
import {
  NOTIFICATION_FEED_LIMIT,
  NOTIFICATION_WINDOW_DAYS,
  type NotificationEventType,
  type NotificationEventV2,
  type NotificationFeedV2,
} from "./types.ts";
import {
  CONSUMER_NOTIFICATION_EVENT_TYPES,
  isConsumerNotificationEventType,
} from "./preferences.ts";

import type { SessionProfile } from "@/lib/auth/session";

type NotificationErrorCode = "forbidden" | "read_failed" | "write_failed";

export class NotificationFeedError extends Error {
  readonly name = "NotificationFeedError";
  readonly code: NotificationErrorCode;

  constructor(code: NotificationErrorCode) {
    super("Notification feed operation failed");
    this.code = code;
  }
}

interface Result<Row> {
  data: Row | null;
  error: unknown;
}

export interface NotificationQuery<Row> extends PromiseLike<Result<Row[]>> {
  eq(column: string, value: unknown): NotificationQuery<Row>;
  neq(column: string, value: unknown): NotificationQuery<Row>;
  gte(column: string, value: string): NotificationQuery<Row>;
  in(column: string, values: readonly unknown[]): NotificationQuery<Row>;
  is(column: string, value: null): NotificationQuery<Row>;
  not(column: string, operator: "is", value: null): NotificationQuery<Row>;
  order(column: string, options: { ascending: boolean }): NotificationQuery<Row>;
  limit(value: number): NotificationQuery<Row>;
}

export interface NotificationTable<Row> {
  select(columns: string): NotificationQuery<Row>;
  insert(values: Record<string, unknown> | Record<string, unknown>[]): PromiseLike<Result<unknown>>;
  upsert(
    values: Record<string, unknown>,
    options: { ignoreDuplicates: boolean; onConflict: string },
  ): PromiseLike<Result<unknown>>;
}

export interface NotificationSessionClient {
  from<Row>(table: string): NotificationTable<Row>;
}

export interface NotificationSourceFlags {
  ancillary: boolean;
  analysis: boolean;
  applications: boolean;
  enrollment: boolean;
  support: boolean;
  tracker: boolean;
}

function enabledNotificationSources(flags: NotificationSourceFlags): NotificationEventType[] {
  const sources: NotificationEventType[] = [];
  if (flags.ancillary) sources.push("monitoring_alert");
  if (flags.tracker) sources.push("stage_change");
  if (flags.analysis) sources.push("analysis_complete", "refresh_result");
  if (flags.enrollment) sources.push("enrollment_milestone");
  if (flags.ancillary) sources.push("document");
  if (flags.support) sources.push("team_message");
  if (flags.applications) sources.push("application_update");
  return sources;
}

interface Candidate extends Omit<NotificationEventV2, "readAt"> {
  sourceReadAt: string | null;
}

interface ClientRow { id: string }
interface MonitoringRow { id: string; created_at: string; read_at: string | null }
interface StageRow { id: string; to_stage: Parameters<typeof stageChangeCopy>[0]; changed_at: string }
interface PlanRow {
  id: string;
  analysis_run_id: string;
  created_at: string;
}
interface AnalysisRunRow { id: string; ran_at: string }
interface MilestoneRow {
  client_id: string;
  kind: keyof typeof ENROLLMENT_MILESTONE_LABELS;
  completed_at: string;
}
interface ConsentRow { id: string; kind: keyof typeof CONSENT_LABELS; signed_at: string }
interface DocumentRow {
  id: string;
  section: Parameters<typeof documentCopy>[0];
  created_at: string;
}
interface ThreadRow { id: string }
interface MessageRow {
  id: string;
  thread_id: string;
  author_profile_id: string;
  sent_at: string;
}
interface ProfileRow { id: string; full_name: string | null }
interface ThreadReadRow { thread_id: string; last_read_at: string }
interface ApplicationRow { id: string; bank_ref: string | null; created_at: string }
interface OutcomeRow { id: string; bank_ref: string | null; created_at: string }
interface ReadRow { event_key: string; read_at: string }
interface PreferenceRow { event_type: string; in_app_enabled: boolean }

const NOTIFICATION_SOURCE_LIMIT = NOTIFICATION_FEED_LIMIT + 1;

function readFailed(): never {
  throw new NotificationFeedError("read_failed");
}

async function rows<Row>(query: NotificationQuery<Row>): Promise<Row[]> {
  const result = await query;
  if (result.error || !result.data) readFailed();
  return result.data;
}

function windowStart(now: Date): string {
  return new Date(now.getTime() - NOTIFICATION_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

function event(
  value: Omit<Candidate, "sourceReadAt">,
  sourceReadAt: string | null = null,
): Candidate {
  return { ...value, sourceReadAt };
}

async function resolveConsumerClientIds(
  db: NotificationSessionClient,
  session: SessionProfile,
): Promise<string[]> {
  const found = await rows(
    db.from<ClientRow>("clients").select("id")
      .eq("consumer_profile_id", session.id)
      .eq("status", "active"),
  );
  return found.map((row) => row.id);
}

async function enabledInAppEventTypes(
  db: NotificationSessionClient,
  profileId: string,
): Promise<ReadonlySet<NotificationEventType>> {
  const saved = await rows(
    db.from<PreferenceRow>("consumer_notification_preferences")
      .select("event_type,in_app_enabled")
      .eq("profile_id", profileId),
  );
  const enabled = new Set<NotificationEventType>(CONSUMER_NOTIFICATION_EVENT_TYPES);
  for (const row of saved) {
    if (!isConsumerNotificationEventType(row.event_type)
        || typeof row.in_app_enabled !== "boolean") readFailed();
    if (row.in_app_enabled) enabled.add(row.event_type);
    else enabled.delete(row.event_type);
  }
  return enabled;
}

async function monitoringEvents(
  db: NotificationSessionClient,
  profileId: string,
  since: string,
): Promise<Candidate[]> {
  const found = await rows(
    db.from<MonitoringRow>("outcome_notifications")
      .select("id,created_at,read_at")
      .eq("recipient_profile_id", profileId)
      .eq("kind", "crs_alert")
      .not("delivered_at", "is", null)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(NOTIFICATION_SOURCE_LIMIT),
  );
  return found.map((row) => event({
    id: `monitoring_alert:${row.id}`,
    type: "monitoring_alert",
    occurredAt: row.created_at,
    ...monitoringAlertCopy(),
    target: "credit",
  }, row.read_at));
}

async function stageEvents(
  db: NotificationSessionClient,
  clientId: string,
  since: string,
): Promise<Candidate[]> {
  const stages = await rows(
    db.from<StageRow>("stage_history")
      .select("id,to_stage,changed_at")
      .eq("client_id", clientId)
      .gte("changed_at", since)
      .order("changed_at", { ascending: false })
      .limit(NOTIFICATION_SOURCE_LIMIT),
  );
  return stages.map((row) => event({
    id: `stage_change:${row.id}`,
    type: "stage_change",
    occurredAt: row.changed_at,
    ...stageChangeCopy(row.to_stage, row.changed_at),
    target: "dashboard",
  }));
}

async function analysisEvents(
  db: NotificationSessionClient,
  clientId: string,
  since: string,
): Promise<Candidate[]> {
  const runs = await rows(
    db.from<AnalysisRunRow>("analysis_runs")
      .select("id,ran_at")
      .eq("client_id", clientId)
      .eq("trigger", "force_pull")
      .gte("ran_at", since)
      .order("ran_at", { ascending: false })
      .limit(NOTIFICATION_SOURCE_LIMIT),
  );
  const [plans, forcePullPlans, firstPlans] = await Promise.all([
    rows(
      db.from<PlanRow>("plans")
        .select("id,analysis_run_id,created_at")
        .eq("client_id", clientId)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(NOTIFICATION_SOURCE_LIMIT),
    ),
    runs.length === 0
      ? []
      : rows(
        db.from<PlanRow>("plans")
          .select("id,analysis_run_id,created_at")
          .eq("client_id", clientId)
          .in("analysis_run_id", runs.map((row) => row.id)),
      ),
    rows(
      db.from<PlanRow>("plans")
        .select("id,analysis_run_id,created_at")
        .eq("client_id", clientId)
        .order("created_at", { ascending: true })
        .limit(1),
    ),
  ]);
  const forcePullRunIds = new Set(runs.map((row) => row.id));
  const planByRunId = new Map(forcePullPlans.map((row) => [row.analysis_run_id, row]));
  const firstPlanId = firstPlans[0]?.id;
  return [
    ...plans.filter((row) => !forcePullRunIds.has(row.analysis_run_id)).map((row) => event({
      id: `analysis_complete:${row.id}`,
      type: "analysis_complete",
      occurredAt: row.created_at,
      ...analysisCompleteCopy(row.id === firstPlanId, row.created_at),
      target: "plan",
    })),
    ...runs.map((row) => {
      const plan = planByRunId.get(row.id);
      if (!plan) readFailed();
      return event({
        id: `refresh_result:${row.id}`,
        type: "refresh_result",
        occurredAt: row.ran_at,
        ...refreshResultCopy(),
        target: "plan",
      });
    }),
  ];
}

async function enrollmentEvents(
  db: NotificationSessionClient,
  clientId: string,
  since: string,
): Promise<Candidate[]> {
  const [milestones, consents] = await Promise.all([
    rows(
      db.from<MilestoneRow>("enrollment_milestones")
        .select("client_id,kind,completed_at")
        .eq("client_id", clientId)
        .not("completed_at", "is", null)
        .gte("completed_at", since)
        .order("completed_at", { ascending: false })
        .limit(NOTIFICATION_SOURCE_LIMIT),
    ),
    rows(
      db.from<ConsentRow>("consents")
        .select("id,kind,signed_at")
        .eq("client_id", clientId)
        .eq("action", "granted")
        .gte("signed_at", since)
        .order("signed_at", { ascending: false })
        .limit(NOTIFICATION_SOURCE_LIMIT),
    ),
  ]);
  return [
    ...milestones.map((row) => event({
      id: `enrollment_milestone:${row.client_id}:${row.kind}`,
      type: "enrollment_milestone",
      occurredAt: row.completed_at,
      ...enrollmentMilestoneCopy(ENROLLMENT_MILESTONE_LABELS[row.kind], row.completed_at),
      target: "documents",
    })),
    ...consents.map((row) => event({
      id: `enrollment_milestone:${row.id}:${row.kind}_consent`,
      type: "enrollment_milestone",
      occurredAt: row.signed_at,
      ...enrollmentMilestoneCopy(CONSENT_LABELS[row.kind], row.signed_at),
      target: "documents",
    })),
  ];
}

async function documentEvents(
  db: NotificationSessionClient,
  clientId: string,
  since: string,
): Promise<Candidate[]> {
  const found = await rows(
    db.from<DocumentRow>("document_uploads")
      .select("id,section,created_at")
      .eq("client_id", clientId)
      .eq("kind", "company")
      .is("purged_at", null)
      .not("section", "is", null)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(NOTIFICATION_SOURCE_LIMIT),
  );
  return found.map((row) => event({
    id: `document:${row.id}`,
    type: "document",
    occurredAt: row.created_at,
    ...documentCopy(row.section),
    target: "documents",
  }));
}

async function teamMessageEvents(
  db: NotificationSessionClient,
  clientId: string,
  profileId: string,
  since: string,
): Promise<Candidate[]> {
  const threads = await rows(
    db.from<ThreadRow>("support_threads").select("id")
      .eq("client_id", clientId)
      .eq("kind", "team_chat"),
  );
  const threadIds = threads.map((row) => row.id);
  if (threadIds.length === 0) return [];

  const [messages, threadReads] = await Promise.all([
    rows(
      db.from<MessageRow>("support_messages")
        .select("id,thread_id,author_profile_id,sent_at")
        .in("thread_id", threadIds)
        .neq("author_kind", "consumer")
        .gte("sent_at", since)
        .order("sent_at", { ascending: false })
        .limit(NOTIFICATION_SOURCE_LIMIT),
    ),
    rows(
      db.from<ThreadReadRow>("support_thread_reads")
        .select("thread_id,last_read_at")
        .eq("profile_id", profileId)
        .in("thread_id", threadIds),
    ),
  ]);
  const authorIds = [...new Set(messages.map((row) => row.author_profile_id))];
  const profiles = authorIds.length === 0
    ? []
    : await rows(
      db.from<ProfileRow>("profiles").select("id,full_name").in("id", authorIds),
    );
  const nameById = new Map(profiles.map((row) => [row.id, row.full_name]));
  const readByThread = new Map(threadReads.map((row) => [row.thread_id, row.last_read_at]));

  return messages.map((row) => {
    const watermark = readByThread.get(row.thread_id) ?? null;
    const sourceReadAt = watermark !== null && watermark >= row.sent_at ? watermark : null;
    return event({
      id: `team_message:${row.id}`,
      type: "team_message",
      occurredAt: row.sent_at,
      ...teamMessageCopy(nameById.get(row.author_profile_id)),
      target: "coach",
    }, sourceReadAt);
  });
}

async function applicationEvents(
  db: NotificationSessionClient,
  clientId: string,
  since: string,
): Promise<Candidate[]> {
  const [applications, outcomes] = await Promise.all([
    rows(
      db.from<ApplicationRow>("applications")
        .select("id,bank_ref,created_at")
        .eq("client_id", clientId)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(NOTIFICATION_SOURCE_LIMIT),
    ),
    rows(
      db.from<OutcomeRow>("outcomes")
        .select("id,bank_ref,created_at")
        .eq("client_id", clientId)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(NOTIFICATION_SOURCE_LIMIT),
    ),
  ]);
  return [
    ...applications.map((row) => event({
      id: `application_update:${row.id}:application`,
      type: "application_update",
      occurredAt: row.created_at,
      ...applicationUpdateCopy("first", row.bank_ref, row.created_at),
      target: "plan",
    })),
    ...outcomes.map((row) => event({
      id: `application_update:${row.id}:outcome`,
      type: "application_update",
      occurredAt: row.created_at,
      ...applicationUpdateCopy("update", row.bank_ref, row.created_at),
      target: "plan",
    })),
  ];
}

export function currentNotificationSourceFlags(): NotificationSourceFlags {
  return {
    ancillary: featureFlag("FEATURE_ANCILLARY"),
    analysis: featureFlag("FEATURE_ANALYSIS"),
    applications: featureFlag("FEATURE_APPLICATIONS"),
    enrollment: featureFlag("FEATURE_ENROLLMENT"),
    support: featureFlag("FEATURE_SUPPORT"),
    tracker: featureFlag("FEATURE_TRACKER"),
  };
}

export async function createNotificationSessionClient(): Promise<NotificationSessionClient> {
  if (!featureFlag("FEATURE_REAL_AUTH")) throw new NotificationFeedError("forbidden");
  const { createClient } = await import("@/lib/supabase/server");
  return await createClient() as unknown as NotificationSessionClient;
}

export async function readNotificationFeedWith(
  session: SessionProfile,
  db: NotificationSessionClient,
  flags: NotificationSourceFlags,
  now = new Date(),
): Promise<NotificationFeedV2> {
  if (session.role !== "consumer") throw new NotificationFeedError("forbidden");
  const inAppEventTypes = await enabledInAppEventTypes(db, session.id);
  const enabledSources = enabledNotificationSources(flags)
    .filter((eventType) => inAppEventTypes.has(eventType));
  const enabledSourceSet = new Set(enabledSources);
  const clientIds = await resolveConsumerClientIds(db, session);
  if (clientIds.length !== 1) {
    return {
      notifications: [],
      unreadCount: 0,
      windowDays: NOTIFICATION_WINDOW_DAYS,
      capped: false,
      sources: enabledSources,
    };
  }

  const clientId = clientIds[0];
  const since = windowStart(now);
  const eventGroups = await Promise.all([
    enabledSourceSet.has("monitoring_alert") ? monitoringEvents(db, session.id, since) : [],
    enabledSourceSet.has("stage_change") ? stageEvents(db, clientId, since) : [],
    enabledSourceSet.has("analysis_complete") || enabledSourceSet.has("refresh_result")
      ? analysisEvents(db, clientId, since) : [],
    enabledSourceSet.has("enrollment_milestone") ? enrollmentEvents(db, clientId, since) : [],
    enabledSourceSet.has("document") ? documentEvents(db, clientId, since) : [],
    enabledSourceSet.has("team_message")
      ? teamMessageEvents(db, clientId, session.id, since) : [],
    enabledSourceSet.has("application_update") ? applicationEvents(db, clientId, since) : [],
  ]);

  const eligibleCandidates = eventGroups.flat()
    .filter((item) => enabledSourceSet.has(item.type))
    .filter((item) => item.occurredAt >= since && item.occurredAt <= now.toISOString())
    .sort((left, right) =>
      right.occurredAt.localeCompare(left.occurredAt) || left.id.localeCompare(right.id));
  const capped = eligibleCandidates.length > NOTIFICATION_FEED_LIMIT;
  const candidates = eligibleCandidates.slice(0, NOTIFICATION_FEED_LIMIT);

  const persistedReads = candidates.length === 0
    ? []
    : await rows(
      db.from<ReadRow>("consumer_notification_reads")
        .select("event_key,read_at")
        .eq("profile_id", session.id)
        .in("event_key", candidates.map((item) => item.id)),
    );
  const readByKey = new Map(persistedReads.map((row) => [row.event_key, row.read_at]));
  const notifications = candidates.map(({ sourceReadAt, ...item }) => ({
    ...item,
    readAt: readByKey.get(item.id) ?? sourceReadAt,
  }));

  return {
    notifications,
    unreadCount: notifications.filter((item) => item.readAt === null).length,
    windowDays: NOTIFICATION_WINDOW_DAYS,
    capped,
    sources: enabledSources,
  };
}

export async function readConsumerNotificationFeed(
  session: SessionProfile,
): Promise<NotificationFeedV2> {
  return readNotificationFeedWith(
    session,
    await createNotificationSessionClient(),
    currentNotificationSourceFlags(),
  );
}
