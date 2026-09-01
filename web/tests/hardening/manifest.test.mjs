import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { test } from "node:test";

import {
  ACCEPTANCE_STATES,
  RATIFIED_FLAG_ORDER,
  databaseMatrices,
  flagRehearsals,
  jobReconciliation,
  lateStateSeams,
  stateMachines,
  validateAcceptanceManifest,
} from "./acceptance-manifest.mjs";
import { FEATURE_FLAG_NAMES } from "../../src/lib/env.ts";
import { JOB_NAMES } from "../../src/lib/jobs/definitions.ts";

const clone = (value) => structuredClone(value);

test("the post-merge acceptance manifest is closed, complete, and path-backed", async () => {
  assert.deepEqual(validateAcceptanceManifest(), []);
  assert.equal(ACCEPTANCE_STATES.length, 6);
  assert.deepEqual(flagRehearsals.map(({ name }) => name), RATIFIED_FLAG_ORDER);
  assert.deepEqual(flagRehearsals.map(({ name }) => name), [...FEATURE_FLAG_NAMES]);
  assert.deepEqual(jobReconciliation.map(({ name }) => name), [...JOB_NAMES]);
  assert.deepEqual(jobReconciliation.filter(({ status }) => status === "PASS").map(({ name }) => name), [
    "analysis.run",
    "billing.accruals",
    "outcomes.refresh_stats",
    "vault.sync_banks",
    "vault.reimport_kb",
    "purge.derived",
    "purge.uploaded_reports",
    "notifications.dispatch",
    "tenancy.trial_expiry",
  ]);
  assert.deepEqual(
    [...new Set(stateMachines.flatMap(({ packetNames }) => packetNames))].sort(),
    ["billing dunning", "cancel", "consent", "enrollment", "outcome recompute", "purge"],
  );

  for (const path of [
    ...stateMachines.flatMap(({ source, sqlProof }) => [source.path, sqlProof]),
    ...lateStateSeams.map(({ source }) => source.path),
    ...databaseMatrices.map(({ file }) => file),
  ]) {
    await access(new URL(path, new URL("../../", import.meta.url)));
  }
});

test("negative fixtures reject duplicate IDs, incomplete edges, and unknown states", () => {
  const machines = clone(stateMachines);
  machines[1].id = machines[0].id;
  machines[2].legalCases = [];
  machines[3].initialStatus = "DONE";

  const errors = validateAcceptanceManifest({
    stateMachines: machines,
    databaseMatrices,
    flagRehearsals,
  });

  assert.ok(errors.some((error) => error.includes("duplicates")));
  assert.ok(errors.some((error) => error.includes("legal and illegal")));
  assert.ok(errors.some((error) => error.includes("unknown acceptance state")));
});

test("a deliberately reordered flag fixture fails the ratified-order check", () => {
  const reordered = clone(flagRehearsals);
  [reordered[0], reordered[1]] = [reordered[1], reordered[0]];
  const errors = validateAcceptanceManifest({ stateMachines, databaseMatrices, flagRehearsals: reordered });
  assert.deepEqual(errors.filter((error) => error.includes("flag order")), [
    "flag order differs from the ratified literal order",
  ]);
});

test("missing paths and required flag fields are visible", async () => {
  const flags = clone(flagRehearsals);
  flags[13].smokeSeam = "";
  assert.ok(
    validateAcceptanceManifest({ stateMachines, databaseMatrices, flagRehearsals: flags })
      .some((error) => error.includes("smokeSeam")),
  );

  await assert.rejects(access(new URL("./does-not-exist", import.meta.url)));
});

test("late seam and job fixtures reject missing proof and false handler closure", () => {
  const seams = clone(lateStateSeams);
  seams[0].proofCommand = "";
  const jobs = clone(jobReconciliation);
  jobs[0].status = "PASS";
  assert.ok(validateAcceptanceManifest({
    stateMachines,
    lateStateSeams: seams,
    jobReconciliation: jobs,
    databaseMatrices,
    flagRehearsals,
  }).some((error) => error.includes("proofCommand")));
  assert.ok(validateAcceptanceManifest({
    stateMachines,
    lateStateSeams,
    jobReconciliation: jobs,
    databaseMatrices,
    flagRehearsals,
  }).some((error) => error.includes("PASS without a handler")));
});
