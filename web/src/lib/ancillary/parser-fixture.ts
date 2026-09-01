import type { CreditReportParser, ParsedCreditEnvelope } from "./parser.ts";

const MARKER = "MOSTFUNDABLE_FIXTURE_CREDIT_V1";
const AT = "2026-08-16T00:00:00.000Z";
export const fixtureParser: CreditReportParser = Object.freeze({
  driver: "fixture",
  assertAvailable() {},
  async parse(bytes: Uint8Array): Promise<ParsedCreditEnvelope> {
    if (new TextDecoder().decode(bytes) !== MARKER) throw new Error("CREDIT_REPORT_PARSE_FAILED");
    return {
      bureaus: ["EQF", "EXP", "TUC"], reportCodes: ["EQF1001", "EXP1001", "TUC3002"], pulledAt: AT,
      body: { noHit: false, perBureau: [["EQF", "EQF1001"], ["EXP", "EXP1001"], ["TUC", "TUC3002"]].map(([bureau, reportCode]) => ({
        bureau, reportCode, pulledAt: AT, subjectRef: "synthetic-subject",
        accounts: [], inquiries: [], monthlyDebtPaymentsCents: 0,
      })) },
    };
  },
});
