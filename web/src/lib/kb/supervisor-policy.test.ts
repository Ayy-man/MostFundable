import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { complianceLanguageCodes } from "../compliance/language-rules.mjs";
import type { ChatRequest, ChatTransport } from "../llm/chat-transport.ts";
import { createMockChatTransport } from "../llm/mock-chat-transport.ts";
import { KB_REFUSAL_CODES, runGroundedChat, runGroundedDecline, type GroundingDocument, type KbRefusalCode } from "./chat-driver.ts";
import { CONSUMER_KB_DECLINE_PROMPT, CONSUMER_KB_PROMPT, KB_DECLINE_SUPERVISOR_PROMPT, KB_SUPERVISOR_PROMPT, OPERATOR_KB_PROMPT } from "./prompts.ts";

const document: GroundingDocument = {
  id: "record:one",
  title: "Client record · Avery Current",
  label: "Client record · Avery Current",
  url: "/workspace/clients/one",
  content: "Avery Current has verified readiness 82 and is in review.",
  metadata: {},
};

describe("KB supervisor policy", () => {
  it("makes grounded derivations passable without treating the question as evidence", () => {
    assert.ok(KB_SUPERVISOR_PROMPT.version >= 2, "the grounded-derivation wording landed in v2 and must not be rolled back");
    assert.match(KB_SUPERVISOR_PROMPT.system, /every factual statement/i);
    assert.match(KB_SUPERVISOR_PROMPT.system, /comparison, ordering, summary, or calculation/i);
    assert.match(KB_SUPERVISOR_PROMPT.system, /question itself is never evidence/i);

    // v4: presenting a supplied value in the question's everyday wording is a
    // restatement, not a new fact — the live reviewer declined, as
    // unsupported_statement, the same grounded readiness ordering it had
    // approved on the same records two hours earlier (2026-08-23, correlation
    // 81b8f6b4), because "closest to funding" reads as a claim the documents
    // never spell out even though the ordering behind it is fully supplied.
    assert.ok(KB_SUPERVISOR_PROMPT.version >= 4, "the everyday-wording clause landed in v4 and must not be rolled back");
    assert.match(KB_SUPERVISOR_PROMPT.system, /everyday wording may present a supplied value/i);
    assert.match(KB_SUPERVISOR_PROMPT.system, /wording alone is never an unsupported statement/i);

    for (const requiredRefusal of [
      /unsupported statement/i,
      /invented or exposed identifier/i,
      /instruction outside the verified records/i,
      /personalized lending-outcome forecast, probability, or guarantee/i,
    ]) assert.match(KB_SUPERVISOR_PROMPT.system, requiredRefusal);
  });

  it("permits only coverage-boundary declines and keeps subject help fail-closed", () => {
    assert.equal(KB_DECLINE_SUPERVISOR_PROMPT.version, 2);
    assert.match(KB_DECLINE_SUPERVISOR_PROMPT.system, /permitted boundary statements/i);
    assert.match(KB_DECLINE_SUPERVISOR_PROMPT.system, /need not be named by or supported by the listed topic titles/i);
    assert.doesNotMatch(KB_DECLINE_SUPERVISOR_PROMPT.system, /asserts anything the listed topics do not name/i);

    for (const requiredRefusal of [
      /any fact about the question's subject/i,
      /even partially or with a hedge/i,
      /hint, recommendation, advice, or next step/i,
      /exposes an identifier/i,
      /personalized lending-outcome forecast, probability, or guarantee/i,
    ]) assert.match(KB_DECLINE_SUPERVISOR_PROMPT.system, requiredRefusal);
  });

  it("binds the v2 policies to the existing closed supervisor payloads", async () => {
    const requests: ChatRequest[] = [];
    const transport = createMockChatTransport((request) => {
      requests.push(request);
      if (request.operation.endsWith("candidate")) {
        const body = JSON.parse(request.messages[1]!.content) as { documents: Array<{ id: string }> };
        return { headline: "Avery Current is in review.", bullets: ["Verified readiness is 82."], citations: [{ id: body.documents[0]!.id }] };
      }
      if (request.operation.endsWith("decline")) {
        const body = JSON.parse(request.messages[1]!.content) as { topics: Array<{ id: string }> };
        return { decline: "I cannot answer that from the verified knowledge base.", topics: [{ id: body.topics[0]!.id }] };
      }
      return { approved: true };
    });

    const answer = await runGroundedChat({ question: "Who is in review?", documents: [document], transport, prompt: CONSUMER_KB_PROMPT });
    const decline = await runGroundedDecline({ question: "What is tomorrow's weather?", topics: [{ ...document, title: "Business records", label: "Business records", content: "Business records" }], transport, prompt: CONSUMER_KB_DECLINE_PROMPT });
    assert.notEqual(answer, null);
    assert.notEqual(decline, null);

    const answerReview = requests.find((request) => request.operation === "kb-answer-supervisor.review");
    const declineReview = requests.find((request) => request.operation === "kb-decline-supervisor.review");
    assert.ok(answerReview);
    assert.ok(declineReview);
    assert.equal(answerReview.schemaName, `${KB_SUPERVISOR_PROMPT.key}-v${KB_SUPERVISOR_PROMPT.version}`);
    assert.equal(declineReview.schemaName, "kb-decline-supervisor-v2");
    assert.equal(answerReview.messages[0]?.content, KB_SUPERVISOR_PROMPT.system);
    assert.equal(declineReview.messages[0]?.content, KB_DECLINE_SUPERVISOR_PROMPT.system);
    assert.deepEqual(Object.keys(JSON.parse(answerReview.messages[1]!.content)).sort(), ["candidate", "documents", "question"]);
    assert.deepEqual(Object.keys(JSON.parse(declineReview.messages[1]!.content)).sort(), ["question", "reply", "topics"]);
  });
});

