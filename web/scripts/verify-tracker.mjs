import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();

function load(file, requireMap = {}) {
  const source = fs.readFileSync(file, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: file,
  }).outputText;
  const record = { exports: {} };
  new Function("exports", "require", "module", "__filename", "__dirname", output)(
    record.exports,
    (specifier) => {
      if (specifier in requireMap) return requireMap[specifier];
      throw new Error(`Unexpected runtime import in ${file}: ${specifier}`);
    },
    record,
    file,
    path.dirname(file),
  );
  return record.exports;
}

const demoTypes = load(path.join(root, "src/lib/demo/types.ts"));
const trackerTypesPath = path.join(root, "src/lib/tracker/types.ts");
const timerPath = path.join(root, "src/lib/tracker/timer.ts");
const realtimePath = path.join(root, "src/lib/tracker/realtime.ts");
const trackerTypes = load(trackerTypesPath);
const timer = load(timerPath);
const realtime = load(realtimePath);

assert.deepEqual(trackerTypes.TRACKER_STAGES.map((stage) => trackerTypes.TRACKER_STAGE_LABELS[stage]), demoTypes.FUNDING_STAGES);
assert.deepEqual(demoTypes.FUNDING_STAGES.map(trackerTypes.trackerStageFromLabel), trackerTypes.TRACKER_STAGES);
assert.deepEqual(trackerTypes.OVERVIEW_TOP_KEYS, ["stage", "monitoring", "nextRefresh"]);
assert.deepEqual(trackerTypes.OVERVIEW_BOTTOM_KEYS, ["readiness", "openActions", "estimatedCompletion", "fundingApproved"]);

const now = new Date("2026-08-16T12:00:00.000Z");
assert.deepEqual(timer.trackerStageTimer("optimization", "2026-08-06T12:00:00.000Z", now), { elapsedDays: 10, remainingDays: 50, targetDays: 60 });
assert.deepEqual(timer.trackerStageTimer("applying", "2026-06-01T12:00:00.000Z", now), { elapsedDays: 76, remainingDays: 0, targetDays: 60 });
assert.deepEqual(timer.trackerStageTimer("optimization", "2026-08-17T12:00:00.000Z", now), { elapsedDays: 0, remainingDays: 60, targetDays: 60 });
for (const stage of ["onboarding", "ready", "funded", "graduate"]) assert.equal(timer.trackerStageTimer(stage, now.toISOString(), now), null);

const goodCreate = trackerTypes.validateTrackerCreateInput({ displayName: "Verifier Client", goalCents: 2500000 });
assert.equal(goodCreate.ok, true);
for (const bad of [
  { displayName: "Verifier", orgId: "a0000000-0000-0000-0000-000000000001" },
  { displayName: "Verifier", goalCents: -1 },
  { displayName: "Verifier", consumerProfileId: "not-a-uuid" },
]) assert.equal(trackerTypes.validateTrackerCreateInput(bad).ok, false);
assert.equal(trackerTypes.validateTrackerPatchInput({ stage: "ready", expectedStage: "optimization" }).ok, true);
assert.equal(trackerTypes.validateTrackerPatchInput({ goalCents: 1000, matchesUnlockedOverride: true }).ok, true);
assert.equal(trackerTypes.validateTrackerPatchInput({ status: "archived" }).ok, true);
for (const bad of [
  { stage: "ready" },
  { stage: "unknown", expectedStage: "optimization" },
  { stage: "ready", expectedStage: "optimization", goalCents: 1 },
  { goalCents: 1, actor: "browser" },
  {},
]) assert.equal(trackerTypes.validateTrackerPatchInput(bad).ok, false);

assert.deepEqual(trackerTypes.TRACKER_CLIENT_KEYS, [
  "id", "consumerProfileId", "displayName", "businessName", "assignedToId", "assignedToName",
  "stage", "stageEnteredAt", "startedAt", "history", "analysisAt", "readiness", "openActionCount",
  "estimatedCompletionAt", "monitoring", "nextRefreshAt", "goalCents", "matchesUnlockedOverride", "fundingApprovedCents",
  "health", "status", "lastActivityAt", "archivedAt", "archivedById",
]);
assert.ok(!trackerTypes.TRACKER_CLIENT_KEYS.includes("derived"));
assert.ok(!trackerTypes.TRACKER_CLIENT_KEYS.includes("analysis"));
assert.ok(!trackerTypes.TRACKER_CLIENT_KEYS.includes("monitoringContent"));

