import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SessionProfile } from "../auth/session.ts";
import { createMockChatTransport } from "../llm/mock-chat-transport.ts";
import type { Application } from "../applications/types.ts";
import type { HeldDraftRow } from "../support/repository.ts";
import type { TrackerClient } from "../tracker/types.ts";
import { buildOperatorGrounding, createOperatorKbAnswer, type OperatorKbDependencies } from "./operator.ts";
import { OPERATOR_NOT_ADVICE_FOOTER } from "./prompts.ts";

function session(id: string): SessionProfile { return { disabledAt: null, id, role: "platform_admin", orgId: null, orgMembership: null, orgRole: null, manages: [] }; }
function client(id: string): TrackerClient { return { id, consumerProfileId: null, displayName: `Client ${id}`, businessName: null, assignedToId: null, assignedToName: null, stage: "applying", stageEnteredAt: "2026-08-16T00:00:00Z", startedAt: "2026-08-01T00:00:00Z", history: [], analysisAt: null, analysisPending: null, readiness: 70, openActionCount: 2, estimatedCompletionAt: null, monitoring: "active", nextRefreshAt: null, goalCents: 100_000, matchesUnlockedOverride: false, fundingApprovedCents: null, health: "green", status: "active", lastActivityAt: "2026-08-16T00:00:00Z", archivedAt: null, archivedById: null }; }
function application(id: string, clientId: string, bankRef: string): Application { return { id, clientId, bankRef, operatorStatus: "todo", consumerStatus: "pending", amountCents: 10_000, visibility: "inherit", createdAt: "2026-08-16T00:00:00Z", updatedAt: "2026-08-16T00:00:00Z" }; }
function draft(threadId: string): HeldDraftRow { return { id: "draft-1", threadId, body: "Draft body", confidence: 1, confidenceThreshold: 0.8, supervisorApproved: true, guardrailFlags: [], status: "draft", driver: "mock", model: "mock", promptKey: "support-draft", promptVersion: 1, createdAt: "2026-08-16T00:00:00Z", sentBy: null, sentAt: null, sentMessageId: null, discardedBy: null, discardedAt: null }; }

function dependencies(): { deps: OperatorKbDependencies; applicationCalls: string[]; bankCalls: string[][]; draftCalls: Array<[string, string]> } {
  const applicationCalls: string[] = [];
  const bankCalls: string[][] = [];
  const draftCalls: Array<[string, string]> = [];
  const transport = createMockChatTransport((request) => {
    if (!request.operation.endsWith("candidate")) return { approved: true };
    // Cited by the handle the request carried. Since F-05 the model receives
    // opaque per-request handles rather than `tracker:<uuid>`, so echoing what
    // arrived is the only way to stay an echo.
    const parsed = JSON.parse(request.messages[1]!.content) as { documents: Array<{ id: string }> };
    return { bullets: ["Readiness is 70."], citations: [{ id: parsed.documents[0]!.id }], headline: "Visible workspace answer." };
  });
  return {
    applicationCalls,
    bankCalls,
    draftCalls,
    deps: {
      async listTrackerClients(activeSession) { return [client(activeSession.id === "session-a" ? "visible-a" : "visible-b")]; },
      async listApplications(clientId) { applicationCalls.push(clientId); return [application(`app-${clientId}`, clientId, `bank-${clientId}`)]; },
      async listBankRetrievalDocuments(refs) { bankCalls.push([...(refs ?? [])]); return (refs ?? []).map((bankRef) => ({ bankRef, statsVersion: 1, document: { bank_ref: bankRef, heat_level: "warm", windows: { d30: { approved: 1, denied: 0, withdrawn: 0, approvedAmountCents: 100 }, d60: { approved: 1, denied: 0, withdrawn: 0, approvedAmountCents: 100 }, d90: { approved: 1, denied: 0, withdrawn: 0, approvedAmountCents: 100 }, d183: { approved: 1, denied: 0, withdrawn: 0, approvedAmountCents: 100 }, d365: { approved: 1, denied: 0, withdrawn: 0, approvedAmountCents: 100 } } }, documentFingerprint: "f", rebuiltAt: "2026-08-16T00:00:00Z" })); },
      transport: () => transport,
      async generateDraft(threadId, viewer) { draftCalls.push([threadId, viewer.profileId]); return draft(threadId); },
    },
  };
}

