import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ClientNoteClientError,
  createClientNote,
  deleteClientNote,
  loadClientNotes,
  updateClientNote,
} from "./client-notes.client.ts";

const CLIENT = "43000000-0000-4000-8000-000000000021";
const OTHER_CLIENT = "43000000-0000-4000-8000-000000000022";
const ACTOR = "43000000-0000-4000-8000-000000000011";
const NOTE = "43000000-0000-4000-8000-000000000031";
const REQUEST = "43000000-0000-4000-8000-000000000041";
const NOW = "2026-09-01T10:00:00.000Z";

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

describe("client notes browser client", () => {
  it("loads only a closed list bound to the requested client", async () => {
    assert.deepEqual(await loadClientNotes(CLIENT, async () => Response.json({
      liveLimit: 100,
      notes: [note],
      writeBlockedReason: null,
    })), { liveLimit: 100, notes: [note], writeBlockedReason: null });
    await assert.rejects(
      loadClientNotes(CLIENT, async () => Response.json({
        liveLimit: 100,
        notes: [{ ...note, clientId: OTHER_CLIENT }],
        writeBlockedReason: null,
      })),
      (error) => error instanceof ClientNoteClientError && error.status === 502,
    );
    await assert.rejects(
      loadClientNotes(CLIENT, async () => Response.json({
        liveLimit: 100,
        notes: [note],
        orgId: "private",
        writeBlockedReason: null,
      })),
      (error) => error instanceof ClientNoteClientError && error.status === 502,
    );
  });

  it("creates and updates with exact bodies and optimistic concurrency", async () => {
    const calls: Array<{ body: unknown; method: string; url: string }> = [];
    await createClientNote(CLIENT, { body: "  Confirm the operating address.  ", requestId: REQUEST }, async (input, init) => {
      calls.push({ body: JSON.parse(String(init?.body)), method: String(init?.method), url: String(input) });
      return Response.json({ note }, { status: 201 });
    });
    await updateClientNote(CLIENT, NOTE, { body: "Updated note", expectedUpdatedAt: NOW }, async (input, init) => {
      calls.push({ body: JSON.parse(String(init?.body)), method: String(init?.method), url: String(input) });
      return Response.json({ note: { ...note, body: "Updated note" } });
    });
    assert.deepEqual(calls, [
      { body: { body: note.body, requestId: REQUEST }, method: "POST", url: `/api/clients/${CLIENT}/notes` },
      {
        body: { body: "Updated note", expectedUpdatedAt: NOW },
        method: "PATCH",
        url: `/api/clients/${CLIENT}/notes/${NOTE}`,
      },
    ]);
  });

  it("deletes only the selected version and requires an empty 204 response", async () => {
    let request: { body: unknown; method: string; url: string } | null = null;
    await deleteClientNote(CLIENT, NOTE, { expectedUpdatedAt: NOW }, async (input, init) => {
      request = { body: JSON.parse(String(init?.body)), method: String(init?.method), url: String(input) };
      return new Response(null, { status: 204 });
    });
    assert.deepEqual(request, {
      body: { expectedUpdatedAt: NOW },
      method: "DELETE",
      url: `/api/clients/${CLIENT}/notes/${NOTE}`,
    });
  });

  it("maps failures to closed copy without reflecting a server detail", async () => {
    await assert.rejects(
      updateClientNote(CLIENT, NOTE, { body: "Updated", expectedUpdatedAt: NOW }, async () => Response.json({
        error: { code: "private_code", message: "database password should not escape" },
      }, { status: 500 })),
      (error) => error instanceof ClientNoteClientError
        && error.message === "Client notes are temporarily unavailable."
        && !error.message.includes("password"),
    );
  });

  it("distinguishes a terminal write block from an optimistic conflict", async () => {
    await assert.rejects(
      createClientNote(CLIENT, { body: "Body", requestId: REQUEST }, async () => Response.json({
        error: { code: "client_notes_write_blocked", message: "private database detail" },
      }, { status: 409 })),
      (error) => error instanceof ClientNoteClientError
        && error.code === "client_notes_write_blocked"
        && error.message.includes("privacy-erased")
        && !error.message.includes("database"),
    );
  });
});
