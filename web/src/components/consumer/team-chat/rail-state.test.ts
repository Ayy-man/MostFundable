// The rail's five states, and the one that was wrong.
//
// Found in a browser rather than by reading: at 1440x900 the rail said "No workspace details yet —
// your workspace details appear here once your funding team has set up your record", on a shell
// that had never asked. `useTrackerClients` answers `enabled: null` when `active` is false, and a
// chain recognising only `enabled === false` as "not connected" falls straight through to the empty
// state. The reader is then told something about their own account that nothing established.
//
// So the `null` case is not written down here. It is read out of `realtime.client.ts`'s own
// `inactiveState`, which is the thing that decides it — if that answer ever changes, this moves
// with it instead of continuing to test a value nobody returns.
//
// Watched failing: with `enabled !== true` put back to `enabled === false`, "states an absence
// rather than describing the reader's account" reports `empty` for the never-asked case.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { railStatusFor, type RailStatus } from "./rail-state";

const HOOK = path.resolve(
  import.meta.dirname,
  "../../../lib/tracker/realtime.client.ts",
);

/** What the hook answers when nothing asked it. Read off the hook, not written here. */
function inactiveAnswer(): { enabled: boolean | null; error: boolean; loading: boolean } {
  const source = fs.readFileSync(HOOK, "utf8");
  const block = /const inactiveState = \{([\s\S]*?)\n\};/.exec(source);
  assert.ok(block, "useTrackerClients no longer declares an inactive state where this test reads it");
  const field = (name: string) => new RegExp(`${name}: ([a-z]+)`).exec(block[1])?.[1];
  const enabled = field("enabled");
  assert.equal(enabled, "null", `the inactive read now reports enabled: ${enabled}`);
  return { enabled: null, error: field("error") === "true", loading: field("loading") === "true" };
}

describe("consumer team chat · the context rail's state", () => {
  it("states an absence rather than describing the reader's account", () => {
    // The defect. A read that never happened is not the same fact as a workspace that is empty,
    // and only one of the two is safe to say out loud.
    assert.equal(railStatusFor({ ...inactiveAnswer(), found: false }), "disabled");
  });

  it("keeps the flag being off and the workspace being empty apart", () => {
    assert.equal(railStatusFor({ enabled: false, error: false, found: false, loading: false }), "disabled");
    assert.equal(railStatusFor({ enabled: true, error: false, found: false, loading: false }), "empty");
    assert.equal(railStatusFor({ enabled: true, error: false, found: true, loading: false }), "ready");
  });

  it("reports a read in flight and a failed read before anything it could conclude", () => {
    // Both arrive with `enabled: null` too, so ordering is the whole of this: a rail that reported
    // "not connected" for the second of a read would flicker that sentence on every refetch.
    assert.equal(railStatusFor({ enabled: null, error: false, found: false, loading: true }), "loading");
    assert.equal(railStatusFor({ enabled: null, error: true, found: false, loading: false }), "error");
  });

  it("has copy for every state it can return", () => {
    // A `RailStatus` added without a branch beside it renders nothing at all, which is the blank
    // pane `PaneState` exists to make unrepresentable.
    const view = fs.readFileSync(path.join(import.meta.dirname, "index.tsx"), "utf8");
    const declaration = /export type RailStatus =([^;]+);/.exec(
      fs.readFileSync(path.join(import.meta.dirname, "rail-state.ts"), "utf8"),
    );
    assert.ok(declaration, "RailStatus is no longer declared where this test reads it");
    const statuses = [...declaration[1].matchAll(/"([a-z]+)"/g)].map((match) => match[1]) as RailStatus[];
    assert.equal(statuses.length, 5, `RailStatus parsed as ${statuses.join(", ")}`);
    for (const status of statuses) {
      assert.ok(view.includes(`case "${status}":`), `the rail can return ${status} and nothing renders it`);
    }
  });
});
