import assert from "node:assert/strict";
import { test } from "node:test";

import { flagRehearsals } from "./acceptance-manifest.mjs";
import { validateLedgerRows } from "../../scripts/verify-flag-rehearsal.mjs";

const SOURCE_SHA = "bddb5ca37d2d46402cb5fc8552bba266c24b7979";

// The release ledger was an internal operations record, so it is intentionally
// absent from this handover. Build the same validation fixture from the shipped
// flag definitions instead: this still proves order, activation, smoke seams,
// driver boundaries, and the PASS evidence rules without asking a contractor to
// recover an internal document.
const rows = flagRehearsals.map((flag, index) => ({
  sequence: String(index + 1),
  flag: flag.name,
  mainSha: SOURCE_SHA,
  activation: flag.activation,
  driverBoundary: flag.mockBoundary,
  smokeSeam: flag.smokeSeam,
  onBuildDeployId: "OPEN",
  onSmokeEvidence: "OPEN",
  offBuildDeployId: "OPEN",
  rollbackEvidence: "OPEN",
  keyArrivalReceipt: "OPEN",
  prerequisiteEvidence: "OPEN",
  actor: "OPEN",
  onUtc: "OPEN",
  offUtc: "OPEN",
  status: flag.initialStatus,
}));
const clone = () => structuredClone(rows);

function close(row) {
  Object.assign(row, {
    status: "PASS",
    onBuildDeployId: `${row.flag}-on`,
    onSmokeEvidence: "receipt:on",
    offBuildDeployId: `${row.flag}-off`,
    rollbackEvidence: "receipt:off",
    keyArrivalReceipt: "N/A",
    prerequisiteEvidence: "receipt:approved",
    actor: "Ayman",
    onUtc: "2026-08-16T00:00:00.000Z",
    offUtc: "2026-08-16T00:05:00.000Z",
  });
}

test("the shipped flag definitions form a structurally valid, honestly open ledger", () => {
  const result = validateLedgerRows(rows);
  assert.equal(result.verdict, "OPEN");
  assert.equal(result.rowCount, 22);
  assert.equal(result.errors.length, 0);
  assert.equal(result.openRows.length, 22);
});

test("order drift and mixed source SHAs are rejected", () => {
  const reordered = clone();
  [reordered[0], reordered[1]] = [reordered[1], reordered[0]];
  assert.ok(validateLedgerRows(reordered).errors.some((error) => error.includes("flag order")));
  const mixed = clone();
  mixed[1].mainSha = "1111111";
  assert.ok(validateLedgerRows(mixed).errors.some((error) => error.includes("one valid main SHA")));
});

test("PASS requires rollback evidence and distinct build-time IDs", () => {
  const missingRollback = clone();
  close(missingRollback[0]);
  missingRollback[0].rollbackEvidence = "UNKNOWN";
  assert.ok(validateLedgerRows(missingRollback).errors.some((error) => error.includes("rollbackEvidence")));
  const reused = clone();
  close(reused[0]);
  reused[0].offBuildDeployId = reused[0].onBuildDeployId;
  assert.ok(validateLedgerRows(reused).errors.some((error) => error.includes("must differ")));
});

test("driver-label drift and unreceipted real-driver PASS are rejected", () => {
  const invalid = clone();
  invalid[2].driverBoundary = "CRS_DRIVER=made_up";
  assert.ok(validateLedgerRows(invalid).errors.some((error) => error.includes("driver boundary")));
  const real = clone();
  close(real[2]);
  real[2].driverBoundary = "CRS_DRIVER=sandbox; AI_DRIVER=mock";
  real[2].keyArrivalReceipt = "UNKNOWN";
  assert.ok(validateLedgerRows(real).errors.some((error) => error.includes("key-arrival receipt")));
});

test("a fully receipted synthetic ledger closes", () => {
  const closed = clone();
  for (const row of closed) close(row);
  assert.deepEqual(validateLedgerRows(closed), { verdict: "PASS", rowCount: 22, errors: [], openRows: [] });
});
