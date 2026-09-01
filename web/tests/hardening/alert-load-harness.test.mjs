import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { executeLoad, runSelfTest, validateProfile } from "../../scripts/verify-alert-batch-load.mjs";

const fixture = path.resolve("tests/hardening/fixtures/alert-envelope.json");

function profile(target) {
  return {
    version: 1,
    target,
    concurrency: 3,
    eventCount: 6,
    payloadFixture: fixture,
    payloadMaxBytes: 1024,
    latencyPercentile: 95,
    latencyCeilingMs: 2_000,
    maxErrorRate: 0,
    recordedBy: "Ayman",
    recordedAt: "2026-08-16T00:00:00.000Z",
    source: "synthetic-test",
  };
}

async function withServer(handler, callback) {
  const server = createServer(handler);
  const port = await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
  try {
    return await callback(`http://127.0.0.1:${port}/batch`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("self-test exercises success, threshold, refusal, payload, and redaction", async () => {
  assert.match(await runSelfTest(), /self-test passed/);
});

test("a successful run sends exactly eventCount and writes no sensitive material", async () => {
  let count = 0;
  await withServer((request, response) => {
    count += 1;
    request.resume();
    response.writeHead(204).end();
  }, async (target) => {
    const result = await executeLoad({ profile: profile(target), profileDirectory: process.cwd(), authorization: "Bearer never-record-this" });
    assert.equal(result.verdict, "PASS");
    assert.deepEqual(result.counts, { attempted: 6, accepted: 6, failed: 0 });
    assert.equal(count, 6);
    assert.doesNotMatch(JSON.stringify(result), /never-record-this|member_ref|hook_id/);
  });
});

test("one failed request closes counts but fails the zero-error threshold", async () => {
  let count = 0;
  await withServer((request, response) => {
    count += 1;
    request.resume();
    response.writeHead(count === 3 ? 503 : 204).end();
  }, async (target) => {
    const result = await executeLoad({ profile: profile(target), profileDirectory: process.cwd() });
    assert.equal(result.verdict, "FAIL");
    assert.deepEqual(result.counts, { attempted: 6, accepted: 5, failed: 1 });
  });
});

test("missing profile fields and oversized envelopes refuse before network work", async () => {
  assert.ok(validateProfile({ ...profile("http://127.0.0.1/batch"), eventCount: "UNKNOWN" }).some((error) => error.includes("eventCount")));
  let count = 0;
  await withServer((request, response) => { count += 1; request.resume(); response.writeHead(204).end(); }, async (target) => {
    const result = await executeLoad({ profile: { ...profile(target), payloadMaxBytes: 1 }, profileDirectory: process.cwd() });
    assert.equal(result.verdict, "FAIL");
    assert.equal(count, 0);
  });
});

test("CLI refuses absent and skeleton profiles without printing PASS", async () => {
  const absent = spawnSync(process.execPath, ["scripts/verify-alert-batch-load.mjs"], { encoding: "utf8" });
  assert.notEqual(absent.status, 0);
  assert.doesNotMatch(absent.stdout, /PASS/);
  const skeleton = spawnSync(process.execPath, ["scripts/verify-alert-batch-load.mjs", "--profile", "../docs/handover/alert-load-profile.json"], { encoding: "utf8" });
  assert.notEqual(skeleton.status, 0);
  assert.doesNotMatch(skeleton.stdout, /"verdict":"PASS"/);
});

test("receipt creation is exclusive and remains redacted", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "mf-alert-load-"));
  const receipt = path.join(directory, "receipt.json");
  await withServer((request, response) => { request.resume(); response.writeHead(204).end(); }, async (target) => {
    const result = await executeLoad({ profile: profile(target), profileDirectory: process.cwd(), authorization: "Bearer hidden" });
    await writeFile(receipt, JSON.stringify(result), { flag: "wx" });
    assert.doesNotMatch(await readFile(receipt, "utf8"), /Bearer hidden|ACCALERT/);
    await assert.rejects(writeFile(receipt, "replace", { flag: "wx" }));
  });
});
