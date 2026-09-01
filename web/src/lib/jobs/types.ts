export const JOB_HANDLER_STATUSES = ["ok", "skipped", "failed"] as const;

export type JobHandlerResult = {
  status: (typeof JOB_HANDLER_STATUSES)[number];
  rows?: number;
  /**
   * G-KB-01: the handler's own domain code for a `failed` result, carried
   * through to the drain log and the tick body. The drainer's `errorCode` on
   * `background_jobs` stays the closed set (`handler_failed`, `handler_threw`,
   * …) because a database column with a per-domain vocabulary is not a set
   * anyone can query; this is the free-text half that says *why*, and a
   * `vault.reimport_kb` that answers `KB_SOURCE_SHAPE_UNVERIFIED` on three
   * consecutive attempts is a configuration defect, not a flaky import.
   *
   * **It must be a closed domain constant, never interpolated data.** The value
   * reaches a Vercel runtime log and the tick's response body, and the drainer
   * deliberately refuses to carry a thrown error's message for exactly that
   * reason — a handler that wants to be diagnosable returns a code here rather
   * than throwing something descriptive.
   */
  code?: string;
};

export type JobHandler = (
  subject: string,
  window: string,
) => Promise<JobHandlerResult>;

export type JobTuple = {
  job: JobName;
  subject: string;
  window: string;
};

export type JobCadence = "on-demand" | "daily" | "nightly" | "weekly" | "monthly";

export type JobName =
  | "crs.alert_batch"
  | "analysis.schedule_due"
  | "analysis.run"
  | "billing.accruals"
  | "outcomes.refresh_stats"
  | "vault.sync_banks"
  | "vault.reimport_kb"
  | "purge.derived"
  | "purge.uploaded_reports"
  | "notifications.dispatch"
  | "tenancy.trial_expiry"
  | "kpi.rollup";

export type CadenceProvider = (now: Date) => Promise<readonly JobTuple[]>;

export type BackgroundJob = JobTuple & {
  attemptCount: number;
  id: string;
  status: "queued" | "running" | "succeeded" | "skipped" | "failed";
};

export interface JobsRepository {
  claim(input: { allowedJobs: readonly JobName[]; leaseSeconds: number; maxJobs: number; workerId: string }): Promise<readonly BackgroundJob[]>;
  /** Targeted lease for run-now (migration 232): the one queued row with this id, retry backoff ignored; empty when it is not queued. */
  claimOne(input: { allowedJobs: readonly JobName[]; jobId: string; leaseSeconds: number; workerId: string }): Promise<readonly BackgroundJob[]>;
  complete(input: { jobId: string; rows: number; status: "succeeded" | "skipped"; workerId: string }): Promise<void>;
  enqueue(tuple: JobTuple): Promise<BackgroundJob>;
  fail(input: { errorCode: string; jobId: string; retry: boolean; retryAfterSeconds: number; workerId: string }): Promise<void>;
  renew(input: { jobId: string; leaseSeconds: number; workerId: string }): Promise<{ attemptCount: number | null; renewed: boolean }>;
}
