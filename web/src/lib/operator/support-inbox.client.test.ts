import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

import { TRACKER_STAGES } from "@/lib/tracker/types";

import {
  discardSupportDraft,
  inboxTeamOptions,
  parseInboxBootstrap,
  parseInboxClient,
  parseInboxMessage,
  parseThreadPayload,
  patchSupportThreadStatus,
  parseThreadWatermark,
  postSupportReply,
  postSupportThreadRead,
  readSupportInbox,
  readSupportInboxDirectory,
  readSupportThread,
  requestSupportDraft,
  SUPPORT_THREAD_STATUSES,
  type SupportInboxClient,
} from "./support-inbox.client.ts";

/**
 * The Inbox's durable rail (UI-WIRING-BACKLOG #9), asserted against the route
 * rather than against a transcription of it.
 *
 * The pre-fix Inbox wrote the reply into a local `sentReplies` map and rendered
 * "Sent just now" over it, so there is no earlier behaviour to pin. What these
 * assertions pin is the two ways the replacement could quietly rot: sending a
 * field the route derives (which would start failing with a 400 the moment the
 * route's list grew, and would mean the client believed it chose the author),
 * and folding a failed read back into an empty inbox.
 *
 * Both expectations are read out of the route's own source at test time —
 * `DERIVED_FIELDS` from the messages route, the URL from where the route file
 * actually sits on disk — so widening either one without widening this file is
 * caught here rather than in production.
 */

const MESSAGES_ROUTE = new URL(
  "../../app/api/support/threads/[id]/messages/route.ts",
  import.meta.url,
);
const THREADS_ROUTE = new URL(
  "../../app/api/support/threads/route.ts",
  import.meta.url,
);
const READ_ROUTE = new URL(
  "../../app/api/support/threads/[id]/read/route.ts",
  import.meta.url,
);

/** The read route's own list of fields a client may not assert. */
function readRouteDerivedFields(): string[] {
  const source = fs.readFileSync(READ_ROUTE, "utf8");
  const declaration = /const DERIVED_FIELDS = \[([\s\S]*?)\] as const;/.exec(source);
  assert.ok(declaration, "the read route no longer declares DERIVED_FIELDS");
  return [...declaration[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

/** The route's own list of fields a client may not assert. */
function derivedFields(): string[] {
  const source = fs.readFileSync(MESSAGES_ROUTE, "utf8");
  const declaration = /const DERIVED_FIELDS = \[([\s\S]*?)\] as const;/.exec(source);
  assert.ok(declaration, "the messages route no longer declares DERIVED_FIELDS");
  const names = [...declaration[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  assert.ok(names.length > 0, "DERIVED_FIELDS parsed as empty");
  return names;
}

/** `/api/support/threads/<id>/messages`, from where the route file lives. */
function routePath(route: URL, threadId: string): string {
  const relative = route.pathname.slice(route.pathname.indexOf("/src/app/") + 8);
  return relative.replace(/\/route\.ts$/, "").replace("[id]", threadId);
}

function recordingFetch(response: Response) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ init, url: String(input) });
    return response;
  }) as unknown as typeof fetch;
  return { calls, fetcher };
}

describe("the operator Inbox's send goes through the messages route", () => {
  it("posts to the path the route file occupies, and posts `body` alone", async () => {
    const threadId = "00000000-0000-0000-0000-000000000001";
    const { calls, fetcher } = recordingFetch(
      Response.json(
        {
          message: {
            authorKind: "operator",
            body: "Thanks, sending that over.",
            id: "00000000-0000-0000-0000-0000000000aa",
            origin: "human",
            sentAt: "2026-08-19T10:00:00Z",
            visibility: "participants",
          },
        },
        { status: 201 },
      ),
    );

    const result = await postSupportReply(threadId, "Thanks, sending that over.", null, fetcher);

    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, routePath(MESSAGES_ROUTE, threadId));
    assert.equal(calls[0].init?.method, "POST");

    const sent = JSON.parse(String(calls[0].init?.body)) as Record<string, unknown>;
    for (const field of derivedFields()) {
      assert.ok(
        !(field in sent),
        `the reply asserted \`${field}\`, which the route derives and refuses`,
      );
    }
    assert.deepEqual(Object.keys(sent), ["body"]);
  });

  it("reports a refused send as failed rather than as sent", async () => {
    const { fetcher } = recordingFetch(
      Response.json({ error: "SUPPORT_REQUEST_INVALID" }, { status: 400 }),
    );
    const result = await postSupportReply(
      "00000000-0000-0000-0000-000000000001",
      "hello",
      null,
      fetcher,
    );
    assert.equal(result.ok, false);
  });
});

