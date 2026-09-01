// The browser half of the assistant, driven rather than read.
//
// The round-5 standard governs three derivations here. The routes are resolved against the app
// router on disk by walking it segment by segment, so a URL this module invents — or a route that
// moves — fails rather than being transcribed as a string that agrees with itself. The source-kind
// case builds its hostile value from `ASSISTANT_SOURCE_KINDS` (a kind that is provably not in the
// vocabulary) instead of naming one that happens not to be. And the stage cases replay
// `ASSISTANT_STAGES` itself, so a fourth stage on the wire is covered on the day it exists.
//
// Watched failing before it counted, against this tree, one at a time:
//
//   * `readConversationList` without its scope filter → "the operator workspace lists a platform
//     conversation".
//   * `readConversationList` mapping a thrown fetch onto `{ status: "ready", conversations: [] }`
//     → "a dropped network read rendered as an empty history".
//   * `askQuestion` returning `answered` when the stream ends after a stage line → "a dropped
//     stream was reported as an answer".
//   * `readStreamLines` called per chunk with no carry → the split-line case fails with the
//     stages arriving as `[]`.
//   * `parseTurn` accepting a row with no `headline` → "an answer with no words in it was
//     rendered".

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { ASSISTANT_SOURCE_KINDS, ASSISTANT_STAGES } from "@/lib/assistant/types";

import {
  askQuestion,
  parseTurn,
  readConversation,
  readConversationList,
  removeConversation,
  startConversation,
} from "./client";

import type { AssistantStage } from "@/lib/assistant/types";

const APP = path.resolve(import.meta.dirname, "../../app");

/**
 * The route file a URL resolves to, walked against the real app router.
 *
 * Exact directory first, then a single dynamic segment — which is how Next resolves it — so
 * `/api/assistant/conversations/<id>/turns` lands on `[id]/turns/route.ts` without this test
 * knowing that the parameter is called `id`.
 */
function routeFileFor(url: string): string | null {
  let directory = APP;
  for (const segment of url.split("?")[0].split("/").filter(Boolean)) {
    const entries = fs.readdirSync(directory, { withFileTypes: true }).filter((e) => e.isDirectory());
    const exact = entries.find((entry) => entry.name === segment);
    const dynamic = entries.filter((entry) => /^\[.+\]$/.test(entry.name));
    const next = exact ?? (dynamic.length === 1 ? dynamic[0] : undefined);
    if (next === undefined) return null;
    directory = path.join(directory, next.name);
  }
  const file = path.join(directory, "route.ts");
  return fs.existsSync(file) ? file : null;
}

function conversation(overrides: Record<string, unknown> = {}) {
  return {
    createdAt: "2026-08-22T09:00:00.000Z",
    id: "11111111-1111-4111-8111-111111111111",
    lastActivityAt: "2026-08-22T09:05:00.000Z",
    messageCount: 2,
    scope: "operator",
    title: "Which clients are closest to funding?",
    ...overrides,
  };
}

function turn(overrides: Record<string, unknown> = {}) {
  return {
    body: "Two clients are close.\n\n- One is in Ready.",
    bullets: ["One is in Ready."],
    createdAt: "2026-08-22T09:05:00.000Z",
    headline: "Two clients are close.",
    id: "22222222-2222-4222-8222-222222222222",
    role: "assistant",
    sources: [{ kind: "client", label: "Client · Morgan Ready Demo", ref: "tracker:x" }],
    ...overrides,
  };
}

/** A fetcher that records the URLs it was asked for and answers from a queue. */
function recording(answers: readonly (() => Response)[]) {
  const urls: string[] = [];
  const inits: (RequestInit | undefined)[] = [];
  let index = 0;
  const fetcher = ((url: string, init?: RequestInit) => {
    urls.push(url);
    inits.push(init);
    const make = answers[Math.min(index, answers.length - 1)];
    index += 1;
    return Promise.resolve(make());
  }) as unknown as typeof fetch;
  return { fetcher, inits, urls };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function ndjson(chunks: readonly string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { headers: { "content-type": "application/x-ndjson" }, status: 200 },
  );
}

