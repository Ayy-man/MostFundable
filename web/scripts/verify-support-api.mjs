/**
 * The support route surface, proven against a running server and a real database.
 *
 * The claim this file exists to make observable is SUPP-01: generating a draft never produces a
 * message. `no-auto-send.test.ts` makes that claim against a fake repository and
 * `verify-no-auto-send.mjs` makes it against the source text, and neither can see what the database
 * actually did. So this script generates drafts over HTTP and then counts messages by reading the
 * thread back, which is the only form of the assertion a wiring mistake cannot pass.
 *
 * Two boots in one invocation, sharing one build:
 *
 *   run 1 — FEATURE_SUPPORT unset: the bootstrap GET answers 200 with an empty list, and every
 *           mutating route answers 404, so the flag being off is indistinguishable from the routes
 *           not existing.
 *   run 2 — FEATURE_SUPPORT=1: the unauthenticated refusals, then the full draft lifecycle.
 *
 * `next start` reads FEATURE_* from `process.env` at request time rather than inlining them at
 * build time, which is what makes one build serve both runs. Rebuilding between them would double
 * the disk cost for no extra coverage.
 *
 * Safety rules this file keeps, matching `verify-tracker-live.mjs`:
 *   - It never runs `supabase db reset`, `supabase stop`, or any migration. One local stack serves
 *     every worktree on this machine.
 *   - Every row it creates carries the reserved `13e00000-` UUID prefix, and cleanup deletes by
 *     that prefix, so an interrupted run is recoverable without knowing how far it got.
 *   - It kills exactly the children it spawned, each identified by PID *and* by still holding the
 *     port it was given.
 *   - Nothing it prints contains a key, a connection string, or a message body.
 *
 * It needs no provider key and no network egress: with AI_DRIVER unset the mock driver is selected
 * (DEC-OWN-CREDLESS), and every draft below comes from it.
 */

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const WEB_ROOT = path.resolve(import.meta.dirname, "..");
const REPO_ROOT = path.resolve(WEB_ROOT, "..");

const SERVER_READY_TIMEOUT_MS = 180_000;

/** Every fixture row this run owns is addressable by this prefix alone. */
const PREFIX = "13e00000";
const ORG_ID = "13e00000-0000-4000-8000-000000000001";
const STAFF_ID = "13e00000-0000-4000-8000-000000000011";
const CONSUMER_ID = "13e00000-0000-4000-8000-000000000012";
const CLIENT_ID = "13e00000-0000-4000-8000-000000000021";
const ABSENT_THREAD_ID = "13e00000-0000-4000-8000-0000000000ff";

// ---------------------------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------------------------

const secrets = new Set();
let passes = 0;

function remember(value) {
  if (typeof value === "string" && value.trim().length > 8) secrets.add(value.trim());
  return value;
}

function redact(value) {
  let text = typeof value === "string" ? value : String(value);
  for (const secret of secrets) text = text.split(secret).join("[redacted]");
  return text;
}

function say(line) {
  process.stdout.write(`${redact(line)}\n`);
}

function fail(message) {
  throw new Error(redact(message));
}

/** Every assertion prints one line, so a green run reads as a list of the properties it proved. */
function check(condition, description, detail) {
  if (!condition) {
    fail(`FAIL  ${description}${detail === undefined ? "" : ` — ${detail}`}`);
  }
  passes += 1;
  say(`pass  ${description}`);
}

