import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ASSISTANT_ERROR_CODES, AssistantError, type AssistantErrorCode } from "../assistant/types.ts";
import type { SessionProfile } from "../auth/session.ts";
import { complianceLanguageCodes } from "../compliance/language-rules.mjs";
import { CONSUMER_KB_IDENTITY } from "./consumer.ts";
import { CONSUMER_ASSISTANT_DEFAULT_FAILURE, CONSUMER_ASSISTANT_FAILURE_COPY, adminKbAnswerHandler, adminKbHandler, consumerAssistantFailure, consumerKbHandler, operatorKbHandler, type KbHandlerDependencies } from "./handlers.ts";
import { containsUuidShaped } from "./identifiers.ts";
import { readKbStreamLines } from "./stream.ts";

const SESSION: Record<"consumer" | "operator" | "admin", SessionProfile> = {
  consumer: { disabledAt: null, id: "consumer", role: "consumer", orgId: null, orgMembership: null, orgRole: null, manages: [] },
  operator: { disabledAt: null, id: "operator", role: "operator_member", orgId: "org", orgMembership: "current", orgRole: "funding_specialist", manages: [] },
  admin: { disabledAt: null, id: "admin", role: "platform_admin", orgId: null, orgMembership: null, orgRole: null, manages: [] },
};

