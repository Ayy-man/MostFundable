import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import type { SessionProfile } from "../auth/session.ts";
import type { Application } from "../applications/types.ts";
import type { TrackerClient } from "../tracker/types.ts";
import { createMockChatTransport } from "../llm/mock-chat-transport.ts";
import { createConsumerKbAnswer } from "./consumer.ts";
import { HASH64_SIMILARITY_THRESHOLD } from "./retrieval.ts";
import { createOperatorKbAnswer, type OperatorKbDependencies } from "./operator.ts";
import type { KbCitation } from "./chat-driver.ts";
import { containsUuidShaped } from "./identifiers.ts";

import { stripComments } from "@/lib/testing/strip-comments";

/**
 * A citation must read as a human label — record type plus display name — and never as the
 * internal key the record is stored under. The check has two halves that have to meet in the
 * middle, because either half alone rots: the surfaces decide WHICH citation field is printed,
 * and the KB builders decide WHAT that field contains. So the first test derives the printed
 * field name from the assistant sources themselves, and the second feeds record ids that are
 * real uuids through the real builders and asserts on exactly that field. A new render site that
 * reaches for `citation.id` again fails the first test; a builder that lets a key into the label
 * fails the second. Neither assertion transcribes the observed leak.
 */
// Imported rather than written a second time. The strip and the check have to
// agree on what a stored key looks like, and two copies of that regex is exactly
// how they stop agreeing.

// The chat rebuild moved both assistants. The consumer's sits beside the Team Chat it renders
// with; the operator's is the answer block of the assistant workspace, which replaced the single
// `components/kb/operator-kb-assistant.tsx` the operator half used to read.
const consumerAssistantPath = new URL("../../components/assistant/consumer-companion.tsx", import.meta.url);
const operatorAssistantPath = new URL("../../components/assistant/answer.tsx", import.meta.url);

/**
 * The citation fields a surface actually puts on screen.
 *
 * This used to anchor on the literal `Source: ` and slice to `</li>`, which was the shape both
 * surfaces happened to share. They no longer do — the operator's is a chip, not a list item, and
 * carries no `Source:` prefix — so anchoring on either spelling would test one surface and skip
 * the other while reporting a pass.
 *
 * Locating the render site is also the wrong move now, because there is a hop in the way: the
 * operator's map hands each source to a `SourceChip` and the printing happens in there. A guard
 * that reads the map body sees no field at all and passes on an empty set.
 *
 * So the question is turned around. The record's field names are read out of its own type
 * declaration at test time, and the file is asked which of them reach text position anywhere in
 * it. That crosses the hop without knowing about it, survives a renamed parameter, and fails
 * rather than passes when a surface prints nothing — and a field added to the record tomorrow is
 * included without anybody extending a list.
 */
function typeFields(source: string, name: string): string[] {
  const at = source.indexOf(`interface ${name} {`);
  assert.notEqual(at, -1, `the ${name} type no longer declares its fields`);
  const body = source.slice(at, source.indexOf("\n}", at));
  const fields = [...body.matchAll(/^\s+(?:readonly )?(\w+)\??:/gm)].map((match) => match[1]);
  assert.ok(fields.length >= 2, `${name} parsed as ${fields.length} field(s); the parse changed`);
  return fields;
}

async function renderedCitationFields(path: URL, typePath: URL, typeName: string): Promise<string[]> {
  const raw = await readFile(path, "utf8");
  const source = stripComments(raw);
  const fields = typeFields(await readFile(typePath, "utf8"), typeName);
  // Text position: after a `>` and before the next `<`, which is where a reader sees it. An index
  // expression like `ICONS[source.kind]` and a template `key` are deliberately not that.
  const printed = fields.filter((field) =>
    new RegExp(`>[^<>{]*\\{\\w+\\.${field}\\}`).test(source),
  );
  assert.ok(
    printed.length > 0,
    `${path.pathname} prints no field of ${typeName}, so a citation reaches the reader as nothing`,
  );
  return [...printed].sort();
}

const CLIENT_ID = "a3000000-0000-4000-8000-000000000001";
const APPLICATION_ID = "a3000000-0000-4000-8000-000000000002";
const ARTICLE_CHUNK_ID = "a3000000-0000-4000-8000-000000000003";

function session(): SessionProfile { return { disabledAt: null, id: "session-a", role: "platform_admin", orgId: null, orgMembership: null, orgRole: null, manages: [] }; }
function client(): TrackerClient { return { id: CLIENT_ID, consumerProfileId: null, displayName: "Devon Derog Demo", businessName: null, assignedToId: null, assignedToName: null, stage: "applying", stageEnteredAt: "2026-08-16T00:00:00Z", startedAt: "2026-08-01T00:00:00Z", history: [], analysisAt: null, analysisPending: null, readiness: 70, openActionCount: 2, estimatedCompletionAt: null, monitoring: "active", nextRefreshAt: null, goalCents: 100_000, matchesUnlockedOverride: false, fundingApprovedCents: null, health: "green", status: "active", lastActivityAt: "2026-08-16T00:00:00Z", archivedAt: null, archivedById: null }; }
function application(): Application { return { id: APPLICATION_ID, clientId: CLIENT_ID, bankRef: "bank-north", operatorStatus: "todo", consumerStatus: "pending", amountCents: 10_000, visibility: "inherit", createdAt: "2026-08-16T00:00:00Z", updatedAt: "2026-08-16T00:00:00Z" }; }

