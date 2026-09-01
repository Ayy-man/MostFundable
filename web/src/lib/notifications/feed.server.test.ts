import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  NotificationFeedError,
  readNotificationFeedWith,
  type NotificationQuery,
  type NotificationSessionClient,
  type NotificationSourceFlags,
  type NotificationTable,
} from "./feed.server.ts";
import {
  markAllNotificationsReadWith,
  markNotificationReadWith,
} from "./mark-read.server.ts";

import type { SessionProfile } from "@/lib/auth/session";

type FakeRow = Record<string, unknown>;
type Predicate<QueryRow> = (row: QueryRow) => boolean;

const NOW = new Date("2026-08-24T12:00:00.000Z");
const PROFILE_ID = "39400000-0000-4000-8000-000000000111";
const CLIENT_ID = "39400000-0000-4000-8000-000000000101";

const OFF: NotificationSourceFlags = {
  ancillary: false,
  analysis: false,
  applications: false,
  enrollment: false,
  support: false,
  tracker: false,
};

function uuid(value: number): string {
  return `39400000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

function session(overrides: Partial<SessionProfile> = {}): SessionProfile {
  return {
    disabledAt: null,
    id: PROFILE_ID,
    manages: [],
    orgId: "39400000-0000-4000-8000-000000000001",
    orgMembership: null,
    orgRole: null,
    role: "consumer",
    ...overrides,
  };
}

function valueAt<QueryRow>(row: QueryRow, column: string): unknown {
  return (row as FakeRow)[column];
}

class FakeQuery<QueryRow> implements NotificationQuery<QueryRow> {
  private readonly source: QueryRow[];
  private readonly predicates: Predicate<QueryRow>[] = [];
  private orderBy: { column: string; ascending: boolean } | null = null;
  private ceiling: number | null = null;

  constructor(source: QueryRow[]) {
    this.source = source;
  }

  eq(column: string, value: unknown): this {
    this.predicates.push((row) => valueAt(row, column) === value);
    return this;
  }

  neq(column: string, value: unknown): this {
    this.predicates.push((row) => valueAt(row, column) !== value);
    return this;
  }

  gte(column: string, value: string): this {
    this.predicates.push((row) => {
      const found = valueAt(row, column);
      return typeof found === "string" && found >= value;
    });
    return this;
  }

  in(column: string, values: readonly unknown[]): this {
    this.predicates.push((row) => values.includes(valueAt(row, column)));
    return this;
  }

  is(column: string, value: null): this {
    this.predicates.push((row) => valueAt(row, column) === value);
    return this;
  }

  not(column: string, operator: "is", value: null): this {
    assert.equal(operator, "is");
    this.predicates.push((row) => valueAt(row, column) !== value);
    return this;
  }

  order(column: string, options: { ascending: boolean }): this {
    this.orderBy = { column, ascending: options.ascending };
    return this;
  }

  limit(value: number): this {
    this.ceiling = value;
    return this;
  }

  private execute(): Promise<{ data: QueryRow[]; error: null }> {
    let data = this.source.filter((row) => this.predicates.every((predicate) => predicate(row)));
    if (this.orderBy) {
      const { ascending, column } = this.orderBy;
      data = [...data].sort((left, right) => {
        const comparison = String(valueAt(left, column)).localeCompare(String(valueAt(right, column)));
        return ascending ? comparison : -comparison;
      });
    }
    if (this.ceiling !== null) data = data.slice(0, this.ceiling);
    return Promise.resolve({ data, error: null });
  }

  then<TResult1 = { data: QueryRow[]; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: QueryRow[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

class FakeClient implements NotificationSessionClient {
  readonly tables: Record<string, FakeRow[]>;
  readonly queriedTables: string[] = [];
  readonly selections: Array<{ table: string; columns: string }> = [];
  readonly insertBatches: Array<{ table: string; rows: FakeRow[] }> = [];
  readonly upserts: Array<{ table: string; row: FakeRow }> = [];

  constructor(tables: Record<string, FakeRow[]> = {}) {
    this.tables = tables;
  }

  from<QueryRow>(table: string): NotificationTable<QueryRow> {
    const source = (this.tables[table] ?? []) as unknown as QueryRow[];
    return {
      select: (columns) => {
        this.queriedTables.push(table);
        this.selections.push({ table, columns });
        return new FakeQuery(source);
      },
      insert: async (values) => {
        const batch = (Array.isArray(values) ? values : [values]) as FakeRow[];
        this.insertBatches.push({ table, rows: batch });
        this.tables[table] ??= [];
        this.tables[table].push(...batch);
        return { data: null, error: null };
      },
      upsert: async (value) => {
        const row = value as FakeRow;
        this.upserts.push({ table, row });
        this.tables[table] ??= [];
        const exists = this.tables[table].some((current) =>
          current.profile_id === row.profile_id && current.event_key === row.event_key);
        if (!exists) this.tables[table].push(row);
        return { data: null, error: null };
      },
    };
  }
}

function allSourceTables(): Record<string, FakeRow[]> {
  const authorId = uuid(112);
  const threadId = uuid(207);
  const planId = uuid(203);
  const scheduledRunId = uuid(212);
  const forcePullRunId = uuid(204);
  return {
    clients: [{ id: CLIENT_ID, consumer_profile_id: PROFILE_ID, status: "active" }],
    outcome_notifications: [{
      id: uuid(201),
      recipient_profile_id: PROFILE_ID,
      kind: "crs_alert",
      delivered_at: "2026-08-24T11:31:00.000Z",
      created_at: "2026-08-24T11:30:00.000Z",
      read_at: null,
    }],
    stage_history: [{
      id: uuid(202), client_id: CLIENT_ID, to_stage: "ready",
      changed_at: "2026-08-24T11:00:00.000Z",
    }],
    plans: [{
      id: planId, client_id: CLIENT_ID, analysis_run_id: scheduledRunId, version: 1,
      created_at: "2026-08-24T10:30:00.000Z",
    }, {
      id: uuid(213), client_id: CLIENT_ID, analysis_run_id: forcePullRunId, version: 3,
      created_at: "2026-08-24T10:05:00.000Z",
    }],
    analysis_runs: [
      {
        id: scheduledRunId, client_id: CLIENT_ID, trigger: "scheduled",
        ran_at: "2026-08-24T10:29:00.000Z",
      },
      {
        id: forcePullRunId, client_id: CLIENT_ID, trigger: "force_pull",
        ran_at: "2026-08-24T10:00:00.000Z",
      },
    ],
    enrollment_milestones: [{
      client_id: CLIENT_ID, kind: "agreement_signed",
      completed_at: "2026-08-24T09:30:00.000Z",
    }],
    consents: [{
      id: uuid(205), client_id: CLIENT_ID, kind: "analysis", action: "granted",
      signed_at: "2026-08-24T09:00:00.000Z",
    }],
    document_uploads: [{
      id: uuid(206), client_id: CLIENT_ID, kind: "company", section: "bank_statements",
      lifecycle: "stored", purged_at: null, created_at: "2026-08-24T08:30:00.000Z",
    }],
    support_threads: [{ id: threadId, client_id: CLIENT_ID, kind: "team_chat" }],
    support_messages: [
      {
        id: uuid(208), thread_id: threadId, author_profile_id: authorId, author_kind: "operator",
        body: `<p>${"A".repeat(85)}</p>`, sent_at: "2026-08-24T08:00:00.000Z",
      },
      {
        id: uuid(209), thread_id: threadId, author_profile_id: PROFILE_ID, author_kind: "consumer",
        body: "This is the consumer's own message.", sent_at: "2026-08-24T08:05:00.000Z",
      },
    ],
    support_thread_reads: [{
      thread_id: threadId, profile_id: PROFILE_ID, last_read_at: "2026-08-24T08:15:00.000Z",
    }],
    profiles: [{ id: authorId, full_name: "Morgan Lee" }],
    applications: [{
      id: uuid(210), client_id: CLIENT_ID, bank_ref: "example-community-bank",
      created_at: "2026-08-24T07:30:00.000Z",
    }],
    outcomes: [{
      id: uuid(211), client_id: CLIENT_ID, bank_ref: "example-community-bank",
      created_at: "2026-08-24T07:00:00.000Z",
    }],
    consumer_notification_reads: [{
      profile_id: PROFILE_ID,
      event_key: `analysis_complete:${planId}`,
      read_at: "2026-08-24T10:45:00.000Z",
    }],
  };
}

describe("consumer notification feed", () => {
  it("derives every contracted event type and merges both read-state sources", async () => {
    const db = new FakeClient(allSourceTables());
    const feed = await readNotificationFeedWith(session(), db, {
      ancillary: true,
      analysis: true,
      applications: true,
      enrollment: true,
      support: true,
      tracker: true,
    }, NOW);

    assert.deepEqual(
      [...new Set(feed.notifications.map((item) => item.type))].sort(),
      [
        "analysis_complete", "application_update", "document", "enrollment_milestone",
        "monitoring_alert", "refresh_result", "stage_change", "team_message",
      ],
    );
    assert.equal(feed.notifications.length, 10);
    assert.equal(feed.unreadCount, 8);
    assert.equal(feed.windowDays, 90);
    assert.equal(feed.capped, false);
    assert.deepEqual(feed.sources, [
      "monitoring_alert",
      "stage_change",
      "analysis_complete",
      "refresh_result",
      "enrollment_milestone",
      "document",
      "team_message",
      "application_update",
    ]);
    assert.deepEqual(
      feed.notifications.map((item) => item.occurredAt),
      [...feed.notifications.map((item) => item.occurredAt)].sort().reverse(),
    );

    const plan = feed.notifications.find((item) => item.type === "analysis_complete");
    assert.equal(plan?.readAt, "2026-08-24T10:45:00.000Z");
    assert.equal(plan?.target, "plan");
    assert.equal(plan?.title, "Your funding plan was updated");
    assert.equal(
      plan?.detail,
      "Your plan's next steps were recalculated from the Aug 24 snapshot.",
    );
    const refreshes = feed.notifications.filter((item) => item.type === "refresh_result");
    assert.equal(refreshes.length, 1);
    assert.equal(refreshes[0]?.id, `refresh_result:${uuid(204)}`);
    assert.equal(refreshes[0]?.target, "plan");
    assert.equal(refreshes[0]?.title, "Your credit refresh is complete");
    assert.equal(
      refreshes[0]?.detail,
      "Your plan and next steps were updated from the new snapshot.",
    );
    assert.equal(
      feed.notifications.some((item) => item.id === `analysis_complete:${uuid(213)}`),
      false,
    );
    const message = feed.notifications.find((item) => item.type === "team_message");
    assert.equal(message?.readAt, "2026-08-24T08:15:00.000Z");
    assert.equal(message?.title, "New message from Morgan Lee");
    assert.equal(message?.detail, "Open Team Chat to read it.");
    assert.doesNotMatch(message?.detail ?? "", /A{10}/);
    assert.doesNotMatch(
      db.selections.find((selection) => selection.table === "support_messages")?.columns ?? "",
      /body/,
    );
    assert.equal(feed.notifications.some((item) => item.id.endsWith(uuid(209))), false);

    assert.equal(
      feed.notifications.find((item) => item.type === "stage_change")?.title,
      "Your stage moved to Ready",
    );
    assert.equal(
      feed.notifications.find((item) => item.id.endsWith(":application"))?.title,
      "An application to Example Community Bank was recorded",
    );
    assert.equal(
      feed.notifications.find((item) => item.id.endsWith(":outcome"))?.title,
      "There's an update on your Example Community Bank application",
    );
    assert.equal(
      feed.notifications
        .filter((item) => item.type === "enrollment_milestone")
        .every((item) => item.target === "documents"),
      true,
    );
  });

  it("queries a source only when that source's feature flag is on", async () => {
    const db = new FakeClient(allSourceTables());
    const feed = await readNotificationFeedWith(session(), db, { ...OFF, ancillary: true }, NOW);

    assert.deepEqual(feed.notifications.map((item) => item.type), ["monitoring_alert", "document"]);
    assert.deepEqual(feed.sources, ["monitoring_alert", "document"]);
    for (const table of [
      "stage_history", "plans", "analysis_runs", "enrollment_milestones", "consents",
      "support_threads", "support_messages", "applications", "outcomes",
    ]) {
      assert.equal(db.queriedTables.includes(table), false, `${table} was read with its flag off`);
    }
  });

  it("does not query or surface event categories the consumer disabled in-app", async () => {
    const tables = allSourceTables();
    tables.consumer_notification_preferences = [
      { profile_id: PROFILE_ID, event_type: "monitoring_alert", in_app_enabled: false },
      { profile_id: PROFILE_ID, event_type: "analysis_complete", in_app_enabled: false },
      { profile_id: PROFILE_ID, event_type: "stage_change", in_app_enabled: false },
    ];
    const db = new FakeClient(tables);
    const feed = await readNotificationFeedWith(session(), db, {
      ancillary: true,
      analysis: true,
      applications: true,
      enrollment: true,
      support: true,
      tracker: true,
    }, NOW);

    assert.equal(feed.notifications.some((item) => item.type === "monitoring_alert"), false);
    assert.equal(feed.notifications.some((item) => item.type === "analysis_complete"), false);
    assert.equal(feed.notifications.some((item) => item.type === "stage_change"), false);
    assert.equal(feed.notifications.some((item) => item.type === "refresh_result"), true);
    assert.equal(db.queriedTables.includes("stage_history"), false);
    assert.deepEqual(feed.sources, [
      "refresh_result",
      "enrollment_milestone",
      "document",
      "team_message",
      "application_update",
    ]);
  });

  it("labels only the consumer's earliest plan as their completed analysis", async () => {
    const planId = uuid(901);
    const db = new FakeClient({
      clients: [{ id: CLIENT_ID, consumer_profile_id: PROFILE_ID, status: "active" }],
      analysis_runs: [],
      plans: [{
        id: planId,
        client_id: CLIENT_ID,
        analysis_run_id: uuid(902),
        created_at: "2026-08-24T10:00:00.000Z",
      }],
      consumer_notification_reads: [],
    });

    const feed = await readNotificationFeedWith(session(), db, { ...OFF, analysis: true }, NOW);

    assert.equal(feed.notifications[0]?.title, "Your analysis is complete");
    assert.deepEqual(feed.sources, ["analysis_complete", "refresh_result"]);
  });

  it("keeps only the newest two hundred events inside the ninety-day window", async () => {
    const stages = Array.from({ length: 205 }, (_unused, index) => ({
      id: uuid(1000 + index),
      client_id: CLIENT_ID,
      to_stage: "optimization",
      changed_at: new Date(NOW.getTime() - index * 1000).toISOString(),
    }));
    stages.push({
      id: uuid(5000),
      client_id: CLIENT_ID,
      to_stage: "optimization",
      changed_at: "2026-05-01T00:00:00.000Z",
    });
    const db = new FakeClient({
      clients: [{ id: CLIENT_ID, consumer_profile_id: PROFILE_ID, status: "active" }],
      stage_history: stages,
      plans: [],
      analysis_runs: [],
      consumer_notification_reads: [],
    });

    const feed = await readNotificationFeedWith(session(), db, { ...OFF, tracker: true }, NOW);

    assert.equal(feed.notifications.length, 200);
    assert.equal(feed.capped, true);
    assert.deepEqual(feed.sources, ["stage_change"]);
    assert.equal(feed.notifications[0]?.id, `stage_change:${uuid(1000)}`);
    assert.equal(feed.notifications.some((item) => item.id.endsWith(uuid(5000))), false);
  });

  it("does not report a bound when exactly two hundred events are eligible", async () => {
    const stages = Array.from({ length: 200 }, (_unused, index) => ({
      id: uuid(6000 + index),
      client_id: CLIENT_ID,
      to_stage: "optimization",
      changed_at: new Date(NOW.getTime() - index * 1000).toISOString(),
    }));
    const db = new FakeClient({
      clients: [{ id: CLIENT_ID, consumer_profile_id: PROFILE_ID, status: "active" }],
      stage_history: stages,
      consumer_notification_reads: [],
    });

    const feed = await readNotificationFeedWith(session(), db, { ...OFF, tracker: true }, NOW);

    assert.equal(feed.notifications.length, 200);
    assert.equal(feed.capped, false);
  });

  it("returns same-day events individually for client-side bundling", async () => {
    const documents = [uuid(7001), uuid(7002), uuid(7003)].map((id) => ({
      id,
      client_id: CLIENT_ID,
      kind: "company",
      section: "bank_statements",
      purged_at: null,
      created_at: "2026-08-24T09:00:00.000Z",
    }));
    const db = new FakeClient({
      clients: [{ id: CLIENT_ID, consumer_profile_id: PROFILE_ID, status: "active" }],
      outcome_notifications: [],
      document_uploads: documents,
      consumer_notification_reads: [],
    });

    const feed = await readNotificationFeedWith(session(), db, { ...OFF, ancillary: true }, NOW);

    assert.deepEqual(
      feed.notifications.map((item) => item.id),
      documents.map((item) => `document:${item.id}`),
    );
  });

  it("does not synthesize enrollment events from IDV session timestamps", async () => {
    const db = new FakeClient({
      clients: [{ id: CLIENT_ID, consumer_profile_id: PROFILE_ID, status: "active" }],
      enrollment_milestones: [],
      consents: [],
      idv_sessions: [{
        id: uuid(8001), client_id: CLIENT_ID, status: "passed",
        updated_at: "2026-08-24T09:00:00.000Z",
      }],
      consumer_notification_reads: [],
    });

    const feed = await readNotificationFeedWith(session(), db, { ...OFF, enrollment: true }, NOW);

    assert.deepEqual(feed.notifications, []);
    assert.deepEqual(feed.sources, ["enrollment_milestone"]);
    assert.equal(db.queriedTables.includes("idv_sessions"), false);
  });

  it("returns enabled event classes even when the consumer has no current rows", async () => {
    const db = new FakeClient({ clients: [] });

    const feed = await readNotificationFeedWith(session(), db, {
      ...OFF,
      analysis: true,
      applications: true,
      support: true,
    }, NOW);

    assert.deepEqual(feed.notifications, []);
    assert.deepEqual(feed.sources, [
      "analysis_complete",
      "refresh_result",
      "team_message",
      "application_update",
    ]);
    assert.deepEqual(db.queriedTables, ["consumer_notification_preferences", "clients"]);
  });

  it("refuses a non-consumer before touching the session client", async () => {
    const db = new FakeClient();
    await assert.rejects(
      () => readNotificationFeedWith(session({ role: "operator_member" }), db, OFF, NOW),
      (error: unknown) => error instanceof NotificationFeedError && error.code === "forbidden",
    );
    assert.deepEqual(db.queriedTables, []);
  });
});

describe("consumer notification read writes", () => {
  it("verifies the key in the current feed and appends one profile receipt", async () => {
    const stageId = uuid(301);
    const db = new FakeClient({
      clients: [{ id: CLIENT_ID, consumer_profile_id: PROFILE_ID, status: "active" }],
      stage_history: [{
        id: stageId, client_id: CLIENT_ID, to_stage: "ready",
        changed_at: "2026-08-24T10:00:00.000Z",
      }],
      plans: [], analysis_runs: [], consumer_notification_reads: [],
    });
    const key = `stage_change:${stageId}`;
    const notification = await markNotificationReadWith(session(), key, {
      db, flags: { ...OFF, tracker: true }, now: NOW,
      async stampMonitoringRead() { throw new Error("unexpected monitoring write"); },
    });

    assert.equal(notification?.id, key);
    assert.equal(notification?.readAt, NOW.toISOString());
    assert.deepEqual(db.upserts, [{
      table: "consumer_notification_reads",
      row: { profile_id: PROFILE_ID, event_key: key, read_at: NOW.toISOString() },
    }]);

    const missing = await markNotificationReadWith(session(), `stage_change:${uuid(399)}`, {
      db, flags: { ...OFF, tracker: true }, now: NOW,
      async stampMonitoringRead() { throw new Error("unexpected monitoring write"); },
    });
    assert.equal(missing, null);
    assert.equal(db.upserts.length, 1);
  });

  it("also stamps the existing outcome notification for a monitoring alert", async () => {
    const sourceId = uuid(401);
    const db = new FakeClient({
      clients: [{ id: CLIENT_ID, consumer_profile_id: PROFILE_ID, status: "active" }],
      outcome_notifications: [{
        id: sourceId, recipient_profile_id: PROFILE_ID, kind: "crs_alert",
        delivered_at: "2026-08-24T10:01:00.000Z", created_at: "2026-08-24T10:00:00.000Z",
        read_at: null,
      }],
      document_uploads: [], consumer_notification_reads: [],
    });
    const stamps: Array<[string, string]> = [];

    await markNotificationReadWith(session(), `monitoring_alert:${sourceId}`, {
      db, flags: { ...OFF, ancillary: true }, now: NOW,
      async stampMonitoringRead(notificationId, profileId) {
        stamps.push([notificationId, profileId]);
      },
    });

    assert.deepEqual(stamps, [[sourceId, PROFILE_ID]]);
    assert.equal(db.upserts.length, 1);
  });

  it("marks every unread key with one bulk insert", async () => {
    const firstId = uuid(501);
    const secondId = uuid(502);
    const db = new FakeClient({
      clients: [{ id: CLIENT_ID, consumer_profile_id: PROFILE_ID, status: "active" }],
      stage_history: [
        { id: firstId, client_id: CLIENT_ID, to_stage: "ready", changed_at: "2026-08-24T10:00:00.000Z" },
        { id: secondId, client_id: CLIENT_ID, to_stage: "applying", changed_at: "2026-08-24T09:00:00.000Z" },
      ],
      plans: [], analysis_runs: [],
      consumer_notification_reads: [{
        profile_id: PROFILE_ID,
        event_key: `stage_change:${firstId}`,
        read_at: "2026-08-24T10:30:00.000Z",
      }],
    });

    const updated = await markAllNotificationsReadWith(session(), {
      db, flags: { ...OFF, tracker: true }, now: NOW,
    });

    assert.equal(updated, 1);
    assert.equal(db.insertBatches.length, 1);
    assert.deepEqual(db.insertBatches[0], {
      table: "consumer_notification_reads",
      rows: [{
        profile_id: PROFILE_ID,
        event_key: `stage_change:${secondId}`,
        read_at: NOW.toISOString(),
      }],
    });
  });
});