const transitionSource = fs.readFileSync(path.join(root, "src/lib/tracker/transition.server.ts"), "utf8");
const readSource = fs.readFileSync(path.join(root, "src/lib/tracker/read.server.ts"), "utf8");
const routeSource = fs.readFileSync(path.join(root, "src/app/api/clients/route.ts"), "utf8");
const patchSource = fs.readFileSync(path.join(root, "src/app/api/clients/[id]/route.ts"), "utf8");
const indexSource = fs.readFileSync(path.join(root, "src/lib/tracker/index.ts"), "utf8");
assert.match(transitionSource, /^import "server-only";/);
assert.match(readSource, /^import "server-only";/);
assert.match(indexSource, /^import "server-only";/);
assert.match(transitionSource, /enrollment:\$\{input\.enrollmentId\}:active/);
assert.match(transitionSource, /analysis:\$\{input\.analysisRunId\}:complete/);
assert.match(transitionSource, /tracker_transition_client_stage/);
assert.match(transitionSource, /featureFlag\("FEATURE_TRACKER"\)/);
assert.ok(transitionSource.indexOf('featureFlag("FEATURE_TRACKER")') < transitionSource.indexOf('import\("@\/lib\/supabase\/admin"\)'));
assert.doesNotMatch(transitionSource + readSource, /\.from\("stage_history"\)\.(?:insert|update|delete)/s);
assert.doesNotMatch(transitionSource + readSource, /\.from\("clients"\)\.update\([^)]*stage/s);
assert.ok(routeSource.indexOf('featureFlag("FEATURE_TRACKER")') < routeSource.indexOf('import\("@\/lib\/auth\/session"\)'));
assert.match(patchSource, /const \{ id \} = await context\.params/);
assert.match(patchSource, /transitionClientStage/);
assert.doesNotMatch(routeSource + patchSource + transitionSource, /process\.env|NEXT_PUBLIC_.*TRACKER/);

function trackerClient(id, displayName) {
  return {
    id,
    consumerProfileId: null,
    displayName,
    businessName: null,
    assignedToId: null,
    assignedToName: null,
    stage: "onboarding",
    stageEnteredAt: "2026-08-16T12:00:00.000Z",
    startedAt: "2026-08-16T12:00:00.000Z",
    history: [],
    analysisAt: null,
    readiness: null,
    openActionCount: null,
    estimatedCompletionAt: null,
    monitoring: "pending",
    nextRefreshAt: null,
    goalCents: null,
    matchesUnlockedOverride: false,
    fundingApprovedCents: null,
    health: "green",
    status: "active",
    lastActivityAt: "2026-08-16T12:00:00.000Z",
    archivedAt: null,
    archivedById: null,
  };
}

const authoritativeInitial = trackerClient("10000000-0000-0000-0000-000000000001", "Initial GET row");
const authoritativeRefresh = trackerClient("10000000-0000-0000-0000-000000000002", "Refetched GET row");
const reads = [
  { enabled: true, clients: [authoritativeInitial] },
  { enabled: true, clients: [authoritativeRefresh] },
];
const replacements = [];
const subscriptions = [];
const scheduled = [];
const cancelled = [];
let fetchCount = 0;
const controller = realtime.createTrackerRealtimeController({
  audience: "operator",
  cancelSchedule(handle) {
    cancelled.push(handle);
    handle.cancelled = true;
  },
  fetchClients: async () => reads[fetchCount++],
  replaceState(response) {
    replacements.push(response);
  },
  schedule(callback) {
    const handle = { callback, cancelled: false };
    scheduled.push(handle);
    return handle;
  },
  subscribe(scope, invalidate) {
    const record = { invalidate, scope, unsubscribed: false };
    subscriptions.push(record);
    return () => {
      record.unsubscribed = true;
    };
  },
});

await controller.start();
assert.equal(fetchCount, 1);
assert.deepEqual(replacements, [{ enabled: true, clients: [authoritativeInitial] }]);
assert.deepEqual(subscriptions[0].scope, { audience: "operator" });

