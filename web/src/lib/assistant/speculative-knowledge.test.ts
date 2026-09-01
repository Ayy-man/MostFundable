import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { answerAssistantQuestion } from "./orchestrator.ts";
import { assistantQuestionIsRestricted } from "./workspace-router.ts";
import { AssistantError } from "./types.ts";
import { KB_PROGRESS_STAGES } from "../kb/progress.ts";

import type { SessionProfile } from "../auth/session.ts";
import type { ChatRequest, ChatTransport } from "../llm/chat-transport.ts";
import type { KbProgressEvent } from "../kb/progress.ts";
import type { KbRetrieval } from "../kb/retrieval.ts";
import type { WorkspaceToolRegistry } from "./workspace-tools.ts";

/**
 * The knowledge chain runs beside the router, not after it.
 *
 * Measured on the deployment on 2026-08-24 (six consumer questions, NDJSON
 * stages timestamped in the page): router 1.5–6.7s, retrieval + scorer
 * 3.1–19.9s, candidate 3.0–8.0s, supervisor 1.6–4.4s — four sequential
 * provider calls, p50 16.1s. Retrieval, scoring, drafting and review do not
 * depend on the router's verdict, so they start at once and their outcome is
 * used only if the verdict is `knowledge`. These tests pin the properties that
 * make that safe: the chain starts before the verdict, a locally restricted
 * question starts nothing, a non-knowledge verdict never lets the chain's
 * progress or answer reach the caller, and a knowledge verdict replays the
 * chain's progress in the order the work happened.
 */
const consumer: SessionProfile = { disabledAt: null, id: "consumer-a", manages: [], orgId: "org-a", orgMembership: null, orgRole: null, role: "consumer" };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function registry(): WorkspaceToolRegistry {
  return {
    namesFor: () => ["client_readiness"],
    async workspaceName() { return null; },
    async run() {
      return { status: "records", documents: [{ id: "tracker:client-a", title: "Riley Foods", label: "Client · Riley Foods", url: "", content: JSON.stringify({ readiness: 84, stage: "ready" }), metadata: { kind: "client" } }] };
    },
  };
}

function article(): KbRetrieval {
  return {
    driver: "hash64",
    async retrieve() {
      return { scale: "hash64", similarityThreshold: 0.18, matches: [{ id: "article-1", sourceArticleId: "src-1", title: "Lender fit review", body: "A lender fit review compares loan criteria before an application is chosen.", sourceUrl: "", metadata: {}, similarity: 0.9 }] };
    },
  };
}

function transport(route: () => Promise<unknown>, events: string[]): ChatTransport {
  return {
    driver: "mock",
    model: "mock",
    async complete(request: ChatRequest) {
      if (request.operation === "assistant-route.select") {
        const verdict = await route();
        events.push("route-resolved");
        return verdict;
      }
      events.push(request.operation);
      if (request.operation.endsWith(".candidate")) {
        const body = JSON.parse(request.messages[1]!.content) as { documents: Array<{ id: string }> };
        const first = body.documents[0]!.id;
        const grounded = request.messages[1]!.content.includes("Riley Foods") ? "Riley Foods has verified readiness of 84." : "A lender fit review compares loan criteria.";
        return { headline: grounded, bullets: [], citations: [{ id: first }] };
      }
      return { approved: true };
    },
  };
}

