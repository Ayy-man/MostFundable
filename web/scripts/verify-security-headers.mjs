#!/usr/bin/env node

import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const defaultContractPath = resolve(scriptDir, "../tests/hardening/security-contract.json");

export function parseArguments(argv) {
  const options = { url: null, buildRef: null, environment: "local", receipt: null, selfTest: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--url") options.url = argv[++index];
    else if (arg === "--build-ref") options.buildRef = argv[++index];
    else if (arg === "--environment") options.environment = argv[++index];
    else if (arg === "--receipt") options.receipt = argv[++index];
    else if (arg === "--self-test") options.selfTest = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!new Set(["local", "deployed"]).has(options.environment)) throw new Error("environment must be local or deployed");
  return options;
}

function validatePredicate(value, predicate) {
  if (predicate.type === "exact") return value === predicate.value;
  if (predicate.type === "includes") return value.includes(predicate.value);
  throw new Error(`unknown predicate: ${predicate.type}`);
}

export function validateHeaders(headers, contract, environment) {
  const findings = [];
  for (const rule of contract.required.filter(({ environments }) => environments.includes(environment))) {
    const value = headers.get(rule.name);
    if (value === null) findings.push({ id: "MISSING_HEADER", header: rule.name });
    else if (!validatePredicate(value, rule.predicate)) findings.push({ id: "MALFORMED_HEADER", header: rule.name });
  }
  return findings;
}

export async function verifyUrl({ url, buildRef, environment, contract }) {
  if (environment === "deployed" && (!url || !buildRef)) {
    return {
      verdict: "UNVERIFIED-FOR-ACCOUNT",
      environment,
      buildRef: buildRef ?? null,
      findings: [{ id: "DEPLOYED_INPUT_REQUIRED" }],
    };
  }
  if (!url) throw new Error("--url is required");
  const requested = new URL(contract.route, url);
  if (!new Set(["http:", "https:"]).has(requested.protocol)) throw new Error("URL must use HTTP or HTTPS");
  const response = await fetch(requested, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
  const findings = [];
  if (response.status >= 300 && response.status < 400) findings.push({ id: "REDIRECT_REFUSED" });
  else if (response.status < 200 || response.status >= 300) findings.push({ id: "UNEXPECTED_STATUS", status: response.status });
  findings.push(...validateHeaders(response.headers, contract, environment));
  return {
    verdict: findings.length === 0 ? "PASS" : "FAIL",
    environment,
    origin: requested.origin,
    path: requested.pathname,
    buildRef: buildRef ?? null,
    status: response.status,
    findings,
  };
}

function loadContract() {
  return JSON.parse(readFileSync(defaultContractPath, "utf8"));
}

async function selfTest() {
  const contract = loadContract();
  const headers = Object.fromEntries(contract.required.map((rule) => [rule.name, rule.predicate.value]));
  const server = createServer((_request, response) => {
    response.writeHead(200, headers);
    response.end("ok");
  });
  await new Promise((resolveReady) => server.listen(0, "127.0.0.1", resolveReady));
  try {
    const address = server.address();
    const receipt = await verifyUrl({
      url: `http://127.0.0.1:${address.port}`,
      buildRef: "self-test",
      environment: "local",
      contract,
    });
    if (receipt.verdict !== "PASS") throw new Error("complete synthetic header set did not pass");
    return { verdict: "PASS", checks: contract.required.length };
  } finally {
    await new Promise((resolveClosed, reject) => server.close((error) => error ? reject(error) : resolveClosed()));
  }
}

async function main() {
  let result;
  try {
    const options = parseArguments(process.argv.slice(2));
    result = options.selfTest
      ? await selfTest()
      : await verifyUrl({ ...options, contract: loadContract() });
    const rendered = `${JSON.stringify(result)}\n`;
    if (options.receipt) writeFileSync(resolve(options.receipt), rendered, { flag: "wx" });
    process.stdout.write(rendered);
    if (result.verdict !== "PASS") process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ verdict: "FAIL", error: error.message })}\n`);
    process.exitCode = 1;
  }
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) await main();
