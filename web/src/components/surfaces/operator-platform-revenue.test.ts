import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const operatorPath = new URL("./operator.tsx", import.meta.url);

async function sourceSections() {
  const source = await readFile(operatorPath, "utf8");
  const start = source.indexOf("function renderPlatformRev()");
  const end = source.indexOf("function renderTeam()", start);
  assert.ok(start >= 0 && end > start, "missing Platform rev section");
  const platform = source.slice(start, end);
  const fixtureStart = platform.indexOf("const activeRows = CLIENT_PLATFORM_PLAN_RECORDS");
  assert.ok(fixtureStart > 0, "missing explicit Platform rev fixture branch");
  return { durable: platform.slice(0, fixtureStart), platform, source };
}

describe("durable operator platform revenue", () => {
  it("reads the private current-month projection only for owner and admin roles", async () => {
    const { source } = await sourceSections();
    assert.match(source, /sessionIdentity\?\.orgRole === "owner" \|\| sessionIdentity\?\.orgRole === "admin"/);
    assert.match(source, /clientsTab !== "platform-rev" \|\| !platformRevenueCanRead/);
    assert.match(source, /fetch\("\/api\/operator\/platform-revenue", \{[\s\S]*?cache: "no-store"[\s\S]*?credentials: "same-origin"/);
    assert.match(source, /parseOperatorPlatformRevenue\(await response\.json\(\)\)/);
  });

  it("shows posted ledger truth and keeps absent or incomplete rows non-zero-free", async () => {
    const { durable, source } = await sourceSections();
    assert.match(durable, /Current-month ledger/);
    assert.match(durable, /ledger\.baseAmountCents/);
    assert.match(durable, /ledger\.pctSnapshot/);
    assert.match(durable, /ledger\.amountCents/);
    assert.match(durable, /ledger\.sourceRowCount/);
    assert.match(durable, /ledger\.settlementStatus/);
    assert.match(durable, /Ledger not posted/);
    assert.match(durable, /ledger\.isComplete \? "Complete" : "Incomplete"/);
    assert.match(source, /revenue-share percentage has not been configured/);
    assert.match(source, /Paid-invoice evidence is incomplete/);
    assert.match(source, /Consumer subscription evidence is incomplete/);
  });

  it("renders every active client with its typed plan state instead of fixtures", async () => {
    const { durable } = await sourceSections();
    assert.match(durable, /revenue\.roster\.map\(\(row\)/);
    assert.match(durable, /platformPlanStatusLabel\(row\.status\)/);
    assert.match(durable, /formatRevenueMoney\(row\.priceCents, row\.currency\)/);
    assert.match(durable, /openTrackerClient\(row\.clientId\)/);
    assert.match(durable, /no plan record/i);
    assert.doesNotMatch(durable, /CLIENT_PLATFORM_PLAN_RECORDS|PLATFORM_PLAN_PRICE|PLATFORM_REV_SHARE/);
  });

  it("renders loading, access, failure and retry states without the stale unreadable claim", async () => {
    const { durable, platform } = await sourceSections();
    assert.match(durable, /limited to workspace owners and admins/);
    assert.match(durable, /Loading the current-month revenue ledger and plan roster/);
    assert.match(durable, /Platform revenue unavailable/);
    assert.match(durable, />\s*Retry\s*</);
    assert.doesNotMatch(platform, /not readable|no roster or share amount can be shown/i);
  });
});
