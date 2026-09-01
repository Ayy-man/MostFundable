import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ClientNoteError } from "./client-notes.ts";
import { createClientNotesService } from "./client-notes.server.ts";

const ORG = "43000000-0000-4000-8000-000000000001";
const CLIENT = "43000000-0000-4000-8000-000000000021";
const ACTOR = "43000000-0000-4000-8000-000000000011";
const NOTE = "43000000-0000-4000-8000-000000000031";
const REQUEST = "43000000-0000-4000-8000-000000000041";
const NOW = "2026-09-01T10:00:00.000Z";

const row = {
  body: "Confirm the operating address.",
  client_id: CLIENT,
  created_at: NOW,
  created_by_id: ACTOR,
  created_by_name: "Notes Owner",
  id: NOTE,
  updated_at: NOW,
  updated_by_id: ACTOR,
  updated_by_name: "Notes Owner",
};

const snapshot = {
  live_limit: 100,
  notes: [row],
  write_blocked_reason: null,
};

describe("client notes server service", () => {
  it("derives actor and tenant in the bounded service-only list call", async () => {
    const calls: Array<{ args: Record<string, unknown>; name: string }> = [];
    const service = createClientNotesService(() => ({
      async rpc(name, args) {
        calls.push({ args, name });
        return { data: snapshot, error: null };
      },
    }));
    const result = await service.list({ actorId: ACTOR, clientId: CLIENT, orgId: ORG });
    assert.equal(result.notes[0]?.body, row.body);
    assert.equal(result.writeBlockedReason, null);
    assert.deepEqual(calls, [{
      args: { p_actor_id: ACTOR, p_client_id: CLIENT, p_org_id: ORG },
      name: "client_notes_list",
    }]);
  });

  it("creates through one idempotent RPC that returns the verified projection", async () => {
    const calls: string[] = [];
    const service = createClientNotesService(() => ({
      async rpc(name) {
        calls.push(name);
        return { data: row, error: null };
      },
    }));
    const note = await service.create({
      actorId: ACTOR,
      body: "  Confirm the operating address.  ",
      clientId: CLIENT,
      orgId: ORG,
      requestId: REQUEST,
    });
    assert.equal(note.id, NOTE);
    assert.deepEqual(calls, ["client_note_create"]);
  });

  it("fails closed on a cross-client row or stale mutation", async () => {
    const wrongClient = createClientNotesService(() => ({
      async rpc() {
        return {
          data: {
            ...snapshot,
            notes: [{ ...row, client_id: "43000000-0000-4000-8000-000000000022" }],
          },
          error: null,
        };
      },
    }));
    await assert.rejects(
      wrongClient.list({ actorId: ACTOR, clientId: CLIENT, orgId: ORG }),
      (error) => error instanceof ClientNoteError && error.code === "unavailable",
    );

    const stale = createClientNotesService(() => ({
      async rpc() {
        return { data: null, error: { code: "40001", message: "CLIENT_NOTE_STALE" } };
      },
    }));
    await assert.rejects(
      stale.update({ actorId: ACTOR, body: "New body", clientId: CLIENT, expectedUpdatedAt: NOW, noteId: NOTE, orgId: ORG }),
      (error) => error instanceof ClientNoteError && error.code === "stale",
    );
  });

  it("accepts only the atomic tombstone projection without a second read", async () => {
    const calls: string[] = [];
    const service = createClientNotesService(() => ({
      async rpc(name) {
        calls.push(name);
        return { data: { deleted: true, id: NOTE }, error: null };
      },
    }));
    await service.remove({ actorId: ACTOR, clientId: CLIENT, expectedUpdatedAt: NOW, noteId: NOTE, orgId: ORG });
    assert.deepEqual(calls, ["client_note_delete"]);
  });

  it("maps terminal privacy and note-cap failures to closed domain codes", async () => {
    for (const [message, code] of [
      ["CLIENT_NOTES_WRITE_BLOCKED", "write_blocked"],
      ["CLIENT_NOTE_LIMIT_REACHED", "limit_reached"],
      ["CLIENT_NOTE_REQUEST_CONFLICT", "request_conflict"],
    ] as const) {
      const service = createClientNotesService(() => ({
        async rpc() { return { data: null, error: { message } }; },
      }));
      await assert.rejects(
        service.create({ actorId: ACTOR, body: "Body", clientId: CLIENT, orgId: ORG, requestId: REQUEST }),
        (error) => error instanceof ClientNoteError && error.code === code,
      );
    }
  });
});
