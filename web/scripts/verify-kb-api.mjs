import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { KB_NDJSON_CONTENT_TYPE, readKbStreamLines } from "../src/lib/kb/stream.ts";
import { KB_EMBEDDING_DRIVERS } from "../src/lib/kb/retrieval.ts";
import { CONSUMER_KB_IDENTITY } from "../src/lib/kb/consumer.ts";

const WEB_ROOT = path.resolve(import.meta.dirname, "..");
const REPO_ROOT = path.resolve(WEB_ROOT, "..");
const ADMIN_ID = "00000000-0000-0000-0000-000000000001";
const OPERATOR_A_ID = "a1000000-0000-0000-0000-000000000001";
const OPERATOR_B_ID = "b1000000-0000-0000-0000-000000000001";
const CONSUMER_ID = "a1000000-0000-0000-0000-000000000011";
const CLIENT_WITH_TEAM_CHAT = "a3000000-0000-0000-0000-000000000003";
// The team chat thread is looked up rather than fabricated. `support_threads_one_team_chat_per_client`
// (migration 100) permits exactly one team_chat row per client, and the seed now carries one for
// this client, so inserting a second is not merely redundant — it is impossible, and it is
// impossible in production too. Deriving the id from the seed also means a reseed that renumbers
// the thread cannot turn this arm into a check of nothing.
let threadId = null;
const WINDOW = "2098-W51";
let assertions = 0;

