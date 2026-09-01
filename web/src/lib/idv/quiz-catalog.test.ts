import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { DEMO_CLIENTS } from "@/lib/demo/feedback-fixtures";

/**
 * The identity quiz's catalog must name no fixture persona.
 *
 * "Which business is associated with this application?" graded against "Okafor
 * Design Co" — a fixture client's company — and offered two more strangers'
 * businesses as the alternatives, so a signed-in consumer proved their identity
 * by picking somebody else's company and the only passable option was the wrong
 * one for them.
 *
 * The roster is read at test time rather than transcribed here: renaming a
 * fixture client renames what this looks for, instead of leaving an enumeration
 * to rot. Kept in its own file so it reads the catalog as source and imports
 * none of the exports the fix introduced — which is what let it be watched
 * failing on the pre-fix tree, where it named the offending business itself:
 *
 *   the quiz catalog transcribes the fixture business "Okafor Design Co"
 */
const configSource = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "config.ts"),
  "utf8",
);

describe("the identity quiz catalog", () => {
  it("transcribes no fixture persona's company", () => {
    const businesses = DEMO_CLIENTS.map((client) => client.business);
    assert.ok(businesses.length > 0, "the fixture roster is empty; this guard proves nothing");
    for (const business of businesses) {
      assert.equal(
        configSource.includes(business),
        false,
        `the quiz catalog transcribes the fixture business ${JSON.stringify(business)}`,
      );
    }
  });

  it("derives the graded answer rather than fixing it to one string", () => {
    assert.match(
      configSource,
      /export function mockQuizAnswer\(businessName\?: string \| null\): string/,
      "the graded answer is a fixed constant again instead of the client's own business name",
    );
    assert.match(
      configSource,
      /export function mockQuizOptions\(businessName\?: string \| null\)/,
      "the option list is a fixed catalog again, so it cannot name this client's business",
    );
  });
});
