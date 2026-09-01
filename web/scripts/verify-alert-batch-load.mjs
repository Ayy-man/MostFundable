#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const SCRIPT_VERSION = 1;
const SUPPORTED_PERCENTILES = new Set([50, 90, 95, 99]);
const UNKNOWN = "UNKNOWN";

function isUnknown(value) {
  return value === undefined || value === null || value === "" || value === UNKNOWN;
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function positiveNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function validateProfile(profile) {
  const errors = [];
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) return ["profile must be a JSON object"];
  if (profile.version !== 1) errors.push("version must be 1");
  if (isUnknown(profile.target)) errors.push("target is required");
  if (!positiveInteger(profile.concurrency)) errors.push("concurrency must be a positive integer");
  if (!positiveInteger(profile.eventCount)) errors.push("eventCount must be a positive integer");
  if (typeof profile.payloadFixture !== "string" || isUnknown(profile.payloadFixture)) errors.push("payloadFixture is required");
  if (!positiveInteger(profile.payloadMaxBytes)) errors.push("payloadMaxBytes must be a positive integer");
  if (!SUPPORTED_PERCENTILES.has(profile.latencyPercentile)) errors.push("latencyPercentile must be one of 50, 90, 95, or 99");
  if (!positiveNumber(profile.latencyCeilingMs)) errors.push("latencyCeilingMs must be positive");
  if (typeof profile.maxErrorRate !== "number" || !Number.isFinite(profile.maxErrorRate) || profile.maxErrorRate < 0 || profile.maxErrorRate > 1) {
    errors.push("maxErrorRate must be between 0 and 1");
  }
  for (const field of ["recordedBy", "recordedAt", "source"]) {
    if (typeof profile[field] !== "string" || isUnknown(profile[field])) errors.push(`${field} is required`);
  }
  if (!isUnknown(profile.recordedAt) && Number.isNaN(Date.parse(profile.recordedAt))) errors.push("recordedAt must be an ISO date-time");
  try {
    if (!isUnknown(profile.target)) {
      const target = new URL(profile.target);
      if (!/^https?:$/.test(target.protocol)) errors.push("target must use http or https");
      if (target.username || target.password || target.search || target.hash) errors.push("target must not contain credentials, query, or fragment");
    }
  } catch {
    if (!isUnknown(profile.target)) errors.push("target must be a valid URL");
  }
  return errors;
}

function percentile(values, selected) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil((selected / 100) * sorted.length) - 1);
  return sorted[index];
}

function gitSha(cwd) {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "UNKNOWN";
  }
}

export async function loadProfile(profilePath) {
  const absolute = path.resolve(profilePath);
  const profile = JSON.parse(await readFile(absolute, "utf8"));
  return { profile, profilePath: absolute, profileDirectory: path.dirname(absolute) };
}

export async function executeLoad({ profile, profileDirectory, authorization = "", fetchImpl = fetch, repositoryRoot = path.resolve(profileDirectory, "../..") }) {
  const errors = validateProfile(profile);
  if (errors.length > 0) return { verdict: "OPEN", errors };

  const payloadPath = path.resolve(profileDirectory, profile.payloadFixture);
  const payload = await readFile(payloadPath);
  if (payload.byteLength > profile.payloadMaxBytes) {
    return { verdict: "FAIL", errors: [`payload exceeds payloadMaxBytes (${payload.byteLength} > ${profile.payloadMaxBytes})`] };
  }
  JSON.parse(payload.toString("utf8"));

  const latencies = [];
  let cursor = 0;
  let accepted = 0;
  let failed = 0;
  const headers = { "content-type": "application/json" };
  if (authorization) headers.authorization = authorization;

  async function worker() {
    while (true) {
      const sequence = cursor;
      cursor += 1;
      if (sequence >= profile.eventCount) return;
      const started = performance.now();
      try {
        const response = await fetchImpl(profile.target, { method: "POST", headers, body: payload });
        latencies.push(performance.now() - started);
        if (response.ok) accepted += 1;
        else failed += 1;
      } catch {
        latencies.push(performance.now() - started);
        failed += 1;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(profile.concurrency, profile.eventCount) }, () => worker()));
  const attempted = accepted + failed;
  const selectedLatency = percentile(latencies, profile.latencyPercentile);
  const errorRate = attempted === 0 ? 1 : failed / attempted;
  const countsClose = attempted === profile.eventCount;
  const thresholdsClose = selectedLatency !== null && selectedLatency <= profile.latencyCeilingMs && errorRate <= profile.maxErrorRate;
  const verdict = countsClose && thresholdsClose ? "PASS" : "FAIL";

  return {
    scriptVersion: SCRIPT_VERSION,
    recordedAtUtc: new Date().toISOString(),
    gitSha: gitSha(repositoryRoot),
    mode: "nightly-alert-batch",
    inputs: {
      target: new URL(profile.target).origin + new URL(profile.target).pathname,
      concurrency: profile.concurrency,
      eventCount: profile.eventCount,
      payloadBytes: payload.byteLength,
      payloadMaxBytes: profile.payloadMaxBytes,
      latencyPercentile: profile.latencyPercentile,
      latencyCeilingMs: profile.latencyCeilingMs,
      maxErrorRate: profile.maxErrorRate,
      recordedBy: profile.recordedBy,
      recordedAt: profile.recordedAt,
      source: profile.source,
    },
    counts: { attempted, accepted, failed },
    measurements: { latencyMs: selectedLatency, errorRate },
    verdict,
  };
}

