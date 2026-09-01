import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { TRACKER_STAGES, type TrackerClient, type TrackerStage } from "./types";
import { deriveDurableHomeMetrics } from "./home-metrics";

const NOW_ISO = "2026-08-19T00:00:00.000Z";
const NOW = Date.parse(NOW_ISO);
const NOW_DATE = new Date(NOW_ISO);
const DAY = 24 * 60 * 60 * 1000;

function at(daysAgo: number): string {
  return new Date(NOW - daysAgo * DAY).toISOString();
}

function client(overrides: Partial<TrackerClient> & { id: string }): TrackerClient {
  return {
    analysisAt: null,
    analysisPending: null,
    archivedAt: null,
    archivedById: null,
    assignedToId: null,
    assignedToName: null,
    businessName: null,
    consumerProfileId: null,
    displayName: `Client ${overrides.id}`,
    estimatedCompletionAt: null,
    fundingApprovedCents: null,
    goalCents: null,
    health: "green",
    history: [],
    lastActivityAt: null,
    matchesUnlockedOverride: null,
    monitoring: "pending",
    nextRefreshAt: null,
    openActionCount: null,
    readiness: null,
    stage: "onboarding",
    stageEnteredAt: at(1),
    startedAt: at(1),
    status: "active",
    ...overrides,
  } as TrackerClient;
}

describe("deriveDurableHomeMetrics", () => {
  /**
   * The regression this guards is the one round 5 named: a rollup written
   * against the stage list as it read on the day it was written. The expected
   * pipeline is taken from the catalog at test time, so adding a stage fails
   * here rather than silently dropping that stage's clients off the Dashboard.
   */
  it("reports one pipeline row per catalog stage, in catalog order", () => {
    const clients = TRACKER_STAGES.map((stage, index) =>
      client({ id: `s${index}`, stage }),
    );
    const metrics = deriveDurableHomeMetrics(clients, NOW_DATE);

    assert.deepEqual(
      metrics.pipeline.map((row) => row.stage),
      [...TRACKER_STAGES],
    );
    assert.deepEqual(
      metrics.pipeline.map((row) => row.count),
      TRACKER_STAGES.map(() => 1),
    );
  });

  /**
   * Active clients and graduates are complements over the catalog rather than
   * two independently written rules, so they cannot drift apart.
   */
  it("splits the active book from the terminal stage without double counting", () => {
    const terminal = TRACKER_STAGES[TRACKER_STAGES.length - 1];
    const clients = [
      ...TRACKER_STAGES.map((stage, index) => client({ id: `a${index}`, stage })),
      client({ id: "archived", stage: "optimization", status: "archived" }),
    ];
    const metrics = deriveDurableHomeMetrics(clients, NOW_DATE);

    const activeRows = clients.filter((row) => row.status === "active");
    assert.equal(
      metrics.activeClients,
      activeRows.filter((row) => row.stage !== terminal).length,
    );
    assert.equal(
      metrics.activeClients + activeRows.filter((row) => row.stage === terminal).length,
      activeRows.length,
    );
    // Graduates count archived rows too — a graduate who is archived still
    // graduated — so this is deliberately not the complement of activeClients.
    assert.equal(
      metrics.graduatedClients,
      clients.filter((row) => row.stage === terminal).length,
    );
  });

  it("counts analysed clients across the whole book, archived rows included", () => {
    const clients = [
      client({ analysisAt: at(3), id: "f2" }),
      client({ analysisAt: at(2), id: "f3", status: "archived" }),
      client({ id: "f4" }),
    ];
    const metrics = deriveDurableHomeMetrics(clients, NOW_DATE);

    assert.equal(
      metrics.analyses,
      clients.filter((row) => row.analysisAt !== null).length,
    );
  });

  /**
   * The Dashboard renders "Funded All-Time" and "Cash Collected" as
   * unavailable, and that is only correct while the tracker read genuinely has
   * no funding figure to give. It hardcodes `fundingApprovedCents: null` on
   * every row today. When someone wires outcomes into that mapping this test
   * fails, which is the intended way to be told the Dashboard now has a real
   * number to show instead of a dash.
   */
  it("read.server.ts maps funded_amount_cents into fundingApprovedCents", async () => {
    // The old tripwire asserted the hardcoded null and demanded this wiring;
    // now the wiring is the contract: the column is selected and a zero (the
    // column default, meaning nothing recorded) becomes null, never $0.
    const source = await readFile(
      new URL("./read.server.ts", import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(source, /fundingApprovedCents: null,/);
    assert.match(source, /funded_amount_cents/);
    assert.match(source, /fundingApprovedCents: row\.funded_amount_cents > 0 \? row\.funded_amount_cents : null,/);
  });

  it("sums recorded funding across the whole book, archived rows included", () => {
    const clients = [
      client({ fundingApprovedCents: 4_500_000, id: "c-funded" }),
      client({ fundingApprovedCents: 1_500_000, id: "c-archived", status: "archived" }),
      client({ fundingApprovedCents: null, id: "c-none" }),
    ];
    assert.equal(deriveDurableHomeMetrics(clients, NOW_DATE).fundedAllTimeCents, 6_000_000);
  });

  it("reports null, not zero, when no client carries recorded funding", () => {
    const clients = [client({ id: "c-1" }), client({ id: "c-2", status: "archived" })];
    assert.equal(deriveDurableHomeMetrics(clients, NOW_DATE).fundedAllTimeCents, null);
  });

  it("averages only optimization spells that both ended and ended recently", () => {
    const spell = (from: TrackerStage, enteredDaysAgo: number, leftDaysAgo: number) => [
      { at: at(enteredDaysAgo), changedBy: null, from, to: "optimization" as const },
      { at: at(leftDaysAgo), changedBy: null, from: "optimization" as const, to: "ready" as const },
    ];

    const metrics = deriveDurableHomeMetrics([
        client({ history: spell("onboarding", 40, 30), id: "ten-days" }),
        client({ history: spell("onboarding", 24, 4), id: "twenty-days" }),
        // Still in optimization: no exit recorded, so no duration to average.
        client({
          history: [{ at: at(10), changedBy: null, from: "onboarding", to: "optimization" }],
          id: "open-spell",
        }),
        // Left optimization more than 90 days ago: outside the stated window.
        client({ history: spell("onboarding", 400, 300), id: "stale" }),
      ],
      NOW_DATE,
    );

    assert.equal(metrics.averageOptimizationDays, 15);
  });

  it("returns null rather than zero when no spell qualifies", () => {
    const metrics = deriveDurableHomeMetrics([client({ id: "none" })], NOW_DATE);
    assert.equal(metrics.averageOptimizationDays, null);
  });

  it("lists only active clients whose health is not green as needing attention", () => {
    const clients = [
      client({ health: "red", id: "red" }),
      client({ health: "amber", id: "amber" }),
      client({ health: "green", id: "green" }),
      client({ health: "red", id: "archived-red", status: "archived" }),
    ];
    const metrics = deriveDurableHomeMetrics(clients, NOW_DATE);

    assert.deepEqual(
      metrics.attention.map((row) => row.id),
      clients
        .filter((row) => row.status === "active" && row.health !== "green")
        .map((row) => row.id),
    );
  });
});
