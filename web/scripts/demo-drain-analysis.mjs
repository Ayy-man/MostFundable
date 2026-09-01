#!/usr/bin/env node
// scripts/demo-drain-analysis.mjs — run the analysis worker once against the local stack.
//
// Why this exists. A browser enrollment on Arm A of MILESTONE2-DEMO.md ends with the client in
// Optimization and ONE `analysis.run` job queued (Phase 5 `onEnrollmentSucceeded`, bridged into
// `background_jobs` by migration 111). Nothing in a bare `next start` drains that queue: on the deployed
// stack the worker is reached by the daily cron tick (`GET /api/revenue/jobs/tick`, Vercel cron in
// `web/vercel.json`) or by the credit vendor's file-ready callback (`POST /api/webhooks/crs` → analysis
// fan-out), and the mock credit-data driver never calls back. So without this step beat 4's "the analysis
// you started two minutes ago finished" is not true on the local arm — the job sits `queued` and the
// consumer's Today view keeps showing no plan. Found walking the script cold on 2026-08-17 (GAPS G-3B-10).
//
// What it does: the same in-process drain `verify-tracker-live.mjs` performs (`drainAnalysisQueue`
// under the ts-resolve hook, local Supabase values from `supabase status -o env`, mock drivers), then a
// one-line report per client touched. It writes only what the worker writes (`analysis_runs`, `plans`,
// job state, tracker receipts) and prints no key material.
//
// Usage, from web/:  npm run demo:drain-analysis        (or: node scripts/demo-drain-analysis.mjs)
// Optional:          MAX_JOBS=5 (default 5)

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

function readStackEnv() {
  const status = spawnSync("supabase", ["status", "-o", "env"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  if (status.status !== 0) {
    console.error(
      "demo:drain-analysis: `supabase status -o env` failed — start the local stack with `supabase start` first.",
    );
    process.exit(1);
  }
  const values = {};
  for (const line of status.stdout.split("\n")) {
    const match = /^([A-Z0-9_]+)="?(.*?)"?$/.exec(line.trim());
    if (match) values[match[1]] = match[2];
  }
  for (const key of ["API_URL", "ANON_KEY", "SERVICE_ROLE_KEY"]) {
    if (!values[key]) {
      console.error(`demo:drain-analysis: \`supabase status -o env\` did not report ${key}.`);
      process.exit(1);
    }
  }
  return values;
}

const stack = readStackEnv();
process.env.FEATURE_ANALYSIS = "1";
process.env.FEATURE_TRACKER = "1";
process.env.NEXT_PUBLIC_SUPABASE_URL = stack.API_URL;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = stack.ANON_KEY;
process.env.SUPABASE_SERVICE_ROLE_KEY = stack.SERVICE_ROLE_KEY;

await import("./ts-resolve-hook.mjs");
const { drainAnalysisQueue } = await import("@/lib/analysis/worker");

const maxJobs = Number.parseInt(process.env.MAX_JOBS ?? "5", 10) || 5;
const result = await drainAnalysisQueue({ maxJobs, workerId: randomUUID() });
console.log(
  `demo:drain-analysis: claimed=${result.claimed} succeeded=${result.succeeded} failed=${result.failed}` +
    (result.claimed === 0 ? " (nothing queued — enroll a consumer first, or the job already ran)" : ""),
);
if (result.failed > 0) {
  console.error(
    "demo:drain-analysis: a job failed — inspect `select client_id, status, error_code from public.analysis_jobs`.",
  );
  process.exit(1);
}
