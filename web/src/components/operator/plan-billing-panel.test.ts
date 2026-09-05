import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const SOURCE = readFileSync(new URL("./plan-billing-panel.tsx", import.meta.url), "utf8");
const OPERATOR_SOURCE = readFileSync(new URL("../surfaces/operator.tsx", import.meta.url), "utf8");

function literal(copy: string): RegExp {
  return new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

describe("operator plan and billing panel", () => {
  it("reads the real subscription on mount and reloads on retry", () => {
    assert.match(SOURCE, /loadPlatformBilling\(\)/);
    assert.match(SOURCE, /\[enabled, reloadVersion\]/);
    assert.match(SOURCE, /setReloadVersion\(\(value\) => value \+ 1\)/);
    assert.match(SOURCE, /Try again/);
  });

  it("renders an honest line for every answer the route can give", () => {
    for (const copy of [
      "Loading this workspace&rsquo;s plan",
      "Platform billing is not turned on for this deployment",
      "Sign in again to view this workspace's plan",
      "Only workspace owners and admins can view billing",
      "This workspace is deactivated",
      "No billing record was found for this workspace",
      "The plan could not be loaded right now",
      "No subscription has been started for this workspace",
    ]) assert.match(SOURCE, literal(copy));
    assert.match(SOURCE, /role="alert"/);
    assert.match(SOURCE, /role="status"/);
  });

  it("shows only what the billing record carries", () => {
    assert.match(SOURCE, /label="Plan" value=\{billing\.plan \?\? "No plan set"\}/);
    assert.match(SOURCE, /label="Subscription" value=\{statusValue\}/);
    assert.match(SOURCE, /label="Seats" value=\{seatsValue\(billing\)\}/);
    assert.match(SOURCE, /label="Active clients" value=\{billing\.clientMeter\.label\}/);
    assert.match(SOURCE, /"Renews on"/);
    assert.match(SOURCE, /"Trial ends"/);
    assert.match(SOURCE, /"Ends on"/);
    assert.match(SOURCE, /"Grace period until"/);
    assert.match(SOURCE, /waiting to sync with the billing provider/);
    assert.match(SOURCE, literal("Payment method, invoices and amounts are not part of this record"));
    assert.doesNotMatch(SOURCE, /\$\d|last4|invoice\.|amountCents|formatDemoMoney/);
  });

  it("offers checkout without a subscription and the portal with one, and says when the driver is the mock", () => {
    assert.match(SOURCE, /const hasSubscription = billing\.subscriptionRef !== null/);
    assert.match(SOURCE, /hasSubscription \? \(\s*<Button[^>]*onClick=\{\(\) => void navigateTo\("portal"\)\}/);
    assert.match(SOURCE, /Manage billing/);
    assert.match(SOURCE, /onClick=\{\(\) => void navigateTo\("checkout"\)\}/);
    assert.match(SOURCE, /Start subscription/);
    assert.match(SOURCE, /window\.location\.assign\(url\)/);
    assert.match(SOURCE, /platformBillingProvider\(billing\)/);
    assert.match(SOURCE, literal("mock billing driver, so these buttons open a placeholder page and no card is reached"));
  });

  it("replaces the durable placeholder in Settings while the demo fixture branch stays demo-only", () => {
    assert.match(OPERATOR_SOURCE, /import \{ PlanBillingPanel \} from "@\/components\/operator\/plan-billing-panel"/);
    assert.match(OPERATOR_SOURCE, /\{durableWorkspace \? \(\s*<PlanBillingPanel \/>\s*\) : \(/);
    assert.doesNotMatch(OPERATOR_SOURCE, /are not readable from this screen, so none of them are shown/);
  });
});
