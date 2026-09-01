import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync(new URL("./consumer.tsx", import.meta.url), "utf8");
const monitoringRouteSource = readFileSync(new URL("../../app/api/monitoring/reading/route.ts", import.meta.url), "utf8");
const monitoringServerSource = readFileSync(new URL("../../lib/monitoring/read.server.ts", import.meta.url), "utf8");
const creditView = source.slice(source.indexOf("function CreditView"), source.indexOf("function OnboardingHubView"));
const durableConfirm = source.slice(source.indexOf("async function confirmPaidRefresh"), source.indexOf("useEffect(() => {\n    onProfileIdentityChange"));

describe("consumer monitoring and paid-refresh truth", () => {
  it("permits the July score baseline only on the explicit fixture state", () => {
    assert.match(creditView, /const fixture = readingState === "fixture"/);
    assert.match(creditView, /reading\?\.bureaus \?\? \(fixture \? bureaus : \[\]\)/);
    assert.match(creditView, /No mock or stored bureau value is being substituted/);
  });

  it("maps a provider-owned unavailable response to an unavailable screen", () => {
    assert.match(source, /setMonitoringReadState\(body\.source === "provider" \? "unavailable" : "fixture"\)/);
    assert.match(source, /SecureView owns the current score display/);
  });

  it("does not date or announce a durable charge from the confirmation click", () => {
    assert.doesNotMatch(durableConfirm, /setRefreshChargedAt|new Date\(\)\.toISOString\(\)/);
    assert.match(durableConfirm, /Refresh request accepted\. Checking the durable payment and analysis status/);
    assert.match(durableConfirm, /watchForRefresh\(result\.requestId\)/);
  });

  it("adds a durable payment-history row only when succeeded-event evidence supplies paidAt", () => {
    assert.match(source, /if \(refresh\.paidAt === null\) continue/);
    assert.match(source, /status: "Paid"/);
    assert.match(source, /fetchConsumerPaidRefreshHistory/);
  });

  it("reads monitoring and durable purchase history even when new purchases are unavailable", () => {
    assert.match(source, /if \(!durableWorkspace\) return;[\s\S]*loadMonitoringReading/);
    assert.match(source, /if \(!durableWorkspace\) return;[\s\S]*loadPaidRefreshHistory/);
    assert.match(source, /latestRefresh=\{paidRefreshes\[0\] \?\? null\}/);
    assert.match(source, /paidRefreshHistoryUnavailable=\{durableWorkspace && paidRefreshReadState === "unavailable"\}/);
    assert.doesNotMatch(monitoringRouteSource, /FEATURE_PAID_REFRESH|notFound/);
    assert.doesNotMatch(monitoringServerSource, /FEATURE_ANALYSIS/);
    assert.match(monitoringServerSource, /monitoringReadSource\(env\)/);
  });

  it("disables a new charge for every unresolved durable refresh state", () => {
    assert.match(source, /paidRefreshBlocksNewPurchase\(refresh\.status\)/);
    assert.match(source, /blockingPaidRefresh === null/);
    assert.match(source, /blockingPaidRefresh !== null/);
    assert.match(source, /An earlier refresh is unresolved/);
  });

  it("resumes only an unresolved request whose exact key survived the reload", () => {
    assert.match(source, /window\.sessionStorage\.getItem\(paidRefreshAttemptStorageKey\(clientId\)\)/);
    assert.match(source, /window\.sessionStorage\.setItem\(paidRefreshAttemptStorageKey\(clientId\), value\)/);
    assert.match(source, /paidRefreshCanResume\(blockingPaidRefresh\.status\)/);
    assert.match(source, /blockingPaidRefresh !== null && replayablePaidRefresh === null/);
    assert.match(source, /retries the original \$\{refreshPriceLabel\} request with its original key/);
    assert.match(source, /cannot create a second purchase/);
  });

  it("shows a resolved remediation as terminal and permits a later purchase", () => {
    assert.match(source, /latestRefresh\.status === "remediated"/);
    assert.match(source, /resolved the earlier paid refresh obligation/);
  });
});