describe("the assistant's durable client", () => {
  it("asks only URLs the app router actually serves", async () => {
    const id = conversation().id;
    const list = recording([() => json({ conversations: [], enabled: true })]);
    await readConversationList("operator", list.fetcher);
    const read = recording([() => json({ conversation: conversation(), turns: [] })]);
    await readConversation(id, read.fetcher);
    const open = recording([() => json({ conversation: conversation() }, 201)]);
    await startConversation("operator", open.fetcher);
    const remove = recording([() => new Response(null, { status: 204 })]);
    await removeConversation(id, remove.fetcher);
    const ask = recording([() => ndjson([`${JSON.stringify({ error: "ASSISTANT_UNAVAILABLE" })}\n`])]);
    await askQuestion(id, "hello", () => {}, ask.fetcher);

    const urls = [...list.urls, ...read.urls, ...open.urls, ...remove.urls, ...ask.urls];
    // The derivation asserted non-empty first, so a client that stopped calling anything cannot
    // pass this vacuously.
    assert.ok(urls.length >= 5, `only ${urls.length} request(s) were made`);
    for (const url of urls) {
      assert.ok(routeFileFor(url), `${url} resolves to no route file under app/`);
    }
  });

  it("sends no-store credentials on the reads and a JSON body on the write", async () => {
    const list = recording([() => json({ conversations: [], enabled: true })]);
    await readConversationList("operator", list.fetcher);
    assert.equal(list.inits[0]?.cache, "no-store");
    assert.equal(list.inits[0]?.credentials, "same-origin");

    const ask = recording([() => ndjson([`${JSON.stringify({ error: "ASSISTANT_UNAVAILABLE" })}\n`])]);
    await askQuestion(conversation().id, "  spaced  ", () => {}, ask.fetcher);
    assert.equal(ask.inits[0]?.method, "POST");
    assert.deepEqual(JSON.parse(String(ask.inits[0]?.body)), { question: "  spaced  " });
  });

  it("lists only this scope's conversations", async () => {
    const mine = conversation({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", scope: "operator" });
    const theirs = conversation({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", scope: "admin" });
    const { fetcher } = recording([() => json({ conversations: [mine, theirs], enabled: true })]);
    const read = await readConversationList("operator", fetcher);
    assert.equal(read.status, "ready");
    assert.deepEqual(
      read.status === "ready" ? read.conversations.map((row) => row.id) : [],
      [mine.id],
      "the operator workspace lists a platform conversation",
    );
  });

  it("tells a disabled flag, a broken read and an empty history apart", async () => {
    const off = await readConversationList(
      "operator",
      recording([() => json({ conversations: [], enabled: false })]).fetcher,
    );
    assert.equal(off.status, "disabled");

    const empty = await readConversationList(
      "operator",
      recording([() => json({ conversations: [], enabled: true })]).fetcher,
    );
    assert.equal(empty.status, "ready");

    const thrown = (() => Promise.reject(new Error("offline"))) as unknown as typeof fetch;
    const broken = await readConversationList("operator", thrown);
    assert.equal(broken.status, "failed", "a dropped network read rendered as an empty history");

    const garbage = await readConversationList(
      "operator",
      recording([() => new Response("not json", { status: 200 })]).fetcher,
    );
    assert.equal(garbage.status, "failed");
  });

  it("separates a conversation that is gone from one that could not be read", async () => {
    const missing = await readConversation(
      conversation().id,
      recording([() => json({ error: "ASSISTANT_NOT_FOUND" }, 404)]).fetcher,
    );
    assert.equal(missing.status, "missing");
    const broken = await readConversation(
      conversation().id,
      recording([() => json({ error: "ASSISTANT_UNAVAILABLE" }, 500)]).fetcher,
    );
    assert.equal(broken.status, "failed");
  });

  it("reports a stage only when the server sent one it knows", async () => {
    const seen: AssistantStage[] = [];
    const lines = [
      ...ASSISTANT_STAGES.map((stage) => `${JSON.stringify({ stage })}\n`),
      `${JSON.stringify({ stage: "polishing" })}\n`,
      `${JSON.stringify({ answer: { conversation: conversation(), turn: turn() } })}\n`,
    ];
    const outcome = await askQuestion(
      conversation().id,
      "q",
      (progress) => seen.push(progress.stage),
      recording([() => ndjson(lines)]).fetcher,
    );
    assert.equal(outcome.status, "answered");
    // Replayed from the vocabulary, so a fourth stage is covered the day the server sends one —
    // and an invented stage is not reported at all.
    assert.deepEqual(seen, [...ASSISTANT_STAGES]);
  });

  it("survives a chunk boundary landing inside a line", async () => {
    const seen: AssistantStage[] = [];
    const whole = `${JSON.stringify({ stage: ASSISTANT_STAGES[0] })}\n${JSON.stringify({
      stage: ASSISTANT_STAGES[1],
    })}\n${JSON.stringify({ answer: { conversation: conversation(), turn: turn() } })}\n`;
    const cut = Math.floor(whole.length / 3);
    const outcome = await askQuestion(
      conversation().id,
      "q",
      (progress) => seen.push(progress.stage),
      recording([() => ndjson([whole.slice(0, cut), whole.slice(cut, cut + 9), whole.slice(cut + 9)])])
        .fetcher,
    );
    assert.deepEqual(seen, [ASSISTANT_STAGES[0], ASSISTANT_STAGES[1]]);
    assert.equal(outcome.status, "answered");
  });

  it("calls a stream that ended after a stage what it is", async () => {
    const outcome = await askQuestion(
      conversation().id,
      "q",
      () => {},
      recording([() => ndjson([`${JSON.stringify({ stage: ASSISTANT_STAGES[0] })}\n`])]).fetcher,
    );
    assert.equal(outcome.status, "failed", "a dropped stream was reported as an answer");
    assert.equal(outcome.status === "failed" ? outcome.code : null, "ASSISTANT_UNAVAILABLE");
  });

  it("carries the server's own refusal code, from the stream and from the status line", async () => {
    const streamed = await askQuestion(
      conversation().id,
      "q",
      () => {},
      recording([() => ndjson([`${JSON.stringify({ error: "ASSISTANT_ANSWER_UNAVAILABLE" })}\n`])])
        .fetcher,
    );
    assert.deepEqual(streamed, { code: "ASSISTANT_ANSWER_UNAVAILABLE", status: "failed" });

    const refused = await askQuestion(
      conversation().id,
      "q",
      () => {},
      recording([() => json({ error: "ASSISTANT_FORBIDDEN" }, 403)]).fetcher,
    );
    assert.deepEqual(refused, { code: "ASSISTANT_FORBIDDEN", status: "failed" });

    // A code this build does not know must not reach the workspace's error table as an unknown.
    const invented = await askQuestion(
      conversation().id,
      "q",
      () => {},
      recording([() => json({ error: "ASSISTANT_TEAPOT" }, 418)]).fetcher,
    );
    assert.deepEqual(invented, { code: "ASSISTANT_UNAVAILABLE", status: "failed" });
  });

  it("refuses an answer whose turn is missing its words", async () => {
    const headless: Record<string, unknown> = { ...turn() };
    delete headless.headline;
    const outcome = await askQuestion(
      conversation().id,
      "q",
      () => {},
      recording([
        () => ndjson([`${JSON.stringify({ answer: { conversation: conversation(), turn: headless } })}\n`]),
      ]).fetcher,
    );
    assert.equal(outcome.status, "failed", "an answer with no words in it was rendered");
  });

  it("drops a source whose kind is outside the contract's five", () => {
    // Built from the vocabulary rather than named, so this stays a kind that is provably absent.
    const unknownKind = `${ASSISTANT_SOURCE_KINDS.join("-")}-unknown`;
    assert.equal(
      (ASSISTANT_SOURCE_KINDS as readonly string[]).includes(unknownKind),
      false,
      "the hostile kind collided with a real one",
    );
    const parsed = parseTurn(
      turn({
        sources: [
          { kind: unknownKind, label: "Something", ref: null },
          { kind: ASSISTANT_SOURCE_KINDS[0], label: "Client · Morgan Ready Demo", ref: null },
          { kind: ASSISTANT_SOURCE_KINDS[0], label: "   ", ref: null },
        ],
      }),
    );
    assert.ok(parsed);
    assert.deepEqual(
      parsed.sources.map((source) => source.kind),
      [ASSISTANT_SOURCE_KINDS[0]],
    );
  });

  it("carries the server's refusal when a conversation cannot be opened", async () => {
    const refused = await startConversation(
      "operator",
      recording([() => json({ error: "ASSISTANT_SCOPE_INVALID" }, 422)]).fetcher,
    );
    assert.deepEqual(refused, { code: "ASSISTANT_SCOPE_INVALID", status: "failed" });

    const signedOut = await startConversation(
      "operator",
      recording([() => json({ error: "ASSISTANT_ACTOR_REQUIRED" }, 401)]).fetcher,
    );
    assert.deepEqual(
      signedOut,
      { code: "ASSISTANT_ACTOR_REQUIRED", status: "failed" },
      "a signed-out session was reported as an unreachable server",
    );

    const opened = await startConversation(
      "operator",
      recording([() => json({ conversation: conversation() }, 201)]).fetcher,
    );
    assert.equal(opened.status, "opened");
  });

  it("reports a delete only when the server performed one", async () => {
    assert.equal(
      await removeConversation(conversation().id, recording([() => new Response(null, { status: 204 })]).fetcher),
      true,
    );
    assert.equal(
      await removeConversation(conversation().id, recording([() => json({ error: "ASSISTANT_FORBIDDEN" }, 403)]).fetcher),
      false,
    );
  });
});