function checkEqual(actual, expected, description) {
  check(
    actual === expected,
    description,
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

// ---------------------------------------------------------------------------------------------
// Local stack
// ---------------------------------------------------------------------------------------------

function readStackEnv() {
  const status = spawnSync("supabase", ["status", "-o", "env"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });

  if (status.status !== 0) {
    fail(
      "`supabase status -o env` failed — start the shared local stack with `supabase start` " +
        "from the repository root and try again.",
    );
  }

  const values = {};
  for (const line of status.stdout.split("\n")) {
    const match = /^([A-Z0-9_]+)="?(.*?)"?$/.exec(line.trim());
    if (match) values[match[1]] = match[2];
  }
  for (const key of ["API_URL", "ANON_KEY", "SERVICE_ROLE_KEY"]) {
    if (!values[key]) fail(`\`supabase status -o env\` did not report ${key}`);
  }

  remember(values.ANON_KEY);
  remember(values.SERVICE_ROLE_KEY);
  if (values.DB_URL) remember(values.DB_URL);
  if (process.env.LOCAL_DATABASE_URL) remember(process.env.LOCAL_DATABASE_URL);
  return values;
}

const stack = readStackEnv();

const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(
  fs.readFileSync(path.join(REPO_ROOT, "supabase/config.toml"), "utf8"),
)?.[1];
if (!projectId) fail("supabase/config.toml must declare project_id");

const databaseUrl = process.env.LOCAL_DATABASE_URL ?? stack.DB_URL ?? null;
const hasLocalPsql = spawnSync("psql", ["--version"], { stdio: "ignore" }).status === 0;
const useLocalPsql = hasLocalPsql && databaseUrl !== null;

function runSql(sql) {
  const command = useLocalPsql ? "psql" : "docker";
  const args = useLocalPsql
    ? ["-X", "-v", "ON_ERROR_STOP=1", "-Atq"]
    : [
        "exec", "-i", `supabase_db_${projectId}`,
        "psql", "-U", "postgres", "-d", "postgres", "-X", "-v", "ON_ERROR_STOP=1", "-Atq",
      ];

  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: useLocalPsql ? { ...process.env, PGDATABASE: databaseUrl } : process.env,
    input: `set time zone 'UTC';\n${sql}`,
    maxBuffer: 8 * 1024 * 1024,
  });

  if (result.status !== 0) {
    fail(`psql failed: ${result.stderr || `exit code ${result.status}`}`);
  }
  return result.stdout.trim();
}

// ---------------------------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------------------------

/**
 * One org, one operator owner, one consumer, and the client that ties them together.
 *
 * `team_sees_all_clients` is false and the owner is the assignee, which is the ordinary shape: the
 * staff member reaches this thread because they are assigned to the client, not because the org
 * waives client scoping. `on conflict do nothing` makes the seed idempotent so an interrupted run
 * can be re-run without a manual clean first.
 */
function seedFixture() {
  runSql(`
    begin;
    insert into auth.users (id, email) values
      ('${STAFF_ID}', 'support-e2e-staff@example.invalid'),
      ('${CONSUMER_ID}', 'support-e2e-consumer@example.invalid')
      on conflict (id) do nothing;

    insert into public.orgs (id, name, slug, team_sees_all_clients) values
      ('${ORG_ID}', 'Support E2E Org', 'support-e2e-org', false)
      on conflict (id) do nothing;

    -- The on_auth_user_created trigger mints a profile the moment the auth user
    -- lands, so these rows already exist by the time this statement runs and the
    -- conflict clause has to overwrite rather than skip. do-nothing here left the
    -- trigger's default role in place and the client insert then failed its role
    -- check, which is a confusing way to learn the trigger exists.
    insert into public.profiles (id, role, org_id, org_role, full_name, email) values
      ('${STAFF_ID}', 'operator_member', '${ORG_ID}', 'owner',
       'Support E2E Owner', 'support-e2e-staff@example.invalid'),
      ('${CONSUMER_ID}', 'consumer', '${ORG_ID}', null,
       'Support E2E Consumer', 'support-e2e-consumer@example.invalid')
      on conflict (id) do update set
        role = excluded.role,
        org_id = excluded.org_id,
        org_role = excluded.org_role,
        full_name = excluded.full_name,
        email = excluded.email;

    insert into public.clients (id, org_id, consumer_profile_id, display_name, assigned_to) values
      ('${CLIENT_ID}', '${ORG_ID}', '${CONSUMER_ID}', 'Support E2E Client', '${STAFF_ID}')
      on conflict (id) do nothing;
    commit;
  `);
}

/**
 * Remove every row the reserved prefix owns, in an order the foreign keys allow.
 *
 * Threads cascade to their messages and drafts, so those are left to the database rather than
 * enumerated — a child table a later migration adds is then cleaned by the cascade instead of being
 * orphaned by a list nobody updated. `audit_log` is the one table with a guard in the way:
 * `audit_log_prevent_change` blocks DELETE, so it is disabled for the length of this one
 * transaction and restored inside it, which means an abort anywhere rolls the guard back on.
 */
