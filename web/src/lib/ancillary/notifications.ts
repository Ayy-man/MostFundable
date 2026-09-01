import { featureFlag, type EnvSource } from "@/lib/env";
import { dispatchOperatorCardFailureEmail } from "@/lib/email/dispatch";
import { createNotificationRepository, type AncillaryNotification, type NotificationRepository } from "./notification-repository.ts";

import type { OperatorCardFailureDispatchEnvelope } from "@/lib/email/dispatch";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID_ONLY = new RegExp(`^${UUID}$`, "i");
const SUBJECT = new RegExp(`^client:${UUID}$`, "i");
const WINDOW = new RegExp(`^notification:${UUID}$`, "i");
const EMAIL_SUBJECT = new RegExp(`^org:${UUID}$`, "i");
const EMAIL_WINDOW = new RegExp(`^billing-event:${UUID}$`, "i");
export async function enqueueCrsAlertNotification(input: { clientId: string; monitoringEventId: string; eventType: string }, options: { env?: EnvSource; repository?: NotificationRepository } = {}): Promise<{ notificationId: string; inserted: boolean } | null> {
  if (!UUID_ONLY.test(input.clientId) || !UUID_ONLY.test(input.monitoringEventId)) throw new Error("NOTIFICATION_SOURCE_INVALID");
  if (!featureFlag("FEATURE_ANCILLARY", options.env ?? process.env) || input.eventType !== "ACCALERT") return null;
  return (options.repository ?? createNotificationRepository()).insertCrsAlert(input.monitoringEventId);
}
export function listNotifications(recipientId: string, repository: NotificationRepository = createNotificationRepository()): Promise<AncillaryNotification[]> {
  if (!UUID_ONLY.test(recipientId)) throw new Error("NOTIFICATION_RECIPIENT_INVALID"); return repository.listDelivered(recipientId);
}
export function markNotificationRead(notificationId: string, recipientId: string, repository: NotificationRepository = createNotificationRepository()): Promise<AncillaryNotification> {
  if (!UUID_ONLY.test(notificationId) || !UUID_ONLY.test(recipientId)) throw new Error("NOTIFICATION_SOURCE_INVALID"); return repository.markRead(notificationId, recipientId);
}
export async function runNotificationDispatch(
  subject: string,
  window: string,
  repository: NotificationRepository = createNotificationRepository(),
  dispatchEmail: (envelope: OperatorCardFailureDispatchEnvelope) => Promise<unknown> = dispatchOperatorCardFailureEmail,
): Promise<{ status: string; rows?: number }> {
  const valid = (SUBJECT.test(subject) && WINDOW.test(window))
    || (EMAIL_SUBJECT.test(subject) && EMAIL_WINDOW.test(window));
  if (!valid) return { status: "failed" };
  try {
    const envelope = await repository.readDispatchEnvelope(subject, window);
    if (envelope === null) return { status: "skipped", rows: 0 };
    if (envelope.channel === "email") await dispatchEmail(envelope);
    return await repository.dispatch(subject, window);
  } catch {
    return { status: "failed" };
  }
}
