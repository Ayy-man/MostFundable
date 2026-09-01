// F-06, closed where the destination is decided rather than where it is
// rendered.
//
// The label half was closed by `1e4d790`: the human phrase a chip prints is
// stamped at the one point a model citation is matched back to its grounding
// document, with anything uuid-shaped removed before the label is accepted. The
// half left open was the anchor. `safeCitationHref(citation.url)` returned a
// live `https://kb.example.test/application-file` and the surfaces rendered it
// with `target="_blank"`, so a client under real auth could click a fixture host
// that serves no page. The ruling was that chips carry the human title and link
// nowhere.
//
// A render-site fix would be a component change, which is lane 4b's to make and
// mine to leave alone. The stronger close is here anyway: **the answer path
// stops offering a destination at all.** A citation that carries no url is one
// no render site — this one, or the one 4b writes next week — can turn into a
// live anchor by reaching for the nearest field. `safeCitationHref()` survives
// untouched for the day a real help destination exists, which is the day this
// type gains the field back deliberately.
//
// The assertion derives the forbidden value from the grounding document the
// citation came from, so a builder that starts pointing somewhere else is
// covered without editing this file.
//
// Watched failing on the pre-fix tree (`4ef499a`): the citation came back
// carrying `url: "https://kb.example.test/business-records"` verbatim.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ChatRequest, ChatTransport } from "../llm/chat-transport.ts";
import { runGroundedChat, type GroundingDocument } from "./chat-driver.ts";
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

function transport(): ChatTransport {
  return {
    async complete(request: ChatRequest) {
      if (!request.operation.endsWith(".candidate")) return { approved: true };
      const body = JSON.parse(request.messages[1]!.content) as { documents: Array<{ id: string }> };
      return {
        bullets: [],
        citations: [{ id: body.documents[0]!.id }],
        headline: "Keep the business records current.",
      };
    },
    driver: "mock",
    model: "probe",
  };
}

describe("a citation names a source and does not link to one (F-06)", () => {
  it("carries the stamped human label", async () => {
    const answer = await runGroundedChat({
      documents: DOCUMENTS,
      prompt: CONSUMER_KB_PROMPT,
      question: "What should I keep current?",
      transport: transport(),
    });

    assert.ok(answer !== null);
    assert.equal(answer.citations[0]!.label, DOCUMENTS[0]!.label);
  });

  it("carries no field a render site could use as an href", async () => {
    const answer = await runGroundedChat({
      documents: DOCUMENTS,
      prompt: CONSUMER_KB_PROMPT,
      question: "What should I keep current?",
      transport: transport(),
    });

    assert.ok(answer !== null);
    for (const citation of answer.citations) {
      // The document's own destination, read off the document rather than
      // written here.
      for (const document of DOCUMENTS) {
        assert.equal(
          JSON.stringify(citation).includes(document.url),
          false,
          `the citation still carries ${document.url}`,
        );
      }
      // And nothing else that parses as a location either, so a builder pointing
      // at a different host is caught by the same case.
      for (const [key, value] of Object.entries(citation)) {
        if (typeof value !== "string") continue;
        let parsed: URL | null = null;
        try {
          parsed = new URL(value);
        } catch {
          parsed = null;
        }
        assert.equal(
          parsed !== null && (parsed.protocol === "http:" || parsed.protocol === "https:"),
          false,
          `citation.${key} is a clickable destination`,
        );
      }
    }
  });
});