function cleanupFixture() {
  runSql(`
    begin;
    delete from public.support_threads where org_id = '${ORG_ID}';
    alter table public.audit_log disable trigger audit_log_prevent_change;
    delete from public.audit_log
      where actor_profile_id::text like '${PREFIX}%' or org_id::text like '${PREFIX}%';
    alter table public.audit_log enable trigger audit_log_prevent_change;
    delete from public.clients where org_id = '${ORG_ID}';
    -- By prefix rather than by org, because a run interrupted between the auth
    -- user insert and the profile update leaves a profile with a null org_id
    -- that would otherwise block the auth.users delete below.
    delete from public.profiles where id::text like '${PREFIX}%';
    delete from auth.users where id::text like '${PREFIX}%';
    delete from public.orgs where id = '${ORG_ID}';
    commit;
  `);
}

function reservedRowCount() {
  return Number(
    runSql(`
      select
        (select count(*) from public.support_threads where org_id = '${ORG_ID}')
      + (select count(*) from public.clients where org_id = '${ORG_ID}')
      + (select count(*) from public.profiles where id::text like '${PREFIX}%')
      + (select count(*) from public.orgs where id = '${ORG_ID}');
    `),
  );
}

// ---------------------------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------------------------

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/**
 * `profileId` of `null` sends no demo header at all, which is exactly how `resolveDemoSession()`
 * sees an unauthenticated request. No real auth provider is involved in either case.
 */