describe("the knowledge chain runs beside the router", () => {
  it("starts retrieval before the routing verdict arrives", async () => {
    const events: string[] = [];
    const retrieval: KbRetrieval = { driver: "hash64", async retrieve(question, limit) { events.push("retrieve"); return article().retrieve(question, limit); } };
    const slowRoute = transport(async () => { await sleep(60); return { route: "knowledge", tools: [] }; }, events);
    const result = await answerAssistantQuestion("What is a lender fit review?", "consumer", consumer, { retrieval, tools: registry(), transport: slowRoute });
    assert.equal(result.citations.length, 1);
    assert.equal(events[0], "retrieve", `retrieval must be the first thing that happens, saw ${JSON.stringify(events)}`);
    assert.ok(events.indexOf("route-resolved") > events.indexOf("retrieve"));
  });

  it("starts nothing for a question the local restricted-terms rule refuses", async () => {
    const question = "What does my credit report say about my tradelines?";
    assert.equal(assistantQuestionIsRestricted(question), true, "premise: the rule module refuses this question");
    const events: string[] = [];
    const retrieval: KbRetrieval = { driver: "hash64", async retrieve() { events.push("retrieve"); throw new Error("must not be reached"); } };
    await assert.rejects(
      () => answerAssistantQuestion(question, "consumer", consumer, { retrieval, tools: registry(), transport: transport(async () => { events.push("provider"); return { route: "knowledge", tools: [] }; }, events) }),
      (error: unknown) => error instanceof AssistantError && error.code === "ASSISTANT_OUT_OF_SCOPE",
    );
    assert.deepEqual(events, []);
  });

  it("never surfaces the speculative chain when the verdict is not knowledge", async () => {
    for (const verdict of [{ route: "workspace", tools: [{ name: "client_readiness" }] }, { route: "out_of_scope", tools: [] }, { route: "policy_refused", tools: [] }]) {
      const events: string[] = [];
      const progress: KbProgressEvent[] = [];
      let chainFinished: () => void = () => undefined;
      const finished = new Promise<void>((resolve) => { chainFinished = resolve; });
      const retrieval: KbRetrieval = { driver: "hash64", async retrieve(question, limit) { const matches = await article().retrieve(question, limit); setTimeout(chainFinished, 30); return matches; } };
      const outcome = await answerAssistantQuestion("Who is closest to funding?", "consumer", consumer, { retrieval, tools: registry(), transport: transport(async () => { await sleep(20); return verdict; }, events), onProgress: (event) => progress.push(event) })
        .then((answer) => answer.body, (error: unknown) => (error instanceof AssistantError ? error.code : "unexpected"));
      // The chain may never start at all (a sequential tree, or a verdict that starts nothing); wait only as long as it could take.
      await Promise.race([finished, sleep(200)]);
      // `searching` is the knowledge chain's own first observation; no workspace path emits it.
      assert.equal(progress.some((event) => event.stage === "searching"), false, `${verdict.route}: knowledge progress leaked ${JSON.stringify(progress)}`);
      if (verdict.route === "workspace") assert.match(outcome, /Riley Foods|lender fit/i);
      else assert.equal(outcome, verdict.route === "out_of_scope" ? "ASSISTANT_OUT_OF_SCOPE" : "ASSISTANT_POLICY_REFUSED");
      if (verdict.route === "workspace") assert.doesNotMatch(outcome, /lender fit review compares/i, "the knowledge draft must not be the answer to a workspace verdict");
    }
  });

  it("replays the chain's progress in the order the work happened once the verdict is knowledge", async () => {
    const events: string[] = [];
    const progress: string[] = [];
    const result = await answerAssistantQuestion("What is a lender fit review?", "consumer", consumer, { retrieval: article(), tools: registry(), transport: transport(async () => { await sleep(60); return { route: "knowledge", tools: [] }; }, events), onProgress: (event) => progress.push(event.stage) });
    assert.equal(result.citations.length, 1);
    // Derived from the stage vocabulary, not transcribed: every stage the chain can report, in
    // pipeline order, each seen at least once and never out of order.
    const order = progress.map((stage) => (KB_PROGRESS_STAGES as readonly string[]).indexOf(stage));
    assert.ok(order.every((index) => index >= 0), `unknown stage in ${JSON.stringify(progress)}`);
    assert.deepEqual([...new Set(progress)], [...KB_PROGRESS_STAGES]);
    assert.deepEqual(order, [...order].sort((a, b) => a - b));
  });
});
