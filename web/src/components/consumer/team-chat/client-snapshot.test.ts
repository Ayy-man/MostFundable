// What the context rail is allowed to see.
//
// Rail 3 forbids a raw identifier anywhere on screen, and the usual way that rule is kept is by
// remembering not to render one. `TrackerClient` carries five identifier fields, so this narrows
// instead: the rail is handed an object those fields are not in, and it therefore cannot render
// one by accident.
//
// The identifier fields are derived from `TRACKER_CLIENT_KEYS` — the tracker's own exported list —
// rather than written here, so a sixth id added to the client row is covered on the next run. That
// is the same argument `SupportDraftContext` makes about what a draft driver may see, and this is
// the same mechanism: the value is simply not in the object.
//
// Watched failing: with `snapshotFrom` spreading the client (`{ ...client, stageLabel: … }`, the
// obvious shortcut), "carries no identifier the rail could render" names `id`, `assignedToId`,
// `consumerProfileId` and `archivedById` in one go.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { TRACKER_CLIENT_KEYS, TRACKER_STAGE_LABELS, type TrackerClient } from "@/lib/tracker/types";

import { observedOn, snapshotFields, snapshotFrom } from "./client-snapshot";

function client(over: Partial<TrackerClient> = {}): TrackerClient {
  return {
    analysisAt: "2026-08-18T00:00:00.000Z",
    analysisPending: null,
    archivedAt: null,
    archivedById: "archived-by-a",
    assignedToId: "assigned-a",
    assignedToName: "Priya Raman",
    businessName: "Clean Slate Logistics",
    consumerProfileId: "consumer-a",
    displayName: "Casey Clean Demo",
    estimatedCompletionAt: null,
    fundingApprovedCents: null,
    goalCents: 100_000,
    health: "green",
    history: [],
    id: "a3000000-0000-0000-0000-000000000001",
    lastActivityAt: "2026-08-20T09:00:00.000Z",
    matchesUnlockedOverride: false,
    monitoring: "active",
    nextRefreshAt: "2026-09-13T00:00:00.000Z",
    openActionCount: 3,
    readiness: 88,
    stage: "ready",
    stageEnteredAt: "2026-08-01T00:00:00.000Z",
    startedAt: "2026-07-20T00:00:00.000Z",
    status: "active",
    ...over,
  };
}

/** Every key on the tracker row that names a record. Derived from the tracker's own key list. */
function identifierKeys(): string[] {
  const keys = TRACKER_CLIENT_KEYS.filter((key) => key === "id" || /Id$/.test(key));
  assert.ok(keys.length >= 3, `the identifier sweep found ${keys.join(", ") || "nothing"}`);
  return [...keys];
}

describe("consumer team chat · the client's own snapshot", () => {
  it("carries no identifier the rail could render", () => {
    const fields = new Set(snapshotFields(client()));
    for (const key of identifierKeys()) {
      assert.equal(fields.has(key), false, `the snapshot carries ${key}, which rail 3 forbids`);
    }
    // And no value in it is uuid-shaped either, which catches an id smuggled in under another
    // name — the field check alone would pass for `owner: client.assignedToId`.
    for (const [field, value] of Object.entries(snapshotFrom(client()))) {
      assert.equal(
        typeof value === "string" && /[0-9a-f]{8}-[0-9a-f]{4}/i.test(value),
        false,
        `${field} carries something uuid-shaped`,
      );
    }
  });

  it("resolves the stage through the one taxonomy", () => {
    // CLAUDE.md names one stage taxonomy for the whole product. A second capitalisation here is
    // how two surfaces come to disagree about what stage somebody is in.
    for (const [stage, label] of Object.entries(TRACKER_STAGE_LABELS)) {
      assert.equal(snapshotFrom(client({ stage: stage as TrackerClient["stage"] })).stageLabel, label);
    }
  });

  it("keeps an unmeasured readiness distinct from a readiness of zero", () => {
    // Different facts. A pane that renders both as "0" tells somebody they scored nothing when
    // nobody has looked yet.
    assert.equal(snapshotFrom(client({ readiness: null })).readiness, null);
    assert.equal(snapshotFrom(client({ readiness: 0 })).readiness, 0);
  });

  it("renders no date it cannot parse", () => {
    // `new Date("")` gives "Invalid Date", which is what a column coming back empty prints the
    // first time. The rail renders nothing instead.
    assert.equal(observedOn(null), null);
    assert.equal(observedOn("not a date"), null);
    assert.equal(observedOn("2026-08-18T00:00:00.000Z"), "18 Aug 2026");
  });
});
