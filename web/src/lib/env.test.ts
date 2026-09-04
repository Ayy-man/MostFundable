// The deprecation shim only. Everything else in `env.ts` is covered by
// `scripts/verify-env-contract.mjs`, which runs the module with an empty
// require map to prove it imports nothing; this file stays narrow so that
// contract keeps one owner.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveDriverFromSpecWithDeprecatedSelector } from "./env.ts";

import type { DriverSpec } from "./env.ts";

/**
 * A spec per test, because the "warn once" guarantee is keyed by the new
 * selector and lives for the life of the process. Sharing one name between
 * two tests would make the second one depend on the first having run.
 */
function specFor(selector: string): DriverSpec {
  return {
    selector,
    values: ["mock", "openrouter"],
    fallback: "mock",
    requires: { openrouter: ["OPENROUTER_API_KEY"] },
  };
}

function collector(): { messages: string[]; warn: (message: string) => void } {
  const messages: string[] = [];
  return { messages, warn: (message) => messages.push(message) };
}

describe("resolveDriverFromSpecWithDeprecatedSelector", () => {
  it("falls back to the table default when neither key is set", () => {
    const { messages, warn } = collector();
    assert.equal(
      resolveDriverFromSpecWithDeprecatedSelector(
        "one",
        specFor("ONE_DRIVER"),
        "AI_DRIVER",
        {},
        warn,
      ),
      "mock",
    );
    assert.deepEqual(messages, []);
  });

  it("reads its own key and says nothing, even with the old key set", () => {
    const { messages, warn } = collector();
    assert.equal(
      resolveDriverFromSpecWithDeprecatedSelector(
        "two",
        specFor("TWO_DRIVER"),
        "AI_DRIVER",
        { TWO_DRIVER: "openrouter", AI_DRIVER: "mock", OPENROUTER_API_KEY: "k" },
        warn,
      ),
      "openrouter",
    );
    assert.deepEqual(messages, []);
  });

  it("honours the deprecated key when its own is blank, and names the new key once", () => {
    const { messages, warn } = collector();
    const spec = specFor("THREE_DRIVER");
    const env = { THREE_DRIVER: "  ", AI_DRIVER: "openrouter", OPENROUTER_API_KEY: "k" };

    assert.equal(
      resolveDriverFromSpecWithDeprecatedSelector("three", spec, "AI_DRIVER", env, warn),
      "openrouter",
    );
    assert.equal(
      resolveDriverFromSpecWithDeprecatedSelector("three", spec, "AI_DRIVER", env, warn),
      "openrouter",
    );

    assert.equal(messages.length, 1, "one warning per selector, not one per call");
    assert.match(messages[0], /THREE_DRIVER/);
    assert.match(messages[0], /AI_DRIVER/);
  });

  it("applies the deprecated key's value through the new spec's own rules", () => {
    const { warn } = collector();
    assert.throws(
      () =>
        resolveDriverFromSpecWithDeprecatedSelector(
          "four",
          specFor("FOUR_DRIVER"),
          "AI_DRIVER",
          { AI_DRIVER: "openrouter" },
          warn,
        ),
      /OPENROUTER_API_KEY/,
    );

    assert.throws(
      () =>
        resolveDriverFromSpecWithDeprecatedSelector(
          "five",
          specFor("FIVE_DRIVER"),
          "AI_DRIVER",
          { AI_DRIVER: "anthropic" },
          warn,
        ),
      /AI_DRIVER/,
    );
  });

  it("reports a blank deprecated key as unset rather than as a value", () => {
    const { messages, warn } = collector();
    assert.equal(
      resolveDriverFromSpecWithDeprecatedSelector(
        "six",
        specFor("SIX_DRIVER"),
        "AI_DRIVER",
        { AI_DRIVER: "   " },
        warn,
      ),
      "mock",
    );
    assert.deepEqual(messages, []);
  });
});
