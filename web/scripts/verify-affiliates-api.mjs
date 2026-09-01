#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

// fileURLToPath, not URL.pathname: the checkout path may contain spaces
// (this repo's does), and pathname keeps them percent-encoded, so spawnSync
// gets a cwd that does not exist and reports status null.
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const webRoot = fileURLToPath(new URL("../", import.meta.url));
const disabledPort = 3155;
const enabledPort = 3156;

const requiredPasswords = ["AUTH_DEV_OPERATOR_PASSWORD", "AUTH_DEV_AFFILIATE_PASSWORD"];
const missingPasswords = requiredPasswords.filter((name) => !process.env[name]?.trim());
const portalRoute = fs.readFileSync(new URL("../src/app/api/affiliates/me/route.ts", import.meta.url), "utf8");
const wallBound = portalRoute.includes('from "@/lib/tenancy/wall"') && portalRoute.includes("assertTenantWriteAllowed(session)");

if (missingPasswords.length > 0 || !wallBound) {
  const reasons = [
    ...(missingPasswords.length > 0 ? [`missing environment names: ${missingPasswords.join(", ")}`] : []),
    ...(!wallBound ? ["Phase 20 assertTenantWriteAllowed binding is absent"] : []),
  ];
  console.error(`SKIPPED affiliate API verifier: ${reasons.join("; ")}`);
  process.exit(2);
}

function localStackEnv() {
  const result = spawnSync("supabase", ["status", "-o", "env"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, "local Supabase status must be available");
  const values = Object.fromEntries((result.stdout ?? "").split("\n").flatMap((line) => {
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

function portAvailable(port) {
  const result = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8" });
  return result.status !== 0 || (result.stdout ?? "").trim() === "";
}

async function waitForServer(baseUrl) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(baseUrl, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Affiliate verifier server did not become ready.");
}

async function withServer(port, stack, flags, verify) {
  assert.equal(portAvailable(port), true, `reserved verifier port ${port} is already in use`);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: webRoot,
    env: {
      HOME: process.env.HOME ?? "",
      NODE_ENV: "production",
      PATH: process.env.PATH ?? "",
      TMPDIR: process.env.TMPDIR ?? "/tmp",
      ...stack,
      ...flags,
    },
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

const stack = localStackEnv();
const build = spawnSync(process.execPath, ["node_modules/next/dist/bin/next", "build"], {
  cwd: webRoot,
  encoding: "utf8",
  env: {
    HOME: process.env.HOME ?? "",
    NODE_ENV: "production",
    PATH: process.env.PATH ?? "",
    TMPDIR: process.env.TMPDIR ?? "/tmp",
    ...stack,
  },
  timeout: 300_000,
});
if (build.status !== 0) process.stderr.write(build.stderr || build.stdout);
assert.equal(build.status, 0, "affiliate verifier production build must pass");

await withServer(disabledPort, stack, {}, async (baseUrl) => {
  for (const [path, init] of [
    ["/api/affiliates/me", {}],
    ["/api/affiliates/a2000000-0000-0000-0000-000000000001/share", { method: "POST", body: "{}" }],
    ["/api/affiliates/a2000000-0000-0000-0000-000000000001/shares/a3000000-0000-0000-0000-000000000002", { method: "PATCH", body: "{}" }],
  ]) {
    const response = await fetch(`${baseUrl}${path}`, init);
    assert.equal(response.status, 404);
    assert.equal(await response.text(), "");
  }
});

await withServer(enabledPort, stack, {
  FEATURE_AFFILIATES: "1",
  FEATURE_ENROLLMENT: "1",
  FEATURE_REAL_AUTH: "1",
}, async (baseUrl) => {
  const result = spawnSync(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--import", "./scripts/ts-resolve-hook.mjs", "--test", "--test-reporter=spec", "tests/e2e/affiliates.test.ts"],
    {
      cwd: webRoot,
      encoding: "utf8",
      env: {
        AFFILIATES_E2E_BASE_URL: baseUrl,
        AUTH_DEV_AFFILIATE_PASSWORD: process.env.AUTH_DEV_AFFILIATE_PASSWORD,
        AUTH_DEV_OPERATOR_PASSWORD: process.env.AUTH_DEV_OPERATOR_PASSWORD,
        HOME: process.env.HOME ?? "",
        PATH: process.env.PATH ?? "",
        TMPDIR: process.env.TMPDIR ?? "/tmp",
      },
    },
  );
  if (result.status !== 0) process.stderr.write(result.stderr || result.stdout);
  assert.equal(result.status, 0, "affiliate e2e lifecycle must pass");
  assert.match(result.stdout, /pass 1|1 passed|tests 1/i, "affiliate e2e emitted no one-test receipt");
});

console.log("affiliate API verifier passed: flag-off 3/3, authenticated lifecycle 1/1");
