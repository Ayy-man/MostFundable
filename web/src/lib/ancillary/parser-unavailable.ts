import type { CreditReportParser } from "./parser.ts";
function unavailable(): never { throw new Error("CREDIT_REPORT_PARSER_UNAVAILABLE"); }
export const unavailableParser: CreditReportParser = Object.freeze({
  driver: "unavailable", assertAvailable: unavailable,
  async parse() { return unavailable(); },
});
