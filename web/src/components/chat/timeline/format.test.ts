// The formatters, and the one that would be a defect rather than a wrong-looking date.
//
// The zone is switched inside the process rather than being asserted about in prose, because
// `process.env.TZ` is what a browser's zone is standing in for and the whole claim — "a calendar
// fact cannot shift a day" — is only meaningful across two zones. Honolulu and Los Angeles are the
// pair the mockup was screenshotted in, and they are on opposite sides of midnight UTC.
//
// Watched failing before it counted: `timelineDate` with the UTC branch removed prints "Aug 19" for
// `2026-08-20` in Honolulu, which is the G-BILL-01 class — a charge dated the day before it was made.

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { isDateOnly, openActionSentence, timelineDate, timelineMoney, timelineTime } from "./format";

const ORIGINAL_TZ = process.env.TZ;
after(() => {
  process.env.TZ = ORIGINAL_TZ;
});

/** Run `body` with the process in `zone`, and put the zone back either way. */
function inZone<T>(zone: string, body: () => T): T {
  const previous = process.env.TZ;
  process.env.TZ = zone;
  try {
    return body();
  } finally {
    process.env.TZ = previous;
  }
}

const ZONES = ["Pacific/Honolulu", "America/Los_Angeles", "Asia/Kolkata", "UTC"] as const;

describe("a calendar fact cannot shift a day", () => {
  it("formats every date-only value identically in every zone", () => {
    // The dates are the contract's own `*On` fields as the fixture carries them: a first charge, a
    // payment's received date, an access end, a cap reset, a decision and a release.
    const dates = ["2026-08-01", "2026-08-20", "2026-09-01", "2026-08-23", "2026-08-24"];
    for (const date of dates) {
      const rendered = ZONES.map((zone) => inZone(zone, () => timelineDate(date)));
      assert.equal(
        new Set(rendered).size,
        1,
        `${date} rendered as ${[...new Set(rendered)].join(" / ")} across zones`,
      );
    }
  });

  it("proves the pair of zones can disagree at all, so the check above is not vacuous", () => {
    // The naive implementation, written out: parse the calendar fact and format it in the reader's
    // zone. That is what the UTC branch replaced, and this is it disagreeing with itself — so the
    // assertion above is checking a branch that is doing work, not a coincidence.
    const naive = () =>
      new Date("2026-08-20T00:00:00Z").toLocaleDateString("en-US", {
        day: "numeric",
        month: "short",
      });
    assert.notEqual(
      inZone("Pacific/Honolulu", naive),
      inZone("Asia/Kolkata", naive),
      "the pair of zones no longer straddles midnight UTC, so this file proves nothing",
    );
    // And the real one does not move for the same value.
    assert.equal(
      inZone("Pacific/Honolulu", () => timelineDate("2026-08-20")),
      inZone("Asia/Kolkata", () => timelineDate("2026-08-20")),
    );
  });

  it("tells a calendar fact from an instant by its shape", () => {
    assert.equal(isDateOnly("2026-08-20"), true);
    assert.equal(isDateOnly("2026-08-20T16:00:00Z"), false);
    assert.equal(isDateOnly(""), false);
  });

  it("shows an instant in the reader's own zone", () => {
    // The opposite rule, and it is deliberate: a row's instant is read in the zone the reader is
    // reading the conversation in. Same value, two zones, two clock times.
    const instant = "2026-08-22T09:01:00Z";
    assert.notEqual(
      inZone("Pacific/Honolulu", () => timelineTime(instant)),
      inZone("Asia/Kolkata", () => timelineTime(instant)),
    );
  });
});

describe("the small formatters", () => {
  it("writes whole dollars", () => {
    assert.equal(timelineMoney(50000), "$500");
    assert.equal(timelineMoney(2900), "$29");
    assert.equal(timelineMoney(4000000), "$40,000");
  });

  it("dates the open-action count, and says nothing when there is nothing", () => {
    assert.equal(openActionSentence(undefined, "2026-08-22T09:01:00Z"), "Open actions were not recorded with this analysis.");
    assert.match(openActionSentence(0, "2026-08-22T09:01:00Z"), /^No open actions as of /);
    assert.match(openActionSentence(1, "2026-08-22T09:01:00Z"), /^1 open action in the plan as of /);
    assert.match(openActionSentence(2, "2026-08-22T09:01:00Z"), /^2 open actions in the plan as of /);
  });
});
