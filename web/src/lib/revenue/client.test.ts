import assert from "node:assert/strict";
import fs from "node:fs";
import { beforeEach, describe, it } from "node:test";

import {
  loadRevenueKpis,
  parseRevenueKpiResponse,
  resetRevenueKpiCacheForTests,
  selectRevenueMetrics,
} from "./client.ts";

const fixture = {
  monthlyRecurringTotal: 1000,
  monitoringCost: 40,
  monitoringProfit: 200,
  monitoringRevenue: 500,
  operatorMonitoringSplit: 260,
  platformMrr: 500,
  referralSplit: 75,
};

describe("revenue KPI browser selector", () => {
  beforeEach(resetRevenueKpiCacheForTests);

  it("returns the fixture object by identity before enablement", () => {
    assert.equal(selectRevenueMetrics(fixture, null), fixture);
  });

  it("treats enabled zeroes as authoritative for only two values", () => {
    const selected = selectRevenueMetrics(fixture, {
      complete: false,
      enabled: true,
      incompleteCodes: ["monitoring_split_unset"],
      monitoringShareTotalCents: 0,
      saasReferralTotalCents: 0,
    });
    assert.equal(selected.monitoringProfit, 0);
    assert.equal(selected.referralSplit, 0);
    assert.equal(selected.monthlyRecurringTotal, fixture.monthlyRecurringTotal);
    assert.equal(selected.platformMrr, fixture.platformMrr);
  });

  it("converts positive integer cents to the existing display money unit", () => {
    const selected = selectRevenueMetrics(fixture, {
      complete: true,
      enabled: true,
      incompleteCodes: [],
      monitoringShareTotalCents: 12_345,
      saasReferralTotalCents: 6_789,
    });
    assert.equal(selected.monitoringProfit, 123.45);
    assert.equal(selected.referralSplit, 67.89);
  });

  it("rejects malformed enabled responses", () => {
    assert.equal(parseRevenueKpiResponse({ enabled: true, monitoringShareTotalCents: "0" }), null);
    assert.equal(parseRevenueKpiResponse({
      complete: true,
      enabled: true,
      incompleteCodes: ["unknown"],
      monitoringShareTotalCents: 0,
      saasReferralTotalCents: 0,
    }), null);
  });

  it("caches one immutable request per window and falls back on 404", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return new Response(null, { status: 404 });
    };
    const first = loadRevenueKpis("2026-08", fetcher as typeof fetch);
    const second = loadRevenueKpis("2026-08", fetcher as typeof fetch);
    assert.equal(first, second);
    assert.equal(await first, null);
    assert.equal(calls, 1);
  });

  it("contains no browser access to the server environment", () => {
    const source = fs.readFileSync(new URL("./client.ts", import.meta.url), "utf8");
    assert.equal(source.includes("process.env"), false);
  });
});

describe("a failed read is not a disabled feature (G-HOST-14)", () => {
  beforeEach(resetRevenueKpiCacheForTests);

  it("maps a server error to the failed state, never to the off state", async () => {
    const fetcher = async () => new Response(null, { status: 500 });
    assert.equal(await loadRevenueKpis("2026-01", fetcher as typeof fetch), "failed");
  });

  it("maps an auth refusal to the failed state", async () => {
    const fetcher = async () => Response.json({ error: { code: "forbidden" } }, { status: 403 });
    assert.equal(await loadRevenueKpis("2026-02", fetcher as typeof fetch), "failed");
  });

  it("maps a 200 whose body does not parse to the failed state", async () => {
    const fetcher = async () => Response.json({ enabled: true, monitoringShareTotalCents: "0" });
    assert.equal(await loadRevenueKpis("2026-03", fetcher as typeof fetch), "failed");
  });

  it("maps a network error to the failed state", async () => {
    const fetcher = async () => { throw new Error("offline"); };
    assert.equal(await loadRevenueKpis("2026-04", fetcher as typeof fetch), "failed");
  });

  it("keeps the fixture numbers but names the failure in the presentation", async () => {
    const { revenuePresentation } = await import("./client.ts");
    assert.equal(selectRevenueMetrics(fixture, "failed"), fixture);
    const failed = revenuePresentation("failed");
    assert.equal(failed.enabled, false);
    assert.equal(failed.failed, true);
    const off = revenuePresentation(null);
    assert.equal(off.failed, false);
    const on = revenuePresentation({
      complete: true,
      enabled: true,
      incompleteCodes: [],
      monitoringShareTotalCents: 0,
      saasReferralTotalCents: 0,
    });
    assert.equal(on.failed, false);
  });
});
