import type { JobCadence, JobName, JobTuple } from "./types.ts";

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const DATE = "\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])";

export const JOB_DEFINITIONS = {
  "crs.alert_batch": { cadence: "nightly", subject: `org:<uuid> or global`, window: "YYYY-MM-DD" },
  "analysis.schedule_due": { cadence: "daily", subject: "global", window: "YYYY-MM-DD" },
  "analysis.run": { cadence: "on-demand", subject: "client:<uuid>", window: "run:<analysis_run_id>" },
  "billing.accruals": { cadence: "monthly", subject: "org:<uuid>", window: "YYYY-MM" },
  "outcomes.refresh_stats": { cadence: "on-demand", subject: "bank:<bank_ref> or global", window: "change:<outcome_id>" },
  "vault.sync_banks": { cadence: "nightly", subject: "global", window: "YYYY-MM-DD" },
  "vault.reimport_kb": { cadence: "weekly", subject: "global", window: "YYYY-Www" },
  "purge.derived": { cadence: "daily", subject: "enrollment:<uuid>", window: "YYYY-MM-DD" },
  "purge.uploaded_reports": { cadence: "daily", subject: "upload:<uuid>", window: "YYYY-MM-DD" },
  "notifications.dispatch": { cadence: "on-demand", subject: "client:<uuid>", window: "notification:<outcome_notification_id>" },
  "tenancy.trial_expiry": { cadence: "daily", subject: "global", window: "YYYY-MM-DD" },
  "kpi.rollup": { cadence: "daily", subject: "org:<uuid>, member:<uuid>, or platform", window: "YYYY-MM-DD" },
} as const satisfies Record<JobName, { cadence: JobCadence; subject: string; window: string }>;

export const JOB_NAMES = Object.freeze(Object.keys(JOB_DEFINITIONS) as JobName[]);

export function isJobName(value: string): value is JobName {
  return Object.hasOwn(JOB_DEFINITIONS, value);
}

function matches(pattern: string, value: string): boolean {
  return new RegExp(`^(?:${pattern})$`).test(value);
}

export const JOB_SUBJECT_PATTERNS: Readonly<Record<JobName, string>> = Object.freeze({
  "crs.alert_batch": `org:${UUID}|global`,
    "analysis.schedule_due": "global",
    "analysis.run": `client:${UUID}`,
    "billing.accruals": `org:${UUID}`,
    "outcomes.refresh_stats": "bank:[A-Za-z0-9_.:-]{1,120}|global",
    "vault.sync_banks": "global",
    "vault.reimport_kb": "global",
    "purge.derived": `enrollment:${UUID}`,
    "purge.uploaded_reports": `upload:${UUID}`,
    "notifications.dispatch": `client:${UUID}`,
    "tenancy.trial_expiry": "global",
  "kpi.rollup": `org:${UUID}|member:${UUID}|platform`,
});

export const JOB_WINDOW_PATTERNS: Readonly<Record<JobName, string>> = Object.freeze({
  "crs.alert_batch": DATE,
    "analysis.schedule_due": DATE,
    "analysis.run": `run:${UUID}`,
    "billing.accruals": "\\d{4}-(?:0[1-9]|1[0-2])",
    "outcomes.refresh_stats": `change:${UUID}`,
    "vault.sync_banks": DATE,
    "vault.reimport_kb": "\\d{4}-W(?:0[1-9]|[1-4]\\d|5[0-3])",
    "purge.derived": DATE,
    "purge.uploaded_reports": DATE,
    "notifications.dispatch": `notification:${UUID}`,
    "tenancy.trial_expiry": DATE,
  "kpi.rollup": DATE,
});

export function validateJobTuple(tuple: JobTuple): JobTuple {
  if (!isJobName(tuple.job)) throw new Error("JOB_NAME_INVALID");
  if (tuple.subject !== tuple.subject.trim() || tuple.window !== tuple.window.trim()) {
    throw new Error("JOB_TUPLE_INVALID");
  }
  if (!matches(JOB_SUBJECT_PATTERNS[tuple.job], tuple.subject)
    || !matches(JOB_WINDOW_PATTERNS[tuple.job], tuple.window)) {
    throw new Error("JOB_TUPLE_INVALID");
  }
  return tuple;
}

/**
 * R5C-02/R5C-03/R5D-01: the class, derived rather than listed.
 *
 * A job whose window pattern is a row identity cannot be given a fresh window the way a
 * dated cadence can — `enqueue_background_job`'s conflict-ignore hands the same tuple back
 * forever — so the tuple's three attempts become the whole life of the obligation. Membership
 * is read off the frozen window pattern itself: a window that carries a row UUID is a row-id
 * window. A new on-demand definition of that shape joins this set with no edit here, which is
 * what makes the class assertion in `scheduler.test.ts` catch it.
 */
export function isRowIdWindowJob(job: JobName): boolean {
  return JOB_WINDOW_PATTERNS[job].includes(UUID);
}

export const REDISCOVERY_MEMBER_JOBS: readonly JobName[] = Object.freeze(
  JOB_NAMES.filter((job) => JOB_DEFINITIONS[job].cadence === "on-demand" && isRowIdWindowJob(job)),
);