describe("operator KB", () => {
  it("derives application ids and lender refs from each session's tracker visibility", async () => {
    const first = dependencies();
    const second = dependencies();
    const docsA = await buildOperatorGrounding(session("session-a"), "Question", first.deps);
    const docsB = await buildOperatorGrounding(session("session-b"), "Question", second.deps);
    assert.deepEqual(first.applicationCalls, ["visible-a"]);
    assert.deepEqual(first.bankCalls, [["bank-visible-a"]]);
    assert.deepEqual(second.applicationCalls, ["visible-b"]);
    assert.deepEqual(second.bankCalls, [["bank-visible-b"]]);
    assert.equal(JSON.stringify(docsA).includes("visible-b"), false);
    assert.equal(JSON.stringify(docsB).includes("visible-a"), false);
  });

  it("drops an application fake that returns an unseen client row", async () => {
    const state = dependencies();
    const deps: OperatorKbDependencies = {
      ...state.deps,
      async listApplications(clientId) { return [application("visible-app", clientId, "visible-bank"), application("unseen-app", "unseen-client", "unseen-bank")]; },
    };
    const documents = await buildOperatorGrounding(session("session-a"), "Question", deps);
    const serialized = JSON.stringify(documents);
    assert.equal(serialized.includes("unseen-client"), false);
    assert.equal(serialized.includes("unseen-bank"), false);
    assert.deepEqual(state.bankCalls, [["visible-bank"]]);
  });

  it("keeps the display-only monitoring rail out of assistant grounding", async () => {
    const state = dependencies();
    const documents = await buildOperatorGrounding(session("session-a"), "Question", state.deps);
    const tracker = documents.find((document) => document.id === "tracker:visible-a");
    assert.ok(tracker);
    const content = tracker.content.toLowerCase();
    for (const blocked of ["monitoring", "bureau", "snapshot", "tradeline", "utilization", "score"]) {
      assert.equal(content.includes(blocked), false, `${blocked} entered assistant grounding`);
    }
  });

  it("does not read lender documents when visible applications contain no bank ref", async () => {
    const state = dependencies();
    const deps: OperatorKbDependencies = {
      ...state.deps,
      async listApplications(clientId) { return [{ ...application("app", clientId, "") }]; },
      async listBankRetrievalDocuments(refs) { state.bankCalls.push([...(refs ?? [])]); return []; },
    };
    const documents = await buildOperatorGrounding(session("session-a"), "Question", deps);
    assert.equal(documents.length, 2);
    assert.deepEqual(state.bankCalls, []);
  });

  it("appends the exact footer once and keeps citations inside visible context", async () => {
    const state = dependencies();
    const result = await createOperatorKbAnswer({ mode: "answer", question: "What is visible?" }, session("session-a"), state.deps);
    assert.equal(result.status, "answered");
    if (result.status === "answered") {
      assert.ok(result.answer.endsWith(OPERATOR_NOT_ADVICE_FOOTER));
      assert.equal(result.answer.split(OPERATOR_NOT_ADVICE_FOOTER).length - 1, 1);
      // F-09. The footer is a field as well as the tail of the encoded string,
      // so a surface can render it in its own right rather than by knowing that
      // the last paragraph of `answer` happens to be one.
      assert.equal(result.footer, OPERATOR_NOT_ADVICE_FOOTER);
      assert.equal(result.headline, "Visible workspace answer.");
      assert.deepEqual([...result.bullets], ["Readiness is 70."]);
      // The handle resolved back to the tracker document it stood for.
      assert.equal(result.citations[0]?.id, "tracker:visible-a");
    }
  });

  it("delegates held drafts and refuses a missing thread without any call", async () => {
    const state = dependencies();
    const refused = await createOperatorKbAnswer({ mode: "message_draft" }, session("session-a"), state.deps);
    assert.equal(refused.status, "unavailable");
    assert.deepEqual(state.draftCalls, []);
    const result = await createOperatorKbAnswer({ mode: "message_draft", supportThreadId: "thread-1" }, session("session-a"), state.deps);
    assert.equal(result.status, "drafted");
    assert.deepEqual(state.draftCalls, [["thread-1", "session-a"]]);
  });
});
