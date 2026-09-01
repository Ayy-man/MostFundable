import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  WRITEBACK_CONFIGURATION_FAILURE,
  createVaultWritebackDriver,
  type VaultClientFactory,
} from "./writeback.ts";
import type { VaultWritebackRow } from "./types.ts";

// Every case here passes an object literal as the environment. Nothing in this
// file mutates or reads the ambient environment, so the cases are
// order-independent and a machine with VAULT keys configured runs them
// identically to a machine with none.

const SOURCE = readFileSync(new URL("./writeback.ts", import.meta.url), "utf8");

function outboxRow(): VaultWritebackRow {
  return {
    id: "cc000000-0000-0000-0000-000000000001",
    outcomeId: "cc000000-0000-0000-0000-000000000002",
    bankRef: "example-bank",
    target: "bank_datapoints",
    source: "mostfundable",
    payload: {
      amount_cents: 250_000,
      bank_ref: "example-bank",
      decided_on: "2026-08-16",
      outcome_kind: "approved",
      stats_version: 4,
    },
    state: "recorded",
    recordedAt: "2026-08-16T00:00:00.000Z",
    failureCode: null,
  };
}

/** A factory that fails the test if the arm ever reaches for a client. */
function neverCalledFactory(): { factory: VaultClientFactory; calls: number } {
  const spy = { calls: 0 };
  const factory: VaultClientFactory = () => {
    spy.calls += 1;
    throw new Error("the driver must not construct a client on this arm");
  };
  return {
    get calls() {
      return spy.calls;
    },
    factory,
  };
}

test("with nothing configured the fixture arm runs and leaves the row recorded", async () => {
  const spy = neverCalledFactory();
  const driver = createVaultWritebackDriver({}, { createClient: spy.factory });

  const result = await driver.deliver(outboxRow());

  assert.deepEqual(result, { state: "recorded" });
  assert.equal(spy.calls, 0, "the fixture arm constructs nothing");
});

test("an explicit supabase arm with no keys refuses instead of half-running", async () => {
  const spy = neverCalledFactory();
  const driver = createVaultWritebackDriver(
    { VAULT_DRIVER: "supabase" },
    { createClient: spy.factory },
  );

  const result = await driver.deliver(outboxRow());

  // `recorded`, not `failed`: nothing was attempted, so the row is exactly as
  // durable as it was and no delivery error has occurred. The code is what
  // separates a configuration gap from a transport problem.
  assert.deepEqual(result, {
    state: "recorded",
    failureCode: WRITEBACK_CONFIGURATION_FAILURE,
  });
  assert.equal(spy.calls, 0, "no client is constructed without both keys");
});

test("one key present is still no keys as far as the arm is concerned", async () => {
  for (const env of [
    { VAULT_DRIVER: "supabase", VAULT_SUPABASE_URL: "https://vault.invalid" },
    { VAULT_DRIVER: "supabase", VAULT_SERVICE_KEY: "" },
    { VAULT_DRIVER: "supabase", VAULT_SUPABASE_URL: "  ", VAULT_SERVICE_KEY: "  " },
  ]) {
    const spy = neverCalledFactory();
    const driver = createVaultWritebackDriver(env, { createClient: spy.factory });
    const result = await driver.deliver(outboxRow());
    assert.deepEqual(result, {
      state: "recorded",
      failureCode: WRITEBACK_CONFIGURATION_FAILURE,
    });
    assert.equal(spy.calls, 0);
  }
});

test("a selector value that is not in the driver table never throws out of deliver", async () => {
  const spy = neverCalledFactory();

  // Construction must not throw either: a misconfigured selector that bricked
  // the module at import would take the review route down with it.
  const driver = createVaultWritebackDriver(
    { VAULT_DRIVER: "vaultish" },
    { createClient: spy.factory },
  );

  assert.deepEqual(await driver.deliver(outboxRow()), {
    state: "recorded",
    failureCode: WRITEBACK_CONFIGURATION_FAILURE,
  });
  assert.equal(spy.calls, 0);
});

test("the fixture arm is pure over a hundred calls and mutates no input", async () => {
  const driver = createVaultWritebackDriver({});
  const row = outboxRow();
  const before = JSON.stringify(row);

  for (let index = 0; index < 100; index += 1) {
    assert.deepEqual(await driver.deliver(row), { state: "recorded" });
  }

  assert.equal(JSON.stringify(row), before, "the row is untouched");
});

test("the driver object is frozen once built", () => {
  assert.equal(Object.isFrozen(createVaultWritebackDriver({})), true);
});

test("the module reads no ambient environment and invents no payload", () => {
  // T-11-19: the arm is chosen by the §10 resolver, never by comparing an
  // ambient variable, so there is exactly one place a driver decision is made.
  assert.equal(
    /process\s*\.\s*env/.test(SOURCE),
    false,
    "writeback.ts must not reach for the ambient environment",
  );
  assert.match(SOURCE, /resolveDriver\("vault", env\)/);

  // T-11-18: the payload the database already allow-listed is shipped verbatim.
  // A field added here would be a field that never passed
  // `private.vault_writeback_payload_valid`.
  assert.match(SOURCE, /\.insert\(row\.payload\)/);
  assert.equal(
    /\.insert\(\{/.test(SOURCE),
    false,
    "the arm must not build an object of its own to send",
  );

  // Pass 3 of the pre-flight: nothing here claims a delivery that has not
  // happened, so the two forward-looking words never appear.
  assert.equal(/Synced|Sent to/.test(SOURCE), false);

  // The unverified-schema warning has to survive edits to this file.
  assert.match(SOURCE, /UNVERIFIED-FOR-ACCOUNT/);
  assert.match(SOURCE, /P-08/);
  assert.match(SOURCE, /KA-11-1/);
});
