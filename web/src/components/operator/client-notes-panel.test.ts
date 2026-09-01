import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const SOURCE = readFileSync(new URL("./client-notes-panel.tsx", import.meta.url), "utf8");
const OPERATOR_SOURCE = readFileSync(new URL("../surfaces/operator.tsx", import.meta.url), "utf8");

describe("private client notes panel", () => {
  it("binds every read and mutation to the selected client without showing stale results", () => {
    assert.match(SOURCE, /read\.clientId === clientId/);
    assert.match(SOURCE, /loadClientNotes\(clientId\)/);
    assert.match(SOURCE, /createClientNote\(clientId/);
    assert.match(SOURCE, /requestId: newRequestId/);
    assert.match(SOURCE, /updateClientNote\(clientId, activeEdit\.noteId/);
    assert.match(SOURCE, /deleteClientNote\(clientId, note\.id/);
    assert.match(SOURCE, /current\.clientId === clientId/);
  });

  it("renders honest disabled, loading, failure, retry, empty, and saved states", () => {
    for (const copy of [
      "Private client notes are not enabled",
      "Loading private client notes",
      "Private client notes could not be loaded",
      "Try again",
      "No private notes have been recorded",
      "Private client note saved",
      "privacy-erased",
      "archived",
    ]) assert.match(SOURCE, new RegExp(copy));
    assert.match(SOURCE, /role="alert"/);
    assert.match(SOURCE, /role="status"/);
  });

  it("supports bounded create, optimistic edit, and confirmed deletion", () => {
    assert.match(SOURCE, /maxLength=\{CLIENT_NOTE_BODY_MAX\}/);
    assert.match(SOURCE, /expectedUpdatedAt: activeEdit\.expectedUpdatedAt/);
    assert.match(SOURCE, /expectedUpdatedAt: note\.updatedAt/);
    assert.match(SOURCE, /Save note/);
    assert.match(SOURCE, /Save changes/);
    assert.match(SOURCE, /Confirm delete/);
    assert.match(SOURCE, /notes\.length\} of \{visibleRead\.liveLimit\} active notes/);
  });

  it("reuses an idempotency key until creation is verified and reloads stale mutations", () => {
    assert.match(SOURCE, /useState\(nextRequestId\)/);
    assert.match(SOURCE, /setNewRequestId\(nextRequestId\(\)\)/);
    assert.match(SOURCE, /clientError\?\.code === "client_note_stale"/);
    assert.match(SOURCE, /clientError\?\.code === "client_note_not_found"/);
    assert.match(SOURCE, /setReloadVersion\(\(value\) => value \+ 1\)/);
    assert.match(SOURCE, /setEditDraft\(null\)/);
    assert.match(SOURCE, /setDeleteCandidate\(null\)/);
  });

  it("keeps archived and privacy-erased records read-only", () => {
    assert.match(SOURCE, /writeBlockedReason \?/);
    assert.match(SOURCE, /private notes are permanently read-only/);
    assert.match(SOURCE, /private notes are read-only until the client is reactivated/);
    assert.match(SOURCE, /writeBlockedReason === null \? <div/);
  });

  it("states the private audience, formats dates, and never reuses chat storage", () => {
    assert.match(SOURCE, /Consumers never see them in messages or their portal/);
    assert.match(SOURCE, /Intl\.DateTimeFormat/);
    assert.doesNotMatch(SOURCE, /support_messages|support thread|team chat/i);
  });

  it("is reachable from the durable client drawer with the selected client id", () => {
    assert.match(OPERATOR_SOURCE, /type DrawerTab = [^;]*"notes"/);
    assert.match(OPERATOR_SOURCE, /\{ label: "Notes", value: "notes" \}/);
    assert.match(OPERATOR_SOURCE, /<ClientNotesPanel clientId=\{selectedTrackerClient\.id\} \/>/);
  });
});
