import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  applyFilter,
  bundleRows,
  childWhen,
  dayLabel,
  EMPTY_STATE_CLAUSE_LIMIT,
  emptyStateClauses,
  filterCounts,
  groupByDay,
  navLabel,
  relativeTime,
  SOURCE_CLAUSE,
  SOURCE_ORDER,
  TYPE_META,
  typeLabel,
  type NotificationFilterV1,
} from "./view-model.ts";
import type { NotificationEventType, NotificationEventV2 } from "./types.ts";

/**
 * Every clock is built with the local `Date` constructor rather than an ISO literal with a fixed
 * offset: "Today", "Yesterday" and "Earlier this week" are all local-midnight questions, so a UTC
 * literal would bucket differently depending on the machine running the suite.
 *
 * Wed 19 Aug 2026, the mockup's fixture clock. Its week (US Sunday start) began Sun 16 Aug.
 */
const NOW = new Date(2026, 7, 19, 16, 40, 0);
/** Mon 17 Aug 2026: the day "Earlier this week" must correctly render nothing. */
const MONDAY = new Date(2026, 7, 17, 16, 40, 0);

function at(daysAgo: number, hours: number, minutes: number): string {
  return new Date(2026, 7, 19 - daysAgo, hours, minutes, 0).toISOString();
}

let seq = 0;
function event(
  type: NotificationEventType,
  occurredAt: string,
  overrides: Partial<NotificationEventV2> = {},
): NotificationEventV2 {
  seq += 1;
  return {
    detail: "Your team recorded it.",
    id: `${type}:${seq}`,
    occurredAt,
    readAt: null,
    target: TYPE_META[type].target,
    title: "An event was recorded",
    type,
    ...overrides,
  };
}

describe("notification type metadata", () => {
  it("covers every type with a nav destination, a source group and an empty-state clause", () => {
    const types = Object.keys(TYPE_META) as NotificationEventType[];
    assert.equal(types.length, 8);
    for (const type of types) {
      const meta = TYPE_META[type];
      assert.ok(meta.label.length > 0, `${type} has no type label`);
      assert.ok(meta.chipLabel.length > 0, `${type} has no filter chip label`);
      assert.ok(meta.icon.length > 0, `${type} has no icon name`);
      assert.ok(navLabel(meta.target).length > 0, `${type} targets ${meta.target}, which no nav item names`);
      assert.ok(SOURCE_ORDER.includes(meta.source), `${type} has source "${meta.source}", which is not a flag group`);
      assert.match(meta.bundle(3)[0], /^3 /, `${type}'s bundle title does not open with the count`);
      assert.ok(meta.bundle(3)[1].trim().endsWith("."), `${type}'s bundle detail is not a sentence`);
    }
    assert.equal(typeLabel("team_message"), TYPE_META.team_message.label);
  });

  it("deep-links to the destinations the R2 rulings name", () => {
    // B21 moved enrollment to Onboarding & Docs; §3 sends the refresh and the application to
    // Your Funding. Pinned by target rather than by label so a nav rename does not fail here.
    assert.equal(TYPE_META.enrollment_milestone.target, "documents");
    assert.equal(TYPE_META.stage_change.target, "dashboard");
    assert.equal(TYPE_META.refresh_result.target, "plan");
    assert.equal(TYPE_META.application_update.target, "plan");
    assert.equal(TYPE_META.analysis_complete.target, "plan");
    assert.equal(TYPE_META.monitoring_alert.target, "credit");
    assert.equal(TYPE_META.team_message.target, "coach");
    assert.equal(TYPE_META.document.target, "documents");
  });

  it("takes its destination labels from the shipped consumer nav, not from a second list", () => {
    // Derived from consumer.tsx's own nav arrays (§5: the labels are the shipped nav labels), so a
    // rename there fails here instead of leaving a row promising a view that no longer has that name.
    const surface = readFileSync(
      new URL("../../surfaces/consumer.tsx", import.meta.url),
      "utf8",
    );
    const shipped = new Map<string, string>();
    for (const match of surface.matchAll(/\{ id: "(\w+)", label: "([^"]+)"/g)) {
      shipped.set(match[1], match[2]);
    }
    assert.ok(shipped.size >= 8, `the nav scan found only ${shipped.size} items; its pattern stopped matching`);
    for (const type of Object.keys(TYPE_META) as NotificationEventType[]) {
      const target = TYPE_META[type].target;
      assert.equal(
        navLabel(target),
        shipped.get(target),
        `${type} names its destination "${navLabel(target)}" but the nav calls it "${shipped.get(target)}"`,
      );
    }
  });

  it("carries no version number, and never says outcome or paid, in any generated string", () => {
    // R2 B22. The server owns the event strings, but the bundle titles and details are ours.
    for (const type of Object.keys(TYPE_META) as NotificationEventType[]) {
      const [title, detail] = TYPE_META[type].bundle(4);
      for (const text of [title, detail, TYPE_META[type].label, TYPE_META[type].chipLabel, TYPE_META[type].clause]) {
        assert.doesNotMatch(text, /\bv\d+\b/i, `${type}: "${text}" carries a raw version number`);
        assert.doesNotMatch(text, /\boutcomes?\b/i, `${type}: "${text}" says outcome`);
        assert.doesNotMatch(text, /\bpaid\b/i, `${type}: "${text}" says paid`);
      }
    }
  });
});

