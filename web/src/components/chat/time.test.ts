// Timestamps, driven rather than read.
//
// These are pure functions with an injected `now`, which is the whole reason they were pulled out
// of the components: a relative timestamp is the classic thing that gets "tested" by looking at
// it, and looking at it is exactly how "sent in 3 minutes" ships.
//
// Watched failing before it counted, one change at a time against this tree:
//   * `relativeTime` returning `${minutes}m` under a minute — the first case failed;
//   * guarding that branch with `elapsed >= 0`, so a slightly-ahead clock falls through to the
//     minutes branch and renders `-1m` — the clock-skew case failed;
//   * `crossesDay` comparing `toISOString().slice(0, 10)` instead of `toDateString()` — the
//     twenty-minutes-across-local-midnight case failed;
//   * the grouping window widened past four hours — the noticeable-gap case failed. Widening it
//     to one hour does NOT fail anything here, and that is correct: the window's value is a
//     product judgement, and the inside/outside case derives from it rather than pinning it.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  absoluteTime,
  crossesDay,
  dayLabel,
  GROUPING_WINDOW_MS,
  parseTimestamp,
  relativeTime,
  withinGroupingWindow,
} from "./time.ts";

/** A fixed local instant, so nothing here depends on when it runs. */
const NOW = new Date("2026-08-22T14:30:00");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

describe("relative time", () => {
  it("reads as `just now` under a minute, and for a clock that is slightly ahead", () => {
    assert.equal(relativeTime(ago(0), NOW), "just now");
    assert.equal(relativeTime(ago(59_000), NOW), "just now");
    // Skew between a browser and the database is real and small. Telling a person their own
    // message arrives in the future helps nobody.
    assert.equal(relativeTime(new Date(NOW.getTime() + 4_000).toISOString(), NOW), "just now");
  });

  it("counts minutes, then hours, then falls back to a date", () => {
    assert.equal(relativeTime(ago(60_000), NOW), "1m");
    assert.equal(relativeTime(ago(59 * 60_000), NOW), "59m");
    assert.equal(relativeTime(ago(60 * 60_000), NOW), "1h");
    assert.equal(relativeTime(ago(23 * 3_600_000), NOW), "23h");
  });

  it("says Yesterday only for the local day before, not for 24 hours ago", () => {
    // 14:30 minus 25 hours is 13:30 the previous local day: yesterday by the calendar.
    assert.equal(relativeTime(ago(25 * 3_600_000), NOW), "Yesterday");
    // And two days back is a date, not a second "Yesterday".
    assert.notEqual(relativeTime(ago(49 * 3_600_000), NOW), "Yesterday");
  });

  it("adds the year only once the year differs", () => {
    const thisYear = relativeTime("2026-01-04T09:00:00Z", NOW);
    const lastYear = relativeTime("2025-11-04T09:00:00Z", NOW);
    assert.equal(/\d{4}/.test(thisYear), false, `same-year label carried a year: ${thisYear}`);
    assert.ok(/2025/.test(lastYear), `cross-year label lost its year: ${lastYear}`);
  });

  it("renders nothing at all for a value that is not a timestamp", () => {
    // Not "Invalid Date", which is what every naive version puts on the screen.
    assert.equal(relativeTime("not a date", NOW), "");
    assert.equal(dayLabel("not a date", NOW), "");
    assert.equal(absoluteTime("not a date"), "");
    assert.equal(parseTimestamp("not a date"), null);
  });
});

describe("absolute time", () => {
  it("carries both the reader's clock and UTC, so two offices can agree", () => {
    const rendered = absoluteTime("2026-08-22T09:05:00Z");
    assert.ok(rendered.includes("UTC"), `no UTC half: ${rendered}`);
    // The UTC half is the instant as UTC, whatever the runner's own zone is.
    const utcHalf = rendered.slice(rendered.lastIndexOf("·") + 1);
    assert.ok(/\b9(:|\.)05\b/.test(utcHalf) || /\b09:05\b/.test(utcHalf), utcHalf);
  });
});

describe("day dividers", () => {
  it("labels today and yesterday by name and everything else by date", () => {
    assert.equal(dayLabel(ago(3_600_000), NOW), "Today");
    assert.equal(dayLabel(ago(25 * 3_600_000), NOW), "Yesterday");
    assert.ok(/August/.test(dayLabel("2026-08-01T10:00:00", NOW)));
  });

  it("crosses on the local midnight, not on a 24-hour boundary", () => {
    const lateLastNight = new Date("2026-08-21T23:50:00").toISOString();
    const earlyToday = new Date("2026-08-22T00:10:00").toISOString();
    assert.equal(crossesDay(lateLastNight, earlyToday), true, "twenty minutes across midnight");

    const morning = new Date("2026-08-22T09:00:00").toISOString();
    const evening = new Date("2026-08-22T21:00:00").toISOString();
    assert.equal(crossesDay(morning, evening), false, "twelve hours inside one day");
  });
});

describe("grouping", () => {
  it("keeps a run together inside the window and splits it outside", () => {
    const first = new Date("2026-08-22T09:00:00").toISOString();
    // Derived from the exported window rather than transcribed, so widening the window in the
    // module cannot leave this test asserting the old one.
    const inside = new Date(Date.parse(first) + GROUPING_WINDOW_MS - 1_000).toISOString();
    const outside = new Date(Date.parse(first) + GROUPING_WINDOW_MS + 1_000).toISOString();
    assert.equal(withinGroupingWindow(first, inside), true);
    assert.equal(withinGroupingWindow(first, outside), false);
  });

  it("refuses to group across a gap a reader would notice", () => {
    const first = new Date("2026-08-22T09:00:00").toISOString();
    const fourHoursLater = new Date("2026-08-22T13:00:00").toISOString();
    assert.equal(withinGroupingWindow(first, fourHoursLater), false);
  });
});
