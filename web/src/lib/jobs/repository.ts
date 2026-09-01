import { createAdminClient } from "@/lib/supabase/admin";

import type { BackgroundJob, JobsRepository, JobTuple } from "./types.ts";

type RpcClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{
    data: unknown;
    error: { code?: string | null } | null;
  }>;
};

type Row = Record<string, unknown>;

function rows(value: unknown): Row[] {
  if (Array.isArray(value)) return value.filter((row): row is Row => !!row && typeof row === "object");
  return value && typeof value === "object" ? [value as Row] : [];
}

function parseJob(value: unknown): BackgroundJob {
  const row = rows(value)[0];
  if (!row || typeof row.id !== "string" || typeof row.job !== "string"
    || typeof row.subject !== "string" || typeof row.window !== "string"
    || typeof row.status !== "string" || !Number.isInteger(row.attempt_count)) {
    throw new Error("BACKGROUND_JOB_ROW_INVALID");
  }
  return {
    attemptCount: row.attempt_count as number,
    id: row.id,
    job: row.job as BackgroundJob["job"],
    status: row.status as BackgroundJob["status"],
    subject: row.subject,
    window: row.window,
  };
}

async function rpc(client: RpcClient, name: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error("BACKGROUND_JOB_DATABASE_ERROR");
  return data;
}

export function createJobsRepository(client: RpcClient): JobsRepository {
  return {
    async claim(input) {
      const data = await rpc(client, "claim_background_jobs", {
        p_allowed_jobs: input.allowedJobs,
        p_lease_seconds: input.leaseSeconds,
        p_max_jobs: input.maxJobs,
        p_worker_id: input.workerId,
      });
      return rows(data).map(parseJob);
    },
    async claimOne(input) {
      const data = await rpc(client, "claim_background_job", {
        p_allowed_jobs: input.allowedJobs,
        p_job_id: input.jobId,
        p_lease_seconds: input.leaseSeconds,
        p_worker_id: input.workerId,
      });
      return rows(data).map(parseJob);
    },
    async complete(input) {
      await rpc(client, "complete_background_job", {
        p_job_id: input.jobId,
        p_rows_processed: input.rows,
        p_status: input.status,
        p_worker_id: input.workerId,
      });
    },
    async enqueue(tuple: JobTuple) {
      return parseJob(await rpc(client, "enqueue_background_job", {
        p_job: tuple.job,
        p_subject: tuple.subject,
        p_window: tuple.window,
      }));
    },
    async fail(input) {
      await rpc(client, "fail_background_job", {
        p_error_code: input.errorCode,
        p_job_id: input.jobId,
        p_retry: input.retry,
        p_retry_after_seconds: input.retryAfterSeconds,
        p_worker_id: input.workerId,
      });
    },
    async renew(input) {
      const data = await rpc(client, "renew_background_job_lease", {
        p_job_id: input.jobId,
        p_lease_seconds: input.leaseSeconds,
        p_worker_id: input.workerId,
      });
      const value = rows(data)[0];
      return {
        attemptCount: typeof value?.attempt_count === "number" ? value.attempt_count : null,
        renewed: value?.renewed === true,
      };
    },
  };
}

export function productionJobsRepository(): JobsRepository {
  return createJobsRepository(createAdminClient() as unknown as RpcClient);
}
