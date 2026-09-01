import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync(new URL("./read.server.ts", import.meta.url), "utf8");
const realtime = readFileSync(new URL("./realtime.client.ts", import.meta.url), "utf8");
const operator = readFileSync(new URL("../../components/surfaces/operator.tsx", import.meta.url), "utf8");

describe("tracker server read/write contract", () => {
  it("carries the no-affiliate filter to the database without a local override", () => {
    assert.match(source, /filters\.affiliate === "none"[^\n]*query\.is\("affiliate_id", null\)/);
    assert.match(realtime, /params\.set\("affiliate", filters\.affiliate\)/);
    assert.match(operator, /affiliateFilter === "none" \|\| isTrackerUuid\(affiliateFilter\)/);
    const liveFilter = operator.slice(operator.indexOf("const filteredTrackerClients"));
    assert.doesNotMatch(liveFilter.slice(0, liveFilter.indexOf("if (trackerClients.loading")), /matchesAffiliate/);
  });

  it("defaults to active before tenant filters and widens only for explicit all", () => {
    assert.match(source, /if \(filters\.status !== "all"\)/);
    assert.match(source, /query = query\.eq\("status", filters\.status \?\? "active"\)/);
    assert.ok(source.indexOf('filters.status ?? "active"') < source.indexOf('session.role === "consumer"'));
  });

  it("uses one batch health RPC and fails closed through the validator", () => {
    assert.equal(source.match(/tracker_client_health_batch/g)?.length, 1);
    assert.match(source, /validateTrackerHealthRows\(ids,/);
  });

  it("projects the assigned member's stored role and active state", () => {
    assert.match(source, /select\("id, full_name, org_role, disabled_at"\)/);
    assert.match(source, /assignedToOrgRole: assignee\?\.org_role \?\? null/);
    assert.match(source, /assignedToActive: assignee === undefined \? null : assignee\.disabled_at === null/);
  });

  it("reads latest monitoring consent and refreshes operators on withdrawal", () => {
    assert.match(source, /\.from\("consents"\)[\s\S]*?\.eq\("kind", "monitoring"\)\.eq\("action", "granted"\)/);
    assert.match(source, /\.from\("consent_revocations"\)[\s\S]*?\.eq\("kind", "monitoring"\)/);
    assert.match(source, /latestAuthorizationByClient\(consentEvents\)/);
    assert.match(source, /monitoringState\(enrollment\?\.status, monitoringAuthorized\.get\(row\.id\) === true\)/);
    assert.match(realtime, /event: "INSERT", schema: "public", table: "consent_revocations"/);
  });

  it("derives current open actions through the Optimization contract", () => {
    assert.match(source, /buildConsumerOptimization\(\{/);
    assert.match(source, /openActionCount\(buildConsumerOptimization/);
    assert.match(source, /\.from\("plans"\)[\s\S]*?\.order\("version", \{ ascending: false \}\)/);
    assert.doesNotMatch(source, /const openCounts = new Map/);
  });

  it("uses only the status RPC for the new mutation", () => {
    const start = source.indexOf("export async function setTrackerClientStatus");
    const statusBody = source.slice(start, source.indexOf("export async function createTrackerClient", start));
    assert.match(statusBody, /\.rpc\("set_client_status"/);
    assert.doesNotMatch(statusBody, /\.from\("(clients|audit_log)"\)\.(update|insert)/);
  });

  it("pins mutation read-back to the already-authorized organization and exact client", () => {
    const helper = source.slice(source.indexOf("async function mutationReadbackClient"));
    assert.match(helper, /createAdminClient\(\)/);
    assert.match(helper, /\.eq\("org_id", session\.orgId\)/);
    assert.match(helper, /\.eq\("id", clientId\)/);
    assert.doesNotMatch(helper, /consumer_profile_id|assigned_to", session\.id/);
  });

  it("projects only active operator members from this organization as assignment choices", () => {
    const start = source.indexOf("export async function listTrackerAssignableMembers");
    const end = source.indexOf("export async function readTrackerClient", start);
    const helper = source.slice(start, end);
    assert.match(helper, /\.eq\("org_id", session\.orgId\)/);
    assert.match(helper, /\.eq\("role", "operator_member"\)/);
    assert.match(helper, /\.is\("disabled_at", null\)/);
    assert.match(helper, /isTrackerAssigneeOrgRole\(row\.org_role\)/);
    assert.match(helper, /isCurrentUser: row\.id === session\.id/);
  });

  it("rechecks assignment availability before the authorized client update", () => {
    const start = source.indexOf("export async function updateTrackerClientMetadata");
    const end = source.indexOf("async function mutationReadbackClient", start);
    const helper = source.slice(start, end);
    assert.match(helper, /const before = await readTrackerClient\(session, clientId\)/);
    assert.match(helper, /\.eq\("id", patch\.assignedToId\)/);
    assert.match(helper, /\.eq\("org_id", session\.orgId\)/);
    assert.match(helper, /\.eq\("role", "operator_member"\)/);
    assert.match(helper, /\.is\("disabled_at", null\)/);
    assert.match(helper, /new TrackerDataError\("invalid_assignee"\)/);
    assert.match(helper, /\.update\(update, \{ count: "exact" \}\)/);
    assert.match(helper, /\.eq\("id", clientId\)[\s\S]*?\.eq\("org_id", session\.orgId\)[\s\S]*?\.eq\("status", "active"\)/);
    assert.match(helper, /if \(count !== 1\) return null/);
  });

  /**
   * No INSERT ... RETURNING on `clients`, anywhere the session client can run.
   *
   * `clients_select_authenticated` decides visibility through
   * `private.can_access_client(id)`, which re-queries the clients table by id.
   * Postgres applies SELECT policies to rows an INSERT ... RETURNING hands
   * back, and a query inside the same command cannot see the row that command
   * is inserting — so the policy answers false and the insert dies with 42501
   * for every real operator session. Found live on the deployment the first
   * night FEATURE_REAL_AUTH ran (POST /api/clients answered 500 on beat 8:30
   * of the Milestone-2 script), reproduced locally byte-for-byte, and green on
   * every REAL_AUTH-off arm because those run on the admin client.
   *
   * The rule is the class, not the site: scanned across every server lib and
   * route, so a new clients insert written with `.select(` chained fails here
   * before it fails in production.
   */
  it("never chains RETURNING onto a clients insert in server code", async () => {
    const { readdir } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const roots = [
      fileURLToPath(new URL("../../lib", import.meta.url)),
      fileURLToPath(new URL("../../app", import.meta.url)),
    ];
    const offenders: string[] = [];
    async function walk(dir: string): Promise<void> {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) { await walk(path); continue; }
        if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) continue;
        const text = readFileSync(path, "utf8");
        for (const match of text.matchAll(/\.from(?:<[^>]+>)?\("clients"\)\s*\.insert\(/g)) {
          const rest = text.slice(match.index, match.index + 600);
          const statement = rest.slice(0, rest.indexOf(";") === -1 ? undefined : rest.indexOf(";"));
          if (/\.select\(/.test(statement)) {
            offenders.push(`${path.slice(path.indexOf("src/"))}:${text.slice(0, match.index).split("\n").length}`);
          }
        }
      }
    }
    for (const root of roots) await walk(root);
    assert.deepEqual(offenders, [], `clients INSERT...RETURNING under RLS: ${offenders.join(", ")}`);
  });

  /**
   * The queued/running hint reads `analysis_jobs` through the admin client
   * because `authenticated` deliberately holds no grant there (migration 030).
   * Two properties keep that safe: the ids it queries are exactly the rows the
   * session's own RLS-filtered read returned, and its failure degrades to "no
   * hint" instead of failing the tracker read. The status list is checked
   * against the worker's own union so a renamed job status fails here instead
   * of silently dropping the hint.
   */
  it("derives the pending-analysis hint only for session-visible ids and only from live job statuses", () => {
    const helper = source.slice(source.indexOf("async function pendingAnalysisByClient"), source.indexOf("async function hydrate"));
    assert.ok(helper.length > 0, "pendingAnalysisByClient not found");
    assert.match(source, /pendingAnalysisByClient\(ids\)/, "the hint must be keyed on hydrate's already-authorized ids");
    assert.match(helper, /if \(error\) return pending;/, "a failed jobs read must degrade to no hint");

    const queried = helper.match(/\.in\("status", \[([^\]]+)\]\)/);
    assert.ok(queried, "the jobs query lost its status filter");
    const statuses = Array.from(queried[1].matchAll(/"([a-z]+)"/g), (match) => match[1]);
    const ports = readFileSync(new URL("../analysis/ports.ts", import.meta.url), "utf8");
    const union = ports.match(/export type AnalysisJobStatus = ([^;]+);/);
    assert.ok(union, "AnalysisJobStatus union not found in ports.ts");
    const members = Array.from(union[1].matchAll(/'([a-z]+)'/g), (match) => match[1]);
    for (const status of statuses) {
      assert.ok(members.includes(status), `queried job status "${status}" is not in the worker's AnalysisJobStatus union`);
    }
    for (const terminal of ["succeeded", "failed", "cancelled"]) {
      assert.ok(members.includes(terminal), `expected terminal status "${terminal}" missing from the union — re-derive this test`);
      assert.ok(!statuses.includes(terminal), `terminal status "${terminal}" must not read as a pending hint`);
    }
  });

  it("mints the created id in the application and reads it back in its own statement", () => {
    const body = source.slice(source.indexOf("export async function createTrackerClient"));
    assert.match(body, /const createdId = crypto\.randomUUID\(\)/);
    assert.match(body, /id: createdId,/);
    assert.match(body, /readTrackerClient\(session, createdId\)/);
  });
});
