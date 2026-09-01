import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ChatRequest } from "../llm/chat-transport.ts";
import { OpenRouterDriverError } from "../llm/chat-transport.ts";
import { createMockChatTransport } from "../llm/mock-chat-transport.ts";
import {
  KB_REVISION_NOTES,
  KB_STRUCTURAL_RETRY_NOTES,
  KB_SUPERVISOR_REVISABLE_REASONS,
  runGroundedChat,
  type GroundingDocument,
  type KbRefusalCode,
} from "./chat-driver.ts";
import { issueGroundingHandles } from "./handles.ts";
import { OPERATOR_KB_PROMPT } from "./prompts.ts";

// Measured live on 2026-08-23 (production ad54e70, correlation
// 556edc35-4ae5-4ad0-bc8e-1c7a87df7354): both drafts of the original operator
// question wrote a document handle into a bullet, and the retry between them
// re-sent the identical request, so the model repeated the mistake and the
// turn died on our own leak gate. A retry that names the defect is the fix;
// these cases pin the note each structural gate feeds the second attempt.

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

/** First candidate draft is structurally broken per `defect`; every later draft is clean. */
function transportFailingOnce(defect: keyof typeof KB_STRUCTURAL_RETRY_NOTES) {
  const candidates: ChatRequest[] = [];
  const verdicts: ChatRequest[] = [];
  const failures: KbRefusalCode[] = [];
  const transport = createMockChatTransport((request) => {
    if (request.operation.endsWith("candidate")) {
      candidates.push(request);
      const handles = handlesIn(request);
      if (candidates.length === 1 && defect === "identifier_leaked") {
        // uuid-shaped, not a handle mention: a handle mention is repaired in
        // place now, and only an unrepairable identifier reaches the retry.
        return { bullets: ["Jordan Newcomer Demo (123e4567-e89b-12d3-a456-426614174000) is at 99%."], citations: [{ id: handles[0] }], headline: "One client leads." };
      }
      if (candidates.length === 1) {
        return { bullets: ["Jordan Newcomer Demo is at 99%."], citations: [{ id: "tracker:0" }], headline: "One client leads." };
      }
      return { bullets: ["Jordan Newcomer Demo is at 99%.", "Casey Clean Demo is at 92%."], citations: handles.map((id) => ({ id })), headline: "Two clients are closest to funding." };
    }
    verdicts.push(request);
    return { approved: true, reason: "approved" };
  });
  const run = () => runGroundedChat({
    documents: DOCUMENTS,
    onFailure: (code) => failures.push(code),
    prompt: OPERATOR_KB_PROMPT,
    question: "Which clients are closest to funding?",
    transport,
  });
  return { candidates, failures, run, verdicts };
}

