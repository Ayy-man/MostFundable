import { resolveDriver, type DriverName } from "@/lib/env";
import { fixtureParser } from "./parser-fixture.ts";
import { unavailableParser } from "./parser-unavailable.ts";
import type { BureauCode, ReportCode } from "@/lib/crs/types";

export interface ParsedCreditEnvelope { bureaus: BureauCode[]; reportCodes: ReportCode[]; pulledAt: string; body: unknown }
export interface CreditReportParser { driver: DriverName<"credit_report_parser">; assertAvailable(): void; parse(bytes: Uint8Array): Promise<ParsedCreditEnvelope> }
export function createCreditReportParser(driver: DriverName<"credit_report_parser">): CreditReportParser {
  return driver === "fixture" ? fixtureParser : unavailableParser;
}
const selectedDriver = resolveDriver("credit_report_parser");
export const creditReportParser = createCreditReportParser(selectedDriver);
