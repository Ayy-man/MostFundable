import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { BANK_FIXTURES } from "@/lib/demo/feedback-fixtures";

import { FIXTURE_BANK_RECORDS } from "./fixture-driver.ts";

/**
 * Migration 382's catalog against the frozen fixtures it was copied from.
 *
 * `381_banks_cache.test.sql` pins the handles 382 produced, which proves the
 * migration applied and nothing more — SQL cannot read a TypeScript module, so
 * the list there is transcribed. That leaves the failure this file exists for:
 * a lender added to `BANK_FIXTURES` and not to 382 renders on the flag-off path
 * and vanishes on the flag-on one, and nothing in either suite would say so.
 *
 * The expectation is derived from the fixture module at test time, so the
 * comparison moves with whichever side changes.
 */

const CATALOG_SQL = readFileSync(
  new URL("../../../../supabase/migrations/382_banks_cache_catalog.sql", import.meta.url),
  "utf8",
);

/** Every `bank_ref` literal the migration inserts, in the order it inserts them. */
function catalogHandles(): string[] {
  const values = CATALOG_SQL.slice(CATALOG_SQL.indexOf("insert into public.banks_cache"));
  return [...values.matchAll(/^\s*\(\s*'([a-z0-9][a-z0-9_-]*)'\s*,/gm)].map((match) => match[1]);
}

describe("migration 382 ships exactly the frozen lender set", () => {
  it("parses handles out of the migration rather than assuming them", () => {
    assert.ok(catalogHandles().length > 0, "the insert block's shape changed and nothing was parsed");
  });

  it("covers every lender the frozen Bank Vault names", () => {
    const missing = BANK_FIXTURES.map((bank) => bank.id).filter(
      (handle) => !catalogHandles().includes(handle),
    );
    assert.deepEqual(
      missing,
      [],
      "a lender renders with FEATURE_VAULT off and disappears with it on",
    );
  });

  it("ships no lender the frozen Bank Vault does not name", () => {
    const known = new Set<string>(BANK_FIXTURES.map((bank) => bank.id));
    assert.deepEqual(catalogHandles().filter((handle) => !known.has(handle)), []);
  });

  it("inserts each handle exactly once", () => {
    const handles = catalogHandles();
    const duplicated = handles.filter((handle, index) => handles.indexOf(handle) !== index);
    assert.deepEqual(duplicated, []);
  });

  it("matches the fixture driver too, so all three lists move together", () => {
    // The driver is the third copy of this set. It is the one the sync writes
    // from, so a lender in the migration but not the driver would be deleted
    // from nothing and simply never refreshed.
    assert.deepEqual(
      FIXTURE_BANK_RECORDS.map((record) => record.bankRef).sort(),
      catalogHandles().sort(),
    );
  });
});
