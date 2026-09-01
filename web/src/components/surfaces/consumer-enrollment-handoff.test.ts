import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync(
  new URL("./consumer.tsx", import.meta.url),
  "utf8",
);

function section(start: string, end: string): string {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `${start} not found`);
  const to = source.indexOf(end, from);
  assert.notEqual(to, -1, `${end} not found after ${start}`);
  return source.slice(from, to);
}

/**
 * The enrollment-to-workspace handoff. The interstitial must resolve every
 * status line to a state that is already true (no infinite progress theater),
 * the durable arm must never claim the source review completed when the real
 * queue drains over minutes, and the landed hero must carry the wait as a live
 * state instead of a dead screen. These are behavior contracts, not styling —
 * each one guards an honesty or accessibility property the walk could regress.
 */
describe("enrollment handoff interstitial", () => {
  const interstitial = section("function AnalysisQueuedView", "\nexport function ConsumerSurface");

  it("spins nothing forever — every status line resolves", () => {
    assert.doesNotMatch(interstitial, /animate-spin/, "the interstitial reintroduced an infinite spinner");
    assert.doesNotMatch(interstitial, /LoaderCircle/, "the interstitial reintroduced an indeterminate loader");
    assert.ok(interstitial.includes("resolvedStatus"), "status lines no longer resolve to a terminal state");
  });

  it("keeps the durable rows honest about the undrained source review", () => {
    const durableRows = section("const DURABLE_HANDOFF_ROWS", "const FIXTURE_HANDOFF_ROWS");
    // "Reviewing authorized sources" completing instantly is the fixture's
    // fiction; the durable enrollment queues real work that drains later.
    assert.doesNotMatch(durableRows, /Reviewing authorized sources/, "the durable interstitial claims an in-flight source review");
    assert.match(durableRows, /resolvedStatus: "Queued"/, "the durable readiness-analysis row must resolve to Queued, not Complete");
  });

  it("claims analysis completion only on the fixture arm", () => {
    const claims = source.split('"First authorized analysis complete. Your verified workspace is ready."').length - 1;
    assert.equal(claims, 1, "the completion claim should exist exactly once");
    // Derived from the landing effect itself rather than a fixed character
    // window, so inserting code between the two lines cannot break the guard.
    const landingEffect = section("if (handoff.phase !== \"staged\" || !handoff.rowsSettled", "// \"landing\" normally resolves");
    assert.match(landingEffect, /const fixture = !enrollLive;/, "the landing no longer distinguishes the fixture arm");
    assert.match(
      landingEffect,
      /if \(fixture\) notify\("First authorized analysis complete\./,
      "the completion claim must be gated to the fixture arm — a durable enrollment's analysis has not completed at landing",
    );
  });

  it("honors reduced motion end to end", () => {
    assert.match(source, /<MotionConfig reducedMotion="user">/);
    assert.ok(interstitial.includes("useReducedMotion()"), "the interstitial choreography ignores prefers-reduced-motion");
  });

  /**
   * The travel is an explicit FLIP, not a motion `layoutId` pair. The first
   * implementation used `layoutId` and it measurably did not animate — sampling
   * the card's bounding box every animation frame produced exactly two states,
   * a hard jump with no interpolated frame. So these assert the mechanism that
   * was proven to work, and the `layoutId` ban is the regression guard.
   */
  it("attaches the landing ref to both hero branches so the travel cannot silently detach", () => {
    const dashboard = section("function DashboardView", "function OptimizationView");
    assert.equal(
      dashboard.split("ref={landingRef}").length - 1,
      2,
      "both the durable and fixture hero must carry the landing ref",
    );
    assert.doesNotMatch(
      source,
      /layoutId=/,
      "layoutId was measured not to animate across the AnimatePresence boundary; the landing uses an explicit FLIP",
    );
  });

  it("measures the outgoing card before it unmounts and animates the incoming one", () => {
    assert.match(source, /const card = document\.querySelector\(`\[\$\{HANDOFF_CARD_ATTR\}\]`\)/, "the landing no longer measures the interstitial card");
    const hook = section("function useHandoffLanding", "function FadeSwap");
    assert.match(hook, /node\.animate\(/, "the landing does not drive a Web Animations travel");
    assert.match(hook, /translateY\(\$\{dy\}px\)/, "the travel no longer starts from the measured offset");
    assert.match(hook, /matchMedia\("\(prefers-reduced-motion: reduce\)"\)/, "the travel ignores reduced motion");
    // A cancelled animation must still resolve the phase, or the workspace
    // stays hidden behind the reveal gate.
    assert.match(hook, /addEventListener\("cancel", finish/, "a cancelled travel never reports landing");
  });
});

describe("landed hero live analysis state", () => {
  const dashboard = section("function DashboardView", "function OptimizationView");

  it("derives the waiting state from the tracker read's job hint", () => {
    for (const claim of ['analysisPending === "running"', 'analysisPending === "queued"']) {
      assert.ok(dashboard.includes(claim), `the hero does not render the ${claim} state`);
    }
  });

  it("bounds the poll and stops it when nothing is awaited", () => {
    assert.match(dashboard, /awaitingFirstAnalysis/);
    assert.match(dashboard, /30 \* 60_000/, "the poll lost its half-hour bound");
    assert.match(dashboard, /clearInterval\(interval\)/, "the poll interval is never cleaned up");
    assert.match(dashboard, /removeEventListener\("visibilitychange"/, "the visibility listener is never cleaned up");
  });
});