async function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

async function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

export async function runSelfTest() {
  let requests = 0;
  const server = createServer((request, response) => {
    requests += 1;
    request.resume();
    response.writeHead(204).end();
  });
  const port = await listen(server);
  const fixture = fileURLToPath(new URL("../tests/hardening/fixtures/alert-envelope.json", import.meta.url));
  const profile = {
    version: 1,
    target: `http://127.0.0.1:${port}/internal-alert-batch`,
    concurrency: 2,
    eventCount: 5,
    payloadFixture: fixture,
    payloadMaxBytes: 1024,
    latencyPercentile: 95,
    latencyCeilingMs: 5_000,
    maxErrorRate: 0,
    recordedBy: "Ayman",
    recordedAt: "2026-08-16T00:00:00.000Z",
    source: "synthetic-self-test",
  };
  try {
    const result = await executeLoad({ profile, profileDirectory: process.cwd(), authorization: "Bearer synthetic-secret" });
    if (result.verdict !== "PASS" || requests !== 5) throw new Error("success arm failed");
    if (JSON.stringify(result).includes("synthetic-secret")) throw new Error("authorization entered receipt");
    const threshold = await executeLoad({ profile: { ...profile, latencyCeilingMs: 0.000001 }, profileDirectory: process.cwd() });
    if (threshold.verdict !== "FAIL") throw new Error("threshold failure arm failed");
    const missing = validateProfile({ ...profile, concurrency: UNKNOWN });
    if (!missing.some((error) => error.includes("concurrency"))) throw new Error("missing-input arm failed");
    const oversized = await executeLoad({ profile: { ...profile, payloadMaxBytes: 1 }, profileDirectory: process.cwd() });
    if (oversized.verdict !== "FAIL") throw new Error("oversized arm failed");
  } finally {
    await close(server);
  }
  return "alert load harness self-test passed: success, threshold, refusal, payload, and redaction arms";
}

function parseArguments(argv) {
  const options = { selfTest: false, profile: null, receipt: null, authFile: null, authStdin: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--self-test") options.selfTest = true;
    else if (["--profile", "--receipt", "--auth-file"].includes(value)) {
      const next = argv[index + 1];
      if (!next) throw new Error(`${value} requires a path`);
      options[value.slice(2).replace("auth-file", "authFile")] = next;
      index += 1;
    } else if (value === "--auth-stdin") options.authStdin = true;
    else throw new Error(`unsupported argument: ${value}`);
  }
  if (options.authFile && options.authStdin) throw new Error("choose one authorization input");
  return options;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8").trim();
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.selfTest) {
    process.stdout.write(`${await runSelfTest()}\n`);
    return;
  }
  if (!options.profile) throw new Error("--profile is required; no load target is built in");
  const loaded = await loadProfile(options.profile);
  const authorization = options.authFile
    ? (await readFile(path.resolve(options.authFile), "utf8")).trim()
    : options.authStdin ? await readStdin() : "";
  const result = await executeLoad({ ...loaded, authorization });
  if (options.receipt) await writeFile(path.resolve(options.receipt), `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.verdict !== "PASS") process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    process.stderr.write(`alert load harness refused: ${error instanceof Error ? error.message : "unknown error"}\n`);
    process.exitCode = 1;
  });
}
