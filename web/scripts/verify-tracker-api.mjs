import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const getRoute = fs.readFileSync(path.join(root, "src/app/api/clients/route.ts"), "utf8");
const patchRoute = fs.readFileSync(path.join(root, "src/app/api/clients/[id]/route.ts"), "utf8");
const config = fs.readFileSync(path.join(root, "../supabase/config.toml"), "utf8");

// Keep the route contract executable without importing Next or constructing an
// application client. The database half runs inside one rolled-back transaction.
assert.ok(getRoute.indexOf('featureFlag("FEATURE_TRACKER")') < getRoute.indexOf('import("@/lib/auth/session")'));
assert.match(getRoute, /enabled: false, clients: \[\]/);
assert.match(getRoute, /status: result\.outcome === "created" \? 201 : 200/);
assert.match(getRoute, /invalid_profile[\s\S]*409/);
assert.match(getRoute, /client_conflict[\s\S]*409/);
assert.match(getRoute, /Cache-Control": "private, no-store"/);
assert.ok(patchRoute.indexOf('featureFlag("FEATURE_TRACKER")') < patchRoute.indexOf('await context.params'));
assert.match(patchRoute, /const \{ id \} = await context\.params/);
assert.match(patchRoute, /transitionClientStage/);
assert.match(patchRoute, /result\.outcome === "stale"[\s\S]*409/);
assert.match(patchRoute, /result\.outcome === "not_found"[\s\S]*404/);
assert.match(patchRoute, /Response\.json\(\{ outcome: result\.outcome, client \}, \{ status: 200/);
assert.doesNotMatch(getRoute + patchRoute, /process\.env|NEXT_PUBLIC_.*TRACKER/);

const projectId = config.match(/^project_id\s*=\s*"([a-zA-Z0-9_-]+)"/m)?.[1];
assert.ok(projectId, "Supabase project_id is required for the transactional verifier");

const clientId = "a3000000-0000-4000-8000-00000000f602";
const ownerId = "a1000000-0000-0000-0000-000000000001";
const prepId = "a1000000-0000-0000-0000-000000000002";
const cedarOwnerId = "b1000000-0000-0000-0000-000000000001";
const orgId = "a0000000-0000-0000-0000-000000000001";

const sql = String.raw`
\set QUIET 1
begin;
insert into public.clients (id, org_id, display_name, stage, assigned_to)
values ('${clientId}', '${orgId}', 'Tracker API verifier', 'onboarding', '${ownerId}');
update public.orgs set team_sees_all_clients = false where id = '${orgId}';
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"${prepId}"}';
select 'same_org_hidden:' || count(*) from public.clients where id = '${clientId}';
set local request.jwt.claims = '{"role":"authenticated","sub":"${cedarOwnerId}"}';
select 'cross_org_hidden:' || count(*) from public.clients where id = '${clientId}';
set local request.jwt.claims = '{"role":"authenticated","sub":"${ownerId}"}';
select 'unchanged:' || result from public.tracker_transition_client_stage(
  '${clientId}', 'onboarding', 'onboarding', '${ownerId}', 'manual', null
);
select 'stale:' || result from public.tracker_transition_client_stage(
  '${clientId}', 'ready', 'optimization', '${ownerId}', 'manual', null
);
select 'transition:' || result from public.tracker_transition_client_stage(
  '${clientId}', 'ready', 'onboarding', '${ownerId}', 'manual', null
);
select 'readback:' || stage::text from public.clients where id = '${clientId}';
rollback;
`;

const db = spawnSync(
  "docker",
  ["exec", "-i", `supabase_db_${projectId}`, "psql", "-X", "-U", "postgres", "-d", "postgres", "-Atq", "-v", "ON_ERROR_STOP=1"],
  { encoding: "utf8", input: sql, maxBuffer: 2 * 1024 * 1024 },
);

assert.equal(db.status, 0, "Transactional tracker database verification failed");
assert.deepEqual(db.stdout.trim().split("\n").filter(Boolean), [
  "same_org_hidden:0",
  "cross_org_hidden:0",
  "unchanged:unchanged",
  "stale:stale",
  "transition:transitioned",
  "readback:ready",
]);

console.log("Tracker route and transactional database verification passed.");
