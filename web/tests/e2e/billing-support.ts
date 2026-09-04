// billing-support.ts — the self-starting child server the two Phase 10 e2e suites share.
//
// The four suites that came before this one skip unless somebody has already
// run `npm run dev -- -p 3003` by hand, so on a normal `npm run test:e2e` they
// report SKIP and prove nothing. Phase 10's criterion 1 is "webhook-driven
// membership states observed over HTTP", which is worth nothing as a suite that
// only runs when a human remembers to start a server, so these two start their
// own child on a free port instead. The lifecycle below is the one
// `scripts/verify-tracker-live.mjs` already uses in this repo — `next start`
// against the existing build, a port probe rather than a fixed port, and a stop
// that confirms the PID still holds the port before it signals anything.
//
// Credentials: every value here is read from the environment or parsed out of
// `supabase status -o env` at run time, handed to the child through its `env`,
// and never written to a file, a log line or an assertion message. The child's
// environment is built from a whitelist rather than by spreading `process.env`,
// so no `STRIPE_*` value from the developer's shell can reach a server these
// suites expect to be credential-free.

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import { createServer } from "node:net";
import path from "node:path";

const WEB_ROOT = path.resolve(import.meta.dirname, "..", "..");
const REPO_ROOT = path.resolve(WEB_ROOT, "..");
const SERVER_READY_TIMEOUT_MS = 90_000;

export type StackEnv = {
  anonKey: string;
  apiUrl: string;
  serviceRoleKey: string;
};

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A blocking pause, used only between retries of a synchronous CLI call. The
 * timer version cannot help there: `resolveStackEnv()` is read at module scope
 * to compute a suite's `skip` value, which node:test needs before it will run
 * anything, so there is nowhere to await.
 */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Remove unrelated shell Stripe values before building the child whitelist. */
export function detachStripeKeys(): void {
  delete process.env.STRIPE_WEBHOOK_SECRET;
  delete process.env.STRIPE_SECRET_KEY;
}

let cachedStack: StackEnv | null | undefined;
let stackFailure = "";

/**
 * Why the CLI is retried rather than trusted once.
 *
 * `supabase status` shells out to Docker, and a single invocation can exit
 * non-zero while the stack is perfectly healthy — observed during the phase
 * gate, when a run immediately after `npm test` had both suites report
 * "no local Supabase stack" and skip, and the identical command run by hand a
 * moment later succeeded. A skip that lands for a transient reason is worse
 * than a failure, because it is green and it hides whatever the suite was
 * meant to catch. Three attempts with a short backoff, and whatever the last
 * attempt actually said is carried into the skip message instead of the
 * assumption that nothing is running.
 */
const STACK_ATTEMPTS = 3;
const STACK_RETRY_MS = 750;

/**
 * The reason the stack could not be resolved, phrased for a skip message. Only
 * meaningful after `resolveStackEnv()` has returned null; it names the exit
 * status and the first line of stderr so a transient Docker failure is
 * distinguishable from a stack nobody started.
 */
export function stackSkipReason(): string {
  return stackFailure === ""
    ? "no local Supabase stack — run `supabase start` from the repository root"
    : stackFailure;
}

/**
 * Prefer the environment, fall back to `supabase status -o env`.
 *
 * A worktree has no `.env.local`, so the CLI is the only source that works here
 * (docs/backend/LOCAL-STACK.md). Its output is parsed, never echoed, and the
 * failure path returns null so the caller can skip with a readable reason
 * rather than throwing a stack trace that might carry a fragment of it.
 */
