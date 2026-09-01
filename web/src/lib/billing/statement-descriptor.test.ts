import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readStatementDescriptor } from "./statement-descriptor.ts";

describe("Stripe statement descriptor", () => {
  it("treats absent and blank values as unset", () => {
    assert.equal(readStatementDescriptor({}), null);
    assert.equal(readStatementDescriptor({ STRIPE_STATEMENT_DESCRIPTOR: "   " }), null);
  });

  it("trims and accepts the platform value", () => {
    assert.equal(readStatementDescriptor({ STRIPE_STATEMENT_DESCRIPTOR: "  MOSTFUNDABLE  " }), "MOSTFUNDABLE");
    assert.equal(readStatementDescriptor({ STRIPE_STATEMENT_DESCRIPTOR: "MF PLATFORM 24" }), "MF PLATFORM 24");
  });

  it("rejects length, non-Latin, letterless and prohibited values without echoing them", () => {
    for (const value of ["MF", "M".repeat(23), "12345", "MÖST FUNDABLE", "MF<PLATFORM", "MF*PLATFORM"]) {
      assert.throws(
        () => readStatementDescriptor({ STRIPE_STATEMENT_DESCRIPTOR: value }),
        (error: unknown) => error instanceof Error && error.name === "MisconfiguredDriverError" && !error.message.includes(value),
      );
    }
  });
});
