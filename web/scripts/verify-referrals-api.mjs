#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";

// fileURLToPath, not URL.pathname: the checkout path may contain spaces
// (this repo's does), and pathname keeps them percent-encoded, so spawnSync
// gets a cwd that does not exist and reports status null.
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const webRoot = fileURLToPath(new URL("../", import.meta.url));
const disabledPort = 3135;
const enabledPort = 3136;
const platformOrgId = "f0000000-0000-0000-0000-000000000001";

function localStackEnv() {
  const result = spawnSync("supabase", ["status", "-o", "env"], { cwd: repoRoot, encoding: "utf8" });
  assert.equal(result.status, 0, "local Supabase status must be available");
  const values = Object.fromEntries(result.stdout.split("\n").flatMap((line) => {
    const match = line.match(/^([A-Z_]+)="?(.*?)"?$/);
    return match ? [[match[1], match[2]]] : [];
  }));
  assert.ok(values.API_URL && values.ANON_KEY && values.SERVICE_ROLE_KEY, "local Supabase names must resolve");
  return {
    NEXT_PUBLIC_SUPABASE_URL: values.API_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: values.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: values.SERVICE_ROLE_KEY,
  };
}

async function waitForServer(baseUrl) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(baseUrl);
      if (response.status < 500) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Referral verifier server did not become ready.");
}

async function withServer(port, extraEnv, verify) {
  const baseUrl = `http://localhost:${port}`;
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: webRoot,
    env: { ...process.env, ...localStackEnv(), ...extraEnv },
    stdio: "ignore",
  });
  try {
    await waitForServer(baseUrl);
    await verify(baseUrl);
  } finally {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
    }
  }
}

const buildEnv = {
  ...process.env,
  ...localStackEnv(),
  FEATURE_REFERRALS: "1",
  REFERRAL_E2E: "1",
  REFERRAL_INTAKE_ORIGIN: `http://localhost:${enabledPort}`,
  REFERRAL_PLATFORM_ORG_ID: platformOrgId,
};
const build = spawnSync(process.execPath, ["node_modules/next/dist/bin/next", "build"], {
  cwd: webRoot,
  encoding: "utf8",
  env: buildEnv,
  timeout: 300_000,
});
if (build.status !== 0) process.stderr.write(build.stderr || build.stdout);
assert.equal(build.status, 0, "referral verifier production build must pass");

await withServer(disabledPort, { FEATURE_REFERRALS: "", REFERRAL_E2E: "" }, async (baseUrl) => {
  for (const [path, init] of [
    ["/api/referrals", { method: "POST" }],
    [`/api/referrals/resolve/${"a".repeat(43)}`, { redirect: "manual" }],
    ["/api/referrals/convert", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }],
  ]) {
    const response = await fetch(`${baseUrl}${path}`, init);
    assert.equal(response.status, 404);
  }
  const document = await (await fetch(baseUrl)).text();
  assert.equal(document.includes("Copy referral link"), false);
});

await withServer(enabledPort, {
  FEATURE_REFERRALS: "1",
  REFERRAL_E2E: "1",
  REFERRAL_INTAKE_ORIGIN: `http://localhost:${enabledPort}`,
  REFERRAL_PLATFORM_ORG_ID: platformOrgId,
}, async (baseUrl) => {
  const result = spawnSync(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--import", "./scripts/ts-resolve-hook.mjs", "--test", "--test-reporter=spec", "tests/e2e/referrals.test.ts"],
    { cwd: webRoot, encoding: "utf8", env: { ...process.env, ...localStackEnv(), FEATURE_REFERRALS: "1", REFERRAL_E2E: "1", REFERRAL_E2E_BASE_URL: baseUrl, REFERRAL_INTAKE_ORIGIN: baseUrl, REFERRAL_PLATFORM_ORG_ID: platformOrgId } },
  );
  if (result.status !== 0) process.stderr.write(result.stderr || result.stdout);
  assert.equal(result.status, 0, "referral e2e lifecycle must pass");
});

console.log("referral API verifier passed: flag-off 3/3, lifecycle 1/1");