function check(value, message) { if (!value) throw new Error(message); assertions += 1; }
function equal(actual, expected, message) { check(actual === expected, `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }

const status = spawnSync("supabase", ["status", "-o", "env"], { cwd: REPO_ROOT, encoding: "utf8" });
if (status.status !== 0) throw new Error("shared local Supabase stack is unavailable");
const stack = {};
for (const line of status.stdout.split("\n")) { const match = /^([A-Z0-9_]+)="?(.*?)"?$/.exec(line.trim()); if (match) stack[match[1]] = match[2]; }
for (const key of ["API_URL", "ANON_KEY", "SERVICE_ROLE_KEY"]) if (!stack[key]) throw new Error(`local stack did not report ${key}`);
const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(fs.readFileSync(path.join(REPO_ROOT, "supabase/config.toml"), "utf8"))?.[1];
if (!projectId) throw new Error("supabase project id is unavailable");

function runSql(sql) {
  const result = spawnSync("docker", ["exec", "-i", `supabase_db_${projectId}`, "psql", "-U", "postgres", "-d", "postgres", "-X", "-v", "ON_ERROR_STOP=1", "-Atq"], { input: sql, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`scoped database check failed: ${result.stderr}`);
  return result.stdout.trim();
}

async function freePort() { return new Promise((resolve, reject) => { const server = createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const address = server.address(); server.close(() => resolve(address.port)); }); }); }
const children = [];
async function start(flagOn) {
  const port = await freePort();
  const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: stack.API_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: stack.ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: stack.SERVICE_ROLE_KEY };
  // Set, never delete. `next start` loads `.env.local`, and Next's precedence puts an inherited
  // process variable above that file but puts the file above a variable that is simply absent — so
  // deleting a name hands the decision to `.env.local` instead of taking it away. On a developer
  // machine with the flags on, that made the flag-off arm run flag-on, made the demo-profile header
  // arm run under FEATURE_REAL_AUTH, and pointed AI_DRIVER at the real OpenRouter account. The
  // first assertion caught it, which is the only reason this was ever visible: an arm whose setup
  // is the negation of an untracked local file passes on the machines that happen to lack the line.
  //
  // The driver values are the fallbacks declared in `src/lib/env.ts` (`ai` falls back to "mock",
  // `vault` to "fixture"), which is what deleting the selector was reaching for.
  env.FEATURE_KB = "0"; env.FEATURE_REAL_AUTH = "0"; env.AI_DRIVER = "mock"; env.VAULT_DRIVER = "fixture";
  env[KB_EMBEDDING_DRIVERS.selector] = KB_EMBEDDING_DRIVERS.fallback;
  if (flagOn) { env.FEATURE_KB = "1"; env.FEATURE_SUPPORT = "1"; }
  const child = spawn(path.join(WEB_ROOT, "node_modules/.bin/next"), ["start", "-p", String(port)], { cwd: WEB_ROOT, detached: true, env, stdio: "ignore" });
  children.push(child);
  const base = `http://localhost:${port}`;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) { if (await fetch(`${base}/api/enroll`).then((response) => response.status > 0, () => false)) return base; await delay(300); }
  throw new Error("built server did not become ready");
}
function stopChildren() { for (const child of children.splice(0)) { try { process.kill(-child.pid, "SIGTERM"); } catch { try { child.kill("SIGTERM"); } catch {} } } }
async function call(base, method, route, profileId, body) {
  const target = new URL(route, base);
  const response = await fetch(target, { method, headers: { ...(profileId ? { "x-mf-demo-profile-id": profileId } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }), ...(!["GET", "HEAD"].includes(method) ? { origin: new URL(base).origin } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let payload = null;
  if ((response.headers.get("content-type") ?? "").includes(KB_NDJSON_CONTENT_TYPE)) {
    const terminal = readKbStreamLines(text).events.findLast((event) => "result" in event);
    payload = terminal && "result" in terminal ? terminal.result : null;
  } else {
    try { payload = JSON.parse(text); } catch {}
  }
  return { status: response.status, payload };
}

try {
  runSql(`delete from public.kb_import_runs where subject = 'global' and "window" = '${WINDOW}';`);
  const off = await start(false);
  equal((await call(off, "GET", "/api/kb/consumer", CONSUMER_ID)).payload?.enabled, false, "consumer bootstrap is disabled");
  equal((await call(off, "GET", "/api/kb/operator", OPERATOR_A_ID)).payload?.enabled, false, "operator bootstrap is disabled");
  for (const [route, body] of [["/api/kb/consumer", { question: "business records" }], ["/api/kb/operator", { mode: "answer", question: "workspace status" }], ["/api/kb/admin/reimport", { subject: "global", window: WINDOW }]]) equal((await call(off, "POST", route, ADMIN_ID, body)).status, 404, `flag-off ${route}`);
  stopChildren(); await delay(500);

  const on = await start(true);
  equal((await call(on, "POST", "/api/kb/admin/reimport", null, { subject: "global", window: WINDOW })).status, 401, "admin import requires a session");
  equal((await call(on, "POST", "/api/kb/admin/reimport", OPERATOR_A_ID, { subject: "global", window: WINDOW })).status, 403, "admin import requires platform admin");
  const imported = await call(on, "POST", "/api/kb/admin/reimport", ADMIN_ID, { subject: "global", window: WINDOW });
  equal(imported.status, 200, "fixture import succeeds"); equal(imported.payload?.status, "ok", "first weekly key imports");
  const repeated = await call(on, "POST", "/api/kb/admin/reimport", ADMIN_ID, { subject: "global", window: WINDOW });
  equal(repeated.payload?.status, "skipped", "repeated weekly key skips");

  const consumer = await call(on, "POST", "/api/kb/consumer", CONSUMER_ID, { question: "Which current business records should I keep consistent?" });
  equal(consumer.status, 200, "consumer answer succeeds"); equal(consumer.payload?.status, "answered", "consumer answer is grounded"); equal(consumer.payload?.identity, CONSUMER_KB_IDENTITY, "consumer answer identifies AI"); check(Array.isArray(consumer.payload?.citations) && consumer.payload.citations.length > 0, "consumer answer has citations");
  const empty = await call(on, "POST", "/api/kb/consumer", CONSUMER_ID, { question: "orchid" });
  equal(empty.payload?.status, "insufficient_grounding", "isolated query declines without grounding");
  equal((await call(on, "POST", "/api/kb/consumer", OPERATOR_A_ID, { question: "business records" })).status, 403, "consumer route refuses operator role");

  const answerA = await call(on, "POST", "/api/kb/operator", OPERATOR_A_ID, { mode: "answer", question: "What workspace item is visible?" });
  const answerB = await call(on, "POST", "/api/kb/operator", OPERATOR_B_ID, { mode: "answer", question: "What workspace item is visible?" });
  equal(answerA.payload?.status, "answered", "first operator gets an answer"); equal(answerB.payload?.status, "answered", "second operator gets an answer");
  check(answerA.payload.answer.endsWith("Answers come from your workspace data. Not credit, legal, or tax advice."), "operator footer is exact");
  check(JSON.stringify(answerA.payload.citations) !== JSON.stringify(answerB.payload.citations), "operator sessions receive distinct visible citations");

  threadId = runSql(`select id from public.support_threads where kind = 'team_chat' and client_id = '${CLIENT_WITH_TEAM_CHAT}' limit 1;`);
  check(threadId, "the seed carries no team chat thread for the scoped client; this arm has nothing to draft against");
  const before = await call(on, "GET", `/api/support/threads/${threadId}`, OPERATOR_A_ID);
  equal(before.status, 200, "scoped support thread is visible");
  const draft = await call(on, "POST", "/api/kb/operator", OPERATOR_A_ID, { mode: "message_draft", supportThreadId: threadId });
  equal(draft.payload?.status, "drafted", "operator mode creates a held draft");
  const after = await call(on, "GET", `/api/support/threads/${threadId}`, OPERATOR_A_ID);
  equal(before.payload?.thread?.messages?.length ?? 0, after.payload?.thread?.messages?.length ?? 0, "held draft does not add a message");
  check(after.payload?.thread?.draft !== null, "held draft is visible on its thread");
  // Only the draft this arm created is removed. The thread is seeded now, so deleting it would
  // leave the local stack differing from a fresh reset and quietly break whatever runs next.
  runSql(`delete from public.held_drafts where thread_id = '${threadId}';`);
  process.stdout.write(`KB API verification passed: ${assertions} assertions.\n`);
} finally {
  stopChildren();
  if (threadId) { try { runSql(`delete from public.held_drafts where thread_id = '${threadId}';`); } catch {} }
  try { runSql(`delete from public.kb_import_runs where subject = 'global' and "window" = '${WINDOW}';`); } catch {}
}