/**
 * Echoes every supplied document back as a citation, so each grounding row reaches a render site.
 *
 * It cites by whatever id the request carried, which since F-05 is the opaque
 * per-request handle rather than the record's own key — so this stays an echo
 * rather than becoming a transcription of a handle format.
 */
function echoTransport() {
  return createMockChatTransport((request) => {
    if (!request.operation.endsWith("candidate")) return { approved: true };
    const parsed = JSON.parse(request.messages[1]!.content) as { documents: Array<{ id: string }> };
    return { bullets: [], citations: parsed.documents.slice(0, 8).map((document) => ({ id: document.id })), headline: "The cited workspace records support this answer." };
  });
}

function operatorDependencies(): OperatorKbDependencies {
  const transport = echoTransport();
  return {
    async listTrackerClients() { return [client()]; },
    async listApplications() { return [application()]; },
    async listBankRetrievalDocuments(refs) { const window = { approved: 1, denied: 0, withdrawn: 0, approvedAmountCents: 100 }; return (refs ?? []).map((bankRef) => ({ bankRef, statsVersion: 1, document: { bank_ref: bankRef, heat_level: "warm" as const, windows: { d30: window, d60: window, d90: window, d183: window, d365: window } }, documentFingerprint: "f", rebuiltAt: "2026-08-16T00:00:00Z" })); },
    transport: () => transport,
    async generateDraft() { throw new Error("not used"); },
  };
}

async function operatorCitations(): Promise<readonly KbCitation[]> {
  const result = await createOperatorKbAnswer({ mode: "answer", question: "What is moving?" }, session(), operatorDependencies());
  assert.equal(result.status, "answered");
  return result.status === "answered" ? result.citations : [];
}

async function consumerCitations(): Promise<readonly KbCitation[]> {
  const transport = echoTransport();
  const matches = [
    { id: `article:${ARTICLE_CHUNK_ID}`, sourceArticleId: "source:1", title: "Business records to keep current", body: "Keep current records.", sourceUrl: "https://example.test/records", metadata: {}, similarity: 0.9 },
    { id: `article:${ARTICLE_CHUNK_ID}-b`, sourceArticleId: "source:2", title: ARTICLE_CHUNK_ID, body: "An article whose own title is a stored key.", sourceUrl: "https://example.test/keyed", metadata: {}, similarity: 0.9 },
  ];
  const result = await createConsumerKbAnswer("What records matter?", { retrieval: { driver: "hash64", async retrieve() { return { scale: "hash64", similarityThreshold: HASH64_SIMILARITY_THRESHOLD, matches }; } }, transport: () => transport });
  assert.equal(result.status, "answered");
  return result.status === "answered" ? result.citations : [];
}

/**
 * The two records and where each one's shape is declared.
 *
 * They are different types now — the consumer panel renders a `KbCitation` from the KB driver and
 * the operator's answer block renders an `AssistantSource` — and that is fine, because the rule
 * was never about one type. It is that whatever a surface calls the thing, only its human label
 * reaches the reader.
 */
const SURFACES = [
  {
    path: consumerAssistantPath,
    typeName: "KbCitation",
    typePath: new URL("./chat-driver.ts", import.meta.url),
  },
  {
    path: operatorAssistantPath,
    typeName: "AssistantSource",
    typePath: new URL("../assistant/types.ts", import.meta.url),
  },
] as const;

describe("KB citation labels", () => {
  it("prints one citation field on every assistant surface", async () => {
    for (const surface of SURFACES) {
      assert.deepEqual(
        await renderedCitationFields(surface.path, surface.typePath, surface.typeName),
        ["label"],
        `${surface.path.pathname} must render only the human citation label`,
      );
    }
  });

  it("keeps every uuid-shaped key out of the field the surfaces print", async () => {
    const fields = await renderedCitationFields(SURFACES[1].path, SURFACES[1].typePath, SURFACES[1].typeName);
    const citations = [...await operatorCitations(), ...await consumerCitations()];
    assert.ok(citations.length >= 4, "the echo transport must return one citation per grounding row");
    for (const citation of citations) {
      for (const field of fields) {
        const rendered = (citation as unknown as Record<string, string>)[field];
        assert.equal(typeof rendered, "string", `citation field ${field} must be a string`);
        assert.equal(containsUuidShaped(rendered), false, `citation field ${field} leaked an internal id: ${rendered}`);
        assert.ok(rendered.trim().length > 0, `citation field ${field} must not be empty`);
      }
    }
  });
});