/**
 * The class the v2 supervisor policy exists to serve, driven rather than read.
 *
 * The three tests above assert the prompt *text*, which is an enumeration
 * standing in for a class — the round-5 standard's named failure mode. They are
 * kept, not deleted, because they are today the only thing in the tree that
 * fails on the pre-fix prompt module; what was missing beside them is a test
 * that drives `runGroundedChat` over the shape of candidate the production
 * supervisor actually declined, and asserts the driver's behaviour rather than
 * the reviewer's wording.
 *
 * What these prove and what they cannot. A fake transport stands in for the
 * model, so nothing here exercises the reviewer's judgment — only a live model
 * can prove that the v2 wording approves a grounded comparison that v1 refused.
 * What is proved deterministically is the surrounding machinery the fix also
 * moved, and every part of it is derived at test time from the module under
 * test:
 *
 *   * the reviewer is shown the question, the same handle table the composer
 *     was shown, and the candidate verbatim — the payload keys are compared
 *     against the values this test passed in, not against transcribed strings.
 *     `36d4d69^` sent `{ documents, candidate }` with no question at all, which
 *     is precisely why a compliant comparison read as unsupported: the reviewer
 *     was asked whether the answer followed from the records without being told
 *     what had been asked.
 *   * an approval yields the candidate's own headline, bullets and resolved
 *     citations, and reports no refusal code.
 *   * a decline yields null under `SUPERVISOR_DECLINED`, read off the exported
 *     refusal table.
 *   * the loosening did not reach the compliance rail: a comparison carrying a
 *     numeric score-gain promise or a personalized approval percentage is still
 *     refused, and refused *before* the reviewer is asked. The test does not
 *     assume those two strings are prohibited — it asks
 *     `complianceLanguageCodes` at test time, so a rule that stopped flagging
 *     them fails this test instead of quietly emptying it.
 */

interface ComparisonClient { readonly name: string; readonly stage: string; readonly readiness: number }

/** The grounded comparison from the production incident: named clients, recorded readiness, nothing derived from the question. */
const COMPARISON_CLIENTS: readonly ComparisonClient[] = [
  { name: "Jordan Newcomer Demo", readiness: 99, stage: "Optimization" },
  { name: "Casey Clean Demo", readiness: 92, stage: "Ready" },
  { name: "Morgan Ready Demo", readiness: 88, stage: "Ready" },
];

const COMPARISON_QUESTION = "Which of my clients has the highest verified readiness right now?";

const COMPARISON_DOCUMENTS: readonly GroundingDocument[] = COMPARISON_CLIENTS.map((client, index) => ({
  content: JSON.stringify({ name: client.name, stage: client.stage, verifiedReadiness: client.readiness }),
  id: `client:r:${index}`,
  label: `Client record · ${client.name}`,
  metadata: {},
  title: `Client record · ${client.name}`,
  url: `/operator/clients/${index}`,
}));

/** The handles the pipeline issued for this call, read off the request the way `chat-driver.test.ts` does — a literal here would be citing a real id the model is never shown. */
function handlesIn(request: ChatRequest): readonly { readonly id: string; readonly title: string; readonly content: string }[] {
  return (JSON.parse(request.messages[1]!.content) as { documents: Array<{ id: string; title: string; content: string }> }).documents;
}

/**
 * A candidate built from the same rows the documents were built from, with an
 * optional extra bullet for the non-compliant arms.
 *
 * Ordering and superlative are the parts the v1 reviewer had no way to accept:
 * "highest" is a fact about the set, not a sentence copied out of one record.
 */
function comparisonCandidate(handles: readonly { readonly id: string }[], extraBullet?: string) {
  const ranked = [...COMPARISON_CLIENTS].sort((left, right) => right.readiness - left.readiness);
  const bullets = ranked.map((client) => `${client.name} is recorded at verified readiness ${client.readiness} in ${client.stage}.`);
  return {
    bullets: extraBullet === undefined ? bullets : [...bullets, extraBullet],
    citations: handles.map((handle) => ({ id: handle.id })),
    headline: `${ranked[0]!.name} has the highest verified readiness of the three clients on file.`,
  };
}

