import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CLIENT_NOTE_BODY_MAX,
  CLIENT_NOTE_LIVE_MAX,
  parseClientNote,
  parseClientNotesSnapshot,
  parseCreateClientNoteInput,
  parseDeleteClientNoteInput,
  parseUpdateClientNoteInput,
} from "./client-notes.ts";

const CLIENT = "43000000-0000-4000-8000-000000000021";
const ACTOR = "43000000-0000-4000-8000-000000000011";
const NOTE = "43000000-0000-4000-8000-000000000031";
const NOW = "2026-09-01T10:00:00.000Z";
const REQUEST = "43000000-0000-4000-8000-000000000041";

describe("client note contract", () => {
  it("accepts one exact, attributed note and rejects extra or stale-shaped fields", () => {
    const note = {
      body: "Confirm the operating address.",
      clientId: CLIENT,
      createdAt: NOW,
      createdById: ACTOR,
      createdByName: "Notes Owner",
      id: NOTE,
      updatedAt: NOW,
      updatedById: ACTOR,
      updatedByName: "Notes Owner",
    };
    assert.deepEqual(parseClientNote(note), note);
    assert.equal(parseClientNote({ ...note, orgId: "private" }), null);
    assert.equal(parseClientNote({ ...note, updatedAt: "2026-08-31T10:00:00.000Z" }), null);
  });

  it("normalizes create and edit bodies while enforcing the shared hard limit", () => {
    assert.deepEqual(parseCreateClientNoteInput({ body: "  Team context  ", requestId: REQUEST }), {
      body: "Team context",
      requestId: REQUEST,
    });
    assert.equal(parseCreateClientNoteInput({ body: "", requestId: REQUEST }), null);
    assert.equal(parseCreateClientNoteInput({ body: "Team context", clientId: CLIENT, requestId: REQUEST }), null);
    assert.equal(parseCreateClientNoteInput({ body: "x".repeat(CLIENT_NOTE_BODY_MAX + 1), requestId: REQUEST }), null);
    assert.deepEqual(parseUpdateClientNoteInput({ body: "  Updated  ", expectedUpdatedAt: NOW }), {
      body: "Updated",
      expectedUpdatedAt: NOW,
    });
    assert.equal(parseUpdateClientNoteInput({ body: "Updated", expectedUpdatedAt: "not-a-date" }), null);
  });

  it("requires an exact optimistic-concurrency token for deletion", () => {
    assert.deepEqual(parseDeleteClientNoteInput({ expectedUpdatedAt: NOW }), { expectedUpdatedAt: NOW });
    assert.equal(parseDeleteClientNoteInput({ expectedUpdatedAt: NOW, force: true }), null);
  });

  it("parses the complete bounded snapshot and its closed write state", () => {
    const note = {
      body: "Confirm the operating address.",
      clientId: CLIENT,
      createdAt: NOW,
      createdById: ACTOR,
      createdByName: "Notes Owner",
      id: NOTE,
      updatedAt: NOW,
      updatedById: ACTOR,
      updatedByName: "Notes Owner",
    };
    assert.deepEqual(parseClientNotesSnapshot({
      liveLimit: CLIENT_NOTE_LIVE_MAX,
      notes: [note],
      writeBlockedReason: "archived",
    }), {
      liveLimit: CLIENT_NOTE_LIVE_MAX,
      notes: [note],
      writeBlockedReason: "archived",
    });
    assert.equal(parseClientNotesSnapshot({
      liveLimit: CLIENT_NOTE_LIVE_MAX,
      notes: [note],
      writeBlockedReason: "unknown",
    }), null);
    assert.equal(parseClientNotesSnapshot({
      liveLimit: CLIENT_NOTE_LIVE_MAX,
      notes: Array.from({ length: CLIENT_NOTE_LIVE_MAX + 1 }, () => note),
      writeBlockedReason: null,
    }), null);
  });
});