function request(body?: unknown): Request { return new Request("http://local.test/api/kb", body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }
function dependencies(session: SessionProfile | null = SESSION.consumer, enabled = true) {
  const calls = { session: 0, consumer: 0, operator: 0, admin: 0, adminAnswer: 0 };
  const deps: KbHandlerDependencies = {
    enabled: () => enabled,
    async getSession() { calls.session += 1; return session; },
    async assertTenantWriteAllowed() {},
    async answerConsumer() { calls.consumer += 1; return { status: "insufficient_grounding", identity: "AI assistant", answer: "No context.", citations: [] }; },
    async answerOperator() { calls.operator += 1; return { status: "insufficient_grounding", answer: "No context.", citations: [] }; },
    async answerAdmin() { calls.adminAnswer += 1; return { status: "insufficient_grounding", answer: "No context.", citations: [] }; },
    async reimport() { calls.admin += 1; return { status: "ok", rows: 6 }; },
  };
  return { deps, calls };
}

describe("KB handler", () => {
  it("returns flag-off responses before session or domain construction", async () => {
    const state = dependencies(SESSION.consumer, false);
    assert.deepEqual(await (await consumerKbHandler(request(), "GET", state.deps)).json(), { enabled: false });
    assert.equal((await consumerKbHandler(request({ question: "Q" }), "POST", state.deps)).status, 404);
    assert.equal((await operatorKbHandler(request({ mode: "answer", question: "Q" }), "POST", state.deps)).status, 404);
    assert.equal((await adminKbHandler(request({ subject: "global", window: "2026-W33" }), state.deps)).status, 404);
    assert.equal((await adminKbAnswerHandler(request({ question: "Q" }), "POST", state.deps)).status, 404);
    // Compared against zeros derived from the counter itself, so a handler added
    // to the set below is covered without this literal being edited — the
    // previous version listed four names and would have gone on passing while
    // the fifth ran behind an off flag.
    assert.deepEqual(state.calls, Object.fromEntries(Object.keys(state.calls).map((key) => [key, 0])));
  });

  it("gates the platform answer on the flag, the session and the platform-admin role", async () => {
    assert.equal((await adminKbAnswerHandler(request({ question: "Q" }), "POST", dependencies(null).deps)).status, 401);
    for (const session of [SESSION.consumer, SESSION.operator]) {
      assert.equal((await adminKbAnswerHandler(request({ question: "Q" }), "POST", dependencies(session).deps)).status, 403);
    }
    // The reimport body must not be accepted here and vice versa: two different
    // things behind one path is how a retry runs a job.
    const state = dependencies(SESSION.admin);
    assert.equal((await adminKbAnswerHandler(request({ subject: "global", window: "2026-W33" }), "POST", state.deps)).status, 400);
    assert.equal((await adminKbAnswerHandler(request({ question: "   " }), "POST", state.deps)).status, 400);
    assert.equal(state.calls.adminAnswer, 0);
    assert.equal((await adminKbAnswerHandler(request({ question: "Which operator grew fastest?" }), "POST", state.deps)).status, 200);
    assert.equal(state.calls.adminAnswer, 1);
    assert.equal(state.calls.admin, 0, "answering a question must not reach the reimport job");
  });

  it("enforces authentication and the consumer role", async () => {
    assert.equal((await consumerKbHandler(request({ question: "Q" }), "POST", dependencies(null).deps)).status, 401);
    assert.equal((await consumerKbHandler(request({ question: "Q" }), "POST", dependencies(SESSION.operator).deps)).status, 403);
    assert.equal((await consumerKbHandler(request({ question: "Q", clientId: "x" }), "POST", dependencies().deps)).status, 400);
    const state = dependencies();
    const response = await consumerKbHandler(request({ question: "  What is documented?  " }), "POST", state.deps);
    assert.equal(response.status, 200);
    assert.equal(state.calls.consumer, 1);
    assert.equal(JSON.stringify(await response.json()).includes("AI assistant"), true);
  });

  it("streams only real consumer progress and rejects monitoring context at the route boundary", async () => {
    const state = dependencies();
    const deps: KbHandlerDependencies = {
      ...state.deps,
      async answerConsumer(_question, onProgress) {
        onProgress?.({ stage: "searching" });
        onProgress?.({ stage: "reading", titles: ["Preparing for a funding application"] });
        onProgress?.({ stage: "composing" });
        onProgress?.({ stage: "reviewing" });
        return { status: "answered", identity: "AI assistant", headline: "Grounded.", bullets: [], footer: null, answer: "Grounded.", citations: [] };
      },
    };
    const response = await consumerKbHandler(request({
      context: { entityRef: "client-1", route: "plan" },
      question: "What should I prepare?",
    }), "POST", deps);
    const events = readKbStreamLines(await response.text()).events;
    assert.deepEqual(events.slice(0, 4), [
      { progress: { stage: "searching" } },
      { progress: { stage: "reading", titles: ["Preparing for a funding application"] } },
      { progress: { stage: "composing" } },
      { progress: { stage: "reviewing" } },
    ]);
    assert.equal("result" in events.at(-1)!, true);

    for (const field of ["monitoring", "bureau", "snapshot", "score"]) {
      const blocked = await consumerKbHandler(request({ context: { entityRef: "client-1", route: field }, question: "Q" }), "POST", deps);
      assert.equal(blocked.status, 400, `${field} context crossed the server boundary`);
    }
  });

  it("separates operator answer and held-draft request bodies", async () => {
    const state = dependencies(SESSION.operator);
    assert.equal((await operatorKbHandler(request({ mode: "answer", question: "Q", supportThreadId: "x" }), "POST", state.deps)).status, 400);
    assert.equal((await operatorKbHandler(request({ mode: "message_draft", supportThreadId: "thread", question: "Q" }), "POST", state.deps)).status, 400);
    assert.equal((await operatorKbHandler(request({ mode: "answer", question: "Question" }), "POST", state.deps)).status, 200);
    assert.equal((await operatorKbHandler(request({ mode: "message_draft", supportThreadId: "thread" }), "POST", state.deps)).status, 200);
    assert.equal(state.calls.operator, 2);
  });

  it("requires platform admin and validates the inline weekly key", async () => {
    assert.equal((await adminKbHandler(request({ subject: "global", window: "2026-W33" }), dependencies(SESSION.operator).deps)).status, 403);
    const state = dependencies(SESSION.admin);
    assert.equal((await adminKbHandler(request({ subject: "global", window: "bad" }), state.deps)).status, 400);
    assert.equal(state.calls.admin, 0);
    const response = await adminKbHandler(request({ subject: "global", window: "2026-W33" }), state.deps);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok", rows: 6 });
  });
});

/**
 * `answerConsumer`'s failure branches, which had no test at all.
 *
 * Every case enumerates from the module rather than from this file. The map is
 * iterated, the unmapped set is derived by subtracting it from the assistant's
 * own code vocabulary, and "this copy is clean" is asked of
 * `complianceLanguageCodes` and `containsUuidShaped` rather than eyeballed —
 * so a sixth outcome added with no copy of its own, or a copy that starts
 * carrying an identifier, fails here instead of arriving silently on a
 * consumer's screen.
 */
const FAILURE_ENTRIES = Object.entries(CONSUMER_ASSISTANT_FAILURE_COPY) as ReadonlyArray<[AssistantErrorCode, { readonly status: string; readonly answer: string }]>;

/** Codes the assistant can raise that the map has no words for; they must all take one fallback. */
const UNMAPPED_CODES = ASSISTANT_ERROR_CODES.filter((code) => !(code in CONSUMER_ASSISTANT_FAILURE_COPY));

function streamedResult(response: Response, text: string): unknown {
  assert.equal(response.status, 200);
  const events = readKbStreamLines(text).events;
  const last = events.at(-1);
  assert.ok(last !== undefined && "result" in last, "the stream ended without a result event");
  return (last as { result: unknown }).result;
}

describe("consumer assistant failure copy", () => {
  it("gives every mapped outcome its own consumer result", async () => {
    assert.notEqual(FAILURE_ENTRIES.length, 0, "the failure map is empty");
    const answers = new Set<string>();
    for (const [code, copy] of FAILURE_ENTRIES) {
      assert.ok(ASSISTANT_ERROR_CODES.includes(code), `${code} is not an assistant outcome`);
      assert.deepEqual(consumerAssistantFailure(new AssistantError(code)), { ...copy, identity: CONSUMER_KB_IDENTITY, citations: [] });
      answers.add(copy.answer);
    }
    // The reviewer's gap: outcomes that read identically are not distinguishable
    // to the person reading them, whatever the code says.
    assert.equal(answers.size, FAILURE_ENTRIES.length, "two outcomes share one sentence");
  });

  it("falls back to one default for every unmapped code and every non-AssistantError throw", () => {
    const expected = { ...CONSUMER_ASSISTANT_DEFAULT_FAILURE, identity: CONSUMER_KB_IDENTITY, citations: [] };
    assert.notEqual(UNMAPPED_CODES.length, 0, "every code is mapped, so the default branch is unreachable and this test is empty");
    for (const code of UNMAPPED_CODES) {
      assert.deepEqual(consumerAssistantFailure(new AssistantError(code)), expected, `${code} did not take the default`);
    }
    const notAssistantErrors: readonly unknown[] = [
      new Error("provider socket closed"),
      new TypeError("undefined is not a function"),
      "ASSISTANT_POLICY_REFUSED",
      null,
      undefined,
      { message: "connection reset" },
      // Duck-typed, and deliberately not trusted: a PostgREST row carrying a
      // code field must be normalized through `toAssistantError` before any
      // copy is chosen, or a database message picks a consumer's words.
      { code: FAILURE_ENTRIES[0]![0] },
    ];
    for (const [index, thrown] of notAssistantErrors.entries()) {
      assert.deepEqual(consumerAssistantFailure(thrown), expected, `case ${index} did not take the default`);
    }
  });

  it("never puts an identifier, an outcome code or prohibited vocabulary in front of a consumer", () => {
    for (const [code, copy] of [...FAILURE_ENTRIES, ["<default>" as AssistantErrorCode, CONSUMER_ASSISTANT_DEFAULT_FAILURE] as const]) {
      const answer = copy.answer;
      assert.equal(containsUuidShaped(answer), false, `${code}'s copy carries an identifier`);
      assert.deepEqual(complianceLanguageCodes({ answer }), [], `${code}'s copy fails the compliance vocabulary`);
      // Neither the machine vocabulary the surface routes on nor the wire code
      // belongs in the sentence. Both sets are read off the modules, so a new
      // member is covered without editing this test.
      for (const known of ASSISTANT_ERROR_CODES) assert.equal(answer.includes(known), false, `${code}'s copy names ${known}`);
      for (const [, other] of FAILURE_ENTRIES) assert.equal(answer.includes(other.status), false, `${code}'s copy names the status ${other.status}`);
    }
  });

  it("carries each outcome's own copy to the consumer over the stream", async () => {
    for (const [code] of FAILURE_ENTRIES) {
      const state = dependencies();
      const deps: KbHandlerDependencies = { ...state.deps, async answerConsumer() { return consumerAssistantFailure(new AssistantError(code)); } };
      const response = await consumerKbHandler(request({ question: "Where does my file stand?" }), "POST", deps);
      assert.deepEqual(streamedResult(response, await response.text()), consumerAssistantFailure(new AssistantError(code)), `${code} did not reach the consumer intact`);
    }
    // And the route's own catch, which is a different branch again: an
    // `answerConsumer` that rejects rather than returning must still terminate
    // the stream with a result rather than a truncated body.
    const state = dependencies();
    const rejecting: KbHandlerDependencies = { ...state.deps, async answerConsumer() { throw new Error("stream boom"); } };
    const response = await consumerKbHandler(request({ question: "Where does my file stand?" }), "POST", rejecting);
    const result = streamedResult(response, await response.text()) as { status: string; citations: readonly unknown[] };
    assert.equal(result.status, "unavailable");
    assert.deepEqual(result.citations, []);
  });
});