describe("handle mentions are repaired, not refused", () => {
  // Measured on the live deployment, 2026-08-23: the retry that merely
  // re-asked failed twice in a row (correlation 556edc35), and after it gained
  // a corrective note the same class still killed three turns in one walk
  // (8bf63863, 2a340bb2, 007acc04) — the model likes writing its citation
  // alias into the prose, and no prompt has reliably stopped it. The handle is
  // this process's own alias for a record it can name, so the deterministic
  // translation back to the title closes the class where persuasion could not.

  it("rewrites every issued handle to its document's title, derived from the table itself", () => {
    const handles = issueGroundingHandles(DOCUMENTS);
    for (const document of handles.visible) {
      assert.equal(handles.rewrite(`${document.title} (${document.id})`), document.title, "a decorative wrapping collapses instead of doubling the name");
      assert.equal(handles.rewrite(`${document.id} is closest.`), `${document.title} is closest.`, "a bare mention becomes the title");
      assert.ok(!handles.leaks(handles.rewrite(`${document.id} and (${document.id})`)), "nothing the rewrite returns can trip the leak gate");
    }
    const invented = `doc-${DOCUMENTS.length + 41}`;
    assert.equal(handles.rewrite(`${invented} stays.`), `${invented} stays.`, "a handle the table never issued is not this table's to translate");
  });

  it("returns a first draft that mentioned a handle, repaired, without consuming a retry", async () => {
    const candidates: ChatRequest[] = [];
    const failures: KbRefusalCode[] = [];
    const transport = createMockChatTransport((request) => {
      if (!request.operation.endsWith("candidate")) return { approved: true, reason: "approved" };
      candidates.push(request);
      const handles = handlesIn(request);
      return { bullets: [`Jordan Newcomer Demo (${handles[0]}) is at 99%.`, `${handles[1]} is at 92%.`], citations: handles.map((id) => ({ id })), headline: "Two clients are closest to funding." };
    });
    const answer = await runGroundedChat({ documents: DOCUMENTS, onFailure: (code) => failures.push(code), prompt: OPERATOR_KB_PROMPT, question: "Which clients are closest to funding?", transport });
    assert.notEqual(answer, null, "the repaired draft is the answer");
    assert.equal(candidates.length, 1, "repair costs no retry");
    assert.deepEqual(failures, []);
    const table = issueGroundingHandles(DOCUMENTS);
    for (const bullet of answer!.bullets) {
      assert.ok(!table.leaks(bullet), `a handle survived into: ${bullet}`);
    }
    assert.ok(answer!.bullets.some((bullet) => bullet.includes(table.visible[1]!.title)), "the bare mention was translated to the record's title, not dropped");
  });

  it("still refuses a uuid-shaped identifier, which no table can translate", async () => {
    const failures: KbRefusalCode[] = [];
    let drafts = 0;
    const transport = createMockChatTransport((request) => {
      if (!request.operation.endsWith("candidate")) return { approved: true, reason: "approved" };
      drafts += 1;
      const handles = handlesIn(request);
      return { bullets: ["Client 123e4567-e89b-12d3-a456-426614174000 is at 99%."], citations: [{ id: handles[0] }], headline: "One client leads." };
    });
    assert.equal(await runGroundedChat({ documents: DOCUMENTS, onFailure: (code) => failures.push(code), prompt: OPERATOR_KB_PROMPT, question: "Which clients are closest to funding?", transport }), null);
    assert.equal(drafts, 2, "the uuid path still gets its one structural retry");
    assert.deepEqual(failures, ["KB_CANDIDATE_IDENTIFIER_LEAKED"]);
  });
});

