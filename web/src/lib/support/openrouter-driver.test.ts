import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createMockChatTransport } from "../llm/mock-chat-transport.ts";
import { createOpenRouterSupportDraftDriver } from "./openrouter-driver.ts";

import type { ChatRequest } from "../llm/chat-transport.ts";
import type { SupportDraftContext } from "./types.ts";
import type { ResolvedPrompt } from "../admin/prompt-types.ts";

const CONTEXT: SupportDraftContext = { threadKind: "team_chat", threadSubject: "Current file", recentMessages: [{ authorKind: "consumer", body: "Can you share a status update?" }] };

describe("support chat transport adapter", () => {
  it("projects the closed context into strict candidate and supervisor requests", async () => {
    const requests: ChatRequest[] = [];
    const transport = createMockChatTransport((request) => {
      requests.push(request);
      return request.operation === "support.candidate"
        ? { body: "The team is reviewing the current step.", confidence: 0.86 }
        : { approved: true, codes: [] };
    }, "support-test-model");
    const driver = createOpenRouterSupportDraftDriver(transport);
    const candidate = await driver.generateDraft(CONTEXT);
    assert.deepEqual(candidate, { body: "The team is reviewing the current step.", confidence: 0.86, model: "support-test-model" });
    assert.deepEqual(await driver.superviseDraft(CONTEXT, candidate), { approved: true, codes: [] });
    assert.deepEqual(requests.map((request) => request.operation), ["support.candidate", "support.supervisor"]);
    for (const request of requests) {
      const schema = request.schema as Record<string, unknown>;
      assert.equal(schema.additionalProperties, false);
      const serialized = JSON.stringify(request.messages);
      for (const key of ["clientId", "profileId", "orgId", "email"]) assert.equal(serialized.includes(key), false);
    }
  });

  it("fails without producing a partial candidate", async () => {
    const driver = createOpenRouterSupportDraftDriver(createMockChatTransport(() => { throw new Error("transport failed"); }));
    await assert.rejects(driver.generateDraft(CONTEXT), /transport failed/);
  });

  it("uses a governed body and version only for the candidate instruction", async () => {
    const requests: ChatRequest[] = [];
    const transport = createMockChatTransport((request) => {
      requests.push(request);
      return request.operation === "support.candidate"
        ? { body: "The team is reviewing the current step.", confidence: 0.86 }
        : { approved: true, codes: [] };
    }, "support-test-model");
    const prompt: ResolvedPrompt = {
      key: "support-draft", version: 2, body: "Governed support prompt body", source: "database",
    };
    const driver = createOpenRouterSupportDraftDriver(transport);
    const candidate = await driver.generateDraft(CONTEXT, prompt);
    await driver.superviseDraft(CONTEXT, candidate, prompt);

    assert.equal(requests[0].messages[0].content, prompt.body);
    assert.equal(JSON.parse(requests[0].messages[1].content).prompt.version, 2);
    assert.notEqual(requests[1].messages[0].content, prompt.body);
    assert.equal(JSON.parse(requests[1].messages[1].content).prompt.version, 2);
  });
});
