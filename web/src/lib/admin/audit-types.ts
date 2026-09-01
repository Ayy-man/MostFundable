/**
 * The deliberately narrow audit projection exposed to a platform admin.
 *
 * `audit_log.meta` can contain operational detail that does not belong in a
 * general-purpose list response, and actor email addresses are identifiers,
 * not display copy. Neither field is part of this contract, so adding either
 * requires an explicit endpoint and UI decision rather than an accidental
 * wider select.
 */
export type AdminAuditEvent = Readonly<{
  action: string;
  actorName: string | null;
  id: string;
  occurredAt: string;
  subjectId: string;
  subjectType: string;
}>;

export const ADMIN_AUDIT_DEFAULT_LIMIT = 100;
export const ADMIN_AUDIT_MAX_LIMIT = 100;

// PostgreSQL UUIDs include the zero-version seeded demo identities, so this
// intentionally validates the database shape rather than RFC version bits.
export const ADMIN_AUDIT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