function askComparison(transport: ChatTransport, onFailure?: (code: KbRefusalCode) => void) {
  return runGroundedChat({ documents: COMPARISON_DOCUMENTS, onFailure, prompt: OPERATOR_KB_PROMPT, question: COMPARISON_QUESTION, transport });
}

describe("KB supervisor gate, driven", () => {
  it("shows the reviewer the question, the composer's evidence and the candidate, and honours approval", async () => {
    const requests: ChatRequest[] = [];
    let returned: unknown = null;
    const transport = createMockChatTransport((request) => {
      requests.push(request);
      if (!request.operation.endsWith("candidate")) return { approved: true };
      returned = comparisonCandidate(handlesIn(request));
      return returned;
    });

    const failures: KbRefusalCode[] = [];
    const answer = await askComparison(transport, (code) => failures.push(code));

    const composed = requests.find((request) => request.operation === `${OPERATOR_KB_PROMPT.key}.candidate`);
    const review = requests.find((request) => request.operation === `${KB_SUPERVISOR_PROMPT.key}.review`);
    assert.ok(composed, "the composer was never asked");
    assert.ok(review, "the supervisor was never asked");

    // The reviewer's payload, compared against what this test supplied rather
    // than against transcribed keys. `36d4d69^` had no `question` here.
    const payload = JSON.parse(review.messages[1]!.content) as Record<string, unknown>;
    assert.equal(payload.question, COMPARISON_QUESTION);
    assert.deepEqual(payload.documents, handlesIn(composed), "the reviewer must judge the same evidence the composer saw");
    assert.deepEqual(payload.candidate, returned, "the reviewer must see the candidate verbatim");
    assert.equal(review.messages[0]?.content, KB_SUPERVISOR_PROMPT.system);
    assert.equal(review.schemaName, `${KB_SUPERVISOR_PROMPT.key}-v${KB_SUPERVISOR_PROMPT.version}`);

    // Approval yields the candidate's own words and resolves every handle back
    // to the record it stood for.
    const candidate = returned as { headline: string; bullets: readonly string[] };
    assert.equal(answer?.headline, candidate.headline);
    assert.deepEqual(answer === null ? null : [...answer.bullets], [...candidate.bullets]);
    assert.deepEqual(answer === null ? null : answer.citations.map((citation) => citation.id), COMPARISON_DOCUMENTS.map((document) => document.id));
    assert.deepEqual(answer === null ? null : answer.citations.map((citation) => citation.label), COMPARISON_DOCUMENTS.map((document) => document.label));
    assert.deepEqual(failures, [], "an approved answer must report no refusal");
    // The comparison itself is compliant copy, derived from the rule module
    // rather than assumed, so the arms below isolate the language rail.
    assert.deepEqual(complianceLanguageCodes(candidate), []);
  });

  it("honours a decline under the supervisor's own refusal code", async () => {
    let supervisorCalls = 0;
    const transport = createMockChatTransport((request) => {
      if (request.operation.endsWith("candidate")) return comparisonCandidate(handlesIn(request));
      supervisorCalls += 1;
      return { approved: false };
    });
    const failures: KbRefusalCode[] = [];
    assert.equal(await askComparison(transport, (code) => failures.push(code)), null);
    assert.equal(supervisorCalls, 1, "a declined candidate must not be re-composed and re-reviewed");
    assert.deepEqual(failures, [KB_REFUSAL_CODES.SUPERVISOR_DECLINED]);
  });

  it("still refuses a non-compliant comparison before the reviewer is asked", async () => {
    // A numeric score-gain promise and a personalized approval percentage, held
    // encoded so this file does not itself carry the vocabulary past
    // `verify-compliance-copy.mjs`.
    const prohibited = [
      atob("V2UgY2FuIGFkZCBmb3J0eSBmaXZlIHBvaW50cyB0byB5b3VyIHByb2ZpbGUu"),
      atob("QXBwbGljYW50cyBsaWtlIHlvdSBhcmUgYXBwcm92ZWQgaW4gZWlnaHR5LXR3byBwZXJjZW50IG9mIGNhc2VzLg=="),
    ];
    for (const bullet of prohibited) {
      // Derived, not assumed: the rule module says this string is prohibited.
      assert.notDeepEqual(complianceLanguageCodes({ bullet }), [], "the rule module no longer flags this arm's input");
      let supervisorCalls = 0;
      const transport = createMockChatTransport((request) => {
        if (request.operation.endsWith("candidate")) return comparisonCandidate(handlesIn(request), bullet);
        supervisorCalls += 1;
        return { approved: true };
      });
      const failures: KbRefusalCode[] = [];
      assert.equal(await askComparison(transport, (code) => failures.push(code)), null, "a prohibited bullet was answered");
      assert.equal(supervisorCalls, 0, "prohibited language must never reach the reviewer");
      assert.deepEqual(failures, [KB_REFUSAL_CODES.LANGUAGE_BLOCKED]);
    }
  });
});
