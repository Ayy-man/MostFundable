#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ACCEPTANCE_STATES, flagRehearsals } from "../tests/hardening/acceptance-manifest.mjs";

const UNKNOWN = new Set(["", "UNKNOWN", "OPEN", "MISSING"]);
const DRIVER_VALUES = Object.freeze({
  CRS_DRIVER: new Set(["mock", "sandbox"]),
  BILLING_DRIVER: new Set(["mock", "stripe"]),
  IDV_DRIVER: new Set(["mock"]),
  AI_DRIVER: new Set(["mock", "openrouter"]),
  VAULT_DRIVER: new Set(["fixture", "supabase"]),
  CREDIT_REPORT_PARSER_DRIVER: new Set(["fixture", "unavailable"]),
  EMAIL_DRIVER: new Set(["mock", "resend"]),
});
const REAL_DRIVER_VALUES = new Set(["sandbox", "stripe", "openrouter", "supabase", "resend"]);

const COLUMNS = Object.freeze([
  "sequence", "flag", "mainSha", "activation", "driverBoundary", "smokeSeam",
  "onBuildDeployId", "onSmokeEvidence", "offBuildDeployId", "rollbackEvidence",
  "keyArrivalReceipt", "prerequisiteEvidence", "actor", "onUtc", "offUtc", "status",
]);

function unknown(value) {
  return UNKNOWN.has(value.trim());
}

function driverBoundary(value) {
  if (value === "none" || value === "local database") return { valid: true, real: false };
  let real = false;
  for (const raw of value.split(";").map((item) => item.trim())) {
    const match = raw.match(/^([A-Z][A-Z0-9_]*_DRIVER)=([a-z_]+)$/);
    if (!match || !DRIVER_VALUES[match[1]]?.has(match[2])) return { valid: false, real: false };
    if (REAL_DRIVER_VALUES.has(match[2])) real = true;
  }
  return { valid: true, real };
}

export function parseLedger(markdown) {
  const rows = [];
  for (const line of markdown.split(/\r?\n/)) {
    if (!/^\|\s*\d+\s*\|/.test(line)) continue;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim().replace(/^`|`$/g, ""));
    if (cells.length !== COLUMNS.length) throw new Error(`ledger row has ${cells.length} columns; expected ${COLUMNS.length}`);
    rows.push(Object.fromEntries(COLUMNS.map((column, index) => [column, cells[index]])));
  }
  return rows;
}

export function validateLedgerRows(rows) {
  const errors = [];
  const openRows = [];
  const expectedNames = flagRehearsals.map(({ name }) => name);
  if (rows.length !== expectedNames.length) errors.push(`expected ${expectedNames.length} rows, found ${rows.length}`);
  const actualNames = rows.map(({ flag }) => flag);
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) errors.push("flag order differs from the merged acceptance manifest");
  const sourceShas = new Set(rows.map(({ mainSha }) => mainSha));
  if (sourceShas.size !== 1 || [...sourceShas].some((sha) => !/^[0-9a-f]{7,40}$/.test(sha))) {
    errors.push("ledger must use one valid main SHA");
  }

  rows.forEach((row, index) => {
    const manifest = flagRehearsals[index];
    if (!manifest) return;
    if (row.sequence !== String(index + 1)) errors.push(`${row.flag} sequence is invalid`);
    if (row.activation !== manifest.activation) errors.push(`${row.flag} activation differs from the manifest`);
    if (row.smokeSeam !== manifest.smokeSeam) errors.push(`${row.flag} smoke seam differs from the manifest`);
    const boundary = driverBoundary(row.driverBoundary);
    if (!boundary.valid) errors.push(`${row.flag} driver boundary is invalid`);
    if (!ACCEPTANCE_STATES.includes(row.status)) errors.push(`${row.flag} status is invalid`);
    if (row.status !== "PASS") {
      openRows.push({ flag: row.flag, status: row.status });
      return;
    }

    for (const field of ["onBuildDeployId", "onSmokeEvidence", "offBuildDeployId", "rollbackEvidence", "actor", "onUtc", "offUtc"]) {
      if (unknown(row[field])) errors.push(`${row.flag} PASS is missing ${field}`);
    }
    if (Number.isNaN(Date.parse(row.onUtc)) || Number.isNaN(Date.parse(row.offUtc))) errors.push(`${row.flag} PASS has an invalid UTC date`);
    if (row.activation === "build" && row.onBuildDeployId === row.offBuildDeployId) {
      errors.push(`${row.flag} build-time ON and OFF IDs must differ`);
    }
    if (boundary.real && unknown(row.keyArrivalReceipt)) errors.push(`${row.flag} real-driver PASS is missing a key-arrival receipt`);
    if (row.flag === "FEATURE_REAL_AUTH" && unknown(row.prerequisiteEvidence)) {
      errors.push("FEATURE_REAL_AUTH PASS is missing its approval and hosted-auth evidence packet");
    }
  });

  return {
    verdict: errors.length > 0 ? "FAIL" : openRows.length > 0 ? "OPEN" : "PASS",
    rowCount: rows.length,
    errors,
    openRows,
  };
}

function parseArguments(argv) {
  const options = { ledger: null, allowOpen: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--ledger") options.ledger = argv[++index];
    else if (argv[index] === "--allow-open") options.allowOpen = true;
    else throw new Error(`unknown argument: ${argv[index]}`);
  }
  if (!options.ledger) throw new Error("--ledger is required");
  return options;
}

function main() {
  try {
    const options = parseArguments(process.argv.slice(2));
    const result = validateLedgerRows(parseLedger(readFileSync(resolve(options.ledger), "utf8")));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.verdict === "FAIL" || (result.verdict === "OPEN" && !options.allowOpen)) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ verdict: "FAIL", error: error.message })}\n`);
    process.exitCode = 1;
  }
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) main();
