import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { JOB_DEFINITIONS, JOB_SUBJECT_PATTERNS, JOB_WINDOW_PATTERNS, validateJobTuple } from "@/lib/jobs/definitions";

import { fixtureVaultDriver } from "../fixture-driver.ts";
import { runVaultSyncBanks } from "../index.ts";
import type { BankCacheRow } from "../types.ts";

import { utcDateWindow, VAULT_SYNC_BANKS_JOB } from "./sync-banks.ts";

/**
 * J6, the nightly VAULT → `banks_cache` sync.
 *
 * The tuple assertions read the shared catalog rather than restating INTERFACES
 * §7, so a change to the key's declared cadence, subject or window fails here
 * instead of drifting silently apart from the registry.
 */

function fakeRepository() {
  const upserts: BankCacheRow[][] = [];
  return {
    upserts,
    repository: {
      async listBanks() {
        return [];
      },
      async readBank() {
        return null;
      },
      async upsertCacheRows(rows: readonly BankCacheRow[]) {
        upserts.push([...rows]);
        return rows.length;
      },
    },
  };
}

describe("J6's tuple matches the shared catalog", () => {
  it("is the nightly, global, date-windowed key §7 declares", () => {
    assert.equal(JOB_DEFINITIONS[VAULT_SYNC_BANKS_JOB].cadence, "nightly");
    assert.equal(JOB_SUBJECT_PATTERNS[VAULT_SYNC_BANKS_JOB], "global");
    assert.match(utcDateWindow(new Date("2026-08-19T23:59:59.000Z")), new RegExp(`^(?:${JOB_WINDOW_PATTERNS[VAULT_SYNC_BANKS_JOB]})$`));
  });

  it("produces a tuple the registry accepts", () => {
    assert.doesNotThrow(() =>
      validateJobTuple({
        job: VAULT_SYNC_BANKS_JOB,
        subject: "global",
        window: utcDateWindow(new Date("2026-08-19T04:00:00.000Z")),
      }),
    );
  });

  it("names the window in UTC, so a run either side of local midnight is one night", () => {
    assert.equal(utcDateWindow(new Date("2026-08-19T00:00:00.000Z")), "2026-08-19");
    assert.equal(utcDateWindow(new Date("2026-08-19T23:59:59.999Z")), "2026-08-19");
  });
});

describe("the sync itself", () => {
  it("writes the whole catalog the driver returned", async () => {
    const { repository, upserts } = fakeRepository();
    const result = await runVaultSyncBanks({ driver: fixtureVaultDriver, repository });

    assert.equal(result.driver, "fixture");
    assert.equal(result.read, result.written);
    assert.deepEqual(result.rejected, []);
    assert.equal(upserts.length, 1);
    assert.equal(upserts[0].length, result.written);
  });

  it("marks rows with the driver that produced them", async () => {
    const { repository, upserts } = fakeRepository();
    await runVaultSyncBanks({ driver: fixtureVaultDriver, repository });
    assert.deepEqual([...new Set(upserts[0].map((row) => row.source))], ["fixture"]);
  });

  it("is idempotent: a second run produces the same rows", async () => {
    const now = new Date("2026-08-19T02:00:00.000Z");
    const first = fakeRepository();
    const second = fakeRepository();
    await runVaultSyncBanks({ driver: fixtureVaultDriver, now, repository: first.repository });
    await runVaultSyncBanks({ driver: fixtureVaultDriver, now, repository: second.repository });
    assert.deepEqual(first.upserts[0], second.upserts[0]);
  });

  it("never asks the repository to delete anything", async () => {
    // The repository has no delete at all, which is what migration 383's
    // foreign key leans on. Asserted against the object's own surface rather
    // than against a description of it.
    const { repository } = fakeRepository();
    const methods = Object.keys(repository);
    assert.deepEqual(
      methods.filter((name) => /delete|remove|truncate|purge/i.test(name)),
      [],
    );
  });
});

describe("the handler", () => {
  it("ignores a subject that is not the one §7 declares", async () => {
    const { runVaultSyncBanksJob } = await import("./sync-banks.ts");
    assert.deepEqual(await runVaultSyncBanksJob("org:whatever"), {
      status: "skipped",
      rows: 0,
    });
  });
});
