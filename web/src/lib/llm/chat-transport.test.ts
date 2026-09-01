import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { createZdrChatTransport, OPENROUTER_MODEL, OpenRouterDriverError, PROVIDER_SORTS } from "./chat-transport.ts";
import { evaluateText } from "./evaluator.ts";
import { createMockChatTransport } from "./mock-chat-transport.ts";

const SCHEMA = { type: "object", additionalProperties: false, required: ["ok"], properties: { ok: { type: "boolean" } } } as const;
const REQUEST = { operation: "kb.candidate", schemaName: "kb_candidate_v1", schema: SCHEMA, maxTokens: 64, messages: [{ role: "system" as const, content: "Use supplied context." }, { role: "user" as const, content: "{}" }] };

function success(value: unknown): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }), { status: 200 });
}

describe("chat transport", () => {
  it("sends the shared strict privacy contract", async () => {
    let captured: Record<string, unknown> | null = null;
    const fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      captured = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return success({ ok: true });
    }) as typeof globalThis.fetch;
    const transport = createZdrChatTransport({ apiKey: "unit-test-key", fetch });
    assert.deepEqual(await transport.complete(REQUEST), { ok: true });
    const requestBody = captured as unknown as Record<string, unknown>;
    assert.deepEqual(requestBody.provider, { zdr: true, data_collection: "deny", require_parameters: true });
    assert.deepEqual(requestBody.response_format, { type: "json_schema", json_schema: { name: "kb_candidate_v1", strict: true, schema: SCHEMA } });
  });

  it("carries the model and reasoning the caller bound, and omits the block when told to", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return success({ ok: true });
    }) as typeof globalThis.fetch;

    const fallback = createZdrChatTransport({ apiKey: "unit-test-key", fetch });
    await fallback.complete(REQUEST);
    assert.equal(bodies[0]!.model, OPENROUTER_MODEL, "an unbound transport must still talk to the shared constant");
    assert.deepEqual(bodies[0]!.reasoning, { effort: "low" }, "the default must stay the family floor");
    assert.equal(fallback.model, OPENROUTER_MODEL, "the reported model must be the one actually sent");

    const bound = createZdrChatTransport({ apiKey: "unit-test-key", fetch, model: "vendor/small", reasoning: "off" });
    await bound.complete(REQUEST);
    assert.equal(bodies[1]!.model, "vendor/small");
    assert.equal(bound.model, "vendor/small");
    // The whole reason `off` exists. `require_parameters: true` routes only to
    // providers supporting every parameter in the request, so sending
    // `reasoning` to a model that does not reason can empty the provider set and
    // fail the request outright — which would make the model override unusable
    // for exactly the small fast models it exists to reach. The key must be
    // absent, not null and not an empty object.
    assert.equal("reasoning" in bodies[1]!, false, "the reasoning key must be absent, not falsy");
    assert.deepEqual(bodies[1]!.provider, { zdr: true, data_collection: "deny", require_parameters: true }, "the ZDR posture is identical on every arm");
  });

  it("asks for a provider order only when the caller chose one, and changes nothing else about the posture", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return success({ ok: true });
    }) as typeof globalThis.fetch;
    // Derived from the transport's own vocabulary: every sort it offers must
    // reach the wire under OpenRouter's key, beside the unchanged ZDR contract.
    for (const sort of PROVIDER_SORTS) {
      await createZdrChatTransport({ apiKey: "unit-test-key", fetch, providerSort: sort }).complete(REQUEST);
      assert.deepEqual(bodies.at(-1)!.provider, { zdr: true, data_collection: "deny", require_parameters: true, sort });
    }
    await createZdrChatTransport({ apiKey: "unit-test-key", fetch }).complete(REQUEST);
    assert.equal("sort" in (bodies.at(-1)!.provider as Record<string, unknown>), false, "an unbound transport must leave the order to OpenRouter, not send a null");
  });

  /**
   * The production outage this pair exists to prevent.
   *
   * OPENROUTER_MODEL is a reasoning model and OpenRouter bills its reasoning
   * tokens against max_tokens. Every supervisor call in the product budgeted for
   * the answer alone, so the model spent the whole allowance thinking, the
   * provider returned 200 with `finish_reason: "length"` and a harmony fragment
   * (`<|start|>assistant<|channel|>final `) instead of JSON, and the driver
   * reported OPENROUTER_CONTENT_INVALID — a code that says "the model wrote
   * nonsense" and hid the real cause, which was our own budget. Signed in against
   * production, every KB answer came back "A grounded answer is unavailable right
   * now."
   *
   * Watched failing on the pre-fix tree: the headroom assertion failed because
   * max_tokens equalled the caller's number exactly, and the truncation assertion
   * failed with OPENROUTER_CONTENT_INVALID.
   *
   * The headroom figure is read out of the module rather than transcribed, so
   * changing the constant moves the test with it instead of leaving it asserting
   * a number the transport no longer uses.
   */
  it("budgets the model room to think on top of what the caller asked for", async () => {
    const source = readFileSync(fileURLToPath(new URL("./chat-transport.ts", import.meta.url)), "utf8");
    const declared = /const REASONING_HEADROOM_TOKENS = (\d+);/.exec(source);
    assert.ok(declared, "the transport no longer declares a reasoning headroom");
    const headroom = Number(declared[1]);

    let captured: Record<string, unknown> | null = null;
    const fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      captured = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return success({ ok: true });
    }) as typeof globalThis.fetch;
    await createZdrChatTransport({ apiKey: "unit-test-key", fetch }).complete(REQUEST);
    const body = captured as unknown as Record<string, unknown>;
    assert.equal(body.max_tokens, REQUEST.maxTokens + headroom);
    assert.deepEqual(body.reasoning, { effort: "low" });
  });

  it("names a truncated completion as truncated, not as malformed content", async () => {
    // The literal a harmony-format model returns when the budget runs out
    // mid-generation. It is a 200 with a body, which is why it parsed as an
    // envelope and then failed only at the content parse.
    const fetch = (async () => new Response(JSON.stringify({
      choices: [{ finish_reason: "length", message: { content: "<|start|>assistant<|channel|>final " } }],
    }), { status: 200 })) as typeof globalThis.fetch;
    await assert.rejects(createZdrChatTransport({ apiKey: "unit-test-key", fetch }).complete(REQUEST), (error: unknown) => {
      assert.ok(error instanceof OpenRouterDriverError);
      assert.equal(error.code, "OPENROUTER_TRUNCATED");
      return true;
    });
  });

  it("retries one malformed 200 response and recovers without relaxing the schema", async () => {
    let calls = 0;
    const fetch = (async () => {
      calls += 1;
      return calls === 1
        ? success({ ok: true, extra: "provider detail" })
        : success({ ok: true });
    }) as typeof globalThis.fetch;
    assert.deepEqual(
      await createZdrChatTransport({ apiKey: "unit-test-key", fetch }).complete(REQUEST),
      { ok: true },
    );
    assert.equal(calls, 2);
  });

  it("rejects repeated malformed output with bounded metadata", async () => {
    let calls = 0;
    const fetch = (async () => {
      calls += 1;
      return success({ ok: true, extra: "provider detail" });
    }) as typeof globalThis.fetch;
    await assert.rejects(createZdrChatTransport({ apiKey: "unit-test-key", fetch }).complete(REQUEST), (error: unknown) => {
      assert.ok(error instanceof OpenRouterDriverError);
      assert.equal(error.code, "OPENROUTER_SCHEMA_INVALID");
      assert.equal(error.attempt, 2);
      assert.equal(JSON.stringify(error).includes("provider detail"), false);
      return true;
    });
    assert.equal(calls, 2);
  });

  it("parses an envelope behind OpenRouter's keep-alive padding", async () => {
    // A non-streaming completion arrives front-padded while the model
    // generates — whitespace on a good day, ": OPENROUTER PROCESSING" comment
    // lines on others. The padded and unpadded forms are the same 200 and must
    // parse the same; before the fix the comment form failed
    // OPENROUTER_ENVELOPE_INVALID, which is how production analysis runs died
    // on responses that were fine.
    const envelope = JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ok: true }) } }] });
    const fetch = (async () => new Response(`: OPENROUTER PROCESSING\n\n   \n${envelope}`, { status: 200 })) as typeof globalThis.fetch;
    assert.deepEqual(await createZdrChatTransport({ apiKey: "unit-test-key", fetch }).complete(REQUEST), { ok: true });
  });

  it("bounds the body read, not just the time to headers", async () => {
    // OpenRouter sends headers (and padding) the moment it accepts the request,
    // so a timer cleared when `fetch` resolves bounds nothing — production
    // attempts ran 35–105s inside the body read and ticks hit the 300s function
    // ceiling. The stream below never ends; only an abort that stays armed
    // through the read can finish this test.
    const fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(streamController) {
          streamController.enqueue(new TextEncoder().encode(" "));
          init?.signal?.addEventListener("abort", () => streamController.error(new Error("aborted")), { once: true });
        },
      });
      return new Response(body, { status: 200 });
    }) as typeof globalThis.fetch;
    await assert.rejects(
      createZdrChatTransport({ apiKey: "unit-test-key", fetch }).complete({ ...REQUEST, timeLimitMs: 100 }),
      (error: unknown) => {
        assert.ok(error instanceof OpenRouterDriverError);
        assert.equal(error.code, "OPENROUTER_TIMEOUT");
        return true;
      },
    );
  });

  it("keeps the deterministic mock on the same interface", async () => {
    let calls = 0;
    const transport = createMockChatTransport((request) => { calls += 1; return { operation: request.operation }; });
    assert.deepEqual(await transport.complete(REQUEST), { operation: "kb.candidate" });
    assert.deepEqual(await transport.complete(REQUEST), { operation: "kb.candidate" });
    assert.equal(calls, 2);
  });

  it("exports the canonical text evaluator without a plan-shaped code", () => {
    assert.deepEqual(evaluateText("Plain funding readiness guidance."), { approved: true, codes: [] });
    assert.ok(evaluateText(Buffer.from("ZGlzcHV0", "base64").toString("utf8")).codes.includes("LANGUAGE_C01"));
  });
});
