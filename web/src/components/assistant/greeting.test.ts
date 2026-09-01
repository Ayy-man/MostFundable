// The greeting, and the one rule that makes it worth rendering: it says nothing it did not read.
//
// `TrackerHealth` is a bare union with no runtime array to derive from, so "which health means on
// track" is taken from `orderTrackerClientsByHealth` — the module that owns health ranking — rather
// than assumed here. The assumption that the best-ranked health is `green` is asserted rather than
// relied on, so a re-ranking fails this file instead of silently changing what "needs a look" means.
//
// Watched failing before it counted, against this tree: `attentionCount` without its `status`
// filter fails "leaves archived clients out of the count"; `detailFor` returning a sentence for the
// loading arm fails "says nothing about a book it has not read"; and `greetingName` returning the
// trimmed name without the key check fails "never greets somebody by a stored key".

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { orderTrackerClientsByHealth } from "@/lib/tracker/health";

import { activeCount, assistantGreeting, attentionCount, greetingName } from "./greeting";

import type { TrackerClient, TrackerHealth } from "@/lib/tracker/types";

function client(health: TrackerHealth, status: "active" | "archived" = "active"): TrackerClient {
  return { displayName: `${health} client`, health, id: `${health}-${status}`, status } as unknown as TrackerClient;
}

const MORNING = new Date("2026-08-22T09:15:00");
const AFTERNOON = new Date("2026-08-22T14:15:00");
const EVENING = new Date("2026-08-22T20:15:00");

describe("the assistant greeting", () => {
  it("counts the clients the tracker itself calls anything other than on track", () => {
    const oneEach = [client("red"), client("amber"), client("green")];
    const ranked = orderTrackerClientsByHealth(oneEach);
    const onTrack = ranked[ranked.length - 1].health;
    // Stated rather than assumed: if the ranking is ever reversed, this is what says so.
    assert.equal(onTrack, "green", "the best-ranked health is no longer the one meaning on track");
    assert.equal(attentionCount(oneEach), oneEach.length - 1);
    assert.equal(attentionCount([client(onTrack), client(onTrack)]), 0);
  });

  it("leaves archived clients out of the count", () => {
    const rows = [client("red"), client("red", "archived"), client("green", "archived")];
    assert.equal(attentionCount(rows), 1);
    assert.equal(activeCount(rows), 1);
  });

  it("says nothing about a book it has not read", () => {
    for (const read of [{ status: "loading" }, { status: "unavailable" }, { status: "absent" }] as const) {
      const greeting = assistantGreeting({ now: MORNING, read, viewerName: "Avery Northbridge" });
      assert.equal(greeting.detail, null, `the ${read.status} state invented a sentence about the book`);
      assert.ok(greeting.salutation.length > 0, "the salutation went with it");
    }
  });

  it("agrees with the figures it was handed", () => {
    const one = assistantGreeting({ now: MORNING, read: { clients: 6, needAttention: 1, status: "operator" } });
    assert.match(one.detail ?? "", /^1 client in your book needs a look today\.$/);

    const some = assistantGreeting({ now: MORNING, read: { clients: 6, needAttention: 2, status: "operator" } });
    assert.match(some.detail ?? "", /^2 clients in your book need a look today\.$/);

    const clear = assistantGreeting({ now: MORNING, read: { clients: 6, needAttention: 0, status: "operator" } });
    assert.match(clear.detail ?? "", /All 6 clients/);

    const none = assistantGreeting({ now: MORNING, read: { clients: 0, needAttention: 0, status: "operator" } });
    assert.doesNotMatch(none.detail ?? "", /\b0\b/, "an empty book was described as zero of something");

    const platform = assistantGreeting({ now: MORNING, read: { clients: 12, operators: 3, status: "admin" } });
    assert.match(platform.detail ?? "", /3 operator workspaces/);
    assert.match(platform.detail ?? "", /12 clients/);
    // The platform greeting must not borrow the operator's possessive.
    assert.doesNotMatch(platform.detail ?? "", /your book/);
  });

  it("greets by the first name, and never by a stored key", () => {
    assert.equal(greetingName("Avery Northbridge Demo"), "Avery");
    assert.equal(greetingName("  Avery  "), "Avery");
    assert.equal(greetingName(""), null);
    assert.equal(greetingName(null), null);
    assert.equal(greetingName(undefined), null);
    assert.equal(
      greetingName("a3000000-0000-4000-8000-000000000006"),
      null,
      "the greeting addressed somebody by a stored key",
    );

    assert.equal(
      assistantGreeting({ now: MORNING, read: { status: "loading" }, viewerName: "Avery Northbridge" }).salutation,
      "Morning, Avery.",
    );
    assert.equal(
      assistantGreeting({ now: MORNING, read: { status: "loading" } }).salutation,
      "Morning.",
    );
  });

  it("reads the clock in the viewer's own day", () => {
    const read = { status: "loading" } as const;
    const at = (now: Date) => assistantGreeting({ now, read }).salutation;
    assert.equal(at(MORNING), "Morning.");
    assert.equal(at(AFTERNOON), "Afternoon.");
    assert.equal(at(EVENING), "Evening.");
    assert.equal(new Set([at(MORNING), at(AFTERNOON), at(EVENING)]).size, 3);
  });
});
