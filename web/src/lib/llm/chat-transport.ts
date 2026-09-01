export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
// Measured against the live account on the operator's own question, with this
// transport's exact request shape, before choosing:
//
//   gpt-oss-20b      3.9s  $0.000030  "Casey Clean Demo"
//   gpt-oss-120b     2.6s  $0.000078  "Casey Clean Demo (readiness 88) and Devon
//                                      Derog Demo (readiness 71) are the clients
//                                      closest to funding."
//   gemini-2.5-flash 2.8s  $0.001080  comparable answer, 36x the cost
//   claude-haiku-4.5 14.3s $0.002139  richest answer, 70x the cost, 5x the latency
//
// The 120b is faster than the 20b it replaces, answers a workspace question with
// the figures an operator asked about rather than a bare name, and stays in the
// same model family — so the harmony-format truncation behaviour this transport
// now guards against, and the strict json_schema support it depends on, are the
// ones already tested rather than a new set to rediscover.
export const OPENROUTER_MODEL = "openai/gpt-oss-120b";
const ATTEMPT_LIMIT = 2;
// Per-attempt wall clock, headers AND body. OpenRouter answers a non-streaming
// request with keep-alive padding the moment it accepts it, so time-to-headers
// is always instant and the generation happens inside the body read — a limit
// that stops at `fetch` resolving bounds nothing (measured: a 4096-token
// candidate on the production model returned headers in <1s and finished the
// body 50–105s later, while this constant claimed 20s). Callers whose
// operations legitimately generate for longer pass their own budget.
const ATTEMPT_TIMEOUT_MS = 30_000;
const RESPONSE_LIMIT_BYTES = 64 * 1024;
const RETRY_DELAY_LIMIT_MS = 2_000;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const OPERATION_PATTERN = /^[a-z][a-z0-9._:-]{0,63}$/;
const RETRYABLE_RESPONSE_CODES: ReadonlySet<OpenRouterErrorCode> = new Set([
  "OPENROUTER_ENVELOPE_INVALID",
  "OPENROUTER_CONTENT_INVALID",
  "OPENROUTER_SCHEMA_INVALID",
]);

export type OpenRouterErrorCode =
  | "OPENROUTER_API_KEY_MISSING"
  | "OPENROUTER_TIMEOUT"
  | "OPENROUTER_NETWORK"
  | "OPENROUTER_HTTP"
  | "OPENROUTER_RESPONSE_TOO_LARGE"
  | "OPENROUTER_ENVELOPE_INVALID"
  | "OPENROUTER_TRUNCATED"
  | "OPENROUTER_CONTENT_INVALID"
  | "OPENROUTER_SCHEMA_INVALID";

export interface ChatMessage {
  readonly role: "system" | "user";
  readonly content: string;
}

export interface ChatRequest {
  readonly operation: string;
  readonly schemaName: string;
  readonly schema: unknown;
  readonly maxTokens: number;
  readonly messages: readonly ChatMessage[];
  /**
   * Wall-clock budget per attempt, covering the whole exchange — connection,
   * headers and the body read where the generation actually happens. Optional;
   * the default suits verdict-sized answers. A caller budgeting thousands of
   * answer tokens must budget the seconds they take too.
   */
  readonly timeLimitMs?: number;
}

export interface ChatTransport {
  readonly driver: "mock" | "openrouter";
  readonly model: string;
  complete(request: ChatRequest): Promise<unknown>;
}

export class OpenRouterDriverError extends Error {
  readonly code: OpenRouterErrorCode;
  readonly operation: string;
  readonly status: number | null;
  readonly attempt: number;
  readonly requestId: string | null;

  constructor(input: { code: OpenRouterErrorCode; operation: string; status: number | null; attempt: number; requestId?: string | null }) {
    super(input.code);
    this.name = "OpenRouterDriverError";
    this.code = input.code;
    this.operation = OPERATION_PATTERN.test(input.operation) ? input.operation : "invalid";
    this.status = input.status;
    this.attempt = input.attempt;
    this.requestId = input.requestId ?? null;
  }
}

