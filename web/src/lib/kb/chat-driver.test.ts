import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NORMALIZED_ADVERSARIAL_LANGUAGE } from "../compliance/__fixtures__/adversarial-language.mjs";
import type { ChatRequest } from "../llm/chat-transport.ts";
import { createMockChatTransport } from "../llm/mock-chat-transport.ts";
import { runGroundedChat, type GroundingDocument } from "./chat-driver.ts";
import { CONSUMER_KB_PROMPT } from "./prompts.ts";

const DOCUMENTS: readonly GroundingDocument[] = [
  { content: "Keep current business records.", id: "doc:1", metadata: { sourceArticleId: "1" }, title: "Business records", url: "https://example.test/1" },
  { content: "Refresh the statements monthly.", id: "doc:2", metadata: { sourceArticleId: "2" }, title: "Bank statements", url: "https://example.test/2" },
];

/**
 * The handles the pipeline issued for `DOCUMENTS`, read off the request rather
 * than written down.
 *
 * Every case below cites through this. The old version of this file wrote
 * `id: "doc:1"` into each candidate, which was the document's real id — exactly
 * the thing F-05 stopped sending — so a fixed literal here would now be testing
 * that an invented citation is refused, whatever else it claimed to be about.
 */
function handlesIn(candidate: ChatRequest): readonly string[] {
  const body = JSON.parse(candidate.messages[1]!.content) as { documents: Array<{ id: string }> };
  return body.documents.map((document) => document.id);
}

function candidateFor(build: (handles: readonly string[]) => unknown) {
  return createMockChatTransport((request) =>
    request.operation.endsWith("candidate") ? build(handlesIn(request)) : { approved: true },
  );
}

const ask = (transport: ReturnType<typeof createMockChatTransport>) =>
  runGroundedChat({ documents: DOCUMENTS, prompt: CONSUMER_KB_PROMPT, question: "What should I keep current?", transport });

describe("KB chat", () => {
  it("returns a deterministic supervised answer with an exact citation", async () => {
    const transport = candidateFor((handles) => ({
      bullets: ["File the last two years of returns."],
      citations: [{ id: handles[0] }],
      headline: "Keep the records current.",
    }));
    const first = await ask(transport);
    const second = await ask(transport);
    assert.deepEqual(first, second);
    // The handle resolved back to the document it stood for, which is what lets
    // a surface open the record it already holds.
    assert.equal(first?.citations[0]?.id, DOCUMENTS[0]!.id);
    assert.equal(first?.headline, "Keep the records current.");
  });

  it("regenerates one structurally unsafe candidate before asking the supervisor", async () => {
    let candidateCalls = 0;
    let supervisorCalls = 0;
    const transport = createMockChatTransport((request) => {
      if (request.operation.endsWith("candidate")) {
        candidateCalls += 1;
        const handle = handlesIn(request)[0]!;
        // uuid-shaped, not a handle mention: a handle mention is repaired to
        // the record's title in place now, and only an identifier the table
        // cannot translate still costs the draft.
        return candidateCalls === 1
          ? {
              bullets: ["See 123e4567-e89b-12d3-a456-426614174000 for the readiness figure."],
              citations: [{ id: handle }],
              headline: "Keep the records current.",
            }
          : {
              bullets: ["File the last two years of returns."],
              citations: [{ id: handle }],
              headline: "Keep the records current.",
            };
      }
      supervisorCalls += 1;
      return { approved: true };
    });

    const answer = await ask(transport);
    assert.equal(answer?.headline, "Keep the records current.");
    assert.equal(candidateCalls, 2);
    assert.equal(supervisorCalls, 1);
  });

  it("refuses two structurally unsafe candidates without asking the supervisor", async () => {
    let candidateCalls = 0;
    let supervisorCalls = 0;
    const transport = createMockChatTransport((request) => {
      if (request.operation.endsWith("candidate")) {
        candidateCalls += 1;
        const handle = handlesIn(request)[0]!;
        return {
          bullets: ["See 123e4567-e89b-12d3-a456-426614174000 for the readiness figure."],
          citations: [{ id: handle }],
          headline: "Keep the records current.",
        };
      }
      supervisorCalls += 1;
      return { approved: true };
    });

    assert.equal(await ask(transport), null);
    assert.equal(candidateCalls, 2);
    assert.equal(supervisorCalls, 0);
  });

  it("rejects missing, invented, mixed, malformed, unsafe, and unapproved candidates", async () => {
    const builders: Array<(handles: readonly string[]) => unknown> = [
      // No citation at all.
      () => ({ bullets: [], citations: [], headline: "No source." }),
      // A handle the table never issued.
      (handles) => ({ bullets: [], citations: [{ id: `${handles[0]}x` }], headline: "Wrong source." }),
      // One real handle and one invented, which must fail the whole answer
      // rather than silently keeping the half that resolved.
      (handles) => ({ bullets: [], citations: [{ id: handles[0] }, { id: "doc-99" }], headline: "Mixed sources." }),
      // The old flat shape. It is here because the schema moved in this lane and
      // a candidate written against the previous one must be refused, not
      // half-parsed.
      (handles) => ({ answer: "Flat answer.", citations: [{ id: handles[0] }] }),
      // A citation carrying more than the handle.
      (handles) => ({ bullets: [], citations: [{ id: handles[0], title: "Business records" }], headline: "Extra fields." }),
      // Compliance language, which must never reach the supervisor.
      (handles) => ({ bullets: [], citations: [{ id: handles[0] }], headline: atob("YXBwcm92YWwgY2hhbmNlcyBhcmUgODAlLg==") }),
    ];
    for (const build of builders) {
      assert.equal(await ask(candidateFor(build)), null);
    }

    const rejected = createMockChatTransport((request) =>
      request.operation.endsWith("candidate")
        ? { bullets: [], citations: [{ id: handlesIn(request)[0] }], headline: "Keep records current." }
        : { approved: false },
    );
    assert.equal(await ask(rejected), null);
  });

  it("rejects each new adversarial form before the KB supervisor", async () => {
    for (const candidate of NORMALIZED_ADVERSARIAL_LANGUAGE) {
      let supervisorCalls = 0;
      const transport = createMockChatTransport((request) => {
        if (request.operation.endsWith("candidate")) {
          return { bullets: [], citations: [{ id: handlesIn(request)[0] }], headline: candidate };
        }
        supervisorCalls += 1;
        return { approved: true };
      });
      assert.equal(await ask(transport), null);
      assert.equal(supervisorCalls, 0);
    }
  });

  it("scans the bullets as well as the headline", async () => {
    // The finding this guards is one the schema change created: the compliance
    // scan used to see one field, and a candidate that put the claim in a bullet
    // would have walked past a scan that only read the headline.
    for (const candidate of NORMALIZED_ADVERSARIAL_LANGUAGE) {
      const transport = candidateFor((handles) => ({
        bullets: ["A clean supporting line.", candidate],
        citations: [{ id: handles[0] }],
        headline: "A clean headline.",
      }));
      assert.equal(await ask(transport), null, `a bullet carrying ${candidate} was answered`);
    }
  });
});
