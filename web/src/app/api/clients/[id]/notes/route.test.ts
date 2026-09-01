import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { ClientNoteError, type ClientNote } from "@/lib/operator/client-notes";
import {
  handleClientNoteItem,
  handleClientNotesCollection,
  type ClientNotesHttpDependencies,
} from "@/lib/operator/client-notes-http.server";

const ORG = "43000000-0000-4000-8000-000000000001";
const CLIENT = "43000000-0000-4000-8000-000000000021";
const ACTOR = "43000000-0000-4000-8000-000000000011";
const NOTE = "43000000-0000-4000-8000-000000000031";
const REQUEST = "43000000-0000-4000-8000-000000000041";
const NOW = "2026-09-01T10:00:00.000Z";

const note: ClientNote = {
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

function operatorRequest(path: string, method = "GET", body?: unknown): Request {
  return new Request(`https://mf.test${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "Content-Type": "application/json", Origin: "https://mf.test" },
    method,
  });
}

function harness(overrides: Partial<ClientNotesHttpDependencies> = {}) {
  const calls: Array<readonly unknown[]> = [];
  const dependencies: ClientNotesHttpDependencies = {
    async assertRead() { calls.push(["read-wall"]); },
    async assertWrite() { calls.push(["write-wall"]); },
    isSameOrigin: () => true,
    async requireOperator() {
      calls.push(["auth"]);
      return {
        disabledAt: null,
        id: ACTOR,
        manages: [],
        orgId: ORG,
        orgMembership: "current",
        orgRole: "owner",
        role: "operator_member",
      };
    },
    service: {
      async create(input) { calls.push(["create", input]); return note; },
      async list(input) {
        calls.push(["list", input]);
        return { liveLimit: 100, notes: [note], writeBlockedReason: null };
      },
      async remove(input) { calls.push(["remove", input]); },
      async update(input) { calls.push(["update", input]); return { ...note, body: input.body }; },
    },
    ...overrides,
  };
  return { calls, dependencies };
}

describe("client notes collection route", () => {
  it("authenticates an operator and applies the own-book wall before a tenant-bound read", async () => {
    const test = harness();
    const response = await handleClientNotesCollection(
      operatorRequest(`/api/clients/${CLIENT}/notes`),
      CLIENT,
      test.dependencies,
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { liveLimit: 100, notes: [note], writeBlockedReason: null });
    assert.deepEqual(test.calls, [
      ["auth"],
      ["read-wall"],
      ["list", { actorId: ACTOR, clientId: CLIENT, orgId: ORG }],
    ]);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  });

  it("applies the write wall before deriving actor and tenant on creation", async () => {
    const test = harness();
    const response = await handleClientNotesCollection(
      operatorRequest(`/api/clients/${CLIENT}/notes`, "POST", {
        body: "  Confirm the operating address.  ",
        requestId: REQUEST,
      }),
      CLIENT,
      test.dependencies,
    );
    assert.equal(response.status, 201);
    assert.deepEqual(test.calls, [
      ["auth"],
      ["write-wall"],
      ["create", { actorId: ACTOR, body: note.body, clientId: CLIENT, orgId: ORG, requestId: REQUEST }],
    ]);
  });

  it("refuses cross-origin or body-supplied ownership before a mutation", async () => {
    let test = harness({ isSameOrigin: () => false });
    let response = await handleClientNotesCollection(
      operatorRequest(`/api/clients/${CLIENT}/notes`, "POST", { body: "Note", requestId: REQUEST }),
      CLIENT,
      test.dependencies,
    );
    assert.equal(response.status, 403);
    assert.equal(test.calls.some(([name]) => name === "create"), false);

    test = harness();
    response = await handleClientNotesCollection(
      operatorRequest(`/api/clients/${CLIENT}/notes`, "POST", { body: "Note", orgId: ORG, requestId: REQUEST }),
      CLIENT,
      test.dependencies,
    );
    assert.equal(response.status, 400);
    assert.equal(test.calls.some(([name]) => name === "create"), false);
  });

  it("returns the same opaque 404 for a missing or cross-tenant client", async () => {
    const test = harness({
      service: {
        async create() { throw new ClientNoteError("not_found"); },
        async list() { throw new ClientNoteError("not_found"); },
        async remove() { throw new Error("unused"); },
        async update() { throw new Error("unused"); },
      },
    });
    const response = await handleClientNotesCollection(
      operatorRequest(`/api/clients/${CLIENT}/notes`),
      CLIENT,
      test.dependencies,
    );
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, "client_note_not_found");
  });
});

describe("client note item route", () => {
  it("edits and deletes only after the write wall with the stored version", async () => {
    let test = harness();
    let response = await handleClientNoteItem(
      operatorRequest(`/api/clients/${CLIENT}/notes/${NOTE}`, "PATCH", { body: "Updated", expectedUpdatedAt: NOW }),
      CLIENT,
      NOTE,
      test.dependencies,
    );
    assert.equal(response.status, 200);
    assert.deepEqual(test.calls, [
      ["auth"],
      ["write-wall"],
      ["update", { actorId: ACTOR, body: "Updated", clientId: CLIENT, expectedUpdatedAt: NOW, noteId: NOTE, orgId: ORG }],
    ]);

    test = harness();
    response = await handleClientNoteItem(
      operatorRequest(`/api/clients/${CLIENT}/notes/${NOTE}`, "DELETE", { expectedUpdatedAt: NOW }),
      CLIENT,
      NOTE,
      test.dependencies,
    );
    assert.equal(response.status, 204);
    assert.deepEqual(test.calls, [
      ["auth"],
      ["write-wall"],
      ["remove", { actorId: ACTOR, clientId: CLIENT, expectedUpdatedAt: NOW, noteId: NOTE, orgId: ORG }],
    ]);
  });

  it("returns a conflict for an edit based on a stale note without leaking content", async () => {
    const test = harness({
      service: {
        async create() { throw new Error("unused"); },
        async list() { return { liveLimit: 100, notes: [], writeBlockedReason: null }; },
        async remove() { throw new ClientNoteError("stale"); },
        async update() { throw new ClientNoteError("stale"); },
      },
    });
    const response = await handleClientNoteItem(
      operatorRequest(`/api/clients/${CLIENT}/notes/${NOTE}`, "PATCH", { body: "Private body", expectedUpdatedAt: NOW }),
      CLIENT,
      NOTE,
      test.dependencies,
    );
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, "client_note_stale");
  });

  it("returns a closed conflict when privacy or archive state blocks writes", async () => {
    const test = harness({
      service: {
        async create() { throw new Error("unused"); },
        async list() { return { liveLimit: 100, notes: [], writeBlockedReason: "privacy_erased" }; },
        async remove() { throw new ClientNoteError("write_blocked"); },
        async update() { throw new ClientNoteError("write_blocked"); },
      },
    });
    const response = await handleClientNoteItem(
      operatorRequest(`/api/clients/${CLIENT}/notes/${NOTE}`, "PATCH", { body: "Updated", expectedUpdatedAt: NOW }),
      CLIENT,
      NOTE,
      test.dependencies,
    );
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, "client_notes_write_blocked");
  });

  it("keeps route files thin and free of direct database access", () => {
    for (const path of ["./route.ts", "./[noteId]/route.ts"]) {
      const source = readFileSync(new URL(path, import.meta.url), "utf8");
      assert.doesNotMatch(source, /\.from\(|\.rpc\(|createAdminClient|support_messages/);
      assert.match(source, /handleClientNote/);
    }
  });
});
