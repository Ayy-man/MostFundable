import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DRIVERS } from "@/lib/env";

import { createFixtureKbSource, FIXTURE_KB_ARTICLES } from "./fixture-source.ts";
import { createKbSourceDriver, KB_SOURCE_DRIVERS, MisconfiguredDriverError } from "./source.ts";

/**
 * Every key any driver in a spec can require, so a selection test can name a
 * driver without tripping the preflight it is not trying to exercise. Derived
 * from the spec rather than listed, so a new `requires` entry is covered here
 * the moment it is added.
 */
function completeKeysFor(spec: { requires: Readonly<Record<string, readonly string[] | undefined>> }): Record<string, string> {
  return Object.fromEntries(
    Object.values(spec.requires).flatMap((keys) => (keys ?? []).map((key) => [key, "configured"] as const)),
  );
}

describe("KB source", () => {
  it("pages six sanitized fixture articles in stable order", async () => {
    const source = createFixtureKbSource();
    const first = await source.fetchPage(null);
    const second = await source.fetchPage(first.nextCursor);
    assert.equal(first.articles.length, 3);
    assert.equal(second.articles.length, 3);
    assert.equal(second.nextCursor, null);
    assert.deepEqual([...first.articles, ...second.articles].map((article) => article.sourceArticleId), FIXTURE_KB_ARTICLES.map((article) => article.sourceArticleId));
    const serialized = JSON.stringify(FIXTURE_KB_ARTICLES);
    for (const forbiddenKey of ["clientId", "profileId", "accountNumber", "secret", "VAULT_SUPABASE_URL"]) {
      assert.equal(serialized.includes(forbiddenKey), false);
    }
    assert.deepEqual(Object.keys(first.articles[0]).sort(), ["body", "metadata", "sourceArticleId", "sourceUpdatedAt", "sourceUrl", "title"]);
  });

  it("defaults to fixture without constructing a real source", () => {
    let calls = 0;
    assert.equal(createKbSourceDriver({}, { onRealSourceRequested: () => { calls += 1; } }).driver, "fixture");
    assert.equal(calls, 0);
  });

  it("fails closed for explicit real selection", () => {
    const { selector, values, fallback } = KB_SOURCE_DRIVERS;
    const real = values.filter((value) => value !== fallback);
    assert.ok(real.length > 0, "the table must carry a non-fixture arm for this assertion to mean anything");
    for (const driver of real) {
      // Preflight first: naming a real driver with none of its keys set is a
      // configuration error, not a shape error.
      assert.throws(() => createKbSourceDriver({ [selector]: driver }), MisconfiguredDriverError);
      let calls = 0;
      assert.throws(
        () => createKbSourceDriver(
          { ...completeKeysFor(KB_SOURCE_DRIVERS), [selector]: driver },
          { onRealSourceRequested: () => { calls += 1; } },
        ),
        { code: "KB_SOURCE_SHAPE_UNVERIFIED" },
        `${selector}=${driver} must still refuse on an unverified shape`,
      );
      assert.equal(calls, 1);
    }
  });

  /**
   * G-KB-01 regression. Phase 8 set `VAULT_DRIVER=supabase` on production so the
   * bank sync could reach the CCA VAULT project, and because the KB source
   * resolved that same selector the weekly `vault.reimport_kb` job took the
   * throwing arm on every run from that moment — silently, for weeks, leaving
   * `kb_articles` empty on hosted.
   *
   * The assertion is derived, not transcribed: it walks every value the frozen
   * §10 vault row carries and asserts each one leaves the KB source exactly
   * where an empty environment leaves it. Adding a third vault driver extends
   * this test with no edit here, and no value from either table is written down.
   */
  it("G-KB-01: the KB source's selection is independent of VAULT_DRIVER", () => {
    assert.notEqual(
      KB_SOURCE_DRIVERS.selector,
      DRIVERS.vault.selector,
      "the KB source must not borrow the vault's selector",
    );
    const unset = createKbSourceDriver({}).driver;
    const vaultKeys = completeKeysFor(DRIVERS.vault);
    for (const vaultDriver of DRIVERS.vault.values) {
      const env = { ...vaultKeys, [DRIVERS.vault.selector]: vaultDriver };
      let calls = 0;
      const source = createKbSourceDriver(env, { onRealSourceRequested: () => { calls += 1; } });
      assert.equal(
        source.driver,
        unset,
        `${DRIVERS.vault.selector}=${vaultDriver} must not change which KB source is selected`,
      );
      assert.equal(calls, 0, "no vault setting may make the KB source ask for a real source");
    }
  });

  it("G-KB-01: the KB source's own selector is what governs, in both directions", () => {
    const { selector, values, fallback } = KB_SOURCE_DRIVERS;
    const vaultKeys = completeKeysFor(DRIVERS.vault);
    // The fixture arm survives the vault being fully real.
    assert.equal(
      createKbSourceDriver({ ...vaultKeys, [DRIVERS.vault.selector]: "supabase", [selector]: fallback }).driver,
      "fixture",
    );
    // And a real KB selection is refused even with the vault left at its fallback.
    for (const driver of values.filter((value) => value !== fallback)) {
      assert.throws(
        () => createKbSourceDriver({ ...completeKeysFor(KB_SOURCE_DRIVERS), [selector]: driver }),
        { code: "KB_SOURCE_SHAPE_UNVERIFIED" },
      );
    }
    // An unknown value is a loud misconfiguration, never a silent fixture fallback.
    assert.throws(() => createKbSourceDriver({ [selector]: "supabase" }), MisconfiguredDriverError);
  });
});