describe("the structural retry note", () => {
  it("exists for exactly the defects the candidate loop can detect itself, as fixed sentences", () => {
    const keys = Object.keys(KB_STRUCTURAL_RETRY_NOTES).sort();
    assert.deepEqual(keys, ["citation_unmatched", "identifier_leaked"]);
    for (const key of keys) {
      const note = KB_STRUCTURAL_RETRY_NOTES[key as keyof typeof KB_STRUCTURAL_RETRY_NOTES];
      assert.equal(typeof note, "string");
      assert.ok(note.length > 0);
    }
    assert.ok(Object.isFrozen(KB_STRUCTURAL_RETRY_NOTES));
  });

  for (const defect of Object.keys(KB_STRUCTURAL_RETRY_NOTES) as Array<keyof typeof KB_STRUCTURAL_RETRY_NOTES>) {
    it(`feeds the second draft the fixed sentence for "${defect}" instead of re-asking cold`, async () => {
      const { candidates, failures, run } = transportFailingOnce(defect);
      const answer = await run();
      assert.notEqual(answer, null, "the corrected second draft must be returned");
      assert.equal(candidates.length, 2, "one structural retry");
      assert.equal(userPayload(candidates[0]!).reviewNote, undefined, "the first draft carries no note");
      assert.equal(userPayload(candidates[1]!).reviewNote, KB_STRUCTURAL_RETRY_NOTES[defect], "the retry carries the table's fixed sentence, nothing model-written");
      assert.deepEqual(failures, [], "a defect the retry fixed is not reported");
    });

    it(`keeps the reviewer cold after a "${defect}" retry`, async () => {
      const { run, verdicts } = transportFailingOnce(defect);
      await run();
      assert.equal(verdicts.length, 1);
      assert.ok(!JSON.stringify(verdicts[0]!.messages).includes(KB_STRUCTURAL_RETRY_NOTES[defect]), "the reviewer's payload carries nothing from the note");
    });
  }

  it("joins the revision note and the structural note when the revised draft is itself broken", async () => {
    const reason = KB_SUPERVISOR_REVISABLE_REASONS[0]!;
    const candidates: ChatRequest[] = [];
    let verdicts = 0;
    const transport = createMockChatTransport((request) => {
      if (request.operation.endsWith("candidate")) {
        candidates.push(request);
        const handles = handlesIn(request);
        // Draft 1 clean → declined by the reviewer; revision draft 1 leaks an
        // unrepairable uuid-shaped identifier; revision draft 2 clean → approved.
        if (candidates.length === 2) {
          return { bullets: ["Jordan Newcomer Demo (123e4567-e89b-12d3-a456-426614174000) is at 99%."], citations: [{ id: handles[0] }], headline: "One client leads." };
        }
        return { bullets: ["Jordan Newcomer Demo is at 99%.", "Casey Clean Demo is at 92%."], citations: handles.map((id) => ({ id })), headline: "Two clients are closest to funding." };
      }
      verdicts += 1;
      return verdicts === 1 ? { approved: false, reason } : { approved: true, reason: "approved" };
    });
    const answer = await runGroundedChat({ documents: DOCUMENTS, onFailure: () => {}, prompt: OPERATOR_KB_PROMPT, question: "Which clients are closest to funding?", transport });
    assert.notEqual(answer, null);
    assert.equal(candidates.length, 3);
    assert.equal(userPayload(candidates[1]!).reviewNote, KB_REVISION_NOTES[reason], "the revision opens with the reviewer's note alone");
    assert.equal(userPayload(candidates[2]!).reviewNote, `${KB_REVISION_NOTES[reason]} ${KB_STRUCTURAL_RETRY_NOTES.identifier_leaked}`, "a broken revision draft gets both fixed sentences");
  });

  it("gives the summarizing shape a budget that survives this model's reasoning tokens", async () => {
    const { candidates, run } = transportFailingOnce("identifier_leaked");
    await run();
    // 900 truncated live (correlation ef948131), and so did the first raise to
    // 1,600 (023d6256) — reasoning tokens bill against the same allowance and
    // their length does not follow the answer's size. The floor is the fix.
    assert.ok(candidates[0]!.maxTokens >= 4_000, `non-ledger candidate budget ${candidates[0]!.maxTokens} must be at least 4000`);
  });

  it("gives the ledger shape constant reasoning headroom on top of its per-record budget", async () => {
    // The ledger's 400 + 110n budgeted only the answer itself; with a handful
    // of applications the whole allowance was near what reasoning alone costs,
    // and the live walk died OPENROUTER_TRUNCATED on
    // kb.operator-application-ledger-answer (2026-08-23, correlation f7dff891).
    const candidates: ChatRequest[] = [];
    const transport = createMockChatTransport((request) => {
      if (request.operation.endsWith("candidate")) {
        candidates.push(request);
        const handles = handlesIn(request);
        return { headline: "Both applications are placed.", items: handles.map((id) => ({ id, detail: "Submitted and waiting on the lender." })) };
      }
      return { approved: true, reason: "approved" };
    });
    await runGroundedChat({ documentLedger: true, documents: DOCUMENTS, onFailure: () => {}, prompt: OPERATOR_KB_PROMPT, question: "Where does each application stand?", transport });
    assert.equal(candidates.length, 1);
    assert.ok(candidates[0]!.maxTokens - DOCUMENTS.length * 110 >= 2_400, `ledger budget ${candidates[0]!.maxTokens} for ${DOCUMENTS.length} records leaves less than 2400 tokens of constant headroom`);
  });

  it("treats a truncated draft as a failed attempt, not an outage", async () => {
    // The fees question truncated at a 4,000-token ceiling on the final walk
    // (correlation f9693c61) after answering cleanly on the three walks before
    // it — reasoning length varies per attempt, so one more draft usually
    // lands. A second truncation is still the outage path.
    let drafts = 0;
    const failures: KbRefusalCode[] = [];
    const transport = createMockChatTransport((request) => {
      if (!request.operation.endsWith("candidate")) return { approved: true, reason: "approved" };
      drafts += 1;
      if (drafts === 1) throw new OpenRouterDriverError({ attempt: 1, code: "OPENROUTER_TRUNCATED", operation: request.operation, status: 200 });
      const handles = handlesIn(request);
      return { bullets: ["Jordan Newcomer Demo is at 99%."], citations: [{ id: handles[0] }], headline: "One client leads." };
    });
    const answer = await runGroundedChat({ documents: DOCUMENTS, onFailure: (code) => failures.push(code), prompt: OPERATOR_KB_PROMPT, question: "Which clients are closest to funding?", transport });
    assert.notEqual(answer, null, "the second draft is the answer");
    assert.equal(drafts, 2);
    assert.deepEqual(failures, [], "a truncation the retry recovered is not reported");

    let always = 0;
    const failuresFinal: KbRefusalCode[] = [];
    const truncating = createMockChatTransport((request) => {
      if (!request.operation.endsWith("candidate")) return { approved: true, reason: "approved" };
      always += 1;
      throw new OpenRouterDriverError({ attempt: 1, code: "OPENROUTER_TRUNCATED", operation: request.operation, status: 200 });
    });
    assert.equal(await runGroundedChat({ documents: DOCUMENTS, onFailure: (code) => failuresFinal.push(code), prompt: OPERATOR_KB_PROMPT, question: "Which clients are closest to funding?", transport: truncating }), null);
    assert.equal(always, 2, "the retry is bounded by the attempt limit");
    assert.deepEqual(failuresFinal, ["KB_ANSWER_FAILED"], "persistent truncation is still the outage it always was");
  });

  it("gives every candidate an attempt window that covers its own token ceiling", async () => {
    // A budget the window cannot contain is a truncation with extra steps: the
    // 93ea508 walk raised the ceilings and promptly lost an admin turn to
    // OPENROUTER_TIMEOUT at the transport's default 30s (correlation
    // 01afe987). Derived from each request's own maxTokens at a conservative
    // 150 tokens/second, plus 15s of connection and queue overhead.
    const seen: ChatRequest[] = [];
    const transport = createMockChatTransport((request) => {
      if (!request.operation.endsWith("candidate")) return { approved: true, reason: "approved" };
      seen.push(request);
      const handles = handlesIn(request);
      return request.schemaName.includes("ledger")
        ? { headline: "Both applications are placed.", items: handles.map((id) => ({ id, detail: "Submitted." })) }
        : { bullets: ["Jordan Newcomer Demo is at 99%."], citations: [{ id: handles[0] }], headline: "One client leads." };
    });
    for (const documentLedger of [false, true]) {
      await runGroundedChat({ documentLedger, documents: DOCUMENTS, onFailure: () => {}, prompt: OPERATOR_KB_PROMPT, question: "Which clients are closest to funding?", transport });
    }
    assert.equal(seen.length, 2);
    for (const request of seen) {
      const needed = (request.maxTokens / 150) * 1_000 + 15_000;
      assert.ok((request.timeLimitMs ?? 30_000) >= needed, `${request.schemaName} budgets ${request.maxTokens} tokens but allows ${request.timeLimitMs ?? 30_000}ms — the window cannot contain its own ceiling`);
    }
  });
});
