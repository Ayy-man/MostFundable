import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

/**
 * G-HOST-20 for the admin Overview MetricStrip: the five headline numbers used
 * to be derived from `deriveAdminOverview(applications)` — fixtures — so the
 * strip showed invented operator counts and funded/cash millions no durable
 * source backs. This mirrors the operator Dashboard swap: every figure reads
 * from `GET /api/admin/overview`. Operators/Consumers/AI Analyses are counts;
 * Funded/Cash are money that is durable only behind FEATURE_APPLICATIONS /
 * FEATURE_FEES, so they arrive as `number | null` and render `—` with a
 * not-enabled reason when the flag is off.
 *
 * These assertions read admin.tsx source and fail if the strip loses its
 * durable read, its failed-read branch, the distinct flag-off state, or lets
 * Funded/Cash fall back to a hardcoded value — the same source-derived style
 * the sibling failed-read-disclosure guard uses.
 */

const admin = fs.readFileSync(new URL("./admin.tsx", import.meta.url), "utf8");

describe("admin Overview strip reads durable platform figures", () => {
  it("fetches the durable overview endpoint instead of deriving from fixtures", () => {
    assert.ok(admin.includes('fetch("/api/admin/overview"'), "the strip no longer reads /api/admin/overview");
    assert.ok(
      !admin.includes("overview.fundedAllTime") && !admin.includes("overview.cashAllTime"),
      "the strip still renders fixture funded/cash millions",
    );
    assert.ok(
      !admin.includes("overview.operatorsActivePlan") && !admin.includes("overview.consumersActivePlan"),
      "the strip still renders fixture operator/consumer counts",
    );
  });

  it("a failed read reaches an unavailable notice, never a fixture number", () => {
    assert.ok(admin.includes('setOverviewRead("failed")'), "the overview reader lost its failure branch");
    assert.ok(admin.includes('overviewRead === "failed"'), "a failed read no longer renders its own state");
  });

  it("the flag-off 404 is a known disabled state, distinct from a failure", () => {
    assert.ok(
      admin.includes("if (response.status === 404) return null"),
      "the flag-off 404 must resolve to the disabled state, not a failed read",
    );
    assert.ok(admin.includes("overviewRead === null"), "the disabled state no longer renders distinctly");
  });

  it("Funded and Cash All-Time render durable money, never a hardcoded em-dash", () => {
    // The hardcoded strip that always rendered `—` for these two must be gone.
    assert.ok(
      !admin.includes('{ label: "Funded All-Time", value: "—"'),
      "Funded All-Time is still hardcoded to an em-dash instead of reading the endpoint",
    );
    assert.ok(
      !admin.includes('{ label: "Cash All-Time", value: "—"'),
      "Cash All-Time is still hardcoded to an em-dash instead of reading the endpoint",
    );
    // Both are driven off the returned funded/cash values through the tri-state.
    assert.ok(admin.includes("overviewMoney("), "Funded/Cash lost the durable money tri-state");
    assert.ok(admin.includes("counts.funded") && admin.includes("counts.cash"), "Funded/Cash no longer read from the endpoint payload");
    assert.ok(admin.includes("formatDemoMoney(cents"), "a returned funded/cash number is no longer rendered as money");
  });

  it("a null funded/cash keeps the exact not-enabled reasons", () => {
    assert.ok(admin.includes("Recorded outcomes not enabled"), "Funded All-Time lost its not-enabled reason");
    assert.ok(admin.includes("Fee records not enabled"), "Cash All-Time lost its not-enabled reason");
  });
});
