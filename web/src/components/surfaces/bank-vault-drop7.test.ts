import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

import {
  BANK_FIXTURES,
  classifyBankTrend,
} from "@/lib/demo/feedback-fixtures";

const operatorSource = fs.readFileSync(new URL("./operator.tsx", import.meta.url), "utf8");
const sharedSource = fs.readFileSync(new URL("../demo/shared.tsx", import.meta.url), "utf8");
const operatorChromeSource = fs.readFileSync(new URL("../operator/chrome.tsx", import.meta.url), "utf8");
const consumerKitSource = fs.readFileSync(new URL("../consumer/consumer-kit.tsx", import.meta.url), "utf8");
const bankVaultSource = operatorSource.slice(
  operatorSource.indexOf("function renderBankVault"),
  operatorSource.indexOf("function renderKnowledge"),
);

describe("Drop 7 bank vault", () => {
  it("uses the exact three tabs and one selected-period row collection", () => {
    for (const literal of [
      '{ label: "Banks", value: "banks" }',
      '{ label: "Updates", value: "updates" }',
      '{ label: "Bank trends", value: "trends" }',
      "const stats = bankStatsByPeriod[period]",
    ]) assert.ok(bankVaultSource.includes(literal), `missing bank-vault contract: ${literal}`);
    assert.equal(bankVaultSource.includes('label: "Intel"'), false);
    assert.equal(bankVaultSource.includes('title="Bank intel"'), false);
  });

  it("keeps bureau metadata on all seven existing local bank fixtures", () => {
    assert.equal(BANK_FIXTURES.length, 7);
    for (const bank of BANK_FIXTURES) assert.ok(bank.bureauPulls.trim(), `missing bureau metadata for ${bank.id}`);
  });

  it("renders both bank presentations from stats with the requested historical tile fields", () => {
    assert.ok(bankVaultSource.includes('bankViewMode === "list"'));
    assert.ok(bankVaultSource.includes('setBankViewMode("tiles")'));
    assert.ok((bankVaultSource.match(/stats\.map\(\(bank\)/g) ?? []).length >= 3);
    for (const label of [
      "Bureau pulls",
      "Heat level",
      "Average funded — recorded historical outcome",
      "Recent approval rate — recorded historical outcome",
    ]) assert.ok(bankVaultSource.includes(label), `missing tile field: ${label}`);
    assert.ok(bankVaultSource.includes("No funded results"));
    assert.ok(bankVaultSource.includes("No outcomes"));
  });

  it("classifies all five trend states and holds missing comparisons neutral", () => {
    const stat = (approvalRate: number, outcomes = 10) => ({ approvalRate, outcomes });
    assert.equal(classifyBankTrend(stat(70), stat(55)), "Trending up");
    assert.equal(classifyBankTrend(stat(60), stat(55)), "Up");
    assert.equal(classifyBankTrend(stat(55), stat(55)), "Neutral");
    assert.equal(classifyBankTrend(stat(50), stat(55)), "Down");
    assert.equal(classifyBankTrend(stat(40), stat(55)), "Trending down");
    assert.equal(classifyBankTrend(stat(70, 0), stat(55)), "Neutral");
    assert.equal(classifyBankTrend(stat(70), undefined), "Neutral");
  });

  it("pairs every trend state with a distinct glyph and visible label", () => {
    for (const literal of [
      '"Trending up":',
      "Icon: ChevronsUp",
      "Icon: ArrowUp",
      "Icon: Minus",
      "Icon: ArrowDown",
      '"Trending down":',
      "Icon: ChevronsDown",
      "No recorded comparison",
      "recorded outcomes",
    ]) assert.ok(operatorSource.includes(literal), `missing accessible trend source: ${literal}`);
  });

  it("enforces title and optional actions at both shared page-header layers", () => {
    const pageHeader = sharedSource.slice(sharedSource.indexOf("export function PageHeader"), sharedSource.indexOf("export function Panel"));
    const consumerHeader = consumerKitSource.slice(consumerKitSource.indexOf("export function ConsumerPageHeader"), consumerKitSource.indexOf("export function WorkspaceSection"));
    for (const header of [pageHeader, consumerHeader]) {
      assert.ok(header.includes("#207"));
      assert.ok(header.includes("<h1"));
      assert.ok(header.includes("{actions ?"));
      assert.equal(header.includes("{eyebrow ?"), false);
      assert.equal(header.includes("{description ?"), false);
    }
    // `CompactHeader` moved to `components/operator/chrome.tsx` with the Inbox extraction — the
    // Inbox needed it and a component importing back into a 6,600-line surface file is circular.
    // The body is unchanged, so the assertion is unchanged; only the address it reads from moved.
    const compactHeader = operatorChromeSource.slice(operatorChromeSource.indexOf("export function CompactHeader"), operatorChromeSource.indexOf("export function ClientIdentity"));
    assert.ok(compactHeader.includes("title={title}"));
    assert.equal(compactHeader.includes("<Icon"), false);
  });

  it("records the inferred responsive referent beside the repaired layout", () => {
    assert.ok(bankVaultSource.includes("TODO(#208: referent inferred — confirm the broken-formatting screenshot)"));
    for (const responsiveClass of ["sm:flex-row", "sm:grid-cols-2", "xl:grid-cols-3", "min-h-11", "break-words"]) {
      assert.ok(bankVaultSource.includes(responsiveClass), `missing responsive source: ${responsiveClass}`);
    }
    assert.ok(bankVaultSource.includes('className="hidden overflow-x-auto lg:block"'));
    assert.ok(bankVaultSource.includes('className="divide-y divide-border lg:hidden"'));
  });
});
