// F-10. Every KB provider call, measured against the schema it has to fill.
//
// The owner measured ~30s for one consumer answer. Wall-clock latency cannot be
// validated from here — there is no OpenRouter key in this environment — so what
// this file validates is the half that is a property of the code rather than of
// the network: how many calls a question costs, and whether each budget is
// tight-but-sufficient rather than padded or starved.
//
// Both directions matter and they fail differently. A budget below what the
// schema can produce does not return a short answer, it returns a harmony
// fragment with no JSON in it — the outage `OPENROUTER_TRUNCATED` was added for.
// A budget far above it is latency and cost nobody asked for, because the model
// generates reasoning against the same allowance. So the bound is derived from
// the schema at test time, and a future tightening that crosses it fails here
// instead of in production.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createMockChatTransport } from "../llm/mock-chat-transport.ts";
import type { ChatRequest } from "../llm/chat-transport.ts";
import { createConsumerKbAnswer } from "./consumer.ts";
import { HASH64_SIMILARITY_THRESHOLD, type KbRetrieval } from "./retrieval.ts";
import { createKbRetrieval } from "./retrieval.ts";
import type { KbArticleMatch } from "./search.ts";

/**
 * The largest JSON a schema can legally produce, in characters.
 *
 * Walks the schema rather than reading a number off it, so a schema that grows a
 * field or widens a `maxLength` moves this bound without an edit here. Object
 * keys, quotes, commas and braces are counted because the model pays for them
 * like any other token.
 */
function worstCaseChars(schema: unknown): number {
  if (typeof schema !== "object" || schema === null) return 0;
  const node = schema as Record<string, unknown>;
  switch (node.type) {
    case "string":
      return typeof node.maxLength === "number" ? node.maxLength + 2 : 64;
    case "integer":
    case "number":
      return 12;
    case "boolean":
      return 5;
    case "array": {
      const items = typeof node.maxItems === "number" ? node.maxItems : 8;
      return 2 + items * (worstCaseChars(node.items) + 1);
    }
    case "object": {
      const properties = (node.properties ?? {}) as Record<string, unknown>;
      return 2 + Object.entries(properties).reduce((total, [key, value]) => total + key.length + 4 + worstCaseChars(value) + 1, 0);
    }
    default:
      return 0;
  }
}

/** The industry rule of thumb, stated once: roughly four characters to a token for JSON-shaped English. */
function worstCaseTokens(schema: unknown): number {
  return Math.ceil(worstCaseChars(schema) / 4);
}

const match: KbArticleMatch = { id: "article:1", sourceArticleId: "source:1", title: "Records", body: "Keep current business records.", sourceUrl: "https://kb.example.test/records", metadata: {}, similarity: 0.9 };

function retrievalOf(matches: readonly KbArticleMatch[]): KbRetrieval {
  return { driver: "hash64", async retrieve() { return { scale: "hash64", similarityThreshold: HASH64_SIMILARITY_THRESHOLD, matches }; } };
}

function recorder(respond: (request: ChatRequest) => unknown) {
  const requests: ChatRequest[] = [];
  return {
    requests,
    transport: () => createMockChatTransport((request) => {
      requests.push(request);
      return respond(request);
    }),
  };
}

describe("KB request budgets (F-10)", () => {
  it("every KB call budgets at least what its own schema can produce", async () => {
    const answering = recorder((request) => {
      if (!request.operation.endsWith("candidate")) return { approved: true };
      const documents = (JSON.parse(request.messages[1]!.content) as { documents: Array<{ id: string }> }).documents;
      return { bullets: ["A supporting point."], citations: [{ id: documents[0]!.id }], headline: "An answer." };
    });
    await createConsumerKbAnswer("What records matter?", { retrieval: retrievalOf([match]), transport: answering.transport });

    const declining = recorder((request) => {
      if (!request.operation.endsWith("decline")) return { approved: true };
      const topics = (JSON.parse(request.messages[1]!.content) as { topics: Array<{ id: string }> }).topics;
      return { decline: "That is outside what the knowledge base covers.", topics: topics.map((topic) => ({ id: topic.id })) };
    });
    await createConsumerKbAnswer("Something else entirely", { retrieval: retrievalOf([{ ...match, similarity: 0.01 }]), transport: declining.transport });

    const scoring = recorder((request) => {
      const articles = (JSON.parse(request.messages[1]!.content) as { articles: Array<{ ref: string }> }).articles;
      return { scores: articles.map((article) => ({ ref: article.ref, relevance: 90 })) };
    });
    await createKbRetrieval({
      env: { KB_EMBEDDING_DRIVER: "llm_score", OPENROUTER_API_KEY: "configured" },
      index: { async search() { return [match]; } },
      transport: scoring.transport,
    }).retrieve("What records matter?", 6);

    const seen = [...answering.requests, ...declining.requests, ...scoring.requests];
    assert.ok(seen.length >= 5, "the four KB operations plus a supervisor must all have been exercised");
    for (const request of seen) {
      const needed = worstCaseTokens(request.schema);
      assert.ok(
        request.maxTokens >= needed,
        `${request.operation} budgets ${request.maxTokens} tokens for a schema that can produce ${needed} — a budget under the schema returns a truncated fragment, not a short answer`,
      );
      // The ceiling is deliberately loose: it catches a budget that has lost its
      // connection to the schema, not one that is merely comfortable.
      assert.ok(
        request.maxTokens <= Math.max(needed * 6, 256),
        `${request.operation} budgets ${request.maxTokens} tokens for a schema that can produce ${needed} — the model generates reasoning against the same allowance, so the surplus is latency`,
      );
    }
  });

  it("costs the round trips it looks like it costs", async () => {
    // The number nobody could see before: an answered consumer question is two
    // sequential supervised calls, and a declined one is two more. Written down
    // so that a change adding a third is a decision somebody made rather than a
    // latency regression discovered in production.
    const answering = recorder((request) => {
      if (!request.operation.endsWith("candidate")) return { approved: true };
      const documents = (JSON.parse(request.messages[1]!.content) as { documents: Array<{ id: string }> }).documents;
      return { bullets: [], citations: [{ id: documents[0]!.id }], headline: "An answer." };
    });
    const answered = await createConsumerKbAnswer("What records matter?", { retrieval: retrievalOf([match]), transport: answering.transport });
    assert.equal(answered.status, "answered");
    assert.deepEqual(answering.requests.map((request) => request.operation), ["consumer-kb-answer.candidate", "kb-answer-supervisor.review"]);

    const declining = recorder((request) => {
      if (!request.operation.endsWith("decline")) return { approved: true };
      const topics = (JSON.parse(request.messages[1]!.content) as { topics: Array<{ id: string }> }).topics;
      return { decline: "That is outside what the knowledge base covers.", topics: topics.map((topic) => ({ id: topic.id })) };
    });
    const declined = await createConsumerKbAnswer("Something else entirely", { retrieval: retrievalOf([{ ...match, similarity: 0.01 }]), transport: declining.transport });
    assert.equal(declined.status, "insufficient_grounding");
    assert.deepEqual(declining.requests.map((request) => request.operation), ["consumer-kb-decline.decline", "kb-decline-supervisor.review"]);
  });
});
