// The three meanings of one prop, and the deduplication behind an optimistic-looking send.
//
// `initialStateFrom` is the whole of F-01's fix expressed as a function: whether the view's first
// frame is the conversation or a skeleton is decided here, before any effect runs. So the case
// that matters most is the boring one — a `ready` snapshot has to produce `ready` synchronously,
// because a version of this that started at `loading` and moved to `ready` in an effect would
// still paint the void for a frame and would still be, by the measure that found the defect,
// the same bug.
//
// Watched failing: with the `undefined` and `null` branches collapsed into one (the natural
// simplification, since both are falsy), "tells the fixture shell apart from a failed read" fails
// on whichever branch lost — and that collapse is exactly how fixture messages would reach a
// signed-in client whose server read came back empty.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ConsumerTeamChatSnapshot, SupportMessageRow } from "@/lib/support";

import { initialStateFrom, withMessage } from "./use-team-chat";

const THREAD = {
  clientId: null,
  createdAt: "2026-08-20T09:00:00.000Z",
  createdBy: "profile-a",
  id: "3f6c2a7e-0000-0000-0000-000000000001",
  kind: "team_chat" as const,
  lastActivityAt: "2026-08-20T09:05:00.000Z",
  orgId: "org-a",
  status: "open" as const,
  subject: "Team Chat",
};

function message(id: string): SupportMessageRow {
  return {
    authorKind: "operator",
    authorProfileId: "profile-a",
    body: "Welcome.",
    id,
    origin: "human",
    originDraftId: null,
    sentAt: "2026-08-20T09:05:00.000Z",
    threadId: THREAD.id,
    visibility: "participants",
  };
}

const READY: ConsumerTeamChatSnapshot = {
  messages: [message("a")],
  read: { counterpartReadAt: null, lastReadAt: null, unreadCount: 1 },
  state: "ready",
  thread: THREAD,
};

describe("consumer team chat · initial state", () => {
  it("paints with its messages rather than waiting for an effect", () => {
    // The defect this view was rebuilt to close: 3,536ms of a loading sentence resolving to a
    // conversation the page could have been rendered with.
    const state = initialStateFrom(READY);
    assert.equal(state.kind, "ready");
    assert.ok(state.kind === "ready" && state.messages.length === 1);
  });

  it("tells the fixture shell apart from a failed read", () => {
    // `undefined` is the demo shell, which is the only state that may show a written conversation.
    // `null` is a real-auth page whose server read had nothing to hand over, which hands the work
    // to the client bootstrap. Collapsing the two — both are falsy, so it is the obvious
    // simplification — would put fixture messages in front of a signed-in client.
    assert.equal(initialStateFrom(undefined).kind, "fixture");
    assert.equal(initialStateFrom(null).kind, "loading");
  });

  it("keeps the flag being off distinct from the read failing", () => {
    assert.equal(initialStateFrom({ state: "disabled" }).kind, "disabled");
  });
});

describe("consumer team chat · arrivals", () => {
  it("drops a message it already holds", () => {
    // A send appends the row the database wrote; realtime delivers the same INSERT a moment later.
    // Without this the sender sees their own message twice, every time.
    const held = [message("a")];
    assert.equal(withMessage(held, message("a")), held);
    assert.equal(withMessage(held, message("b")).length, 2);
  });

  it("appends rather than re-sorting", () => {
    // A message that arrives is by definition the newest one, and sorting on every arrival would
    // reshuffle a thread on a few milliseconds of clock skew between the browser and the database.
    const arrived = withMessage([message("a")], message("b"));
    assert.deepEqual(
      arrived.map((each) => each.id),
      ["a", "b"],
    );
  });
});