export function resolveStackEnv(): StackEnv | null {
  if (cachedStack !== undefined) return cachedStack;

  const fromEnv = {
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    apiUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  if (fromEnv.anonKey && fromEnv.apiUrl && fromEnv.serviceRoleKey) {
    cachedStack = fromEnv as StackEnv;
    return cachedStack;
  }

  for (let attempt = 1; attempt <= STACK_ATTEMPTS; attempt += 1) {
    const status = spawnSync("supabase", ["status", "-o", "env"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    });

    if (status.status === 0) {
      const values: Record<string, string> = {};
      for (const line of (status.stdout ?? "").split("\n")) {
        const match = /^([A-Z0-9_]+)="?(.*?)"?$/.exec(line.trim());
        if (match?.[1] && match[2]) values[match[1]] = match[2];
      }

      if (values.API_URL && values.ANON_KEY && values.SERVICE_ROLE_KEY) {
        cachedStack = {
          anonKey: values.ANON_KEY,
          apiUrl: values.API_URL,
          serviceRoleKey: values.SERVICE_ROLE_KEY,
        };
        return cachedStack;
      }

      // Exit 0 with a key missing is a different fault from a failed call, and
      // it is the one case where retrying is pointless.
      stackFailure =
        "`supabase status -o env` succeeded but reported no API_URL/ANON_KEY/SERVICE_ROLE_KEY — is this the right project directory?";
      cachedStack = null;
      return cachedStack;
    }

    // Only the failure's shape is recorded. The command's stdout carries keys,
    // so stderr's first line is the most that may be quoted.
    const firstStderrLine = (status.stderr ?? "").split("\n")[0] ?? "";
    stackFailure = `\`supabase status -o env\` exited ${String(status.status)} on attempt ${String(attempt)} of ${String(STACK_ATTEMPTS)}${
      firstStderrLine === "" ? "" : ` (${firstStderrLine})`
    } — the stack may be down, or Docker may have been busy`;

    if (attempt < STACK_ATTEMPTS) sleepSync(STACK_RETRY_MS);
  }

  cachedStack = null;
  return cachedStack;
}

/**
 * The test process reads the database directly through `createAdminClient()`,
 * which resolves its URL and key from `process.env` at call time. Setting them
 * here mirrors `loadWorker()` in `scripts/verify-tracker-live.mjs`; the values
 * stay in this process's memory and reach no file.
 */
export function applyStackEnv(stack: StackEnv): void {
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.apiUrl;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = stack.anonKey;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;
}

function newestMtime(directory: string): number {
  let newest = 0;
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const { mtimeMs } = fs.statSync(full);
      if (mtimeMs > newest) newest = mtimeMs;
    }
  };
  walk(directory);
  return newest;
}

/**
 * `next start` serves whatever is in `.next`, silently, so a suite run against
 * a stale build asserts yesterday's behaviour and passes. Comparing the newest
 * source mtime against `BUILD_ID` turns that into a skip with an instruction
 * instead of a green run that means nothing.
 */
export function buildProblem(): string | null {
  const buildId = path.join(WEB_ROOT, ".next", "BUILD_ID");
  if (!fs.existsSync(buildId)) {
    return "no production build in web/.next — run `npm run build` first";
  }

  const built = fs.statSync(buildId).mtimeMs;
  if (newestMtime(path.join(WEB_ROOT, "src")) > built) {
    return "web/.next is older than web/src — run `npm run build` first";
  }

  return null;
}

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (address === null || typeof address === "string") {
        probe.close(() => reject(new Error("port probe returned no address")));
        return;
      }
      const { port } = address;
      probe.close(() => resolve(port));
    });
  });
}

/**
 * Signal the child only after confirming the PID still holds the port this run
 * handed out. PIDs are reused, and this stack is shared with other agents, so
 * "kill the PID we remember" is the one thing a suite here must never do. The
 * identity check is `lsof` rather than `ps`, because Next rewrites its own
 * process title and the `-p <port>` argument is gone by the time it is up.
 */
export function stopChild(pid: number | null, port: number | null): string {
  if (pid === null || port === null || !Number.isInteger(pid) || pid <= 1) {
    return "no child recorded";
  }

  const alive = spawnSync("ps", ["-p", String(pid), "-o", "command="], {
    encoding: "utf8",
  });
  if (alive.status !== 0 || !alive.stdout.trim()) {
    try {
      process.kill(pid, 0);
    } catch {
      return `pid ${pid} already gone`;
    }
  }

  const listening = spawnSync(
    "lsof",
    ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"],
    { encoding: "utf8" },
  );
  const owners = (listening.stdout ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (!owners.includes(String(pid))) {
    return `pid ${pid} no longer holds port ${port} — left alone`;
  }

  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      return `pid ${pid} could not be signalled`;
    }
  }
  return `pid ${pid} stopped`;
}

