import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const consumerPage = source("../../app/(surfaces)/consumer/page.tsx");
const consumerWrapper = source("../../app/(surfaces)/consumer/surface-client.tsx");
const consumer = source("../../components/surfaces/consumer.tsx");
const operatorPage = source("../../app/(surfaces)/operator/page.tsx");
const operatorWrapper = source("../../app/(surfaces)/operator/surface-client.tsx");
const operator = source("../../components/surfaces/operator.tsx");
const adminPage = source("../../app/(surfaces)/admin/page.tsx");
const adminWrapper = source("../../app/(surfaces)/admin/surface-client.tsx");
const admin = source("../../components/surfaces/admin.tsx");
const root = source("../../app/page.tsx");
const demo = source("../../components/demo/demo-app.tsx");

describe("pricing surface contract", () => {
  it("defaults paid refresh false through every real-auth boundary", () => {
    for (const boundary of [consumerWrapper, consumer, operatorWrapper, operator, adminWrapper, admin]) {
      assert.match(boundary, /paidRefreshEnabled = false/);
    }
    assert.match(consumerWrapper, /paidRefreshEnabled=\{paidRefreshEnabled\}/);
    assert.match(operatorWrapper, /paidRefreshEnabled=\{paidRefreshEnabled\}/);
    assert.match(adminWrapper, /paidRefreshEnabled=\{paidRefreshEnabled\}/);
  });

  it("resolves the server-only flag after exact role authorization", () => {
    for (const page of [consumerPage, operatorPage, adminPage]) {
      assert.ok(page.indexOf("requireRole(SURFACE_ROLE)") < page.indexOf('featureFlag("FEATURE_PAID_REFRESH")'));
      assert.match(page, /paidRefreshEnabled=\{paidRefreshEnabled\}/);
    }
  });

  it("keeps root and fixture callers outside runtime pricing", () => {
    for (const fixture of [root, demo]) {
      assert.doesNotMatch(fixture, /paidRefreshEnabled|\/api\/pricing|\/api\/refresh-now/);
    }
  });

  it("fetches each exact role catalog only from a guarded no-store effect", () => {
    for (const [surface, endpoint] of [
      [consumer, "/api/pricing/consumer"],
      [operator, "/api/pricing/operator"],
      [admin, "/api/pricing/admin"],
    ]) {
      const fetchIndex = surface.indexOf(`fetch("${endpoint}"`);
      const guardIndex = surface.lastIndexOf("if (!paidRefreshEnabled) return;", fetchIndex);
      assert.ok(guardIndex >= 0 && guardIndex < fetchIndex);
      assert.match(surface.slice(fetchIndex, fetchIndex + 180), /cache: "no-store"/);
    }
  });

  it("substitutes runtime values at every named consumer display", () => {
    assert.match(consumer, /pricingCatalog\.monitoring\.amountCents/);
    assert.match(consumer, /pricingCatalog\.forcePull\.amountCents/);
    assert.match(consumer, /`Refresh · \$\{refreshPriceLabel\}`/);
    assert.match(consumer, /monitoringPriceLabel=\{monitoringPriceLabel\}/);
    assert.match(consumer, /monitoringPriceAmountLabel=\{monitoringPriceAmountLabel\}/);
    assert.match(consumer, /refreshPriceAmountLabel=\{refreshPriceAmountLabel\}/);
    assert.match(consumer, /A \$\{refreshPriceLabel\} add-on charge/);
    assert.match(consumer, /`Confirm \$\{refreshPriceLabel\} refresh`/);
  });

  it("substitutes the operator split in text, summary and share calculations", () => {
    assert.match(operator, /pricingCatalog\.monitoringSplit\.percent/);
    assert.match(operator, /monitoringShareLabel/);
    assert.match(operator, /monitoringShareRate/);
    // Re-pinned 2026-08-22 (fixture eviction, LANE A): `monitoringShareRate` is
    // `number | null` now — a failed or absent pricing read renders an em dash
    // instead of the literal 40% — so the Platform-rev body reads it once into
    // `shareRate` and multiplies with that. Same substitution, one hop.
    assert.match(operator, /const shareRate = monitoringShareRate \?\? PLATFORM_REV_SHARE;/);
    assert.ok((operator.match(/PLATFORM_PLAN_PRICE \* shareRate/g) ?? []).length >= 2);
  });

  it("substitutes admin price and split without adding a persistence route", () => {
    assert.match(admin, /catalog\.forcePull\.amountCents/);
    assert.match(admin, /catalog\.monitoringSplit\.percent/);
    assert.match(admin, /monitoringSplitLabel/);
    assert.match(admin, /forcePullPrice/);
    assert.doesNotMatch(admin, /fetch\("\/api\/pricing\/admin"[\s\S]{0,180}method:/);
  });

  it("retains the original false-branch literals and demo timer behavior", () => {
    assert.match(consumer, /: "\$49"/);
    assert.match(consumer, /: "\$49\.00"/);
    assert.match(consumer, /: "\$19"/);
    assert.match(consumer, /: "\$19\.00"/);
    assert.match(consumer, /Refresh started and the \$19 charge is pending/);
    assert.match(consumer, /window\.setTimeout\(\(\) => \{ setRefreshPending\(false\); setRefreshComplete\(true\)/);
    assert.match(operator, /const PLATFORM_REV_SHARE = 0\.4;/);
    // Re-pinned 2026-08-22: the fixture shell still falls back to the 40%
    // assumption, but it is now derived from the constant rather than written
    // out as a literal beside it, and a signed-in workspace with no pricing
    // read gets an em dash rather than a rate it never agreed to.
    assert.match(operator, /PLATFORM_REV_SHARE \* 100/);
    assert.match(operator, /monitoringSharePercent === null \? "—"/);
    assert.match(admin, /useState\("\$19"\)/);
    assert.match(admin, /useState\(40\)/);
    assert.match(admin, /: "40%"/);
  });

  it("posts the displayed governed amount, blocks unresolved pricing and retains one key across retries", () => {
    const start = consumer.indexOf("async function confirmPaidRefresh()");
    const end = consumer.indexOf("useEffect(() => {", start);
    const handler = consumer.slice(start, end > start ? end : start + 2_400);
    assert.match(handler, /refreshSubmitting[\s\S]*blockingPaidRefresh !== null && replayablePaidRefresh === null[\s\S]*paidRefreshReadState !== "ready"[\s\S]*pricingState !== "ready"[\s\S]*!pricingCatalog/);
    assert.match(handler, /refreshAttemptKey\.current \?\? crypto\.randomUUID\(\)/);
    assert.match(handler, /fetch\("\/api\/refresh-now"/);
    assert.match(handler, /method: "POST"/);
    assert.match(handler, /"Idempotency-Key": idempotencyKey/);
    assert.match(handler, /expectedAmountCents: pricingCatalog\.forcePull\.amountCents/);
    const requestBody = handler.slice(handler.indexOf("body: JSON.stringify"), handler.indexOf("method: \"POST\""));
    assert.doesNotMatch(requestBody, /clientId|currency|provider/);
    const networkCatch = handler.slice(handler.indexOf("} catch {"), handler.indexOf("const result"));
    assert.doesNotMatch(networkCatch, /refreshAttemptKey\.current = null/);
    const failedResult = handler.slice(
      handler.indexOf("if (!response.ok"),
      handler.indexOf("rememberRefreshAttemptKey(null)", handler.indexOf("if (!response.ok")),
    );
    assert.doesNotMatch(failedResult, /rememberRefreshAttemptKey\(null\)/);
    assert.match(consumer, /disabled=\{paidRefreshEnabled && \(refreshSubmitting \|\| \(blockingPaidRefresh !== null && replayablePaidRefresh === null\)/);
    assert.match(consumer, /window\.sessionStorage\.setItem\(paidRefreshAttemptStorageKey\(clientId\), value\)/);
    assert.match(consumer, /rememberRefreshAttemptKey\(idempotencyKey\)/);
    assert.match(consumer, /pricingState === "unavailable"|setPricingState\("unavailable"\)/);
    assert.match(consumer, /pricingCatalog \? priceLabel\(pricingCatalog\.forcePull\.amountCents\) : "Unavailable"/);
  });
});
