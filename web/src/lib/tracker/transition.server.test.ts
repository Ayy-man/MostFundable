import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { trackerTransitionErrorCode } from "./transition.server.ts";

describe("tracker transition errors", () => {
  it("recognizes the manual-stage rule without treating unrelated database failures as conflicts", () => {
    assert.equal(
      trackerTransitionErrorCode({ code: "P0001", message: "stage_transition_not_allowed" }),
      "stage_transition_not_allowed",
    );
    assert.equal(trackerTransitionErrorCode({ code: "P0001", message: "other_failure" }), "failed");
  });
});
