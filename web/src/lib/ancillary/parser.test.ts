import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractFeatures } from "@/lib/analysis/features";
import { sealReport } from "@/lib/crs/report";
import { createCreditReportParser } from "./parser.ts";

describe("credit report parser", () => {
  it("defaults through the fixture arm to deterministic sanitized features", async () => {
    const parser = createCreditReportParser("fixture");
    parser.assertAvailable();
    const envelope = await parser.parse(new TextEncoder().encode("MOSTFUNDABLE_FIXTURE_CREDIT_V1"));
    const first = extractFeatures(sealReport(envelope));
    const second = extractFeatures(sealReport(envelope));
    assert.deepEqual(first, second);
    assert.deepEqual(first.bureausPulled, ["EQF", "EXP", "TUC"]);
    assert.deepEqual(first.accounts, []);
  });

  it("fails closed with a fixed code in the explicit unavailable arm", async () => {
    const parser = createCreditReportParser("unavailable");
    assert.throws(() => parser.assertAvailable(), /CREDIT_REPORT_PARSER_UNAVAILABLE/);
    await assert.rejects(() => parser.parse(new Uint8Array([1])), /CREDIT_REPORT_PARSER_UNAVAILABLE/);
  });
});