describe("a failed inbox read is never an empty inbox", () => {
  it("reads the bootstrap from the collection route's path", async () => {
    const { calls, fetcher } = recordingFetch(
      Response.json({ enabled: true, threads: [] }, { status: 200 }),
    );
    await readSupportInbox(fetcher);
    assert.equal(calls[0].url, routePath(THREADS_ROUTE, ""));
  });

  it("keeps `disabled` and `failed` apart, and neither becomes `ready`", async () => {
    assert.deepEqual(parseInboxBootstrap({ enabled: false, threads: [] }), {
      state: "disabled",
    });
    // A 200 the route cannot have produced: `enabled` is required on every
    // reachable answer, so a body without it is a failure, not an empty list.
    assert.equal(parseInboxBootstrap({ threads: [] }), null);

    const { fetcher: broken } = recordingFetch(new Response(null, { status: 500 }));
    assert.deepEqual(await readSupportInbox(broken), { state: "failed" });

    const { fetcher: garbled } = recordingFetch(
      new Response("not json", { status: 200 }),
    );
    assert.deepEqual(await readSupportInbox(garbled), { state: "failed" });
  });

  it("a thread that cannot be read is failed, not an empty conversation", async () => {
    const { fetcher } = recordingFetch(
      Response.json({ error: "SUPPORT_DRAFT_NOT_FOUND" }, { status: 404 }),
    );
    assert.deepEqual(
      await readSupportThread("00000000-0000-0000-0000-000000000001", fetcher),
      { state: "failed" },
    );
  });
});

/**
 * The capabilities the Inbox had no control for at all (walk lane B).
 *
 * `PATCH /api/support/threads/[id]`, the two draft verbs and the `draftId`
 * pairing on a send were all built, tested and merged, and nothing in
 * `web/src` called any of them. These assertions pin the wiring against the
 * routes themselves — the verbs each route exports, the statuses it accepts,
 * the fields it refuses, the paths the files occupy — so a route that grows a
 * status, drops a verb or renames a code fails here rather than in a browser.
 */

const THREAD_ROUTE = new URL(
  "../../app/api/support/threads/[id]/route.ts",
  import.meta.url,
);
const DRAFT_ROUTE = new URL(
  "../../app/api/support/threads/[id]/draft/route.ts",
  import.meta.url,
);
const CLIENTS_ROUTE = new URL("../../app/api/clients/route.ts", import.meta.url);
const SUPPORT_ERRORS = new URL("../support/errors.ts", import.meta.url);

