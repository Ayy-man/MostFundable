import type { TimelineKind } from "./types";

/** Audit rows are opt-in: an action absent from this map can never become an event. */
export const TIMELINE_AUDIT_ACTIONS = {
  "paid_refresh.transition": "refresh",
  "pull.blocked": "refresh_blocked",
  "support.thread_opened": "thread_opened",
  "support.thread_status_changed": "thread_status",
} as const satisfies Readonly<Record<string, TimelineKind>>;

export type TimelineAuditAction = keyof typeof TIMELINE_AUDIT_ACTIONS;

export function isTimelineAuditAction(value: string): value is TimelineAuditAction {
  return Object.prototype.hasOwnProperty.call(TIMELINE_AUDIT_ACTIONS, value);
}

export const DOCUMENT_TIMELINE_LABELS = {
  articles: { name: "Articles of organization", named: "articles of organization", section: "Company" },
  bank_statements: { name: "Bank statement", named: "a bank statement", section: "Financial" },
  ein: { name: "EIN confirmation", named: "an EIN confirmation", section: "Company" },
  other: { name: "Document", named: "a document", section: "Company" },
  tax_returns: { name: "Tax return", named: "a tax return", section: "Financial" },
} as const;

export const STAGE_TIMELINE_LABELS = {
  applying: "Applying",
  funded: "Funded",
  graduate: "Graduate",
  onboarding: "Onboarding",
  optimization: "Optimization",
  ready: "Ready",
} as const;
