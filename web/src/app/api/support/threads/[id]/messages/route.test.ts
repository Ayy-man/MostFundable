import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NORMALIZED_ADVERSARIAL_LANGUAGE } from "@/lib/compliance/__fixtures__/adversarial-language.mjs";
import { toHttpResponse } from "@/lib/support/errors";
import { evaluateDraftLanguage } from "@/lib/support/language-gate";
import { createSupportService } from "@/lib/support/service";
import { handleSendMessage } from "./route.ts";

import type { SessionProfile } from "@/lib/auth/session";
import type { SupportMessageRow, SupportRepository } from "@/lib/support/repository";
import type { SendMessageRouteDependencies } from "./route.ts";

// Pre-launch defect C5, at the HTTP boundary. The handler is driven with a
// fake session and a fake repository, and everything between them is real:
// the service, its language screen, and the error mapping. What is asserted
// is the wire shape a surface has to parse — status 422, `error`, `codes` —
// and that the repository saw nothing.

const THREAD_ID = "13000000-0000-0000-0000-0000000000aa";

const OPERATOR: SessionProfile = {
  disabledAt: null,
  id: "13000000-0000-0000-0000-000000000111",
  manages: [],
  orgId: "13000000-0000-0000-0000-000000000001",
  orgMembership: "current",
  orgRole: "admin",
  role: "operator_member",
};

const CONSUMER: SessionProfile = {
  disabledAt: null,
  id: "13000000-0000-0000-0000-000000000113",
  manages: [],
  orgId: null,
  orgMembership: null,
  orgRole: null,
  role: "consumer",
};

const POISONED_BODY = ((): string => {
  const found = NORMALIZED_ADVERSARIAL_LANGUAGE.find((text) => evaluateDraftLanguage(text).length > 0);
  if (found === undefined) throw new Error("the shared compliance fixture no longer trips the language battery");
  return found;
})();

const CLEAN_BODY = "Your file is with the team and I will follow up here as soon as I can.";

function repository(calls: string[]): SupportRepository {
  const refuse = (name: string) => () => {
    calls.push(name);
    return Promise.reject(new Error(`${name} is not part of this test`));
  };
  return {
    discardDraft: refuse("discardDraft"),
    listThreads: refuse("listThreads"),
    markThreadRead: refuse("markThreadRead"),
    openThread: refuse("openThread"),
    readThread: refuse("readThread"),
    recordDraft: refuse("recordDraft"),
    setThreadStatus: refuse("setThreadStatus"),
    sendMessage(input) {
      calls.push("sendMessage");
      const sent: SupportMessageRow = {
        id: "13000000-0000-0000-0000-0000000000e1",
        threadId: input.threadId,
        authorProfileId: input.actorProfileId,
        authorKind: input.authorKind,
        origin: input.draftId === undefined ? "human" : "ai_assisted",
        originDraftId: input.draftId ?? null,
        visibility: input.visibility ?? "participants",
        body: input.body,
        sentAt: "2026-08-16T10:40:00.000Z",
      };
      return Promise.resolve(sent);
    },
  };
}

function dependencies(session: SessionProfile, calls: string[]): SendMessageRouteDependencies {
  const service = createSupportService({ env: {}, repository: repository(calls) });
  return {
    assertTenantWriteAllowed: async () => { calls.push("wall"); },
    getSession: async () => session,
    sendMessage: (threadId, actor, body, draftId, visibility) =>
      service.sendMessage(threadId, actor, body, draftId, visibility),
    tenantErrorResponse: () => new Response(null, { status: 500 }),
    toHttpResponse,
  };
}

async function send(session: SessionProfile, body: Record<string, unknown>) {
  const calls: string[] = [];
  const response = await handleSendMessage(
    new Request(`https://app.example.test/api/support/threads/${THREAD_ID}/messages`, {
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
    { params: Promise.resolve({ id: THREAD_ID }) },
    dependencies(session, calls),
  );
  return { calls, payload: (await response.json()) as Record<string, unknown>, response };
}

describe("messages route language screen (C5)", () => {
  it("answers 422 with the code and the rule ids when an operator types a flagged body", async () => {
    const { calls, payload, response } = await send(OPERATOR, { body: POISONED_BODY });
    assert.equal(response.status, 422);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.deepEqual(Object.keys(payload).sort(), ["codes", "error"]);
    assert.equal(payload.error, "SUPPORT_MESSAGE_LANGUAGE");
    assert.ok(Array.isArray(payload.codes) && payload.codes.length > 0);
    for (const code of payload.codes as unknown[]) assert.match(String(code), /^LANGUAGE_C\d{2}$/);
    // The body is never echoed: the response names rules, not phrases.
    assert.equal(JSON.stringify(payload).includes(POISONED_BODY), false);
    // The wall ran and the send seam did not: nothing was recorded.
    assert.deepEqual(calls, ["wall"]);
  });

  it("records the same body from a consumer, who is not the regulated speaker", async () => {
    const { calls, payload, response } = await send(CONSUMER, { body: POISONED_BODY });
    assert.equal(response.status, 201);
    assert.deepEqual(calls, ["wall", "sendMessage"]);
    const message = payload.message as Record<string, unknown>;
    assert.equal(message.authorKind, "consumer");
    assert.equal(message.body, POISONED_BODY);
  });

  it("records clean text from an operator as before", async () => {
    const { calls, payload, response } = await send(OPERATOR, { body: CLEAN_BODY });
    assert.equal(response.status, 201);
    assert.deepEqual(calls, ["wall", "sendMessage"]);
    assert.equal((payload.message as Record<string, unknown>).body, CLEAN_BODY);
  });

  it("lets an operator's internal note through, since migration 385 keeps it from the client", async () => {
    const { calls, response } = await send(OPERATOR, { body: POISONED_BODY, visibility: "internal" });
    assert.equal(response.status, 201);
    assert.deepEqual(calls, ["wall", "sendMessage"]);
  });
});
