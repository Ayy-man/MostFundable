import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const source = readFileSync(
  fileURLToPath(new URL("./consumer.tsx", import.meta.url)),
  "utf8",
);

/**
 * The Overview hero must never present fixture claims while the tracker read
 * is active: the walk that motivated this (GAPS G-HOST-23) saw "Bring Chase
 * Ink to $3,480" and a six-snapshot graph rendered above durable panels
 * reporting readiness 99. The guard isolates the durable branch of the hero
 * ternary and asserts it holds no fixture literals and derives from the
 * tracker read. Watched failing on the pre-fix tree, where the hero had no
 * durable branch at all.
 */
function heroBranches(): { durable: string; fixture: string } {
  // Re-pinned by the Tier-2 eviction lane. The gate used to be `trackerClients.enabled !== false`
  // — a question about a deployment flag — which handed the fixture hero to a signed-in consumer
  // whenever FEATURE_TRACKER was off. `fixtureOverview` is the same branch asking the right
  // question: it is true only when the read is off AND this is the fixture shell.
  const start = source.indexOf("{!fixtureOverview ? (\n          trackerClient ? (");
  assert.notEqual(start, -1, "the Overview hero no longer branches on the tracker read");
  assert.match(
    source,
    /const fixtureOverview = !durableWorkspace && trackerClients\.enabled === false;/,
    "the fixture-hero gate stopped asking whether this is a durable workspace",
  );
  const fixtureFallback = source.indexOf(") : (", start);
  assert.notEqual(fixtureFallback, -1);
  const end = source.indexOf("<ReadinessTrajectory", start);
  assert.notEqual(end, -1, "fixture hero trajectory not found after the durable branch");
  assert.ok(fixtureFallback < end, "fixture fallback should precede the fixture trajectory");
  return {
    durable: source.slice(start, fixtureFallback),
    fixture: source.slice(fixtureFallback, end),
  };
}

describe("consumer Overview hero durable branch", () => {
  const { durable, fixture } = heroBranches();

  it("contains no fixture claims", () => {
    // Fixed persona/account names, amounts, dates, and the fixture readiness
    // value must not appear in the branch a real session renders.
    for (const claim of [/Chase Ink/, /3,480/, /4,140/, /Jul 14/, /Aug 13/, /Jun 24/, /readiness closed at 62/, /snapshotFrames/]) {
      assert.doesNotMatch(durable, claim, `durable hero branch carries fixture claim ${claim}`);
    }
  });

  it("derives every stated figure from the tracker read", () => {
    for (const field of ["trackerClient.readiness", "trackerClient.openActionCount", "trackerClient.analysisAt"]) {
      assert.ok(durable.includes(field), `durable hero branch does not read ${field}`);
    }
    assert.ok(durable.includes("DurableReadinessPanel"), "durable hero branch does not render the durable readiness panel");
  });

  it("keeps the fixture hero as the flag-off fallback", () => {
    assert.ok(fixture.includes("Bring Chase Ink to $3,480"), "fixture hero headline moved out of the fallback branch");
  });

  it("presents no trajectory graph from a single observation", () => {
    // One dated snapshot is not a history; the durable panel must not draw
    // the fixture's SVG trajectory.
    const panelStart = source.indexOf("function DurableReadinessPanel");
    assert.notEqual(panelStart, -1);
    const panelEnd = source.indexOf("\nfunction ", panelStart + 1);
    const panel = source.slice(panelStart, panelEnd);
    assert.doesNotMatch(panel, /<svg/, "durable readiness panel draws a graph it has no history for");
    for (const field of ["client.readiness", "client.analysisAt", "client.nextRefreshAt"]) {
      assert.ok(panel.includes(field), `durable readiness panel does not read ${field}`);
    }
  });

  it("keeps the header status tag off fixture analysis claims in durable mode", () => {
    // Re-pinned with the hero gate above: the tag now has a third arm for the read being off on a
    // durable account, where neither "Analysis current" nor the fixture's claim is true.
    assert.match(source, /const overviewStatusTag = trackerReadOff/);
    assert.match(source, /const trackerReadOff = durableWorkspace && trackerClients\.enabled === false;/);
    assert.doesNotMatch(source, /actions=\{referralsEnabled \? <><StatusTag icon=\{canceled/);
  });
});

describe("consumer Overview below-the-fold sections in durable mode", () => {
  it("removes the duplicate plan and monitoring cards while preserving the monitoring metric", () => {
    const start = source.indexOf("function DashboardView");
    const end = source.indexOf("function useConsumerTracker", start);
    assert.ok(start !== -1 && end > start, "the Overview implementation could not be located");
    const overview = source.slice(start, end);
    assert.doesNotMatch(overview, /title="Your action plan"/);
    assert.doesNotMatch(overview, /title="Credit monitoring"/);
    assert.match(source, /function OverviewMetricCell/);
    assert.match(source, /Monitoring \$\{monitoringActive \? "active"/);
  });

  it("reports the enrollment monitoring status inside the active-state metric", () => {
    assert.match(source, /detail: "Enrollment monitoring status"/);
    assert.match(source, /metric\.label === "Monitoring"/);
  });

  it("drives the journey from the tracker stage with no fixture dates", () => {
    assert.match(source, /currentStage=\{TRACKER_STAGE_LABELS\[trackerClient\.stage\] as FundingStage\}/);
    assert.match(source, /durable=\{\{ analysisComplete: trackerClient\.analysisAt !== null, currentDateLabel: `Entered \$\{formatTrackerDate\(trackerClient\.stageEnteredAt\)\}` \}\}/);
    // JourneyTimeline's fixture dates and the Optimization fixture sub-grid
    // must be gated off in durable mode.
    assert.match(source, /durable \|\| name !== "Onboarding" \? "Complete" : "Jun 24"/);
    assert.match(source, /\? durable \? durable\.currentDateLabel : canceled \? "Closed Jul 21" : currentDates\[name\]/);
    assert.match(source, /stage\.name === "Optimization" && !durable/);
  });
});