/** The statuses the thread route's own validator accepts. */
function routeThreadStatuses(): string[] {
  const source = fs.readFileSync(THREAD_ROUTE, "utf8");
  const declaration = /const THREAD_STATUSES = \[([\s\S]*?)\] as const;/.exec(source);
  assert.ok(declaration, "the thread route no longer declares THREAD_STATUSES");
  const names = [...declaration[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  assert.ok(names.length > 0, "THREAD_STATUSES parsed as empty");
  return names;
}

/** The HTTP verbs a route file actually exports. */
function routeVerbs(route: URL): string[] {
  const source = fs.readFileSync(route, "utf8");
  return [...source.matchAll(/export async function ([A-Z]+)\s*\(/g)].map((match) => match[1]);
}

/** The refusal identifiers `src/lib/support/errors.ts` declares. */
function supportErrorCodes(): string[] {
  const source = fs.readFileSync(SUPPORT_ERRORS, "utf8");
  const declaration = /export type SupportErrorCode =([\s\S]*?);\n/.exec(source);
  assert.ok(declaration, "errors.ts no longer declares SupportErrorCode");
  return [...declaration[1].matchAll(/'([A-Z_]+)'/g)].map((match) => match[1]);
}

describe("the Inbox can move a thread's status", () => {
  it("offers exactly the statuses the route accepts, and no more", () => {
    assert.deepEqual([...SUPPORT_THREAD_STATUSES], routeThreadStatuses());
  });

  it("PATCHes the path the thread route file occupies", async () => {
    const threadId = "00000000-0000-0000-0000-000000000001";
    const { calls, fetcher } = recordingFetch(
      Response.json({ thread: {} }, { status: 200 }),
    );
    const result = await patchSupportThreadStatus(threadId, "resolved", fetcher);

    assert.deepEqual(result, { ok: true });
    assert.equal(calls[0].url, routePath(THREAD_ROUTE, threadId));
    assert.equal(calls[0].init?.method, "PATCH");
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { status: "resolved" });
  });

  it("reports a refusal rather than a status that did not move", async () => {
    const { fetcher } = recordingFetch(
      Response.json({ error: "SUPPORT_FORBIDDEN" }, { status: 403 }),
    );
    assert.deepEqual(
      await patchSupportThreadStatus("00000000-0000-0000-0000-000000000001", "open", fetcher),
      { code: "SUPPORT_FORBIDDEN", ok: false },
    );
  });
});

describe("a resolved thread's refusal is told apart from a broken send", () => {
  it("carries the route's own code back to the caller", async () => {
    const closed = "SUPPORT_THREAD_CLOSED";
    assert.ok(
      supportErrorCodes().includes(closed),
      `${closed} is no longer a declared support error code`,
    );

    const { fetcher } = recordingFetch(Response.json({ error: closed }, { status: 409 }));
    const result = await postSupportReply(
      "00000000-0000-0000-0000-000000000001",
      "hello",
      null,
      fetcher,
    );
    assert.deepEqual(result, { code: closed, ok: false });
  });
});

describe("the Inbox composer can cite a suggestion", () => {
  it("sends `body` and `draftId` alone, and never a field the route derives", async () => {
    const threadId = "00000000-0000-0000-0000-000000000001";
    const draftId = "00000000-0000-0000-0000-0000000000bb";
    const { calls, fetcher } = recordingFetch(
      Response.json(
        {
          message: {
            authorKind: "operator",
            body: "As suggested.",
            id: "00000000-0000-0000-0000-0000000000aa",
            origin: "ai_assisted",
            sentAt: "2026-08-21T10:00:00Z",
            visibility: "participants",
          },
        },
        { status: 201 },
      ),
    );

    const result = await postSupportReply(threadId, "As suggested.", draftId, fetcher);
    assert.equal(result.ok, true);

    const sent = JSON.parse(String(calls[0].init?.body)) as Record<string, unknown>;
    for (const field of derivedFields()) {
      assert.ok(!(field in sent), `the paired send asserted \`${field}\``);
    }
    assert.deepEqual(Object.keys(sent).sort(), ["body", "draftId"]);
  });

  it("uses each verb the draft route exports, against that route's own path", async () => {
    const threadId = "00000000-0000-0000-0000-000000000001";
    const verbs = routeVerbs(DRAFT_ROUTE);
    assert.deepEqual(
      verbs.sort(),
      ["DELETE", "POST"],
      "the draft route's verbs changed; the Inbox's two controls no longer match it",
    );

    const generate = recordingFetch(Response.json({ draft: {} }, { status: 201 }));
    await requestSupportDraft(threadId, generate.fetcher);
    const discard = recordingFetch(Response.json({ draft: {} }, { status: 200 }));
    await discardSupportDraft(threadId, discard.fetcher);

    const used = [generate.calls[0], discard.calls[0]];
    for (const call of used) {
      assert.equal(call.url, routePath(DRAFT_ROUTE, threadId));
    }
    assert.deepEqual(used.map((call) => String(call.init?.method)).sort(), verbs);
  });
});

describe("the thread payload's draft and origins reach the Inbox", () => {
  it("parses the draft inline and keeps an unreadable one from rendering", () => {
    const ready = parseThreadPayload({
      draft: {
        body: "Here is a reply you could send.",
        confidence: 0.82,
        confidenceThreshold: 0.7,
        guardrailFlags: [],
        id: "00000000-0000-0000-0000-0000000000bb",
        status: "approved",
      },
      messages: [],
      thread: {
        clientId: "00000000-0000-0000-0000-0000000000c1",
        id: "00000000-0000-0000-0000-000000000001",
        kind: "team_chat",
        lastActivityAt: "2026-08-21T10:00:00Z",
        status: "open",
        subject: "Team Chat",
      },
    });
    assert.equal(ready?.state, "ready");
    assert.equal(ready?.state === "ready" ? ready.draft?.status : null, "approved");
    assert.equal(ready?.state === "ready" ? ready.thread?.clientId : null,
      "00000000-0000-0000-0000-0000000000c1");

    // A draft missing its confidence bar would render a figure with nothing to
    // judge it against, so the payload fails rather than half-rendering.
    assert.equal(
      parseThreadPayload({
        draft: { body: "x", confidence: 0.9, guardrailFlags: [], id: "d", status: "approved" },
        messages: [],
      }),
      null,
    );
    // No draft at all is the ordinary case, not a failure.
    assert.equal(parseThreadPayload({ messages: [] })?.state, "ready");
  });

  it("refuses an origin the schema cannot produce", () => {
    const good = parseInboxMessage({
      authorKind: "operator",
      body: "hello",
      id: "00000000-0000-0000-0000-0000000000aa",
      origin: "ai_assisted",
      sentAt: "2026-08-21T10:00:00Z",
      visibility: "participants",
    });
    assert.equal(good?.origin, "ai_assisted");
    assert.equal(
      parseInboxMessage({
        authorKind: "operator",
        body: "hello",
        id: "00000000-0000-0000-0000-0000000000aa",
        origin: "machine",
        sentAt: "2026-08-21T10:00:00Z",
        visibility: "participants",
      }),
      null,
    );
  });
});

describe("the client directory behind the Inbox's labels and team filter", () => {
  it("reads the path the clients route file occupies", async () => {
    const { calls, fetcher } = recordingFetch(
      Response.json({
        clients: [],
        currentProfileId: "11111111-1111-4111-8111-111111111111",
        enabled: true,
      }, { status: 200 }),
    );
    await readSupportInboxDirectory(fetcher);
    assert.equal(
      calls[0].url.split("?")[0],
      routePath(CLIENTS_ROUTE, ""),
    );
  });

  it("treats a disabled tracker and a broken read the same, and neither invents clients", async () => {
    const { fetcher: off } = recordingFetch(
      Response.json({ clients: [], enabled: false }, { status: 200 }),
    );
    assert.deepEqual(await readSupportInboxDirectory(off), { state: "unavailable" });

    const { fetcher: broken } = recordingFetch(new Response(null, { status: 500 }));
    assert.deepEqual(await readSupportInboxDirectory(broken), { state: "unavailable" });
  });

  it("keeps the client snapshot optional, so a thinner row is a thinner rail", () => {
    // `/api/clients` returning these six today is not a contract. The rail has to survive a row
    // that omits one, or carries it in a shape the route never promised — with a line missing,
    // never with a render that fails or a value invented to fill the gap.
    const bare = parseInboxClient({ displayName: "Vela Freight", id: "c1" });
    assert.deepEqual(bare, {
      analysisAt: null, assignedToActive: null, assignedToId: null,
      assignedToIsCurrentUser: false, assignedToName: null, assignedToOrgRole: null,
      businessName: null,
      displayName: "Vela Freight", id: "c1", nextRefreshAt: null, openActionCount: null,
      readiness: null, stage: null,
    });

    const wrongShapes = parseInboxClient({
      analysisAt: 17, businessName: [], displayName: "Vela Freight", id: "c1",
      nextRefreshAt: {}, openActionCount: "four", readiness: "88", stage: "onboarding",
    });
    assert.equal(wrongShapes?.readiness, null, "a readiness that is not a number is not a readiness");
    assert.equal(wrongShapes?.openActionCount, null);
    assert.equal(wrongShapes?.analysisAt, null);
    assert.equal(wrongShapes?.businessName, null);
    assert.equal(wrongShapes?.nextRefreshAt, null);
    assert.equal(wrongShapes?.stage, "onboarding", "a stage in the taxonomy survives");
  });

  it("refuses a stage this product does not have, rather than passing it to a chip", () => {
    // Derived from the taxonomy rather than from a literal: the guard's job is that the chip only
    // ever colours a stage the product defines, so the test asks the taxonomy what those are and
    // builds its counter-example from a string that is not among them.
    for (const stage of TRACKER_STAGES) {
      assert.equal(parseInboxClient({ displayName: "n", id: "c", stage })?.stage, stage);
    }
    const notAStage = `${TRACKER_STAGES.join("-")}-x`;
    assert.equal(parseInboxClient({ displayName: "n", id: "c", stage: notAStage })?.stage, null);
  });

  it("offers a team option only for an owner the directory actually names", () => {
    // `inboxTeamOptions` reads assignment and nothing else, so these fixtures name assignment and
    // nothing else. The snapshot fields the Details rail uses are filled by `client()` rather than
    // spelled out here, so a rail that grows a seventh field does not edit four lines that have no
    // opinion about it.
    const client = (row: Pick<SupportInboxClient, "assignedToId" | "assignedToName" | "displayName" | "id">): SupportInboxClient => ({
      analysisAt: null, assignedToActive: true, assignedToIsCurrentUser: false,
      assignedToOrgRole: "member", businessName: null, nextRefreshAt: null,
      openActionCount: null, readiness: null, stage: null, ...row,
    });
    const options = inboxTeamOptions([
      client({ assignedToId: "tm-2", assignedToName: "Rosa Kim", displayName: "Vela Freight", id: "c1" }),
      client({ assignedToId: "tm-1", assignedToName: "Alec Doyle", displayName: "Northbrook", id: "c2" }),
      client({ assignedToId: "tm-1", assignedToName: "Alec Doyle", displayName: "Harbor Line", id: "c3" }),
      client({ assignedToId: null, assignedToName: null, displayName: "Unassigned Co", id: "c4" }),
    ]);
    assert.deepEqual(options, [
      { active: true, id: "tm-1", isCurrentUser: false, name: "Alec Doyle", orgRole: "member" },
      { active: true, id: "tm-2", isCurrentUser: false, name: "Rosa Kim", orgRole: "member" },
    ]);
  });

  it("derives current-user identity from stable ids and carries role and active state", () => {
    const currentProfileId = "11111111-1111-4111-8111-111111111111";
    const client = parseInboxClient({
      assignedToActive: true,
      assignedToId: currentProfileId,
      assignedToName: "Current Owner",
      assignedToOrgRole: "owner",
      displayName: "Vela Freight",
      id: "c1",
    }, currentProfileId);
    assert.equal(client?.assignedToIsCurrentUser, true);
    assert.equal(client?.assignedToOrgRole, "owner");
    assert.equal(client?.assignedToActive, true);
  });
});


describe("the unread watermark is the database's number, not the browser's", () => {
  it("posts to the read route's own path and asserts nothing the route derives", async () => {
    // Both expectations are read out of the route at test time: the URL from
    // where the file sits on disk, and the refused field list from the route's
    // own DERIVED_FIELDS. Widening either without widening this file fails here.
    const threadId = "00000000-0000-0000-0000-000000000001";
    const { calls, fetcher } = recordingFetch(
      Response.json({ read: { lastReadAt: "2026-08-21T10:00:00Z", unreadCount: 0 } }),
    );

    const result = await postSupportThreadRead(threadId, "2026-08-21T10:00:00Z", fetcher);

    assert.equal(result.ok, true);
    assert.equal(calls[0].url, routePath(READ_ROUTE, threadId));
    assert.equal(calls[0].init?.method, "POST");

    const sent = JSON.parse(String(calls[0].init?.body)) as Record<string, unknown>;
    for (const field of readRouteDerivedFields()) {
      assert.ok(!(field in sent), `the read asserted \`${field}\`, which the route refuses`);
    }
    assert.deepEqual(Object.keys(sent), ["lastReadAt"]);
  });

  it("sends an empty body when the caller does not name a moment", async () => {
    const { calls, fetcher } = recordingFetch(
      Response.json({ read: { lastReadAt: null, unreadCount: 0 } }),
    );
    await postSupportThreadRead("00000000-0000-0000-0000-000000000001", null, fetcher);
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {});
  });

  it("never lets a badge render a negative or fractional count", () => {
    // Watched failing against a parser that passed `unreadCount` through when it
    // was a number. This is the last point before the value becomes text on a
    // screen, and the database's own floor cannot help a malformed payload.
    assert.equal(parseThreadWatermark({ unreadCount: -3 }).unreadCount, 0);
    assert.equal(parseThreadWatermark({ unreadCount: 2.7 }).unreadCount, 2);
    assert.equal(parseThreadWatermark({ unreadCount: "many" }).unreadCount, 0);
    assert.equal(parseThreadWatermark(null).unreadCount, 0);
    assert.equal(parseThreadWatermark(null).lastReadAt, null);
  });

  it("keeps a thread row when its watermark is unreadable", () => {
    // A thread with a wrong badge is worth showing; a thread that vanished
    // because its badge was malformed is the G-HOST-14 failure again.
    const parsed = parseInboxBootstrap({
      enabled: true,
      threads: [
        {
          id: "00000000-0000-0000-0000-000000000001",
          kind: "team_chat",
          lastActivityAt: "2026-08-21T10:00:00Z",
          read: "not an object",
          status: "open",
          subject: "Team Chat",
        },
      ],
    });
    assert.equal(parsed?.state, "ready");
    assert.equal(parsed?.state === "ready" ? parsed.threads[0].read.unreadCount : null, 0);
    assert.equal(parsed?.state === "ready" ? parsed.threads[0].lastMessagePreview : "x", null);
  });

  it("keeps participant replies and internal notes as separate list facts", () => {
    const parsed = parseInboxBootstrap({
      enabled: true,
      threads: [{
        id: "00000000-0000-0000-0000-000000000001",
        internalMessageCount: 2,
        kind: "team_chat",
        lastActivityAt: "2026-08-21T10:00:00Z",
        lastInternalMessagePreview: "Review the agreement.",
        lastMessagePreview: "Review the agreement.",
        lastParticipantMessagePreview: "I uploaded the statements.",
        participantMessageCount: 3,
        status: "open",
        subject: "Team Chat",
      }],
    });
    assert.equal(parsed?.state, "ready");
    const row = parsed?.state === "ready" ? parsed.threads[0] : null;
    assert.equal(row?.participantMessageCount, 3);
    assert.equal(row?.internalMessageCount, 2);
    assert.equal(row?.lastParticipantMessagePreview, "I uploaded the statements.");
    assert.equal(row?.lastInternalMessagePreview, "Review the agreement.");
  });
});

describe("an internal note is a different request from a reply", () => {
  it("omits visibility on an ordinary reply and names it on a note", async () => {
    // Watched failing before the client forwarded visibility: the note's payload
    // was identical to a reply's, so the route defaulted it to `participants`
    // and the note landed in the thread the client reads.
    const threadId = "00000000-0000-0000-0000-000000000001";
    const reply = recordingFetch(
      Response.json(
        {
          message: {
            authorKind: "operator",
            body: "Sending that over.",
            id: "00000000-0000-0000-0000-0000000000aa",
            origin: "human",
            sentAt: "2026-08-21T10:00:00Z",
            visibility: "participants",
          },
        },
        { status: 201 },
      ),
    );
    await postSupportReply(threadId, "Sending that over.", null, reply.fetcher);
    assert.deepEqual(Object.keys(JSON.parse(String(reply.calls[0].init?.body))), ["body"]);

    const note = recordingFetch(
      Response.json(
        {
          message: {
            authorKind: "operator",
            body: "Team note: confirm the filing date.",
            id: "00000000-0000-0000-0000-0000000000ab",
            origin: "human",
            sentAt: "2026-08-21T10:01:00Z",
            visibility: "internal",
          },
        },
        { status: 201 },
      ),
    );
    const sent = await postSupportReply(
      threadId,
      "Team note: confirm the filing date.",
      null,
      note.fetcher,
      "internal",
    );
    assert.equal(sent.ok, true);
    assert.equal(sent.ok ? sent.message.visibility : null, "internal");
    assert.deepEqual(
      JSON.parse(String(note.calls[0].init?.body)),
      { body: "Team note: confirm the filing date.", visibility: "internal" },
    );
  });

  it("refuses a visibility the schema cannot produce", () => {
    // The safe-looking default is the dangerous one: an unrecognised visibility
    // rendered as `participants` puts a note in front of the person it is about.
    assert.equal(
      parseInboxMessage({
        authorKind: "operator",
        body: "hello",
        id: "00000000-0000-0000-0000-0000000000aa",
        origin: "human",
        sentAt: "2026-08-21T10:00:00Z",
        visibility: "team-only",
      }),
      null,
    );
    assert.equal(
      parseInboxMessage({
        authorKind: "operator",
        body: "hello",
        id: "00000000-0000-0000-0000-0000000000aa",
        origin: "human",
        sentAt: "2026-08-21T10:00:00Z",
      }),
      null,
    );
  });
});

describe("a thread read carries the server's timeline through to the Inbox", () => {
  // 2026-08-25: found on the deployment — the payload carried 14 events and the Inbox said
  // "0 updates", because the parser dropped the field. The assertion reads what the parser
  // returns for what the server sends, never a transcribed count.
  const base = {
    draft: null,
    messages: [],
    read: { lastReadAt: null, counterpartLastReadAt: null },
    thread: null,
  };
  const events: unknown[] = [
    { ref: "e1", kind: "thread_opened", at: "2026-08-01T09:45:00Z" },
    { ref: "e2", kind: "stage_changed", at: "2026-08-15T09:03:00Z", to: "Optimization" },
    { ref: "e3", kind: "not-an-event", at: "2026-08-16T09:03:00Z" },
    {
      ref: "e4",
      kind: "document_requested",
      at: "2026-08-17T09:03:00Z",
      named: "a bank statement",
      why: "Needed for review.",
      requestId: "request-1",
    },
    { kind: "not-an-event" },
    "junk",
  ];

  it("passes every valid event and the readFailed flag through", () => {
    const ready = parseThreadPayload({ ...base, timeline: { events, readFailed: true } });
    assert.ok(ready !== null && ready.state === "ready");
    assert.deepEqual(ready.timeline?.events.map((event) => event.kind), [
      "thread_opened",
      "stage_changed",
    ]);
    assert.equal(ready.timeline?.readFailed, true);
  });

  it("filters an unknown kind even when its base fields look valid", () => {
    const ready = parseThreadPayload({ ...base, timeline: { events: [events[2]] } });
    assert.ok(ready !== null && ready.state === "ready");
    assert.deepEqual(ready.timeline?.events, []);
  });

  it("filters document_requested when a formatter-required name is missing", () => {
    const ready = parseThreadPayload({ ...base, timeline: { events: [events[3]] } });
    assert.ok(ready !== null && ready.state === "ready");
    assert.deepEqual(ready.timeline?.events, []);
  });

  it("leaves timeline absent when the server sent none, so the flag-off thread is unchanged", () => {
    const ready = parseThreadPayload(base);
    assert.ok(ready !== null && ready.state === "ready");
    assert.equal("timeline" in ready, false);
  });
});
