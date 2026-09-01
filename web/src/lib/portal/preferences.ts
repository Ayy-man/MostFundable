export const PORTAL_APPLICATION_VISIBILITIES = ["details", "status-only"] as const;
export const NOTIFICATION_DIGEST_FREQUENCIES = ["daily", "weekly", "monthly"] as const;

export type PortalApplicationVisibility = (typeof PORTAL_APPLICATION_VISIBILITIES)[number];
export type NotificationDigestFrequency = (typeof NOTIFICATION_DIGEST_FREQUENCIES)[number];

export interface PortalPreferences {
  readonly allowDocumentUploads: boolean;
  readonly applicationVisibility: PortalApplicationVisibility;
  readonly showFundingProgress: boolean;
  readonly showTrainings: boolean;
}

export interface OperatorNotificationPreferences {
  readonly clientMessages: boolean;
  readonly digestEnabled: boolean;
  readonly digestFrequency: NotificationDigestFrequency;
  readonly emailHolds: boolean;
  readonly paymentFailed: boolean;
  readonly taskDue: boolean;
}

export interface WorkspacePreferences {
  readonly notifications: OperatorNotificationPreferences;
  readonly portal: PortalPreferences;
}

export const DEFAULT_WORKSPACE_PREFERENCES: WorkspacePreferences = Object.freeze({
  notifications: Object.freeze({
    clientMessages: false,
    digestEnabled: true,
    digestFrequency: "weekly",
    emailHolds: true,
    paymentFailed: true,
    taskDue: true,
  }),
  portal: Object.freeze({
    allowDocumentUploads: true,
    applicationVisibility: "details",
    showFundingProgress: true,
    showTrainings: true,
  }),
});

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function member<const T extends readonly string[]>(values: T, value: unknown): T[number] | null {
  return typeof value === "string" && values.some((candidate) => candidate === value)
    ? value as T[number]
    : null;
}

export function workspacePreferencesFromRow(value: unknown): WorkspacePreferences | null {
  const row = record(value);
  if (row === null) return null;
  const applicationVisibility = member(PORTAL_APPLICATION_VISIBILITIES, row.portal_application_visibility);
  const digestFrequency = member(NOTIFICATION_DIGEST_FREQUENCIES, row.notification_digest_frequency);
  const booleans = [
    row.portal_allow_document_uploads,
    row.portal_show_funding_progress,
    row.portal_show_trainings,
    row.notification_client_messages,
    row.notification_digest_enabled,
    row.notification_email_holds,
    row.notification_payment_failed,
    row.notification_task_due,
  ];
  if (applicationVisibility === null || digestFrequency === null || booleans.some((item) => typeof item !== "boolean")) {
    return null;
  }
  return Object.freeze({
    notifications: Object.freeze({
      clientMessages: row.notification_client_messages as boolean,
      digestEnabled: row.notification_digest_enabled as boolean,
      digestFrequency,
      emailHolds: row.notification_email_holds as boolean,
      paymentFailed: row.notification_payment_failed as boolean,
      taskDue: row.notification_task_due as boolean,
    }),
    portal: Object.freeze({
      allowDocumentUploads: row.portal_allow_document_uploads as boolean,
      applicationVisibility,
      showFundingProgress: row.portal_show_funding_progress as boolean,
      showTrainings: row.portal_show_trainings as boolean,
    }),
  });
}

export function workspacePreferencesFromResponse(value: unknown): WorkspacePreferences | null {
  const body = record(value);
  const preferences = record(body?.preferences);
  if (preferences === null) return null;
  const portal = record(preferences.portal);
  const notifications = record(preferences.notifications);
  if (portal === null || notifications === null) return null;
  return workspacePreferencesFromRow({
    notification_client_messages: notifications.clientMessages,
    notification_digest_enabled: notifications.digestEnabled,
    notification_digest_frequency: notifications.digestFrequency,
    notification_email_holds: notifications.emailHolds,
    notification_payment_failed: notifications.paymentFailed,
    notification_task_due: notifications.taskDue,
    portal_allow_document_uploads: portal.allowDocumentUploads,
    portal_application_visibility: portal.applicationVisibility,
    portal_show_funding_progress: portal.showFundingProgress,
    portal_show_trainings: portal.showTrainings,
  });
}

export type WorkspacePreferencePatch = Partial<{
  notification_client_messages: boolean;
  notification_digest_enabled: boolean;
  notification_digest_frequency: NotificationDigestFrequency;
  notification_email_holds: boolean;
  notification_payment_failed: boolean;
  notification_task_due: boolean;
  portal_allow_document_uploads: boolean;
  portal_application_visibility: PortalApplicationVisibility;
  portal_show_funding_progress: boolean;
  portal_show_trainings: boolean;
}>;

export async function readWorkspacePreferences(fetcher: typeof fetch = fetch): Promise<WorkspacePreferences | null> {
  try {
    const response = await fetcher("/api/portal/preferences", {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) return null;
    return workspacePreferencesFromResponse(await response.json());
  } catch {
    return null;
  }
}

export async function saveWorkspacePreferences(
  patch: WorkspacePreferencePatch,
  fetcher: typeof fetch = fetch,
): Promise<WorkspacePreferences | null> {
  try {
    const response = await fetcher("/api/org/settings", {
      body: JSON.stringify(patch),
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    });
    if (!response.ok) return null;
    const body = record(await response.json());
    return workspacePreferencesFromRow(body?.org);
  } catch {
    return null;
  }
}
