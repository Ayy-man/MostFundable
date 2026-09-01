/**
 * The supervisor says why, and "why" changes what the reader is told.
 *
 * Three admin questions on the live walk were declined here and the
 * `route_failure` line for each carried nothing but `KB_SUPERVISOR_DECLINED`,
 * so the cause had to be reasoned out from the shape of the documents instead of
 * read off the log. A boolean verdict is also the reason an incomplete answer —
 * the model doing the job badly — reached the reader as a policy refusal, which
 * is non-retryable and says a compliance rule blocked a compliant answer.
 *
 * Every expectation below is read off the exported vocabulary, the schema the
 * driver actually sent, or the mapping module. Nothing is transcribed from the
 * reproduction, so a reason added to the enum is caught by the exhaustiveness
 * cases rather than quietly falling through to the default.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assistantErrorIsRetryable } from "../../components/assistant/errors.ts";
import { groundedFailureOutcome } from "../assistant/orchestrator.ts";
import { setRouteFailureSink, type RouteFailureRecord } from "../diagnostics/route-failure.ts";
import { createMockChatTransport } from "../llm/mock-chat-transport.ts";
import {
  KB_REFUSAL_CODES,
  KB_SUPERVISOR_REASONS,
  KB_SUPERVISOR_SCHEMA,
  parseSupervisorVerdict,
  runGroundedChat,
  type GroundingDocument,
  type KbSupervisorReason,
} from "./chat-driver.ts";
import { CONSUMER_KB_PROMPT, KB_SUPERVISOR_PROMPT } from "./prompts.ts";

const DOCUMENT: GroundingDocument = {
  content: "Northstar Funding has 12 active clients.",
  id: "operator:one",
  label: "Operator · Northstar Funding",
  metadata: { kind: "operator" },
  title: "Operator · Northstar Funding",
  url: "",
};

const DECLINE_REASONS = KB_SUPERVISOR_REASONS.filter((reason) => reason !== "approved");

function reviewing(verdict: unknown) {
  const requests: Array<{ operation: string; schemaName: string; schema: unknown }> = [];
  const transport = createMockChatTransport((request) => {
    requests.push({ operation: request.operation, schemaName: request.schemaName, schema: request.schema });
    if (!request.operation.endsWith(".candidate")) return verdict;
    const body = JSON.parse(request.messages[1]!.content) as { documents: Array<{ id: string }> };
    return { headline: "Northstar Funding has the most active clients.", bullets: ["It has 12."], citations: [{ id: body.documents[0]!.id }] };
  });
  return { requests, transport };
}

describe("the supervisor verdict carries its reason", () => {
  it("asks for a reason in the schema, from the vocabulary the module exports", () => {
    assert.ok((KB_SUPERVISOR_SCHEMA.required as readonly string[]).includes("reason"), "the verdict can still come back as a bare boolean");
    assert.deepEqual([...KB_SUPERVISOR_SCHEMA.properties.reason.enum], [...KB_SUPERVISOR_REASONS]);
    assert.ok(KB_SUPERVISOR_REASONS.includes("incomplete"), "there is no way to say an answer left records out");
  });

  it("names every reason it can be asked for in the prompt that produces them", () => {
    assert.ok(KB_SUPERVISOR_PROMPT.version >= 3, "the widened policy was not versioned");
    for (const reason of KB_SUPERVISOR_REASONS) {
      assert.ok(KB_SUPERVISOR_PROMPT.system.includes(reason), `the prompt never tells the model it may answer ${reason}`);
    }
  });

  it("keeps every rejection the earlier policy made while allowing a faithful restatement", () => {
    for (const intact of [
      /every factual statement/i,
      /question itself is never evidence/i,
      /unsupported statement/i,
      /invented or exposed identifier/i,
      /instruction outside the verified records/i,
      /personalized lending-outcome forecast, probability, or guarantee/i,
    ]) assert.match(KB_SUPERVISOR_PROMPT.system, intact, "widening the policy dropped a rejection clause");
    for (const restatement of [/cents to dollars/i, /formatting a date/i, /counting or ordering/i, /plain-language label/i]) {
      assert.match(KB_SUPERVISOR_PROMPT.system, restatement, "the machine-value restatement that was being refused is still not permitted");
    }
  });

  it("reads a verdict back without discarding an approval that omitted its reason", () => {
    for (const reason of KB_SUPERVISOR_REASONS) {
      assert.deepEqual(parseSupervisorVerdict({ approved: reason === "approved", reason }), { approved: reason === "approved", reason });
    }
    assert.deepEqual(parseSupervisorVerdict({ approved: true }), { approved: true, reason: null });
    assert.deepEqual(parseSupervisorVerdict({ approved: false, reason: "a sentence the model invented" }), { approved: false, reason: null });
    for (const malformed of [null, "approved", { reason: "approved" }, { approved: "yes" }, { approved: true, verdict: "ok" }]) {
      assert.equal(parseSupervisorVerdict(malformed), null, JSON.stringify(malformed));
    }
  });

  it("puts the reason on the route-failure record where the log reads its cause code", async () => {
    for (const reason of DECLINE_REASONS) {
      const records: RouteFailureRecord[] = [];
      const restore = setRouteFailureSink((record) => { records.push(record); });
      try {
        const { transport } = reviewing({ approved: false, reason });
        const answer = await runGroundedChat({ documents: [DOCUMENT], prompt: CONSUMER_KB_PROMPT, question: "Which operator has the most active clients?", transport });
        assert.equal(answer, null);
      } finally {
        restore();
      }
      const declined = records.find((record) => record.code === KB_REFUSAL_CODES.SUPERVISOR_DECLINED);
      assert.ok(declined, `${reason} produced no route-failure record`);
      assert.equal(declined.causeCode, reason, `${reason} was logged as ${String(declined.causeCode)}`);
    }
  });

  it("hands the reason to the caller that has to choose what the reader is told", async () => {
    const seen: Array<{ code: string; reason: KbSupervisorReason | null }> = [];
    const { transport } = reviewing({ approved: false, reason: "incomplete" });
    await runGroundedChat({
      documents: [DOCUMENT],
      onFailure: (code, detail) => { seen.push({ code, reason: detail?.reason ?? null }); },
      prompt: CONSUMER_KB_PROMPT,
      question: "Which operator has the most active clients?",
      transport,
    });
    assert.deepEqual(seen, [{ code: KB_REFUSAL_CODES.SUPERVISOR_DECLINED, reason: "incomplete" }]);
  });
});

describe("a badly written answer is not a policy refusal", () => {
  it("maps every reason to a real outcome and offers the retry only where one can help", () => {
    const outcomes = new Map<KbSupervisorReason, ReturnType<typeof groundedFailureOutcome>>();
    for (const reason of DECLINE_REASONS) {
      outcomes.set(reason, groundedFailureOutcome(KB_REFUSAL_CODES.SUPERVISOR_DECLINED, reason));
    }
    assert.equal(outcomes.size, DECLINE_REASONS.length, "a reason in the vocabulary has no outcome");

    // An answer that left records out can come back complete; a rule that held
    // will hold again. The first must be retryable and the second must not.
    assert.equal(assistantErrorIsRetryable(outcomes.get("incomplete")!), true, "an incomplete answer tells the reader not to try again");
    assert.equal(assistantErrorIsRetryable(outcomes.get("forecast_or_guarantee")!), false, "a compliance refusal invites a retry that must fail");
    assert.equal(outcomes.get("forecast_or_guarantee"), "ASSISTANT_POLICY_REFUSED");
    assert.notEqual(outcomes.get("incomplete"), "ASSISTANT_POLICY_REFUSED");

    // A decline with no recorded reason keeps the conservative classification.
    assert.equal(groundedFailureOutcome(KB_REFUSAL_CODES.SUPERVISOR_DECLINED, null), "ASSISTANT_POLICY_REFUSED");
  });
});
