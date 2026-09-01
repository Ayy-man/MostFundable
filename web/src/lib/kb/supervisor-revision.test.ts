import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ChatRequest } from "../llm/chat-transport.ts";
import { createMockChatTransport } from "../llm/mock-chat-transport.ts";
import {
  KB_REVISION_NOTES,
  KB_SUPERVISOR_REASONS,
  KB_SUPERVISOR_REVISABLE_REASONS,
  SUPERVISOR_ROUND_LIMIT,
  runGroundedChat,
  type GroundingDocument,
  type KbRefusalCode,
  type KbRefusalDetail,
  type KbSupervisorReason,
} from "./chat-driver.ts";
import { OPERATOR_KB_PROMPT } from "./prompts.ts";

// The live walk on 2026-08-23 (production 8d7cd03, correlation
// 59b8ece4-d7e9-485e-955a-02e3e48de651): the reviewer declined, with reason
// `unsupported_statement`, the same grounded readiness comparison it had
// approved on the same records two hours earlier. A reviewer that names a
// sentence has named something a second draft can fix; these cases pin the
// one-revision round that gives it that draft, and the reasons that do not.

const DOCUMENTS: readonly GroundingDocument[] = [
  { content: JSON.stringify({ clientName: "Jordan Newcomer Demo", readiness: 99, stage: "Optimization" }), id: "tracker:0", label: "Client · Jordan Newcomer Demo", metadata: { kind: "client" }, title: "Client · Jordan Newcomer Demo", url: "" },
  { content: JSON.stringify({ clientName: "Casey Clean Demo", readiness: 92, stage: "Optimization" }), id: "tracker:1", label: "Client · Casey Clean Demo", metadata: { kind: "client" }, title: "Client · Casey Clean Demo", url: "" },
];

function handlesIn(request: ChatRequest): readonly string[] {
  const body = JSON.parse(request.messages[1]!.content) as { documents: Array<{ id: string }> };
  return body.documents.map((document) => document.id);
}

function userPayload(request: ChatRequest): Record<string, unknown> {
  return JSON.parse(request.messages[1]!.content) as Record<string, unknown>;
}

/** A reviewer that declines with `reason` on its first verdict and approves every later one. */
function reviewerDecliningOnce(reason: KbSupervisorReason) {
  const candidates: ChatRequest[] = [];
  const verdicts: ChatRequest[] = [];
  const failures: Array<{ code: KbRefusalCode; detail?: KbRefusalDetail }> = [];
  const transport = createMockChatTransport((request) => {
    if (request.operation.endsWith("candidate")) {
      candidates.push(request);
      const handles = handlesIn(request);
      return { bullets: ["Jordan Newcomer Demo is at 99%.", "Casey Clean Demo is at 92%."], citations: handles.map((id) => ({ id })), headline: "Two clients are closest to funding." };
    }
    verdicts.push(request);
    return verdicts.length === 1 ? { approved: false, reason } : { approved: true, reason: "approved" };
  });
  const run = () => runGroundedChat({
    documents: DOCUMENTS,
    onFailure: (code, detail) => failures.push({ code, detail }),
    prompt: OPERATOR_KB_PROMPT,
    question: "Which clients are closest to funding?",
    transport,
  });
  return { candidates, failures, run, verdicts };
}

describe("the supervisor's one revision round", () => {
  it("exposes a revisable vocabulary that is a strict subset of the reviewer's reasons, and never includes a compliance rule", () => {
    assert.ok(KB_SUPERVISOR_REVISABLE_REASONS.length > 0);
    for (const reason of KB_SUPERVISOR_REVISABLE_REASONS) {
      assert.ok((KB_SUPERVISOR_REASONS as readonly string[]).includes(reason), `${reason} is not a reviewer reason`);
      assert.equal(typeof KB_REVISION_NOTES[reason], "string");
    }
    for (const rule of ["identifier_exposed", "forecast_or_guarantee", "instruction_outside_records", "approved"] as const) {
      assert.ok(!(KB_SUPERVISOR_REVISABLE_REASONS as readonly string[]).includes(rule), `${rule} must not buy a second draft`);
    }
    assert.equal(SUPERVISOR_ROUND_LIMIT, 2, "one first draft plus one revision");
  });

  for (const reason of KB_SUPERVISOR_REVISABLE_REASONS) {
    it(`composes one more draft carrying the fixed note for "${reason}", and the reviewer reads it cold`, async () => {
      const { candidates, failures, run, verdicts } = reviewerDecliningOnce(reason);
      const answer = await run();
      assert.notEqual(answer, null, "the revised draft was approved and must be returned");
      assert.equal(candidates.length, 2, "exactly one revision");
      assert.equal(verdicts.length, 2, "each draft reviewed once");
      assert.equal(userPayload(candidates[0]!).reviewNote, undefined, "the first draft carries no note");
      assert.equal(userPayload(candidates[1]!).reviewNote, KB_REVISION_NOTES[reason], "the note is the table's fixed sentence for the reason");
      assert.ok(!("reviewNote" in userPayload(verdicts[1]!)), "the reviewer never sees the note");
      assert.ok(!JSON.stringify(verdicts[1]!.messages).includes("previous draft"), "the reviewer's payload carries nothing from the note");
      assert.deepEqual(failures, [], "a decline that was revised is not reported as a failure");
    });
  }

  it("keeps the same candidate schema and budget for the revision", async () => {
    const { candidates, run } = reviewerDecliningOnce(KB_SUPERVISOR_REVISABLE_REASONS[0]!);
    await run();
    assert.equal(candidates[1]!.schemaName, candidates[0]!.schemaName);
    assert.deepEqual(candidates[1]!.schema, candidates[0]!.schema);
    assert.equal(candidates[1]!.maxTokens, candidates[0]!.maxTokens);
  });

  for (const reason of KB_SUPERVISOR_REASONS.filter((r) => r !== "approved" && !(KB_SUPERVISOR_REVISABLE_REASONS as readonly string[]).includes(r))) {
    it(`is final on the first verdict for "${reason}"`, async () => {
      const { candidates, failures, run, verdicts } = reviewerDecliningOnce(reason);
      assert.equal(await run(), null);
      assert.equal(candidates.length, 1, "no second draft for a rule");
      assert.equal(verdicts.length, 1);
      assert.deepEqual(failures, [{ code: "KB_SUPERVISOR_DECLINED", detail: { reason } }]);
    });
  }

  it("is final after the revision round even for a revisable reason", async () => {
    const reason = KB_SUPERVISOR_REVISABLE_REASONS[0]!;
    let verdicts = 0;
    const failures: Array<{ code: KbRefusalCode; detail?: KbRefusalDetail }> = [];
    const transport = createMockChatTransport((request) => {
      if (request.operation.endsWith("candidate")) {
        const handles = handlesIn(request);
        return { bullets: ["Jordan Newcomer Demo is at 99%."], citations: [{ id: handles[0] }], headline: "One client leads." };
      }
      verdicts += 1;
      return { approved: false, reason };
    });
    const answer = await runGroundedChat({ documents: DOCUMENTS, onFailure: (code, detail) => failures.push({ code, detail }), prompt: OPERATOR_KB_PROMPT, question: "Which clients are closest to funding?", transport });
    assert.equal(answer, null);
    assert.equal(verdicts, SUPERVISOR_ROUND_LIMIT);
    assert.deepEqual(failures, [{ code: "KB_SUPERVISOR_DECLINED", detail: { reason } }]);
  });
});
