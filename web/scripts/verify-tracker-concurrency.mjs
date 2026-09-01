import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const databaseUrl = process.env.LOCAL_DATABASE_URL;

assert.ok(
  databaseUrl,
  "LOCAL_DATABASE_URL is required; derive it from `supabase status -o env` in the invoking shell.",
);

const orgId = "6c000000-0000-0000-0000-000000000100";
const clientId = "6c000000-0000-0000-0000-000000001001";
const enrollmentKey = "concurrency:tracker:enrollment";
const analysisKey = "concurrency:tracker:analysis";
const hasLocalPsql =
  spawnSync("psql", ["--version"], { stdio: "ignore" }).status === 0;
const config = readFileSync(
  new URL("../../supabase/config.toml", import.meta.url),
  "utf8",
);
const projectId = config.match(/^project_id\s*=\s*"([^"]+)"/m)?.[1];

assert.ok(projectId, "supabase/config.toml must declare project_id");

function sanitized(value) {
  return String(value).split(databaseUrl).join("[redacted database URL]");
}

function runSql(sql) {
  return new Promise((resolve, reject) => {
    const command = hasLocalPsql ? "psql" : "docker";
    const args = hasLocalPsql
      ? ["-X", "-v", "ON_ERROR_STOP=1", "-Atq"]
      : [
          "exec",
          "-i",
          `supabase_db_${projectId}`,
          "psql",
          "-U",
          "postgres",
          "-d",
          "postgres",
          "-X",
          "-v",
          "ON_ERROR_STOP=1",
          "-Atq",
        ];
    const child = spawn(command, args, {
      env: { ...process.env, PGDATABASE: databaseUrl },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(sanitized(stderr || `psql exited with code ${code}`)));
        return;
      }
      resolve(stdout.trim());
    });

    child.stdin.end(sql);
  });
}

const setupSql = `
begin;
set local session_replication_role = replica;
delete from public.audit_log where client_id = '${clientId}'::uuid;
delete from public.stage_history where client_id = '${clientId}'::uuid;
delete from public.tracker_transition_receipts
where event_key in ('${enrollmentKey}', '${analysisKey}');
delete from public.clients where id = '${clientId}'::uuid;
delete from public.orgs where id = '${orgId}'::uuid;
insert into public.orgs (id, name, slug, team_sees_all_clients)
values ('${orgId}', 'Tracker Concurrency Test', 'tracker-concurrency-test', false);
insert into public.clients (id, org_id, display_name, stage)
values ('${clientId}', '${orgId}', 'Tracker Concurrency Client', 'onboarding');
commit;
`;

const cleanupSql = `
begin;
set local session_replication_role = replica;
delete from public.audit_log where client_id = '${clientId}'::uuid;
delete from public.stage_history where client_id = '${clientId}'::uuid;
delete from public.tracker_transition_receipts
where event_key in ('${enrollmentKey}', '${analysisKey}');
delete from public.clients where id = '${clientId}'::uuid;
delete from public.orgs where id = '${orgId}'::uuid;
commit;
`;

const firstTransitionSql = `
begin;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select result
from public.tracker_transition_client_stage(
  '${clientId}',
  'optimization',
  'onboarding',
  null,
  'enrollment',
  '${enrollmentKey}'
);
select pg_sleep(1.5);
commit;
`;

const secondTransitionSql = `
begin;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select result
from public.tracker_transition_client_stage(
  '${clientId}',
  'optimization',
  'onboarding',
  null,
  'analysis',
  '${analysisKey}'
);
commit;
`;

const verifySql = `
do $$
declare
  client_timestamp timestamptz;
  history_timestamp timestamptz;
  audit_timestamp timestamptz;
begin
  select stage_entered_at into strict client_timestamp
  from public.clients
  where id = '${clientId}'::uuid and stage = 'optimization';

  select changed_at into strict history_timestamp
  from public.stage_history
  where client_id = '${clientId}'::uuid;

  select occurred_at into strict audit_timestamp
  from public.audit_log
  where client_id = '${clientId}'::uuid
    and action = 'client.stage.transitioned';

  if (select count(*) from public.tracker_transition_receipts
      where event_key in ('${enrollmentKey}', '${analysisKey}')) <> 2 then
    raise exception 'expected two consumed automatic-event receipts';
  end if;

  if (select count(*) from public.stage_history
      where client_id = '${clientId}'::uuid) <> 1 then
    raise exception 'expected one stage-history row';
  end if;

  if (select count(*) from public.audit_log
      where client_id = '${clientId}'::uuid
        and action = 'client.stage.transitioned') <> 1 then
    raise exception 'expected one tracker audit row';
  end if;

  if client_timestamp <> history_timestamp or client_timestamp <> audit_timestamp then
    raise exception 'client, history, and audit timestamps diverged';
  end if;
end;
$$;
`;

let setupComplete = false;

try {
  await runSql(setupSql);
  setupComplete = true;

  const first = runSql(firstTransitionSql);
  await new Promise((resolve) => setTimeout(resolve, 150));
  const second = runSql(secondTransitionSql);
  const [firstResult, secondResult] = await Promise.allSettled([first, second]);

  if (firstResult.status === "rejected") throw firstResult.reason;
  if (secondResult.status === "rejected") throw secondResult.reason;

  assert.equal(firstResult.value, "transitioned");
  assert.equal(secondResult.value, "unchanged");
  await runSql(verifySql);
  process.stdout.write(
    "tracker concurrency verification passed: two causes, one transition, one history row, one audit row\n",
  );
} finally {
  if (setupComplete) await runSql(cleanupSql);
}
