// The history rail's grouping, checked against the module that owns the day arithmetic.
//
// Every expected label is produced by calling `dayLabel` at test time rather than written out as
// "Today" / "Yesterday" / "12 August". That is deliberate: the labels are the chat foundation's to
// decide, this module only decides which conversations land under which one, and a transcribed
// label would fail on a wording change that broke nothing.
//
// Watched failing before it counted, against this tree: dropping the day sort in
// `groupConversations` fails "puts the most recent day first"; dropping the inner sort fails "and
// the most recent conversation first inside it"; accepting an unparseable timestamp fails "files
// nothing under a day it had to invent"; and `searchConversations` returning the whole list on a
// miss fails "a search that matches nothing matches nothing".

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { dayLabel } from "@/components/chat/time";

import { groupConversations, searchConversations } from "./history";

import type { AssistantConversation } from "@/lib/assistant/types";

const NOW = new Date("2026-08-22T15:00:00.000Z");

function at(iso: string, title: string): AssistantConversation {
  return {
    createdAt: iso,
    id: `${title.length}-${iso}`,
    lastActivityAt: iso,
    messageCount: 2,
    scope: "operator",
    title,
  };
}

/** Local noon on a day offset from `NOW`, so the group cannot straddle a timezone boundary. */
function localNoon(dayOffset: number): string {
  const day = new Date(NOW);
  day.setDate(day.getDate() + dayOffset);
  day.setHours(12, 0, 0, 0);
  return day.toISOString();
}

describe("the assistant history rail", () => {
  it("puts the most recent day first, and the most recent conversation first inside it", () => {
    const older = at(localNoon(-3), "Older question");
    const earlyToday = at(localNoon(0), "Early today");
    const lateToday = at(new Date(new Date(localNoon(0)).getTime() + 3_600_000).toISOString(), "Late today");
    const yesterday = at(localNoon(-1), "Yesterday question");

    const groups = groupConversations([older, earlyToday, yesterday, lateToday], NOW);

    assert.equal(groups.length, 3);
    assert.deepEqual(
      groups.map((group) => group.label),
      [dayLabel(lateToday.lastActivityAt, NOW), dayLabel(yesterday.lastActivityAt, NOW), dayLabel(older.lastActivityAt, NOW)],
    );
    assert.deepEqual(
      groups[0].conversations.map((conversation) => conversation.title),
      ["Late today", "Early today"],
    );
  });

  it("labels every group with what the chat foundation calls that day", () => {
    const rows = [localNoon(0), localNoon(-1), localNoon(-9)].map((iso) => at(iso, iso));
    for (const group of groupConversations(rows, NOW)) {
      const member = group.conversations[0];
      assert.equal(group.label, dayLabel(member.lastActivityAt, NOW));
      assert.ok(group.label.trim().length > 0, "a group carries no label");
    }
  });

  it("files nothing under a day it had to invent", () => {
    const good = at(localNoon(0), "Real");
    const broken = at("not a timestamp", "Unfiled");
    const groups = groupConversations([good, broken], NOW);
    assert.equal(groups.length, 1);
    assert.deepEqual(
      groups.flatMap((group) => group.conversations.map((row) => row.title)),
      ["Real"],
    );
  });

  it("renders no group at all rather than an empty one", () => {
    assert.deepEqual(groupConversations([], NOW), []);
  });

  it("filters on the title, and a search that matches nothing matches nothing", () => {
    const rows = [at(localNoon(0), "Which clients are closest to funding?"), at(localNoon(-1), "Open applications")];
    assert.deepEqual(searchConversations(rows, "  ").length, 2, "a blank search filtered the list");
    assert.deepEqual(
      searchConversations(rows, "CLOSEST").map((row) => row.title),
      ["Which clients are closest to funding?"],
    );
    assert.deepEqual(searchConversations(rows, "nothing at all"), [], "a search that matched nothing returned everything");
  });
});