export interface ZdrChatTransportOptions {
  readonly apiKey: string | undefined;
  /**
   * The model this transport talks to. Defaults to `OPENROUTER_MODEL`.
   *
   * A caller passes one when its operations have a different shape from the
   * plan engine's — the KB assistants are short supervised exchanges a reader
   * waits on, where time to first word is the product, while a plan candidate is
   * a long structured generation nobody is watching. One constant cannot be
   * right for both, and the alternative to this parameter is a second transport
   * that copies the retry, timeout, truncation and envelope handling this one
   * has already been fixed for twice.
   *
   * Note that the `OPENROUTER_MODEL` **environment variable** in `.env.example`
   * is read by nothing — the model has always been the constant below. Setting
   * that variable has no effect today, and did not before this change either.
   */
  readonly model?: string;
  /** See `ReasoningSetting`. Defaults to `low`, which is correct for `OPENROUTER_MODEL` and wrong to change without changing the model too. */
  readonly reasoning?: ReasoningSetting;
  /**
   * How OpenRouter orders the ZDR providers that survive `require_parameters`.
   *
   * Absent, OpenRouter load-balances by price, and for `OPENROUTER_MODEL` the
   * cheapest ZDR endpoints are the slow ones — the model is also served under
   * ZDR with strict `json_schema` by Cerebras and Groq, which generate it an
   * order of magnitude faster. Profiled on the deployment (2026-08-24): a
   * 4,000-token candidate took 3–8s and a 128-token verdict 1.6–4.4s on the
   * default routing. `throughput` asks for the fastest generator first; every
   * other part of the request — ZDR, `data_collection: "deny"`, strict schema —
   * is unchanged, so this decides only which upstream serves.
   */
  readonly providerSort?: ProviderSort;
  readonly fetch?: typeof globalThis.fetch;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly now?: () => number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function matchesJsonSchema(value: unknown, schemaValue: unknown): boolean {
  if (!isRecord(schemaValue)) return false;
  if ("const" in schemaValue && !sameJsonValue(value, schemaValue.const)) return false;
  if (Array.isArray(schemaValue.enum) && !schemaValue.enum.some((item) => sameJsonValue(item, value))) return false;
  switch (schemaValue.type) {
    case "object": {
      if (!isRecord(value) || !isRecord(schemaValue.properties)) return false;
      const properties = schemaValue.properties;
      const required = Array.isArray(schemaValue.required) ? schemaValue.required : [];
      if (!required.every((key) => typeof key === "string" && key in value)) return false;
      if (schemaValue.additionalProperties === false && Object.keys(value).some((key) => !(key in properties))) return false;
      return Object.entries(value).every(([key, item]) => properties[key] !== undefined && matchesJsonSchema(item, properties[key]));
    }
    case "array":
      return Array.isArray(value)
        && (typeof schemaValue.minItems !== "number" || value.length >= schemaValue.minItems)
        && (typeof schemaValue.maxItems !== "number" || value.length <= schemaValue.maxItems)
        && value.every((item) => matchesJsonSchema(item, schemaValue.items));
    case "string":
      return typeof value === "string"
        && (typeof schemaValue.minLength !== "number" || value.length >= schemaValue.minLength)
        && (typeof schemaValue.maxLength !== "number" || value.length <= schemaValue.maxLength);
    case "integer":
      return typeof value === "number" && Number.isInteger(value)
        && (typeof schemaValue.minimum !== "number" || value >= schemaValue.minimum)
        && (typeof schemaValue.maximum !== "number" || value <= schemaValue.maximum);
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        && (typeof schemaValue.minimum !== "number" || value >= schemaValue.minimum)
        && (typeof schemaValue.maximum !== "number" || value <= schemaValue.maximum);
    case "boolean": return typeof value === "boolean";
    case "null": return value === null;
    case undefined: return "const" in schemaValue || Array.isArray(schemaValue.enum);
    default: return false;
  }
}

function requestIdFrom(response: Response): string | null {
  const value = response.headers.get("x-request-id");
  return value !== null && REQUEST_ID_PATTERN.test(value) ? value : null;
}

function retryDelay(response: Response, now: () => number): number {
  const value = response.headers.get("retry-after");
  if (value === null) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(Math.round(seconds * 1_000), RETRY_DELAY_LIMIT_MS);
  const date = Date.parse(value);
  return Number.isNaN(date) ? 0 : Math.min(Math.max(date - now(), 0), RETRY_DELAY_LIMIT_MS);
}

async function readBounded(response: Response, input: { operation: string; attempt: number; requestId: string | null }): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > RESPONSE_LIMIT_BYTES) {
    throw new OpenRouterDriverError({ code: "OPENROUTER_RESPONSE_TOO_LARGE", operation: input.operation, status: response.status, attempt: input.attempt, requestId: input.requestId });
  }
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let output = "";
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    total += chunk.value.byteLength;
    if (total > RESPONSE_LIMIT_BYTES) {
      await reader.cancel();
      throw new OpenRouterDriverError({ code: "OPENROUTER_RESPONSE_TOO_LARGE", operation: input.operation, status: response.status, attempt: input.attempt, requestId: input.requestId });
    }
    output += decoder.decode(chunk.value, { stream: true });
  }
  return output + decoder.decode();
}