async function call(baseUrl, method, route, profileId, body) {
  const response = await fetch(`${baseUrl}${route}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(profileId === null ? {} : { "x-mf-demo-profile-id": profileId }),
    },
    method,
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = null;
  }
  return { payload, status: response.status };
}

const children = [];

function stopChild(pid, port) {
  if (!Number.isInteger(pid) || pid <= 1) return "no child recorded";

  const alive = spawnSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" });
  if (alive.status !== 0 || !alive.stdout.trim()) return `pid ${pid} already gone`;

  const listening = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
    encoding: "utf8",
  });
  const owners = (listening.stdout ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
  if (!owners.includes(String(pid))) return `pid ${pid} no longer holds port ${port} — left alone`;

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

function stopEveryChild() {
  while (children.length > 0) {
    const child = children.pop();
    say(`teardown: ${stopChild(child.pid, child.port)}`);
  }
}

async function startServer(flagOn) {
  const port = await freePort();
  const sink = fs.openSync(process.env.MF_SUPPORT_LOG ?? "/dev/null", "a");

  // FEATURE_SUPPORT is set only in the on run. Setting it to '0' instead of omitting it would
  // test the falsy branch of `featureFlag`, not the unset branch, and the unset branch is the one
  // that ships.
  const env = {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: stack.ANON_KEY,
    NEXT_PUBLIC_SUPABASE_URL: stack.API_URL,
    SUPABASE_SERVICE_ROLE_KEY: stack.SERVICE_ROLE_KEY,
  };
  // Set, never delete — see the note in `verify-kb-api.mjs`. `next start` loads `.env.local`, and
  // a name that is absent from the process environment is supplied by that file rather than left
  // unset, so deleting these handed the arm's setup to whatever the developer happens to have on.
  env.FEATURE_SUPPORT = "0";
  env.FEATURE_REAL_AUTH = "0";
  env.AI_DRIVER = "mock";
  if (flagOn) env.FEATURE_SUPPORT = "1";

  const child = spawn(
    path.join(WEB_ROOT, "node_modules/.bin/next"),
    ["start", "-p", String(port)],
    { cwd: WEB_ROOT, detached: true, env, stdio: ["ignore", sink, sink] },
  );
  child.unref();
  children.push({ pid: child.pid, port });

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const up = await fetch(`${baseUrl}/api/enroll`).then((response) => response.ok, () => false);
    if (up) return baseUrl;
    await delay(500);
  }
  fail(`the child application server did not answer on port ${port} in ${SERVER_READY_TIMEOUT_MS}ms`);
}

// ---------------------------------------------------------------------------------------------
// Run 1 — the flag is off
// ---------------------------------------------------------------------------------------------

async function assertFlagOff(baseUrl) {
  say("");
  say("FEATURE_SUPPORT unset");

  const bootstrap = await call(baseUrl, "GET", "/api/support/threads", STAFF_ID);
  checkEqual(bootstrap.status, 200, "flag off: the bootstrap GET still answers 200");
  checkEqual(bootstrap.payload?.enabled, false, "flag off: the bootstrap reports enabled false");
  check(
    Array.isArray(bootstrap.payload?.threads) && bootstrap.payload.threads.length === 0,
    "flag off: the bootstrap returns an empty thread list",
  );

  const mutations = [
    ["POST", "/api/support/threads", { kind: "team_chat", subject: "x", clientId: CLIENT_ID }],
    ["POST", `/api/support/threads/${ABSENT_THREAD_ID}/messages`, { body: "x" }],
    ["POST", `/api/support/threads/${ABSENT_THREAD_ID}/draft`, undefined],
    ["DELETE", `/api/support/threads/${ABSENT_THREAD_ID}/draft`, undefined],
    ["PATCH", `/api/support/threads/${ABSENT_THREAD_ID}`, { status: "resolved" }],
    ["GET", `/api/support/threads/${ABSENT_THREAD_ID}`, undefined],
  ];

  for (const [method, route, body] of mutations) {
    const response = await call(baseUrl, method, route, STAFF_ID, body);
    checkEqual(response.status, 404, `flag off: ${method} ${route.replace(ABSENT_THREAD_ID, ":id")} is 404`);
  }

  const threads = Number(
    runSql(`select count(*) from public.support_threads where org_id = '${ORG_ID}';`),
  );
  checkEqual(threads, 0, "flag off: no thread reached the database");
}

// ---------------------------------------------------------------------------------------------
// Run 2 — the flag is on
// ---------------------------------------------------------------------------------------------

async function assertNoSession(baseUrl) {
  say("");
  say("FEATURE_SUPPORT=1, no session");

  const bootstrap = await call(baseUrl, "GET", "/api/support/threads", null);
  checkEqual(bootstrap.status, 200, "no session: the bootstrap GET answers 200");
  checkEqual(bootstrap.payload?.enabled, true, "no session: the bootstrap reports enabled true");
  check(
    Array.isArray(bootstrap.payload?.threads) && bootstrap.payload.threads.length === 0,
    "no session: the bootstrap returns an empty thread list",
  );

  const guarded = [
    ["POST", "/api/support/threads", { kind: "team_chat", subject: "x", clientId: CLIENT_ID }],
    ["GET", `/api/support/threads/${ABSENT_THREAD_ID}`, undefined],
    ["PATCH", `/api/support/threads/${ABSENT_THREAD_ID}`, { status: "resolved" }],
    ["POST", `/api/support/threads/${ABSENT_THREAD_ID}/messages`, { body: "x" }],
    ["POST", `/api/support/threads/${ABSENT_THREAD_ID}/draft`, undefined],
    ["DELETE", `/api/support/threads/${ABSENT_THREAD_ID}/draft`, undefined],
  ];

  for (const [method, route, body] of guarded) {
    const response = await call(baseUrl, method, route, null, body);
    const label = route.replace(ABSENT_THREAD_ID, ":id");
    checkEqual(response.status, 401, `no session: ${method} ${label} is 401`);
    checkEqual(
      response.payload?.error,
      "SUPPORT_ACTOR_REQUIRED",
      `no session: ${method} ${label} answers with one error key`,
    );
  }
}

async function openThread(baseUrl, subject) {
  const created = await call(baseUrl, "POST", "/api/support/threads", STAFF_ID, {
    clientId: CLIENT_ID,
    kind: "team_chat",
    subject,
  });
  checkEqual(created.status, 201, `open a thread: ${subject}`);
  const id = created.payload?.thread?.id;
  if (typeof id !== "string") fail("the open-thread response carried no thread id");
  return id;
}

async function readThread(baseUrl, threadId, profileId) {
  const response = await call(baseUrl, "GET", `/api/support/threads/${threadId}`, profileId);
  checkEqual(response.status, 200, "read the thread back");
  return response.payload;
}

/**
 * The unsendable half of SUPP-04, on a thread with no messages in it.
 *
 * The mock driver classifies intent from the most recent message from the other side, so a thread
 * with nothing in it resolves to `fallback` at 0.40 — below the 0.7 bar. That makes an empty thread
 * the cheapest possible below-threshold case, and it is a real one rather than a contrived low
 * confidence, because a support agent asking for a draft before the client has said anything is
 * precisely the situation the bar exists for.
 */
async function assertBelowThresholdLifecycle(baseUrl) {
  say("");
  say("lifecycle A — a draft that never clears the bar");

  const threadId = await openThread(baseUrl, "Draft lifecycle without a message");

  const first = await call(baseUrl, "POST", `/api/support/threads/${threadId}/draft`, STAFF_ID);
  checkEqual(first.status, 201, "generate: the first draft is created");
  checkEqual(first.payload?.draft?.status, "draft", "generate: an empty thread is below threshold");
  const draftId = first.payload.draft.id;

  let payload = await readThread(baseUrl, threadId, STAFF_ID);
  checkEqual(payload?.draft?.id, draftId, "generate: the draft comes back inline on the thread GET");
  checkEqual(payload?.messages?.length, 0, "generate: the thread still has zero messages");

  const second = await call(baseUrl, "POST", `/api/support/threads/${threadId}/draft`, STAFF_ID);
  checkEqual(second.status, 409, "generate again: a second open draft is refused");
  checkEqual(second.payload?.error, "SUPPORT_DRAFT_EXISTS", "generate again: the code is DRAFT_EXISTS");

  const discarded = await call(baseUrl, "DELETE", `/api/support/threads/${threadId}/draft`, STAFF_ID);
  checkEqual(discarded.status, 200, "discard: the open draft is discarded");
  checkEqual(discarded.payload?.draft?.status, "discarded", "discard: the stored status is discarded");

  payload = await readThread(baseUrl, threadId, STAFF_ID);
  checkEqual(payload?.draft, null, "discard: the thread GET now returns draft null");
  checkEqual(payload?.messages?.length, 0, "discard: the thread still has zero messages");

  const third = await call(baseUrl, "POST", `/api/support/threads/${threadId}/draft`, STAFF_ID);
  checkEqual(third.status, 201, "generate: a third draft is created after the discard");
  const thirdId = third.payload.draft.id;

  payload = await readThread(baseUrl, threadId, STAFF_ID);
  checkEqual(payload?.messages?.length, 0, "generate: still zero messages after three generates");

  const send = await call(baseUrl, "POST", `/api/support/threads/${threadId}/messages`, STAFF_ID, {
    body: payload.draft.body,
    draftId: thirdId,
  });
  checkEqual(send.status, 422, "send: a below-threshold draft cannot be sent");
  checkEqual(send.payload?.error, "SUPPORT_DRAFT_NOT_APPROVED", "send: the code is DRAFT_NOT_APPROVED");

  payload = await readThread(baseUrl, threadId, STAFF_ID);
  checkEqual(payload?.messages?.length, 0, "send refused: the thread still has zero messages");

  // Clear the bench for lifecycle B, which continues on this same thread.
  const cleared = await call(baseUrl, "DELETE", `/api/support/threads/${threadId}/draft`, STAFF_ID);
  checkEqual(cleared.status, 200, "the below-threshold draft is discarded before the next phase");

  return threadId;
}

/**
 * The sendable half, and the single-send property.
 *
 * A consumer message comes first because it is what gives the mock driver an intent to classify;
 * with it the draft clears every gate and reaches `approved`. The message count is asserted before
 * and after the generate, so "generating produced no message" is still the assertion — it is just
 * measured from one rather than from zero.
 */
async function assertApprovedLifecycle(baseUrl, threadId) {
  say("");
  say("lifecycle B — a draft that clears every gate");

  // The same thread, on purpose. `support_open_thread` is idempotent for
  // `team_chat` — one client, one team thread — so asking for a second one
  // returns the first, and a lifecycle B on a "new" thread would silently have
  // been lifecycle A's thread with A's leftover draft still open on it.
  const reopened = await call(baseUrl, "POST", "/api/support/threads", STAFF_ID, {
    clientId: CLIENT_ID,
    kind: "team_chat",
    subject: "A second request for the same client team chat",
  });
  checkEqual(reopened.status, 201, "reopen: the team chat opens again without error");
  checkEqual(
    reopened.payload?.thread?.id,
    threadId,
    "reopen: one client team chat, not a second thread",
  );

  const asked = await call(baseUrl, "POST", `/api/support/threads/${threadId}/messages`, CONSUMER_ID, {
    body: "Where do I upload the bank statement you asked for?",
  });
  checkEqual(asked.status, 201, "the consumer sends a question");
  checkEqual(asked.payload?.message?.origin, "human", "a message sent with no draft is origin human");
  checkEqual(asked.payload?.message?.authorKind, "consumer", "the author kind came from the session role");

  let payload = await readThread(baseUrl, threadId, STAFF_ID);
  checkEqual(payload?.messages?.length, 1, "the thread holds the one human message");

  const generated = await call(baseUrl, "POST", `/api/support/threads/${threadId}/draft`, STAFF_ID);
  checkEqual(generated.status, 201, "generate: a draft is created for the question");
  checkEqual(generated.payload?.draft?.status, "approved", "generate: the draft cleared every gate");
  const draftId = generated.payload.draft.id;

  payload = await readThread(baseUrl, threadId, STAFF_ID);
  checkEqual(payload?.draft?.id, draftId, "generate: the approved draft is inline on the thread GET");
  checkEqual(
    payload?.messages?.length,
    1,
    "generate: an approved draft added no message — SUPP-01 over HTTP",
  );

  const stored = runSql(`
    select count(*) from public.support_messages where thread_id = '${threadId}';
  `);
  checkEqual(Number(stored), 1, "generate: the database agrees the message count is unchanged");

  const sent = await call(baseUrl, "POST", `/api/support/threads/${threadId}/messages`, STAFF_ID, {
    body: payload.draft.body,
    draftId,
  });
  checkEqual(sent.status, 201, "send: a person sends the approved draft");
  checkEqual(sent.payload?.message?.origin, "ai_assisted", "send: the message is marked ai_assisted");
  checkEqual(sent.payload?.message?.originDraftId, draftId, "send: the message cites the draft");
  checkEqual(sent.payload?.message?.authorKind, "operator", "send: the author kind is the staff role");

  payload = await readThread(baseUrl, threadId, STAFF_ID);
  checkEqual(payload?.messages?.length, 2, "send: the thread now holds exactly two messages");
  checkEqual(payload?.draft, null, "send: the spent draft is no longer the thread's open draft");

  const draftState = runSql(`select status from public.held_drafts where id = '${draftId}';`);
  checkEqual(draftState, "sent", "send: the stored draft status is sent");

  const again = await call(baseUrl, "POST", `/api/support/threads/${threadId}/messages`, STAFF_ID, {
    body: sent.payload.message.body,
    draftId,
  });
  checkEqual(again.status, 422, "resend: a spent draft cannot be sent twice");
  checkEqual(again.payload?.error, "SUPPORT_DRAFT_NOT_APPROVED", "resend: the code is DRAFT_NOT_APPROVED");

  payload = await readThread(baseUrl, threadId, STAFF_ID);
  checkEqual(payload?.messages?.length, 2, "resend refused: the thread still holds two messages");

}

/**
 * The consumer sees the conversation and not the drafts behind it.
 *
 * This is migration 100's `held_drafts_select` policy doing the work, not an application filter:
 * the repository does not issue the draft query for a consumer role, and even if it did the policy
 * requires a staff app role. Asserting the messages are visible in the same breath is what makes
 * the `null` meaningful — a blanket read failure would produce the same `draft: null`.
 */
async function assertConsumerVisibility(baseUrl, threadId) {
  say("");
  say("consumer visibility");

  const payload = await readThread(baseUrl, threadId, CONSUMER_ID);
  checkEqual(payload?.messages?.length, 2, "consumer: both messages are visible");
  checkEqual(payload?.draft, null, "consumer: the draft is not");

  // Three rows by now: lifecycle A's first and third drafts, both discarded,
  // and lifecycle B's, sent. The consumer sees none of them, which is the point
  // — the `null` above is a policy denying rows that exist, not an empty table.
  const drafts = runSql(`
    select count(*) from public.held_drafts where thread_id = '${threadId}';
  `);
  checkEqual(Number(drafts), 3, "consumer: the drafts the consumer cannot see do exist");
}

/** Validation refusals that never reach the database. */
async function assertValidation(baseUrl) {
  say("");
  say("request validation");

  const cases = [
    ["POST", "/api/support/threads", { kind: "escalation", subject: "x", clientId: CLIENT_ID },
      "an unknown thread kind"],
    ["POST", "/api/support/threads", { kind: "team_chat", subject: "  ", clientId: CLIENT_ID },
      "a blank subject"],
    ["POST", "/api/support/threads", { kind: "team_chat", subject: "x".repeat(161), clientId: CLIENT_ID },
      "a subject over 160 characters"],
    ["POST", "/api/support/threads", { kind: "team_chat", subject: "x", clientId: "not-a-uuid" },
      "a client id that is not a UUID"],
    ["PATCH", `/api/support/threads/${ABSENT_THREAD_ID}`, { status: "archived" },
      "an unknown thread status"],
    ["POST", `/api/support/threads/${ABSENT_THREAD_ID}/messages`, { body: "   " },
      "a blank message body"],
    ["POST", `/api/support/threads/${ABSENT_THREAD_ID}/messages`, { body: "x".repeat(4001) },
      "a message body over 4000 characters"],
    ["POST", `/api/support/threads/${ABSENT_THREAD_ID}/messages`, { body: "x", draftId: "invalid" },
      "a draft id that is not a UUID"],
    ["POST", `/api/support/threads/${ABSENT_THREAD_ID}/messages`, { body: "x", authorKind: "admin" },
      "a client-asserted author kind"],
    ["POST", `/api/support/threads/${ABSENT_THREAD_ID}/messages`, { body: "x", authorProfileId: CONSUMER_ID },
      "a client-asserted author profile"],
  ];

  for (const [method, route, body, description] of cases) {
    const response = await call(baseUrl, method, route, STAFF_ID, body);
    checkEqual(response.status, 400, `validation: ${description} is refused`);
    checkEqual(
      response.payload?.error,
      "SUPPORT_REQUEST_INVALID",
      `validation: ${description} answers with one error key`,
    );
  }

  const missing = await call(baseUrl, "GET", `/api/support/threads/${ABSENT_THREAD_ID}`, STAFF_ID);
  checkEqual(missing.status, 404, "validation: a thread that does not exist is 404");
}

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

function ensureBuild() {
  if (fs.existsSync(path.join(WEB_ROOT, ".next/BUILD_ID"))) {
    say("using the existing .next build");
    return;
  }
  say("building the application once (both runs share it)");
  const build = spawnSync("npm", ["run", "build"], { cwd: WEB_ROOT, stdio: "inherit" });
  if (build.status !== 0) fail("`npm run build` failed");
}

async function main() {
  ensureBuild();
  seedFixture();
  say(`seeded the reserved fixture (${PREFIX}…)`);

  const offUrl = await startServer(false);
  await assertFlagOff(offUrl);
  stopEveryChild();

  const onUrl = await startServer(true);
  await assertNoSession(onUrl);
  await assertValidation(onUrl);
  const threadId = await assertBelowThresholdLifecycle(onUrl);
  await assertApprovedLifecycle(onUrl, threadId);
  await assertConsumerVisibility(onUrl, threadId);
  stopEveryChild();
}

let exitCode = 0;
try {
  await main();
} catch (error) {
  process.stderr.write(`${redact(error?.stack ?? error?.message ?? error)}\n`);
  exitCode = 1;
} finally {
  stopEveryChild();
  try {
    cleanupFixture();
    const remaining = reservedRowCount();
    if (remaining === 0) {
      say("");
      say(`cleanup: the reserved prefix ${PREFIX}… is back to zero rows`);
    } else {
      process.stderr.write(`cleanup left ${remaining} reserved rows behind\n`);
      exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`cleanup failed: ${redact(error?.message ?? error)}\n`);
    exitCode = 1;
  }
}

if (exitCode === 0) {
  say("");
  say(`verify-support-api: ${passes} assertions passed`);
}
process.exit(exitCode);