describe("emptyStateClauses", () => {
  it("names the first few enabled sources in priority order, never the whole inventory", () => {
    // §8: at most three clauses, taken off the front of SOURCE_ORDER. Both halves are derived from
    // the module -- the cap from its own constant, the wording from the clause table -- so
    // reordering the priorities or moving the cap is a decision made in one place.
    const all = emptyStateClauses(Object.keys(TYPE_META) as NotificationEventType[]);
    assert.deepEqual(all, SOURCE_ORDER.slice(0, EMPTY_STATE_CLAUSE_LIMIT).map((source) => SOURCE_CLAUSE[source]));
    assert.equal(all.length, EMPTY_STATE_CLAUSE_LIMIT);
    assert.ok(EMPTY_STATE_CLAUSE_LIMIT <= 3, "§8 caps the empty state at three clauses");
  });

  it("still reaches enrollment and applications when the earlier sources are off (B2)", () => {
    // The cap decides how many classes get named, never whether a named one is real: with the
    // three priority sources disabled, the tail of the order surfaces rather than nothing.
    const tail = emptyStateClauses(["enrollment_milestone", "application_update", "monitoring_alert"]);
    assert.deepEqual(tail, [SOURCE_CLAUSE.monitoring, SOURCE_CLAUSE.enrollment, SOURCE_CLAUSE.applications]);
  });

  it("collapses the types that share one flag into a single clause", () => {
    // analysis_complete, refresh_result and stage_change all ride the analysis flag; three clauses
    // for one switch would be three promises a single flag turns off together.
    const clauses = emptyStateClauses(["analysis_complete", "refresh_result", "stage_change"]);
    assert.equal(clauses.length, 1);
  });

  it("never promises a class the caller did not report", () => {
    const clauses = emptyStateClauses(["team_message"]);
    assert.deepEqual(clauses, [SOURCE_CLAUSE.support]);
    assert.deepEqual(emptyStateClauses([]), []);
  });
});

describe("relativeTime", () => {
  it("counts minutes, then hours, then names the day", () => {
    assert.equal(relativeTime(at(0, 16, 40), NOW), "just now");
    assert.equal(relativeTime(at(0, 16, 39), NOW), "1 minute ago");
    assert.equal(relativeTime(at(0, 16, 15), NOW), "25 minutes ago");
    assert.equal(relativeTime(at(0, 15, 40), NOW), "1 hour ago");
    assert.equal(relativeTime(at(0, 8, 40), NOW), "8 hours ago");
    assert.equal(relativeTime(at(1, 15, 44), NOW), "yesterday");
    assert.equal(relativeTime(at(7, 13, 40), NOW), "Aug 12");
  });

  it("never renders a negative age when a source row is stamped ahead of the client", () => {
    assert.equal(relativeTime(at(0, 16, 43), NOW), "just now");
  });

  it("says nothing rather than guessing when the timestamp is unusable", () => {
    assert.equal(relativeTime("not-a-date", NOW), "");
  });
});

describe("childWhen", () => {
  it("is a clock inside two days and a dated clock beyond it", () => {
    assert.equal(childWhen(at(0, 9, 51), NOW), "9:51 AM");
    assert.equal(childWhen(at(1, 14, 5), NOW), "2:05 PM");
    assert.equal(childWhen(at(7, 10, 25), NOW), "Aug 12 · 10:25 AM");
  });
});

