import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MONITORING_BASELINE,
  MONITORING_BASELINE_LABEL,
  MONITORING_BASELINE_UTILIZATION_PCT,
  deriveMonitoringReading,
  monitoringDateLabel,
  nextIncludedRefreshAt,
  type CompletedRefresh,
} from "./reading.ts";

/**
 * Run ids are uuids in production. These are shaped like them and are spread across the space so
 * the distribution assertions below are measured rather than asserted from one lucky draw.
 */
function runIds(count: number): CompletedRefresh[] {
  const refreshes: CompletedRefresh[] = [];
  for (let index = 0; index < count; index += 1) {
    const suffix = String(index).padStart(12, "0");
    refreshes.push({
      ranAt: "2026-08-22T00:00:00.000Z",
      runId: `3f2b1c4e-0000-4000-8000-${suffix}`,
    });
  }
  return refreshes;
}

test("no completed refresh renders the frozen baseline untouched", () => {
  const reading = deriveMonitoringReading([]);

  assert.deepEqual(reading.bureaus, MONITORING_BASELINE);
  assert.equal(reading.asOfLabel, MONITORING_BASELINE_LABEL);
  assert.equal(reading.utilizationPct, MONITORING_BASELINE_UTILIZATION_PCT);
  assert.equal(reading.nextRefreshLabel, "Aug 13");
});

test("the same refresh id always renders the same numbers", () => {
  const refreshes = runIds(3);

  assert.deepEqual(deriveMonitoringReading(refreshes), deriveMonitoringReading(refreshes));
});

test("a refresh moves every bureau by between 3 and 12 points, in whole numbers", () => {
  for (const refresh of runIds(200)) {
    const after = deriveMonitoringReading([refresh]).bureaus;

    after.forEach((entry, index) => {
      const delta = Math.abs(entry.score - MONITORING_BASELINE[index].score);
      assert.ok(Number.isInteger(entry.score), `${entry.bureau} produced a fractional score`);
      assert.ok(delta >= 3 && delta <= 12, `${entry.bureau} moved ${delta}, outside 3..12`);
    });
  }
});

test("a refresh is never uniformly upward — a pull reveals a file, it does not improve one", () => {
  for (const refresh of runIds(400)) {
    const after = deriveMonitoringReading([refresh]).bureaus;
    const rose = after.filter((entry, index) => entry.score > MONITORING_BASELINE[index].score);

    assert.notEqual(rose.length, after.length, `${refresh.runId} moved every bureau upward`);
  }
});

test("both directions really occur, and the bureaus move independently", () => {
  let anyRose = false;
  let anyFell = false;
  let anyDisagreedInMagnitude = false;

  for (const refresh of runIds(200)) {
    const after = deriveMonitoringReading([refresh]).bureaus;
    const deltas = after.map((entry, index) => entry.score - MONITORING_BASELINE[index].score);

    if (deltas.some((delta) => delta > 0)) anyRose = true;
    if (deltas.some((delta) => delta < 0)) anyFell = true;
    if (new Set(deltas.map(Math.abs)).size > 1) anyDisagreedInMagnitude = true;
  }

  assert.ok(anyRose, "no refresh ever moved a bureau upward");
  assert.ok(anyFell, "no refresh ever moved a bureau downward");
  assert.ok(anyDisagreedInMagnitude, "every bureau moved by the same amount — the seeds correlate");
});

test("a second refresh moves the file again rather than re-rendering the first", () => {
  const [first, second] = runIds(2);
  const once = deriveMonitoringReading([first]);
  const twice = deriveMonitoringReading([first, second]);

  assert.notDeepEqual(twice.bureaus, once.bureaus);
  // The fold is ordered, so the first refresh's result is still the input to the second.
  assert.deepEqual(deriveMonitoringReading([first]).bureaus, once.bureaus);
});

test("the band is recomputed from the moved number, not carried over", () => {
  // 661 is the Good floor, so a baseline sitting one point above it must be able to become Fair.
  const baseline = [{ band: "Good", bureau: "TransUnion", change: "Updated Jul 14", score: 662 }];
  let sawFair = false;

  for (const refresh of runIds(100)) {
    const [entry] = deriveMonitoringReading([refresh], { baseline }).bureaus;
    assert.equal(entry.band, entry.score >= 661 ? "Good" : "Fair");
    if (entry.band === "Fair") sawFair = true;
  }

  assert.ok(sawFair, "a downward move never relabelled the band");
});

