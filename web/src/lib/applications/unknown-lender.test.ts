import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { POST } from "@/app/api/applications/route.ts";

import { failureResponse } from "./http.ts";
import { mapError } from "./repository.ts";
import { APPLICATIONS_ERROR_CODES, ApplicationsError } from "./types.ts";

/**
 * Migration 383 gave `applications.bank_ref` a foreign key to
 * `public.banks_cache`. A foreign key cannot sit behind a feature flag, so from
 * that migration on a lender handle with no catalog row is refused on the
 * FEATURE_VAULT-off path too — which made naming an unknown lender a 500,
 * because 23503 fell through to `failed`.
 */

describe("an unknown lender is a bad request, not a server failure", () => {
  it("maps the foreign-key violation to a closed code", () => {
    assert.equal(mapError({ code: "23503" }).code, "unknown_reference");
  });

  it("answers 4xx, and never the 500 the unmapped SQLSTATE produced", () => {
    const response = failureResponse(mapError({ code: "23503" }));
    assert.equal(response.status, 400);
    assert.ok(response.status >= 400 && response.status < 500);
  });

  it("names no table, constraint or SQLSTATE in the body", async () => {
    // The whole reason the repository maps rather than forwards: a raw 23503
    // message reads "violates foreign key constraint
    // applications_bank_ref_fk on table applications".
    const body = await failureResponse(
      mapError({
        code: "23503",
        details: "Key (bank_ref)=(no-such-lender) is not present in table \"banks_cache\".",
        message: 'insert or update on table "applications" violates foreign key constraint "applications_bank_ref_fk"',
      }),
    ).json();
    const serialized = JSON.stringify(body);
    for (const leak of ["23503", "banks_cache", "applications_bank_ref_fk", "no-such-lender"]) {
      assert.equal(serialized.includes(leak), false, leak);
    }
  });

  it("gives every closed code a status and a sentence of its own", async () => {
    // Derived from the union rather than transcribed, so a code added later
    // without a status or a message fails here instead of quietly answering
    // with another code's sentence.
    const sentences = new Set<string>();
    for (const code of APPLICATIONS_ERROR_CODES) {
      const response = failureResponse(new ApplicationsError(code));
      const body = (await response.json()) as { error: string; message: string };
      assert.equal(body.error, code);
      assert.ok(body.message.trim().length > 0, code);
      sentences.add(body.message);
      // `failed` is the one 500 by definition — it is the code that means "we
      // do not know". The two 503s say the feature is not available at all.
      // Everything the caller can act on, unknown_reference included, is 4xx.
      const NON_4XX: Partial<Record<typeof code, number>> = {
        configuration_error: 503,
        disabled: 503,
        failed: 500,
      };
      const expected = NON_4XX[code] ?? null;
      if (expected !== null) assert.equal(response.status, expected, code);
      else assert.ok(response.status >= 400 && response.status < 500, `${code} answered ${response.status}`);
    }
    assert.equal(sentences.size, APPLICATIONS_ERROR_CODES.length, "two codes share one sentence");
  });

  it("still refuses a malformed lender handle before the database sees it", async () => {
    // The 400 above is for a well-formed handle with no catalog row. A handle
    // that is not a lender slug never reaches Postgres at all, and that guard
    // predates this fix.
    const previous = process.env.FEATURE_APPLICATIONS;
    process.env.FEATURE_APPLICATIONS = "1";
    try {
      const response = await POST(
        new Request("http://local.test/api/applications", {
          body: JSON.stringify({ bankRef: "NOT A SLUG", clientId: "11111111-1111-4111-8111-111111111111" }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );
      assert.ok(response.status === 400 || response.status === 401, `got ${response.status}`);
    } finally {
      if (previous === undefined) delete process.env.FEATURE_APPLICATIONS;
      else process.env.FEATURE_APPLICATIONS = previous;
    }
  });
});
