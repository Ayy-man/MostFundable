import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

import {
  BANK_FIXTURES,
  deriveAdminBookStats,
} from "@/lib/demo/feedback-fixtures";

const source = fs.readFileSync(new URL("./admin.tsx", import.meta.url), "utf8");
const fixtureSource = fs.readFileSync(new URL("../../lib/demo/feedback-fixtures.ts", import.meta.url), "utf8");

describe("Drop 7 admin IA", () => {
  it("freezes the exact three navigation groups and item order", () => {
    const navigation = source.slice(source.indexOf("const ADMIN_SECTIONS"), source.indexOf("const ADMIN_VIEW_IDS"));
    const expected = [
      'label: "Performance"',
      'id: "overview", label: "Overview"',
      'id: "tenants", label: "Operators"',
      'id: "lenders", label: "Bank Vault"',
      'label: "Platform"',
      'id: "billing", label: "SaaS"',
      'id: "trainings", label: "Client Trainings"',
      'id: "security", label: "Access & audit log"',
      'id: "support", label: "Support"',
      'label: "Platform AI"',
      'id: "ai-brain", label: "AI Brain"',
      'id: "ai-chat", label: "AI Chat"',
    ];
    let position = -1;
    for (const literal of expected) {
      const next = navigation.indexOf(literal);
      assert.ok(next > position, `missing or out-of-order admin navigation item: ${literal}`);
      position = next;
    }
    assert.equal((navigation.match(/label: "Performance"/g) ?? []).length, 1);
    assert.equal((navigation.match(/label: "Platform"/g) ?? []).length, 1);
    assert.equal((navigation.match(/label: "Platform AI"/g) ?? []).length, 1);
  });

  it("keeps moved views nested while exposing the grounded AI Chat", () => {
    const viewType = source.slice(source.indexOf("type AdminView"), source.indexOf("function titleCase"));
    const dispatch = source.slice(source.indexOf("function renderAdminView"), source.indexOf("export function AdminSurface"));
    for (const stale of ['| "intel"', '| "analytics"', 'case "intel"', 'case "analytics"']) {
      assert.equal(viewType.includes(stale) || dispatch.includes(stale), false, `stale top-level view remains: ${stale}`);
    }
    assert.ok(viewType.includes('| "ai-chat"'));
    assert.ok(dispatch.includes('case "ai-chat": return <AdminAssistant viewerName={viewerName} />'));
    assert.ok(source.includes('activeView !== "ai-chat"'));
  });

  it("nests Industry updates under Bank Vault without duplicating its stateful body", () => {
    const parent = source.slice(source.indexOf("function LendersView"), source.indexOf("function LendersBody"));
    assert.ok(parent.includes('{ label: "Banks", value: "banks" }'));
    assert.ok(parent.includes('{ label: "Industry updates", value: "industry-updates" }'));
    assert.ok(parent.includes("<LendersBody "));
    assert.ok(parent.includes("<IndustryUpdatesBody "));
    assert.equal((source.match(/function IndustryUpdatesBody/g) ?? []).length, 1);
    const body = source.slice(source.indexOf("function IndustryUpdatesBody"), source.indexOf("function TrainingsView"));
    assert.equal(body.includes("<PageHeader"), false);
    for (const action of ["Promote selected", "Reject selected", "Save to review", "BankTrendsSection"]) assert.ok(body.includes(action));
  });

  it("nests fixture or governed Analytics under the three SaaS tabs", () => {
    const billing = source.slice(source.indexOf("function BillingView"), source.indexOf("function SecurityView"));
    for (const literal of [
      '{ label: "Billing ledger", value: "ledger" }',
      '{ label: "Platform settings", value: "settings" }',
      '{ label: "Analytics", value: "analytics" }',
      "adminEnabled ? <GovernedAnalyticsBody /> : <AnalyticsBody />",
    ]) assert.ok(billing.includes(literal), `missing SaaS nesting contract: ${literal}`);
    assert.equal((source.match(/function GovernedAnalyticsBody/g) ?? []).length, 1);
    assert.equal((source.match(/function AnalyticsBody/g) ?? []).length, 1);
    for (const name of ["GovernedAnalyticsBody", "AnalyticsBody"]) {
      const start = source.indexOf(`function ${name}`);
      const end = source.indexOf("\nfunction ", start + 1);
      assert.equal(source.slice(start, end).includes("<PageHeader"), false, `${name} adds a second page heading`);
    }
    assert.ok(source.includes("Save tile order"));
  });

  it("ranks exactly five real banks by recorded funded amount with a stable tie break", () => {
    const topBanks = deriveAdminBookStats().topBanks;
    assert.equal(topBanks.length, 5);
    const fixtureIds = new Set(BANK_FIXTURES.map((bank) => bank.id));
    for (const bank of topBanks) assert.ok(fixtureIds.has(bank.bankId as (typeof BANK_FIXTURES)[number]["id"]));
    for (let index = 1; index < topBanks.length; index += 1) {
      const prior = topBanks[index - 1];
      const current = topBanks[index];
      assert.ok(prior.fundedAmount > current.fundedAmount || (prior.fundedAmount === current.fundedAmount && prior.bankName.localeCompare(current.bankName) <= 0));
    }
    // Re-pinned 2026-08-22 (fixture eviction, LANE B). The three strings this
    // used to look for lived in `BookStatsPanel`, which reported client growth,
    // an average time to optimize, an average funding per client and this
    // five-lender ranking as "recorded performance across all operator
    // workspaces" — every figure derived from the in-memory fixture book. The
    // panel is gone, so the source assertions go with it; the derivation itself
    // still has to hold its shape for the fixture shell, which is the rest of
    // this test, and admin.tsx must no longer render it.
    assert.equal(source.includes("Hottest banks"), false, "the fixture book-stats panel is back");
    assert.equal(source.includes("deriveAdminBookStats"), false);
    assert.ok(fixtureSource.includes(".slice(0, 5)"));
  });
});