test("scores stay inside the VantageScore range however long the chain runs", () => {
  const long = runIds(400).map((refresh, index) => ({ ...refresh, runId: `${refresh.runId}-${index}` }));
  const low = deriveMonitoringReading(long, {
    baseline: [{ band: "Very poor", bureau: "TransUnion", change: "Updated Jul 14", score: 305 }],
  });
  const high = deriveMonitoringReading(long, {
    baseline: [{ band: "Excellent", bureau: "TransUnion", change: "Updated Jul 14", score: 845 }],
  });

  for (const reading of [low, high]) {
    for (const entry of reading.bureaus) {
      assert.ok(entry.score >= 300 && entry.score <= 850, `${entry.score} left the range`);
    }
  }
});

test("the utilization watch item agrees with the sentence printed above it", () => {
  for (const refresh of runIds(200)) {
    const reading = deriveMonitoringReading([refresh]);
    const rose = reading.utilizationPct > MONITORING_BASELINE_UTILIZATION_PCT;

    assert.equal(
      reading.whatChanged.includes("a higher revolving balance"),
      rose,
      "the balance sentence contradicts the utilization watch item",
    );
    assert.ok(reading.utilizationPct >= 11 && reading.utilizationPct <= 89);
    assert.ok(Number.isInteger(reading.utilizationPct));
  }
});

test("the panel's dates come from the completed run, and the next one is 30 days on", () => {
  const reading = deriveMonitoringReading([
    { ranAt: "2026-08-22T09:15:00.000Z", runId: "3f2b1c4e-0000-4000-8000-00000000000a" },
  ]);

  assert.equal(reading.asOfLabel, "Aug 22");
  assert.equal(reading.nextRefreshLabel, "Sep 21");
  assert.ok(reading.whatChanged.startsWith("The Aug 22 "));
  for (const entry of reading.bureaus) {
    assert.ok(entry.change.endsWith(" Aug 22"), `${entry.bureau} kept a stale caption`);
  }
});

test("each bureau keeps its own caption verb when the date moves", () => {
  const reading = deriveMonitoringReading([
    { ranAt: "2026-08-22T00:00:00.000Z", runId: "3f2b1c4e-0000-4000-8000-00000000000b" },
  ]);

  assert.equal(reading.bureaus[0].change, "Updated Aug 22");
  assert.equal(reading.bureaus[1].change, "Snapshot Aug 22");
  assert.equal(reading.bureaus[2].change, "Updated Aug 22");
});

test("a completed analysis dates the panel even when no refresh was ever bought", () => {
  // The live defect this pins: the panel stated a July pull and an Aug 13 next refresh — a date
  // already in the past — while the Overview, reading the same run, stated September.
  const reading = deriveMonitoringReading([], { latestRunAt: "2026-08-21T12:00:00.000Z" });

  assert.equal(reading.asOfLabel, "Aug 21");
  assert.equal(reading.nextRefreshLabel, "Sep 20");
  // No refresh was bought, so the numbers must not have moved.
  assert.deepEqual(
    reading.bureaus.map((entry) => entry.score),
    MONITORING_BASELINE.map((entry) => entry.score),
  );
  // ...but the captions must not still claim the frozen July pull.
  for (const entry of reading.bureaus) assert.ok(entry.change.endsWith(" Aug 21"));
});

test("the schedule follows the latest analysis while the numbers follow the paid refreshes", () => {
  const reading = deriveMonitoringReading(
    [{ ranAt: "2026-08-10T00:00:00.000Z", runId: "3f2b1c4e-0000-4000-8000-00000000000c" }],
    { latestRunAt: "2026-09-01T00:00:00.000Z" },
  );

  assert.equal(reading.asOfLabel, "Sep 1");
  assert.equal(reading.nextRefreshLabel, "Oct 1");
  assert.notDeepEqual(
    reading.bureaus.map((entry) => entry.score),
    MONITORING_BASELINE.map((entry) => entry.score),
  );
  // Every date the panel prints comes from the one run, so no two can disagree.
  assert.ok(reading.whatChanged.startsWith("The Sep 1 "));
  for (const entry of reading.bureaus) assert.ok(entry.change.endsWith(" Sep 1"));
});

test("an unparseable completion instant falls back to the baseline label rather than rendering Invalid Date", () => {
  assert.equal(monitoringDateLabel("not-a-date"), MONITORING_BASELINE_LABEL);
  assert.equal(nextIncludedRefreshAt("not-a-date"), null);
});

test("the machine-readable tracker schedule is thirty days after the durable analysis", () => {
  assert.equal(
    nextIncludedRefreshAt("2026-08-30T12:15:00.000Z"),
    "2026-09-29T12:15:00.000Z",
  );
});

test("the derived copy never reaches for score-promise vocabulary", () => {
  for (const refresh of runIds(50)) {
    const { whatChanged } = deriveMonitoringReading([refresh]);

    for (const banned of ["point", "score", "guarantee", "boost", "increase your"]) {
      assert.ok(
        !whatChanged.toLowerCase().includes(banned),
        `derived copy used "${banned}": ${whatChanged}`,
      );
    }
  }
});
