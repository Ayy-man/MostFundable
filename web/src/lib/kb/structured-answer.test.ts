// F-09, asserted against the schema and the pipeline rather than against a
// sample answer.
//
// The finding: `KB_CANDIDATE_SCHEMA` was `{ answer: string, citations }`, the
// design brief specifies "a headline sentence, supporting bullets, then a
// sources row", and a surface handed one string has to parse prose back into
// structure. The correction on the finding matters as much as the finding —
// the claim that prompt v2 had cost the answer its substance did not replicate,
// so nothing here asserts anything about answer quality. What it asserts is
// that the parts arrive separately and survive the round trip into storage,
// which is the half that stood.
//
// The schema half derives its expectation from `KB_CANDIDATE_SCHEMA` itself: it
// reads the required field names off the object the transport is handed. A test
// that listed them would go on passing if the schema were reverted and the
// pipeline patched around it.
//
// Watched failing on the pre-fix tree (`4ef499a`): every case fails, the schema
// one reporting `answer` where `headline` and `bullets` are required, and the
// pipeline ones because the flat candidate has no parts to keep separate.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ChatRequest, ChatTransport } from "../llm/chat-transport.ts";
import { decodeAnswerBody, encodeAnswerBody } from "./answer-body.ts";
import { KB_CANDIDATE_SCHEMA, citationLabel, runGroundedChat, type GroundingDocument } from "./chat-driver.ts";
import { CONSUMER_KB_PROMPT } from "./prompts.ts";

const DOCUMENTS: readonly GroundingDocument[] = [
  {
    content: "Keep current business records.",
    id: "kb:1",
    label: "Knowledge article · Business records",
    metadata: { sourceArticleId: "1" },
    title: "Business records",
    url: "https://kb.example.test/business-records",
  },
];

const HEADLINE = "Keep the business records current.";
const BULLETS = ["File the last two years of returns.", "Refresh the bank statements each month."];

function recording(respond: (candidate: ChatRequest) => unknown): {
  transport: ChatTransport;
  requests: ChatRequest[];
} {
  const requests: ChatRequest[] = [];
  return {
    requests,
    transport: {
      async complete(request) {
        requests.push(request);
        return request.operation.endsWith(".candidate") ? respond(request) : { approved: true };
      },
      driver: "mock",
      model: "probe",
    },
  };
}

function structured(candidate: ChatRequest): unknown {
  const body = JSON.parse(candidate.messages[1]!.content) as { documents: Array<{ id: string }> };
  return { bullets: BULLETS, citations: [{ id: body.documents[0]!.id }], headline: HEADLINE };
}

/** The field names the candidate schema actually requires, read off the request. */
function requiredCandidateFields(request: ChatRequest): readonly string[] {
  const schema = request.schema as { required?: readonly string[] };
  return [...(schema.required ?? [])].sort();
}

describe("a supervised answer arrives in parts (F-09)", () => {
  it("asks the model for a headline and bullets as separate fields", async () => {
    const { requests, transport } = recording(structured);
    await runGroundedChat({
      documents: DOCUMENTS,
      prompt: CONSUMER_KB_PROMPT,
      question: "What should I keep current?",
      transport,
    });

    const candidate = requests.find((request) => request.operation.endsWith(".candidate"));
    assert.ok(candidate, "the pipeline never made a candidate call");
    assert.deepEqual(requiredCandidateFields(candidate), ["bullets", "citations", "headline"]);
  });

  it("returns them without the caller having to split a string", async () => {
    const { transport } = recording(structured);
    const answer = await runGroundedChat({
      documents: DOCUMENTS,
      prompt: CONSUMER_KB_PROMPT,
      question: "What should I keep current?",
      transport,
    });

    assert.ok(answer !== null, "the structured candidate must be answered");
    assert.equal(answer.headline, HEADLINE);
    assert.deepEqual([...answer.bullets], BULLETS);
  });

  it("survives the round trip through the single column storage gives it", () => {
    // Derived from the encoder rather than transcribed: the expectation is that
    // whatever `encodeAnswerBody` writes, `decodeAnswerBody` reads back, so a
    // change to the format is covered without editing a literal here.
    //
    // The zero-bullet case is the one that matters and is why it leads. The
    // first version of this module also encoded the not-advice footer, which
    // round-tripped correctly with bullets present and folded into the headline
    // without them — a defect a two-bullet fixture alone would not have shown.
    for (const bullets of [[], BULLETS, [BULLETS[0]!]]) {
      const body = { bullets, headline: HEADLINE };
      assert.deepEqual(decodeAnswerBody(encodeAnswerBody(body)), { bullets, headline: HEADLINE });
    }
  });

  it("decodes a body that carries no bullets as a headline and nothing else", () => {
    // The shape a row written before this format existed will have. It must
    // render as something rather than throwing or inventing a bullet.
    assert.deepEqual(decodeAnswerBody("A single sentence with no parts."), {
      bullets: [],
      headline: "A single sentence with no parts.",
    });
  });

  it("keeps a bullet whose own text opens with the marker", () => {
    // The encoder writes the marker, so a bullet that begins with one produces
    // two — and the decode has to strip exactly the one it wrote. Getting this
    // backwards eats a character off the reader's text every time.
    const body = { bullets: ["- a literal dash opens this point"], headline: HEADLINE };
    assert.deepEqual(decodeAnswerBody(encodeAnswerBody(body)), body);
  });
});