subscriptions[0].invalidate({ new: { id: "payload-insert", display_name: "Payload INSERT row" } });
subscriptions[0].invalidate({ new: { id: "payload-update", display_name: "Payload UPDATE row" } });
assert.equal(scheduled.length, 1, "INSERT and UPDATE invalidations must debounce to one GET");
scheduled[0].callback();
await new Promise((resolve) => setImmediate(resolve));
assert.equal(fetchCount, 2);
assert.deepEqual(replacements.at(-1), { enabled: true, clients: [authoritativeRefresh] });
assert.ok(!JSON.stringify(replacements).includes("Payload INSERT row"));
assert.ok(!JSON.stringify(replacements).includes("Payload UPDATE row"));

subscriptions[0].invalidate({ new: { id: "after-cleanup" } });
const pendingAfterCleanup = scheduled.at(-1);
controller.dispose();
assert.equal(subscriptions[0].unsubscribed, true);
assert.ok(cancelled.includes(pendingAfterCleanup));
pendingAfterCleanup.callback();
subscriptions[0].invalidate({ new: { id: "later-callback" } });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(fetchCount, 2, "cleanup must suppress later fetches");

let disabledSubscriptions = 0;
const disabledController = realtime.createTrackerRealtimeController({
  audience: "operator",
  cancelSchedule() {},
  fetchClients: async () => ({ enabled: false, clients: [] }),
  replaceState(response) {
    assert.deepEqual(response, { enabled: false, clients: [] });
  },
  schedule() {
    throw new Error("disabled tracker must not schedule a refetch");
  },
  subscribe() {
    disabledSubscriptions += 1;
    return () => {};
  },
});
await disabledController.start();
assert.equal(disabledSubscriptions, 0, "disabled GET must not load the subscription transport");
disabledController.dispose();

let consumerScope;
const consumerController = realtime.createTrackerRealtimeController({
  audience: "consumer",
  cancelSchedule() {},
  fetchClients: async () => ({ enabled: true, clients: [authoritativeInitial] }),
  replaceState() {},
  schedule() {
    throw new Error("consumer scope proof does not schedule");
  },
  subscribe(scope) {
    consumerScope = scope;
    return () => {};
  },
});
await consumerController.start();
assert.deepEqual(consumerScope, {
  audience: "consumer",
  clientId: authoritativeInitial.id,
});
consumerController.dispose();

const realtimeClientSource = fs.readFileSync(path.join(root, "src/lib/tracker/realtime.client.ts"), "utf8");
const realtimeSource = fs.readFileSync(realtimePath, "utf8");
assert.match(realtimeClientSource, /^"use client";/);
assert.match(realtimeClientSource, /import\("@\/lib\/supabase\/client"\)/);
assert.match(realtimeClientSource, /event:\s*"INSERT"/);
assert.match(realtimeClientSource, /event:\s*"UPDATE"/);
assert.match(realtimeClientSource, /filter:\s*`id=eq\.\$\{scope\.clientId\}`/);
assert.doesNotMatch(realtimeClientSource, /FEATURE_TRACKER|process\.env|supabase\/(?:admin|server)/);
assert.doesNotMatch(realtimeClientSource + realtimeSource, /supabase_realtime|C9-ACCOUNT.*confirmed/i);

const operatorSource = fs.readFileSync(path.join(root, "src/components/surfaces/operator.tsx"), "utf8");
const persistedRenderer = operatorSource.slice(
  operatorSource.indexOf("function renderPersistedClientsTracker"),
  operatorSource.indexOf("function renderClientsTracker"),
);
assert.match(operatorSource, /active:\s*view === "clients" && clientsTab === "tracker"/);
assert.match(operatorSource, /if \(trackerClients\.enabled !== false\)/);
assert.match(operatorSource, /body:\s*JSON\.stringify\(\{ displayName \}\)/);
assert.match(operatorSource, /method:\s*"POST"/);
assert.ok(
  operatorSource.indexOf("await trackerClients.refetch()") <
    operatorSource.indexOf('setLeadCaptureOpen(false)', operatorSource.indexOf("async function createPersistedTrackerClient")),
);
assert.match(operatorSource, /Client saved to the funding-readiness tracker\./);
assert.match(operatorSource, /Unable to save this client to the funding-readiness tracker\./);
assert.match(operatorSource, /Unable to load the funding-readiness tracker\./);
assert.match(persistedRenderer, /client\.history/);
assert.match(persistedRenderer, /trackerStageTimer\(/);
assert.doesNotMatch(persistedRenderer, /openClient\(|CLIENT_DETAILS|filteredClients\b|as Client\b/);
assert.doesNotMatch(operatorSource, /FEATURE_TRACKER|process\.env/);

console.log("Tracker contract verification passed.");
