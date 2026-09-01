import "server-only";
import { randomUUID } from "node:crypto";

export type AncillaryNotificationKind = "outcome_review_approved" | "crs_alert";
export interface AncillaryNotification { id: string; clientId: string; sourceId: string; kind: AncillaryNotificationKind; createdAt: string; deliveredAt: string; readAt: string | null }
export type NotificationDispatchEnvelope =
  | { channel: "in_app"; deliveryId: string; subject: string; window: string }
  | { channel: "email"; deliveryId: string; subject: string; window: string; orgId: string; billingEventId: string; template: "operator_card_failure" };
export interface NotificationRepository {
  insertCrsAlert(
    monitoringEventId: string,
  ): Promise<{ notificationId: string; inserted: boolean } | null>;
  listDelivered(recipientId: string): Promise<AncillaryNotification[]>;
  getClientId(notificationId: string): Promise<string | null>;
  markRead(notificationId: string, recipientId: string): Promise<AncillaryNotification>;
  readDispatchEnvelope(subject: string, window: string): Promise<NotificationDispatchEnvelope | null>;
  dispatch(subject: string, window: string): Promise<{ status: "ok" | "skipped" | "failed"; rows?: number }>;
}
interface Result<T> { data: T | null; error: unknown }
interface Query<T> extends PromiseLike<Result<T[]>> {
  eq(column: string, value: unknown): Query<T>; not(column: string, operator: string, value: unknown): Query<T>;
  in(column: string, values: readonly unknown[]): Query<T>; order(column: string, options: { ascending: boolean }): Query<T>;
  maybeSingle(): PromiseLike<Result<T | null>>;
}
export interface NotificationDb { rpc(name: string, args: Record<string, unknown>): PromiseLike<Result<unknown>>; from<T>(table: string): {
  select(columns: string): Query<T>;
  update(values: Record<string, unknown>): { eq(column: string, value: unknown): { eq(column: string, value: unknown): { select(columns: string): Query<T> } } };
} }
interface Row { id: string; client_id: string; outcome_id: string | null; monitoring_event_id: string | null; kind: string; created_at: string; delivered_at: string | null; read_at: string | null }
interface DispatchRow { id: string; channel: string; dispatch_subject: string; dispatch_window: string; org_id: string | null; billing_event_id: string | null; email_template: string | null; status: string }
const COLUMNS = "id,client_id,outcome_id,monitoring_event_id,kind,created_at,delivered_at,read_at";
const DISPATCH_COLUMNS = "id,channel,dispatch_subject,dispatch_window,org_id,billing_event_id,email_template,status";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function map(value: unknown): AncillaryNotification {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("NOTIFICATION_RESULT_INVALID");
  const row = value as Row;
  const sourceId = row.kind === "crs_alert" ? row.monitoring_event_id : row.kind === "outcome_review_approved" ? row.outcome_id : null;
  if (!row.id || !row.client_id || !sourceId || !row.created_at || !row.delivered_at || (row.kind !== "crs_alert" && row.kind !== "outcome_review_approved")) throw new Error("NOTIFICATION_RESULT_INVALID");
  return { id: row.id, clientId: row.client_id, sourceId, kind: row.kind, createdAt: row.created_at, deliveredAt: row.delivered_at, readAt: row.read_at };
}
function mapDispatch(row: DispatchRow): NotificationDispatchEnvelope {
  if (!UUID.test(row.id) || row.status !== "queued") throw new Error("NOTIFICATION_RESULT_INVALID");
  if (
    row.channel === "in_app"
    && /^client:[0-9a-f-]{36}$/i.test(row.dispatch_subject)
    && /^notification:[0-9a-f-]{36}$/i.test(row.dispatch_window)
    && row.org_id === null
    && row.billing_event_id === null
    && row.email_template === null
  ) return { channel: "in_app", deliveryId: row.id, subject: row.dispatch_subject, window: row.dispatch_window };
  if (
    row.channel === "email"
    && row.org_id !== null
    && row.billing_event_id !== null
    && UUID.test(row.org_id)
    && UUID.test(row.billing_event_id)
    && row.dispatch_subject === `org:${row.org_id}`
    && row.dispatch_window === `billing-event:${row.billing_event_id}`
    && row.email_template === "operator_card_failure"
  ) return { channel: "email", deliveryId: row.id, subject: row.dispatch_subject, window: row.dispatch_window, orgId: row.org_id, billingEventId: row.billing_event_id, template: row.email_template };
  throw new Error("NOTIFICATION_RESULT_INVALID");
}
async function db(): Promise<NotificationDb> { const { createAdminClient } = await import("@/lib/supabase/admin"); return createAdminClient() as unknown as NotificationDb; }
export function createNotificationRepository(injected?: NotificationDb): NotificationRepository {
  const client = async () => injected ?? await db();
  return {
    async insertCrsAlert(monitoringEventId) {
      const result = await (await client()).rpc("insert_crs_alert_notification", { p_monitoring_event_id: monitoringEventId });
      if (result.error || !Array.isArray(result.data) || result.data.length !== 1) throw new Error("NOTIFICATION_WRITE_FAILED");
      const row = result.data[0] as Record<string, unknown>;
      if (row.notification_id === null && row.inserted === false) return null;
      if (typeof row.notification_id !== "string" || typeof row.inserted !== "boolean") throw new Error("NOTIFICATION_RESULT_INVALID");
      return { notificationId: row.notification_id, inserted: row.inserted };
    },
    async listDelivered(recipientId) {
      const result = await (await client()).from<Row>("outcome_notifications").select(COLUMNS)
        .eq("recipient_profile_id", recipientId).not("delivered_at", "is", null)
        .in("kind", ["outcome_review_approved", "crs_alert"]).order("delivered_at", { ascending: false });
      if (result.error || !result.data) throw new Error("NOTIFICATION_READ_FAILED");
      return result.data.map(map);
    },
    async getClientId(notificationId) {
      const result = await (await client()).from<{ id: string; client_id: string }>("outcome_notifications").select("id,client_id").eq("id", notificationId);
      if (result.error || !result.data) throw new Error("NOTIFICATION_READ_FAILED");
      if (result.data.length === 0) return null;
      if (result.data.length !== 1) throw new Error("NOTIFICATION_RESULT_INVALID");
      return result.data[0].client_id;
    },
    async markRead(notificationId, recipientId) {
      const result = await (await client()).from<Row>("outcome_notifications").update({ read_at: new Date().toISOString() })
        .eq("id", notificationId).eq("recipient_profile_id", recipientId).select(COLUMNS);
      if (result.error || !result.data || result.data.length !== 1) throw new Error("NOTIFICATION_WRITE_FAILED");
      return map(result.data[0]);
    },
    async readDispatchEnvelope(subject, window) {
      const result = await (await client()).from<DispatchRow>("notification_delivery_dispatch_view")
        .select(DISPATCH_COLUMNS).eq("dispatch_subject", subject).eq("dispatch_window", window).maybeSingle();
      if (result.error) throw new Error("NOTIFICATION_READ_FAILED");
      if (result.data === null || result.data.status !== "queued") return null;
      return mapDispatch(result.data);
    },
    async dispatch(subject, window) {
      const result = await (await client()).rpc("dispatch_notification", { p_subject: subject, p_window: window, p_worker: randomUUID() });
      if (result.error || !Array.isArray(result.data) || result.data.length !== 1) return { status: "failed" };
      const row = result.data[0] as Record<string, unknown>;
      if ((row.status !== "ok" && row.status !== "skipped" && row.status !== "failed") || !Number.isInteger(row.rows)) return { status: "failed" };
      return { status: row.status, rows: row.rows as number };
    },
  };
}