/**
 * The ledger shape, tested against the schema the driver actually sent.
 *
 * Each expectation is read off the request the transport received — the item
 * count from the schema's own `minItems`, the handles from the documents in the
 * body — so a changed ceiling or a renamed field moves the test with the code
 * rather than leaving it asserting a number nothing produces.
 */
describe("a per-record answer is complete or it is refused", () => {
  const LEDGER: readonly GroundingDocument[] = Array.from({ length: 11 }, (_, index) => ({
    content: JSON.stringify({ status: index % 2 === 0 ? "pending" : "approved" }),
    id: `application:${index}`,
    label: `Application · Client ${index + 1} · Lender ${index + 1}`,
    metadata: { kind: "application" },
    title: `Application · Client ${index + 1} · Lender ${index + 1}`,
    url: "",
  }));

  it("carries one bullet and one citation per record past the generic bullet and citation ceilings", async () => {
    const { requests, transport } = recording((request) => {
      const body = JSON.parse(request.messages[1]!.content) as { documents: Array<{ id: string }> };
      return {
        headline: "Every recorded application is listed on its own.",
        items: body.documents.map((row, index) => ({ id: row.id, detail: `recorded status ${index}` })),
      };
    });
    const answer = await runGroundedChat({ documentLedger: true, documents: LEDGER, prompt: CONSUMER_KB_PROMPT, question: "Where does every application stand?", transport });

    const schema = requests[0]!.schema as { properties: { items: { minItems: number; maxItems: number } } };
    const generic = KB_CANDIDATE_SCHEMA.properties;
    assert.ok(answer !== null);
    assert.equal(schema.properties.items.minItems, LEDGER.length);
    assert.equal(schema.properties.items.maxItems, LEDGER.length);
    assert.ok(LEDGER.length > generic.bullets.maxItems && LEDGER.length > generic.citations.maxItems, "the fixture no longer exceeds the ceilings it exists to exceed");
    assert.equal(answer.bullets.length, LEDGER.length);
    assert.equal(answer.citations.length, LEDGER.length);
    assert.match(answer.bullets.at(-1)!, /Client 11 · Lender 11: recorded status 10/);
  });

  it("refuses a duplicated, invented, missing or reordered handle before the supervisor is asked", async () => {
    const cases: Readonly<Record<string, (ids: readonly string[]) => Array<{ id: string; detail: string }>>> = {
      missing: (ids) => ids.slice(1).map((id) => ({ id, detail: "one short" })),
      duplicated: (ids) => ids.map(() => ({ id: ids[0]!, detail: "same record twice" })),
      invented: (ids) => ids.map((id, index) => ({ id: index === 0 ? "handle-not-issued" : id, detail: "invented" })),
      reordered: (ids) => [...ids].reverse().map((id) => ({ id, detail: "out of order" })),
    };
    for (const [name, build] of Object.entries(cases)) {
      const { requests, transport } = recording((request) => {
        const body = JSON.parse(request.messages[1]!.content) as { documents: Array<{ id: string }> };
        return { headline: "An incomplete ledger.", items: build(body.documents.map((row) => row.id)) };
      });
      const answer = await runGroundedChat({ documentLedger: true, documents: LEDGER, prompt: CONSUMER_KB_PROMPT, question: "Where does every application stand?", transport });
      assert.equal(answer, null, name);
      assert.equal(requests.some((request) => request.operation.endsWith(".review")), false, `${name} reached the supervisor`);
    }
  });

  it("regenerates a refused ledger candidate exactly as it regenerates a refused summary", async () => {
    let attempt = 0;
    const { requests, transport } = recording((request) => {
      const body = JSON.parse(request.messages[1]!.content) as { documents: Array<{ id: string }> };
      attempt += 1;
      const items = body.documents.map((row, index) => ({ id: row.id, detail: `recorded status ${index}` }));
      return attempt === 1
        ? { headline: "An incomplete ledger.", items: items.slice(1) }
        : { headline: "Every recorded application is listed on its own.", items };
    });
    const answer = await runGroundedChat({ documentLedger: true, documents: LEDGER, prompt: CONSUMER_KB_PROMPT, question: "Where does every application stand?", transport });

    const candidates = requests.filter((request) => request.operation.endsWith(".candidate"));
    assert.ok(answer !== null, "the retry that exists for summaries does not exist for ledgers");
    assert.equal(candidates.length, 2);
    // The second attempt must ask for the same shape, not fall back to the
    // summarizing schema that has no cardinality guarantee.
    assert.deepEqual(candidates[1]!.schema, candidates[0]!.schema);
    assert.equal(answer.bullets.length, LEDGER.length);
  });

  it("keeps a duplicate-lender ordinal when a long human label has to be shortened", () => {
    const long = `Application · ${"Very Long Client Name ".repeat(9)}· ${"Very Long Lender Name ".repeat(9)}· Application 12`;
    const label = citationLabel({ ...DOCUMENTS[0]!, label: long });
    assert.ok(long.length > label.length, "the fixture is no longer long enough to be shortened");
    assert.match(label, /· Application 12$/, "the ordinal that separates two applications to one lender was cut off");
  });
});
