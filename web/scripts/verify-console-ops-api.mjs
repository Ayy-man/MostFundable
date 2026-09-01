#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";

const webRoot = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(webRoot, "..");

function stackEnv() {
  const status = spawnSync("supabase", ["status", "-o", "env"], { cwd: repoRoot, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  if (status.status !== 0) throw new Error("The shared local Supabase stack is unavailable.");
  const values = {};
  for (const line of status.stdout.split("\n")) {
    const match = /^([A-Z0-9_]+)="?(.*?)"?$/.exec(line.trim());
    if (match) values[match[1]] = match[2];
  }
  assert.ok(values.API_URL && values.ANON_KEY && values.SERVICE_ROLE_KEY);
  return values;
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { const address = server.address(); const port = typeof address === "object" && address ? address.port : 0; server.close(() => resolve(port)); });
  });
}

const stack = stackEnv();
const db = createClient(stack.API_URL, stack.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;
const child = spawn("npm", ["run", "start", "--", "-p", String(port)], {
  cwd: webRoot,
  detached: true,
  stdio: "ignore",
  env: {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: stack.API_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: stack.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: stack.SERVICE_ROLE_KEY,
    FEATURE_TRACKER: "1",
    FEATURE_ANCILLARY: "1",
    FEATURE_CONSOLE_OPS: "1",
  },
});

async function api(route, actorId, init = {}) {
  const response = await fetch(`${baseUrl}${route}`, { ...init, headers: { "x-mf-demo-profile-id": actorId, ...(init.headers ?? {}) } });
  const value = (response.headers.get("content-type") ?? "").includes("json") ? await response.json() : null;
  return { response, value };
}

try {
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try { const response = await fetch(`${baseUrl}/`); if (response.status < 500) { ready = true; break; } } catch {}
    await delay(500);
  }
  assert.ok(ready, "production server did not become ready");

  const adminResult = await db.from("profiles").select("id").eq("role", "platform_admin").limit(1).single();
  const operatorResult = await db.from("profiles").select("id,org_id").eq("role", "operator_member").in("org_role", ["owner", "admin", "commando"]).not("org_id", "is", null).limit(1).single();
  assert.equal(adminResult.error, null); assert.equal(operatorResult.error, null);
  const adminId = adminResult.data.id; const operatorId = operatorResult.data.id; const orgId = operatorResult.data.org_id;
  const marker = randomUUID().slice(0, 8);
  const now = Date.now();
  const clients = [
    { id: randomUUID(), display_name: `Console quiet red ${marker}`, stage: "ready", stage_entered_at: new Date(now - 2 * 86_400_000).toISOString(), last_activity_at: new Date(now - 14 * 86_400_000).toISOString(), expected: "red" },
    { id: randomUUID(), display_name: `Console target red ${marker}`, stage: "optimization", stage_entered_at: new Date(now - 61 * 86_400_000).toISOString(), last_activity_at: new Date(now).toISOString(), expected: "red" },
    { id: randomUUID(), display_name: `Console amber ${marker}`, stage: "optimization", stage_entered_at: new Date(now - 50 * 86_400_000).toISOString(), last_activity_at: new Date(now).toISOString(), expected: "amber" },
    { id: randomUUID(), display_name: `Console green ${marker}`, stage: "optimization", stage_entered_at: new Date(now - 10 * 86_400_000).toISOString(), last_activity_at: new Date(now).toISOString(), expected: "green" },
  ];
  const inserted = await db.from("clients").insert(clients.map((client) => ({
    id: client.id, display_name: client.display_name, stage: client.stage,
    stage_entered_at: client.stage_entered_at, last_activity_at: client.last_activity_at,
    org_id: orgId, assigned_to: operatorId,
  })));
  assert.equal(inserted.error, null);

  const listed = await api("/api/clients", operatorId);
  assert.equal(listed.response.status, 200); assert.equal(listed.value.consoleOpsEnabled, true);
  const visible = listed.value.clients.filter((row) => clients.some((client) => client.id === row.id));
  assert.deepEqual(visible.map((row) => row.health), ["red", "red", "amber", "green"]);

  const target = clients[3];
  const archived = await api(`/api/clients/${target.id}`, operatorId, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "archived" }) });
  assert.equal(archived.response.status, 200);
  const archivedRow = await db.from("clients").select("status,archived_at,archived_by").eq("id", target.id).single();
  assert.equal(archivedRow.data?.status, "archived"); assert.ok(archivedRow.data?.archived_at); assert.equal(archivedRow.data?.archived_by, operatorId);
  const archiveAudit = await db.from("audit_log").select("id").eq("subject_id", target.id).eq("action", "client.status.changed");
  assert.equal(archiveAudit.data?.length, 1);
  const afterArchive = await api("/api/clients", operatorId); assert.equal(afterArchive.value.clients.some((row) => row.id === target.id), false);
  const restored = await api(`/api/clients/${target.id}`, operatorId, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "active" }) });
  assert.equal(restored.response.status, 200);
  const restoredRow = await db.from("clients").select("status,archived_at,archived_by").eq("id", target.id).single();
  assert.deepEqual(restoredRow.data, { status: "active", archived_at: null, archived_by: null });
  const restoreAudits = await db.from("audit_log").select("id").eq("subject_id", target.id).eq("action", "client.status.changed"); assert.equal(restoreAudits.data?.length, 2);

  const publishedId = randomUUID();
  const fixtureAt = new Date().toISOString();
  const publishedInsert = await db.from("trainings").insert({ id: publishedId, org_id: orgId, audience: "client", source: "operator", title: `Published fixture ${marker}`, video_url: "https://youtu.be/console-fixture", body: "Local fixture body.", published: true, published_at: fixtureAt, published_by: operatorId, attested: true, attested_at: fixtureAt, attestation_text: "PGTAP_FIXTURE_ONLY", created_by: operatorId });
  assert.equal(publishedInsert.error, null);
  const edited = await api(`/api/trainings/${publishedId}`, operatorId, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ audience: "client", title: `Edited fixture ${marker}`, videoUrl: "https://youtu.be/console-fixture", body: "Edited local fixture body." }) });
  assert.equal(edited.response.status, 200);
  const editedRow = await db.from("trainings").select("published,published_at,published_by,attested,attested_at,attestation_text").eq("id", publishedId).single();
  assert.deepEqual(editedRow.data, { published: false, published_at: null, published_by: null, attested: false, attested_at: null, attestation_text: null });
  const editAudit = await db.from("audit_log").select("id").eq("subject_id", publishedId).eq("action", "training.updated"); assert.equal(editAudit.data?.length, 1);
  console.log("SKIPPED real training publish/edit arm: TRAINING_ATTESTATION_TEXT is absent; HTTP edit used a database-owned fixture.");

  const platformId = randomUUID();
  const platformInsert = await db.from("trainings").insert({ id: platformId, org_id: null, audience: "operator", source: "platform", title: `Platform fixture ${marker}`, video_url: "https://www.loom.com/share/console-fixture", body: "Platform fixture body.", created_by: adminId });
  assert.equal(platformInsert.error, null);
  const missing = await api(`/api/trainings/${platformId}/publication`, adminId, { method: "DELETE" }); assert.equal(missing.response.status, 400);
  const reason = `Local policy review ${marker}`;
  const takenDown = await api(`/api/trainings/${platformId}/publication`, adminId, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason }) }); assert.equal(takenDown.response.status, 200);
  const takenDownRow = await db.from("trainings").select("takedown_reason,taken_down_by,taken_down_at").eq("id", platformId).single();
  assert.equal(takenDownRow.data?.takedown_reason, reason); assert.equal(takenDownRow.data?.taken_down_by, adminId); assert.ok(takenDownRow.data?.taken_down_at);
  const operatorTrainings = await api("/api/trainings", operatorId); const visiblePlatform = operatorTrainings.value.trainings.find((row) => row.id === platformId); assert.equal(visiblePlatform.takedownReason, reason);

  console.log(`Console operations API verification passed: health order, archive read-back, training edit reset, and takedown reason; retained fixture ids ${clients.map(({ id }) => id).concat([publishedId, platformId]).join(",")}.`);
} finally {
  try { process.kill(-child.pid, "SIGTERM"); } catch { try { child.kill("SIGTERM"); } catch {} }
}