export type ChildServer = { baseUrl: string; pid: number; port: number };

/**
 * `next start` against the build already in `.next`, never `next dev`.
 *
 * `NEXT_PUBLIC_SUPABASE_URL` survives as a `process.env` read in the server
 * bundle rather than being inlined, so one credential-free build serves every
 * environment and neither suite has to rebuild to point the app at the local
 * stack.
 */
export async function startChildServer(input: {
  flags: Readonly<Record<string, string>>;
  port: number;
  stack: StackEnv;
  webhookSigningValue?: string;
}): Promise<ChildServer> {
  const logPath = process.env.MF_BILLING_E2E_LOG;
  const sink = fs.openSync(logPath ?? "/dev/null", "a");

  const child = spawn(
    path.join(WEB_ROOT, "node_modules/.bin/next"),
    ["start", "-p", String(input.port)],
    {
      cwd: WEB_ROOT,
      detached: true,
      // A whitelist, not a spread: this is what guarantees the child holds no
      // Stripe key regardless of the shell that launched the suite.
      env: {
        HOME: process.env.HOME ?? "",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: input.stack.anonKey,
        NEXT_PUBLIC_SUPABASE_URL: input.stack.apiUrl,
        NODE_ENV: "production",
        PATH: process.env.PATH ?? "",
        ...(input.webhookSigningValue
          ? { STRIPE_WEBHOOK_SECRET: input.webhookSigningValue }
          : {}),
        SUPABASE_SERVICE_ROLE_KEY: input.stack.serviceRoleKey,
        TMPDIR: process.env.TMPDIR ?? "/tmp",
        ...input.flags,
      },
      stdio: ["ignore", sink, sink],
    },
  );
  child.unref();

  // Next 16.3 canonicalizes `next start` request URLs to localhost. Use that
  // runtime origin here so test requests exercise the same-origin guard rather
  // than being rejected before they reach the route under test.
  const baseUrl = `http://localhost:${input.port}`;
  const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    // Any HTTP answer means the server is listening. Insisting on a 200 would
    // couple readiness to whichever feature flags this particular child holds.
    const up = await fetch(`${baseUrl}/api/enroll`).then(
      () => true,
      () => false,
    );
    if (up) return { baseUrl, pid: child.pid ?? -1, port: input.port };
    await delay(400);
  }

  stopChild(child.pid ?? null, input.port);
  throw new Error(
    `the child server did not answer on port ${input.port} within ${SERVER_READY_TIMEOUT_MS}ms`,
  );
}

/**
 * Poll until `read()` satisfies `matches`, then return the value.
 *
 * The `after()` callback finishes some unbounded time after the 200, so every
 * "did it land" assertion in these suites goes through here rather than through
 * a fixed sleep that is either flaky or slow. The failure message carries the
 * last value seen, which is what makes a timeout diagnosable.
 */
export async function waitFor<T>(input: {
  label: string;
  matches: (value: T) => boolean;
  read: () => Promise<T>;
  timeoutMs?: number;
}): Promise<T> {
  const deadline = Date.now() + (input.timeoutMs ?? 20_000);
  let last: T | undefined;

  while (Date.now() < deadline) {
    last = await input.read();
    if (input.matches(last)) return last;
    await delay(150);
  }

  throw new Error(
    `${input.label} did not settle within the timeout; last value was ${JSON.stringify(last)}`,
  );
}

/**
 * Proving that nothing moved needs a wait of its own: there is no row to poll
 * for, so the only honest option is to give the `after()` callback more time
 * than it needs and then assert the world is where it was. Kept separate from
 * `waitFor` so the difference between "wait for a change" and "wait out a
 * non-change" stays visible at every call site.
 */
export async function settle(ms = 2_000): Promise<void> {
  await delay(ms);
}