describe("dayLabel and groupByDay", () => {
  it("means the same calendar week, not a rolling seven days", () => {
    // R1 #18. NOW is Wednesday; its week began Sunday Aug 16.
    assert.equal(dayLabel(at(0, 12, 0), NOW), "Today");
    assert.equal(dayLabel(at(1, 12, 0), NOW), "Yesterday");
    assert.equal(dayLabel(at(2, 12, 0), NOW), "Earlier this week");
    assert.equal(dayLabel(at(3, 12, 0), NOW), "Earlier this week", "Sunday Aug 16 is in this week");
    assert.equal(dayLabel(at(4, 12, 0), NOW), "Aug 15", "Saturday Aug 15 is the previous week");
  });

  it("renders no 'Earlier this week' group on a Monday, which is the correct answer", () => {
    // Monday Aug 17: the week began the day before, which is Yesterday, so nothing is left over.
    const monday = (daysAgo: number) => new Date(2026, 7, 17 - daysAgo, 12, 0, 0).toISOString();
    assert.equal(dayLabel(monday(0), MONDAY), "Today");
    assert.equal(dayLabel(monday(1), MONDAY), "Yesterday");
    assert.equal(dayLabel(monday(2), MONDAY), "Aug 15");
    const groups = groupByDay(
      [event("document", monday(0)), event("document", monday(1)), event("document", monday(2))],
      MONDAY,
    );
    assert.deepEqual(groups.map((group) => group.label), ["Today", "Yesterday", "Aug 15"]);
  });

  it("carries that day's unread count, computed over events and not over collapsed rows", () => {
    const groups = groupByDay(
      [
        event("document", at(0, 15, 0)),
        event("document", at(0, 14, 0)),
        event("document", at(0, 13, 0)),
        event("stage_change", at(1, 9, 5), { readAt: at(1, 10, 0) }),
      ],
      NOW,
    );
    assert.deepEqual(groups.map((group) => group.unreadCount), [3, 0], "a bundle of three counts as three");
  });

  it("returns nothing for an empty feed, and orders an unsorted window newest first", () => {
    assert.deepEqual(groupByDay([], NOW), []);
    const groups = groupByDay([event("document", at(2, 16, 30)), event("stage_change", at(0, 15, 12))], NOW);
    assert.deepEqual(groups.map((group) => group.label), ["Today", "Earlier this week"]);
  });
});

