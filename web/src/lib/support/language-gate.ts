import { complianceLanguageCodes } from "../compliance/language-rules.mjs";

export function evaluateDraftLanguage(text: string): readonly string[] {
  return complianceLanguageCodes(text);
}
