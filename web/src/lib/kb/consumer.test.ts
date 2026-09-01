import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ChatRequest, ChatTransport } from "../llm/chat-transport.ts";
import { createMockChatTransport } from "../llm/mock-chat-transport.ts";
import { CONSUMER_KB_STATIC_DECLINE, createConsumerKbAnswer } from "./consumer.ts";
import { HASH64_SIMILARITY_THRESHOLD, type KbRetrieval } from "./retrieval.ts";
import type { KbArticleMatch } from "./search.ts";

const match = { id: "article:1", sourceArticleId: "source:1", title: "Records", body: "Keep current records.", sourceUrl: "https://example.test/records", metadata: { category: "basics" }, similarity: 0.9 };

/** A model that writes a decline and offers every topic it was shown, recording what it was asked so the gate order can be asserted. */
function declineTransport(requests: ChatRequest[]): ChatTransport {
  return createMockChatTransport((request) => {
    requests.push(request);
    if (!request.operation.endsWith("decline")) return { approved: true };
    const body = JSON.parse(request.messages[1]!.content) as { topics: Array<{ id: string }> };
    return { decline: "That is outside what the knowledge base covers.", topics: body.topics.map((topic) => ({ id: topic.id })) };
  });
}

/** The rows a retrieval returned, on the hash arm's scale — the gate these tests are about is the one every environment runs today. */
function retrievalOf(matches: readonly KbArticleMatch[]): KbRetrieval {
  return { driver: "hash64", async retrieve() { return { scale: "hash64", similarityThreshold: HASH64_SIMILARITY_THRESHOLD, matches }; } };
}

describe("consumer KB", () => {
  /**
   * This test used to assert the opposite — that no transport was constructed at
   * all when nothing cleared the gate, on the argument that a refusal must not
   * cost a round trip. The owner overruled that on 2026-08-22: one fixed
   * sentence for every unmatched question reads as a broken control, and the
   * decline is now written and gated like any other consumer-facing output.
   *
   * What survives unchanged is the part that was actually load-bearing: the
   * status stays `insufficient_grounding`, nothing is cited, and the reply is
   * still a refusal. The cost property is gone deliberately, so it is asserted
   * in its new form — the decline path is reached, and it is reached only when
   * there is something to offer.
   */
  it("writes a decline when nothing clears the gate, and offers only knowledge-base topics", async () => {
    for (const rows of [[{ ...match, similarity: 0.01 }], [{ ...match, similarity: 0.01 }, { ...match, id: "article:2", sourceArticleId: "source:2", title: "Statements", similarity: 0.005 }]]) {
      const requests: ChatRequest[] = [];
      const result = await createConsumerKbAnswer("What records matter?", { retrieval: retrievalOf(rows), transport: () => declineTransport(requests) });
      assert.equal(result.status, "insufficient_grounding");
      assert.equal(result.identity, "AI assistant");
      assert.deepEqual(result.citations, []);
      // Generated, not the constant — and carrying the titles retrieval actually
      // returned, derived from the rows rather than written down here.
      assert.notEqual(result.answer, CONSUMER_KB_STATIC_DECLINE);
      for (const row of rows) assert.ok(result.answer.includes(row.title), `the decline must offer ${row.title}`);
      // The decline is supervised exactly as an answer is.
      assert.deepEqual(requests.map((request) => request.operation), ["consumer-kb-decline.decline", "kb-decline-supervisor.review"]);
    }
  });

  it("falls back to the fixed sentence when the decline cannot be written", async () => {
    // Every way the decline path can fail, and one shape it must never take: a
    // corpus with nothing to offer skips the model entirely, because a warm
    // sentence whose second half is empty is the broken control again.
    const failures: Array<{ readonly rows: readonly (typeof match)[]; readonly transport: () => ChatTransport }> = [
      { rows: [], transport: () => { throw new Error("must not run — nothing to offer"); } },
      { rows: [{ ...match, similarity: 0.01 }], transport: () => { throw new Error("provider down"); } },
      { rows: [{ ...match, similarity: 0.01 }], transport: () => createMockChatTransport(() => { throw new Error("provider timeout"); }) },
      // Chose no topic though one was available: an offer of nothing.
      { rows: [{ ...match, similarity: 0.01 }], transport: () => createMockChatTransport((request) => request.operation.endsWith("decline") ? { decline: "I cannot answer that here.", topics: [] } : { approved: true }) },
      // Invented a handle the table never issued.
      { rows: [{ ...match, similarity: 0.01 }], transport: () => createMockChatTransport((request) => request.operation.endsWith("decline") ? { decline: "I cannot answer that here.", topics: [{ id: "doc-9" }] } : { approved: true }) },
      // The supervisor declined it.
      { rows: [{ ...match, similarity: 0.01 }], transport: () => createMockChatTransport((request) => request.operation.endsWith("decline") ? { decline: "I cannot answer that here.", topics: [{ id: "doc-1" }] } : { approved: false }) },
    ];
    for (const [index, failure] of failures.entries()) {
      const result = await createConsumerKbAnswer("What records matter?", { retrieval: retrievalOf(failure.rows), transport: failure.transport });
      assert.equal(result.status, "insufficient_grounding", `case ${index}`);
      assert.equal(result.answer, CONSUMER_KB_STATIC_DECLINE, `case ${index} must fall back to the fixed sentence`);
    }
  });

  it("sends only bounded article grounding and returns validated citations", async () => {
    const requests: unknown[] = [];
    const transport = createMockChatTransport((request) => {
      requests.push(request);
      if (!request.operation.endsWith("candidate")) return { approved: true };
      // Cited by the handle the request carried. Since F-05 the model is not
      // shown `article:1` at all, so a literal here would be testing that an
      // invented citation is refused.
      const documents = (JSON.parse(request.messages[1]!.content) as { documents: Array<{ id: string }> }).documents;
      return { bullets: ["Keep the statements current."], citations: [{ id: documents[0]!.id }], headline: "Keep current records." };
    });
    const result = await createConsumerKbAnswer("What records matter?", { retrieval: retrievalOf([{ ...match, body: "x".repeat(9_000) }]), transport: () => transport });
    assert.equal(result.status, "answered");
    assert.equal(result.identity, "AI assistant");
    const serialized = JSON.stringify(requests);
    assert.ok(serialized.length < 12_000);
    for (const forbiddenKey of ["session", "tenant", "clientId", "orgId", "profileId"]) assert.equal(serialized.includes(forbiddenKey), false);
    // F-09: the parts arrive separately, so the surface never splits a string.
    assert.equal(result.status === "answered" && result.headline, "Keep current records.");
    assert.deepEqual(result.status === "answered" ? [...result.bullets] : null, ["Keep the statements current."]);
  });

  it("fails closed when a citation is substituted", async () => {
    const transport = createMockChatTransport((request) => request.operation.endsWith("candidate") ? { bullets: [], citations: [{ id: "doc-99" }], headline: "Answer." } : { approved: true });
    const result = await createConsumerKbAnswer("Question", { retrieval: retrievalOf([match]), transport: () => transport });
    assert.equal(result.status, "unavailable");
    assert.deepEqual(result.citations, []);
  });
});