describe("bundleRows", () => {
  it("leaves one and two same-type events as their own rows", () => {
    const day = [event("document", at(0, 10, 20)), event("document", at(0, 10, 4))];
    assert.deepEqual(bundleRows(day, day).map((row) => row.kind), ["event", "event"]);
  });

  it("collapses three or more, keeping every child's own id, read state and target", () => {
    const children = [
      event("document", at(0, 10, 20), { title: "Articles of organization" }),
      event("document", at(0, 10, 4), { title: "EIN confirmation letter", readAt: at(0, 12, 0) }),
      event("document", at(0, 9, 51), { title: "Operating agreement" }),
    ];
    const day = [event("analysis_complete", at(0, 15, 12)), ...children, event("stage_change", at(0, 9, 5))];
    const rows = bundleRows(day, day);
    assert.deepEqual(rows.map((row) => row.kind), ["event", "bundle", "event"]);
    const bundled = rows[1];
    assert.equal(bundled.kind, "bundle");
    if (bundled.kind !== "bundle") return;
    assert.equal(bundled.title, "3 documents were received");
    assert.equal(bundled.occurredAt, at(0, 10, 20), "a bundle is dated by its newest child");
    assert.deepEqual(bundled.children.map((child) => child.id), children.map((child) => child.id));
    assert.deepEqual(bundled.children.map((child) => child.readAt !== null), [false, true, false]);
    assert.equal(bundled.unreadCount, 2, "the bundle counts its own unread children");
  });

  it("is dated and titled by ALL the day's events even when the filter hides some", () => {
    // R2 B8. Under "Unread" a four-document day still says four, and still renders only the
    // unread children — a title that counted the filtered set would be a different claim.
    const all = [
      event("document", at(0, 10, 20)),
      event("document", at(0, 10, 4), { readAt: at(0, 12, 0) }),
      event("document", at(0, 9, 51), { readAt: at(0, 12, 0) }),
      event("document", at(0, 9, 33)),
    ];
    const visible = all.filter((row) => row.readAt === null);
    const rows = bundleRows(all, visible);
    assert.equal(rows.length, 1);
    const bundled = rows[0];
    assert.equal(bundled.kind, "bundle");
    if (bundled.kind !== "bundle") return;
    assert.equal(bundled.title, "4 documents were received", "the title states the day's true count");
    assert.equal(bundled.children.length, 2, "only the filtered children render");
    assert.equal(bundled.totalCount, 4);
  });

  it("still bundles when the filter leaves only one child of a collapsed day", () => {
    const all = [
      event("monitoring_alert", at(0, 8, 12)),
      event("monitoring_alert", at(0, 12, 45), { readAt: at(0, 13, 0) }),
      event("monitoring_alert", at(0, 17, 30), { readAt: at(0, 18, 0) }),
    ];
    const rows = bundleRows(all, [all[0]]);
    assert.equal(rows[0].kind, "bundle");
    assert.equal(rows[0].kind === "bundle" && rows[0].title, "3 credit source alerts are ready");
  });

  it("sits where its newest visible child sat, so the day stays in time order", () => {
    const all = [
      event("team_message", at(0, 16, 0)),
      event("team_message", at(0, 15, 0)),
      event("analysis_complete", at(0, 14, 0)),
      event("team_message", at(0, 13, 0)),
    ];
    assert.deepEqual(bundleRows(all, all).map((row) => row.kind), ["bundle", "event"]);
  });

  it("is unread while any child is unread, and read once every child is", () => {
    const read = { readAt: at(0, 17, 0) };
    const allRead = [
      event("document", at(0, 10, 20), read),
      event("document", at(0, 10, 4), read),
      event("document", at(0, 9, 51), read),
    ];
    const settled = bundleRows(allRead, allRead)[0];
    assert.equal(settled.kind, "bundle");
    assert.equal(settled.kind === "bundle" ? settled.unread : null, false);

    const mixed = [allRead[0], event("document", at(0, 10, 4)), allRead[2]];
    const partial = bundleRows(mixed, mixed)[0];
    assert.equal(partial.kind, "bundle");
    assert.equal(partial.kind === "bundle" ? partial.unread : null, true);
    assert.equal(partial.kind === "bundle" ? partial.unreadCount : null, 1);
  });

  it("bundles each type separately on the same day", () => {
    const day = [
      ...Array.from({ length: 3 }, (_, i) => event("document", at(0, 15 - i, 0))),
      ...Array.from({ length: 3 }, (_, i) => event("monitoring_alert", at(0, 11 - i, 0))),
    ];
    const rows = bundleRows(day, day);
    assert.deepEqual(rows.map((row) => row.kind), ["bundle", "bundle"]);
    assert.deepEqual(rows.map((row) => (row.kind === "bundle" ? row.type : null)), ["document", "monitoring_alert"]);
  });
});

describe("filterCounts and applyFilter", () => {
  const events = [
    event("analysis_complete", at(0, 15, 12)),
    event("monitoring_alert", at(0, 11, 48)),
    event("monitoring_alert", at(1, 8, 12), { readAt: at(1, 9, 0) }),
    event("team_message", at(1, 15, 44), { readAt: at(1, 16, 0) }),
  ];

  it("offers All, Unread, and only the types actually present, in contract order", () => {
    assert.deepEqual(filterCounts(events), [
      { count: 4, filter: "all", label: "All" },
      { count: 2, filter: "unread", label: "Unread" },
      { count: 2, filter: "monitoring_alert", label: "Monitoring" },
      { count: 1, filter: "analysis_complete", label: "Analysis" },
      { count: 1, filter: "team_message", label: "Messages" },
    ]);
  });

  it("renders no chip row below two events, because there is nothing to filter", () => {
    // R2 B26.
    assert.deepEqual(filterCounts([]), []);
    assert.deepEqual(filterCounts([events[0]]), []);
    assert.equal(filterCounts([events[0], events[1]]).length > 0, true);
  });

  it("selects by filter, and returns an empty list rather than everything for an absent type", () => {
    assert.equal(applyFilter(events, "all").length, 4);
    assert.equal(applyFilter(events, "unread").length, 2);
    assert.equal(applyFilter(events, "monitoring_alert").length, 2);
    assert.deepEqual(applyFilter(events, "document" as NotificationFilterV1), []);
  });

  it("keeps the counts and the selection in agreement for every offered chip", () => {
    for (const chip of filterCounts(events)) {
      assert.equal(applyFilter(events, chip.filter).length, chip.count, `chip ${chip.filter}`);
    }
  });
});