function extractContent(body: string, input: { operation: string; status: number; attempt: number; requestId: string | null }): unknown {
  // OpenRouter keeps a non-streaming connection alive by front-padding the body
  // while the model generates — usually whitespace, sometimes comment lines
  // (": OPENROUTER PROCESSING"). Neither is part of the envelope, and parsing
  // the padded string as-is made the same 200 response parse or fail depending
  // on which padding the proxy chose that day. The envelope is always a JSON
  // object, so it starts at the first brace.
  const envelopeStart = body.indexOf("{");
  let envelope: unknown;
  try { envelope = JSON.parse(envelopeStart === -1 ? body : body.slice(envelopeStart)); } catch {
    throw new OpenRouterDriverError({ code: "OPENROUTER_ENVELOPE_INVALID", ...input });
  }
  if (!isRecord(envelope) || !Array.isArray(envelope.choices) || envelope.choices.length < 1) {
    throw new OpenRouterDriverError({ code: "OPENROUTER_ENVELOPE_INVALID", ...input });
  }
  const first = envelope.choices[0];
  if (!isRecord(first) || !isRecord(first.message) || typeof first.message.content !== "string") {
    throw new OpenRouterDriverError({ code: "OPENROUTER_ENVELOPE_INVALID", ...input });
  }
  // A truncated completion is not a malformed one, and conflating them cost us a
  // production outage nobody could see. When the budget runs out mid-generation the
  // provider still returns 200 with whatever it had written — for a harmony-format
  // model that is a fragment like `<|start|>assistant<|channel|>final `, which fails
  // JSON.parse and used to surface as OPENROUTER_CONTENT_INVALID. That code reads as
  // "the model wrote nonsense", so the real cause (our own max_tokens) stayed hidden
  // while every supervised answer in the product returned "unavailable". Naming it
  // separately is what makes the next occurrence diagnosable from the code alone.
  if (first.finish_reason === "length") {
    throw new OpenRouterDriverError({ code: "OPENROUTER_TRUNCATED", ...input });
  }
  try { return JSON.parse(first.message.content); } catch {
    throw new OpenRouterDriverError({ code: "OPENROUTER_CONTENT_INVALID", ...input });
  }
}

/**
 * Room for the model to think, added on top of whatever the caller budgeted.
 *
 * `OPENROUTER_MODEL` is a reasoning model and OpenRouter charges its reasoning
 * tokens against `max_tokens`, so a caller who budgets 80 tokens for a one-field
 * boolean verdict is not budgeting a small answer — it is budgeting a model that
 * never reaches the answer. Measured against the live account: the KB supervisor
 * at 80 spent 85 tokens reasoning and returned `finish_reason: "length"` with no
 * JSON at all.
 *
 * The caller's number stays a statement about how much *answer* it wants, which
 * is the only thing a caller can sensibly reason about, and the transport adds
 * what the model needs to get there. 256 is generous against the 38 reasoning
 * tokens `effort: "low"` actually spends on a verdict, and it is cheap: unused
 * budget is not billed.
 */
const REASONING_HEADROOM_TOKENS = 256;

/**
 * How the reasoning block is set, and why it is a caller's choice rather than a
 * constant.
 *
 * `low` is the right setting for `OPENROUTER_MODEL` and every operation this
 * transport serves: structured extraction or a verdict against a schema, never
 * open-ended writing. Measured on the supervisor call it is 2.6x faster and 3x
 * cheaper than the default and returns the same verdict, and it is the floor for
 * this model family — harmony models reason as part of generating, so there is
 * no setting below it and none of them is "off".
 *
 * `off` omits the block entirely, and it exists because of an interaction that
 * would otherwise make the model override unusable. `provider.require_parameters`
 * is `true`, which tells OpenRouter to route only to providers that support
 * **every** parameter in the request. Send `reasoning` to a model that does not
 * reason and the candidate provider set can come back empty — an HTTP error, not
 * a graceful ignore. So anyone who points a KB call at a small non-reasoning
 * model has to be able to stop sending it, or their first request fails and the
 * arm silently falls back.
 *
 * Which means `off` is **not** a speed setting. On a reasoning model, omitting
 * the block hands the choice to the provider's own default, which is higher than
 * `low` — slower and dearer, the exact opposite of the intent. It is only
 * correct alongside a model that does not reason at all.
 */
