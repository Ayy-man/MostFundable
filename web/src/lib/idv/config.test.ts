import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  IDV_LOCK_DURATION_HOURS,
  MAX_IDV_ATTEMPTS,
  MOCK_SMS_CODE,
} from "@/lib/idv/config";

describe("IDV policy configuration", () => {
  it("locks after exactly two failed quiz attempts", () => {
    assert.equal(
      MAX_IDV_ATTEMPTS,
      2,
      "the IDV attempt cap no longer matches the two-attempt enrollment rule",
    );
  });

  it("parks a locked enrollment for exactly 72 hours", () => {
    assert.equal(
      IDV_LOCK_DURATION_HOURS,
      72,
      "the IDV lock window no longer matches the 72-hour parked rule",
    );
  });

  it("keeps the mock SMS code as a string", () => {
    assert.equal(
      MOCK_SMS_CODE,
      "246810",
      "the deterministic mock SMS code changed unexpectedly",
    );
    assert.equal(
      typeof MOCK_SMS_CODE,
      "string",
      "the mock SMS code must preserve all of its digits as text",
    );
  });
});
