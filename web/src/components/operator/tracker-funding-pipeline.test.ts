import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

const SOURCE = fs.readFileSync(
  new URL("./tracker-funding-pipeline.tsx", import.meta.url),
  "utf8",
);

describe("operator lender application pipeline", () => {
  it("reads the selected client's applications and the real lender catalog", () => {
    assert.match(SOURCE, /readClientApplications\(clientId\)/);
    assert.match(SOURCE, /readApplicationLenders\(\)/);
    assert.match(SOURCE, /read\.clientId === clientId/);
    assert.doesNotMatch(SOURCE, /DEMO_|FIXTURE|useFeedbackSession/);
  });

  it("creates, edits and records every supported outcome through client adapters", () => {
    assert.match(SOURCE, /createClientApplication\(/);
    assert.match(SOURCE, /updateClientApplication\(/);
    assert.match(SOURCE, /recordClientApplicationOutcome\(/);
    assert.match(SOURCE, /value: "approved"/);
    assert.match(SOURCE, /value: "denied"/);
    assert.match(SOURCE, /value: "withdrawn"/);
    assert.match(SOURCE, /operatorStatus: activeEdit\.operatorStatus/);
    assert.match(SOURCE, /consumerStatus: activeEdit\.consumerStatus/);
    assert.match(SOURCE, /visibility: activeEdit\.visibility/);
    assert.match(SOURCE, /amountCents: amount\.cents/);
  });

  it("re-reads server state after each successful mutation", () => {
    assert.equal(
      (SOURCE.match(/await refreshApplications\(clientId\);/g) ?? []).length,
      3,
    );
    assert.match(SOURCE, /setRead\(\{ clientId: targetClientId, state: "loading" \}\)/);
    assert.match(SOURCE, /const result = await readClientApplications\(targetClientId\)/);
  });

  it("keeps loading, disabled, empty and failure states explicit", () => {
    assert.match(SOURCE, /Application tracking is not enabled for this workspace/);
    assert.match(SOURCE, /Loading applications…/);
    assert.match(SOURCE, /No pipeline state is being inferred/);
    assert.match(SOURCE, /No lender applications have been recorded for this client/);
    assert.match(SOURCE, /Existing applications remain editable/);
    assert.match(SOURCE, /role="alert"/);
    assert.match(SOURCE, />\s*Try again\s*</);
  });

  it("uses labelled project controls and validates money and decision dates", () => {
    assert.match(SOURCE, /<BrandSelect/);
    assert.match(SOURCE, /<Label htmlFor=/);
    assert.match(SOURCE, /parseDollarInput\(/);
    assert.match(SOURCE, /isApplicationDate\(/);
    assert.match(SOURCE, /type="date"/);
    assert.doesNotMatch(SOURCE, /<select/);
  });
});
