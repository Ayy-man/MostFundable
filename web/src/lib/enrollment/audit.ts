// Database triggers own every transition represented by a row. This pure
// module describes only events with no row of their own, such as a request
// rejected before persistence or an event that resolves to no subject. This
// split prevents double-writing. Metadata is limited to state names, versions,
// counts, timestamps and the selected driver; payment details and bureau
// content never enter it. D-45 also forbids stronger UI logging claims while
// coverage is still being introduced.
export const AUDIT_ACTIONS = [
  "consent.create",
  "consent.revoke",
  "enrollment.create",
  "enrollment.idv_started",
  "enrollment.idv_retry",
  "enrollment.idv_quiz",
  "enrollment.idv_pass",
  "enrollment.idv_locked",
  "enrollment.park",
  "enrollment.activate",
  "enrollment.cancel",
  "billing.setup_intent_recorded",
  "billing.subscription_started",
  "billing.subscription_cancelled",
  "milestone.complete",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];
export type AuditSubject =
  | `enrollment:${string}`
  | `client:${string}`
  | `consent:${string}`;

export type RowlessAuditEntry = {
  actor: string;
  action: AuditAction;
  subject: AuditSubject;
  meta: Readonly<Record<string, string | number | boolean | null>>;
};

export function enrollmentSubject(id: string): `enrollment:${string}` {
  return `enrollment:${id}`;
}

export function clientSubject(id: string): `client:${string}` {
  return `client:${id}`;
}

export function consentSubject(id: string): `consent:${string}` {
  return `consent:${id}`;
}

export function rowlessAuditEntry(
  actor: string,
  action: AuditAction,
  subject: AuditSubject,
  meta: RowlessAuditEntry["meta"] = {},
): RowlessAuditEntry {
  return { actor, action, subject, meta };
}