export type ReasoningSetting = "low" | "off";

export const PROVIDER_SORTS = Object.freeze(["throughput", "latency", "price"] as const);
export type ProviderSort = (typeof PROVIDER_SORTS)[number];

function buildRequest(request: ChatRequest, model: string, reasoning: ReasoningSetting, providerSort: ProviderSort | undefined) {
  return {
    model,
    messages: request.messages,
    temperature: 0,
    max_tokens: request.maxTokens + REASONING_HEADROOM_TOKENS,
    stream: false,
    ...(reasoning === "off" ? {} : { reasoning: { effort: reasoning } }),
    provider: { zdr: true, data_collection: "deny", require_parameters: true, ...(providerSort === undefined ? {} : { sort: providerSort }) },
    response_format: { type: "json_schema", json_schema: { name: request.schemaName, strict: true, schema: request.schema } },
  };
}

export function createZdrChatTransport(options: ZdrChatTransportOptions): ChatTransport {
  if (options.apiKey === undefined || options.apiKey.trim() === "") {
    throw new OpenRouterDriverError({ code: "OPENROUTER_API_KEY_MISSING", operation: "candidate", status: null, attempt: 0 });
  }
  const apiKey = options.apiKey;
  const model = options.model ?? OPENROUTER_MODEL;
  const reasoning = options.reasoning ?? "low";
  const send = options.fetch ?? globalThis.fetch;
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const now = options.now ?? Date.now;
  return Object.freeze({
    driver: "openrouter" as const,
    model,
    async complete(request: ChatRequest): Promise<unknown> {
      const operation = OPERATION_PATTERN.test(request.operation) ? request.operation : "invalid";
      const body = buildRequest(request, model, reasoning, options.providerSort);
      const timeLimitMs = request.timeLimitMs ?? ATTEMPT_TIMEOUT_MS;
      for (let attempt = 1; attempt <= ATTEMPT_LIMIT; attempt += 1) {
        const controller = new AbortController();
        let timedOut = false;
        // Armed across the WHOLE attempt: the padding OpenRouter sends while the
        // model generates means headers always arrive instantly and the real
        // time is spent in the body read below, so the timer must outlive the
        // fetch call or it bounds nothing.
        const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, timeLimitMs);
        let response: Response;
        try {
          response = await send(OPENROUTER_URL, { method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
        } catch {
          clearTimeout(timeout);
          if (attempt < ATTEMPT_LIMIT) continue;
          throw new OpenRouterDriverError({ code: timedOut ? "OPENROUTER_TIMEOUT" : "OPENROUTER_NETWORK", operation, status: null, attempt });
        }
        const requestId = requestIdFrom(response);
        if (!response.ok) {
          clearTimeout(timeout);
          if (attempt < ATTEMPT_LIMIT && (response.status === 429 || response.status >= 500)) {
            await sleep(retryDelay(response, now));
            continue;
          }
          throw new OpenRouterDriverError({ code: "OPENROUTER_HTTP", operation, status: response.status, attempt, requestId });
        }
        let responseBody: string;
        try {
          responseBody = await readBounded(response, { operation, attempt, requestId });
        } catch (error) {
          clearTimeout(timeout);
          if (error instanceof OpenRouterDriverError) throw error;
          // The abort landed mid-body: the generation exceeded the attempt's
          // budget. Retrying an over-budget generation with the same budget is
          // how the production drain burned 300-second function ceilings, so a
          // body-read timeout is terminal for the attempt loop too.
          throw new OpenRouterDriverError({ code: timedOut ? "OPENROUTER_TIMEOUT" : "OPENROUTER_NETWORK", operation, status: response.status, attempt, requestId });
        }
        clearTimeout(timeout);
        let content: unknown;
        try {
          content = extractContent(responseBody, { operation, status: response.status, attempt, requestId });
        } catch (error) {
          if (
            error instanceof OpenRouterDriverError
            && attempt < ATTEMPT_LIMIT
            && RETRYABLE_RESPONSE_CODES.has(error.code)
          ) {
            continue;
          }
          throw error;
        }
        if (!matchesJsonSchema(content, request.schema)) {
          if (attempt < ATTEMPT_LIMIT) continue;
          throw new OpenRouterDriverError({ code: "OPENROUTER_SCHEMA_INVALID", operation, status: response.status, attempt, requestId });
        }
        return content;
      }
      throw new OpenRouterDriverError({ code: "OPENROUTER_NETWORK", operation, status: null, attempt: ATTEMPT_LIMIT });
    },
  });
}
