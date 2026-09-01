import "server-only";

import type { ChatTransport } from "../llm/chat-transport.ts";
import type { KbProgressReporter } from "./progress.ts";
import { recordRouteFailure } from "../diagnostics/route-failure.ts";
import { complianceLanguageCodes } from "../compliance/language-rules.mjs";
import { issueGroundingHandles } from "./handles.ts";
import { containsUuidShaped, stripUuidShaped } from "./identifiers.ts";
import { KB_DECLINE_SUPERVISOR_PROMPT, KB_SUPERVISOR_PROMPT } from "./prompts.ts";

export interface GroundingDocument {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  /** Human reading of the record — record type plus display name. Falls back to the title when a builder omits it. */
  readonly label?: string;
  readonly content: string;
  readonly metadata: Readonly<Record<string, string | number | boolean | null>>;
}

/**
 * What a surface is handed for one cited source.
 *
 * `id` is the grounding document's real id and is the peek handle a surface
 * passes back to open the record it already holds; rail 3 covers it by never
 * being rendered. `label` is the one string meant to be printed.
 *
 * There is deliberately **no `url`**. F-06: the field held a fixture host, the
 * surfaces rendered it as an anchor with `target="_blank"`, and a client under
 * real auth could click through to a page that does not exist. A citation that
 * offers no destination is one no render site can turn into a live link by
 * reaching for the nearest field. `safeCitationHref()` stays where it is for the
 * day a real destination exists — that day this field comes back deliberately.
 */
export interface KbCitation {
  readonly id: string;
  readonly title: string;
  readonly label: string;
}

/**
 * A supervised answer in parts.
 *
 * F-09: this used to be one `answer` string, and the surface had to parse prose
 * back into the headline and bullets the design brief specifies. `answer-body.ts`
 * owns the encoding that carries these three fields through the single text
 * column storage gives a turn.
 */
export interface GroundedAnswer {
  readonly headline: string;
  readonly bullets: readonly string[];
  readonly citations: readonly KbCitation[];
}

/**
 * A citation carries `id` because the supervisor gate and the surfaces need a stable key, but the
 * key is an internal uuid and a user must never read one. Rather than trusting each render site to
 * pick the right field, the label a surface prints is stamped here, at the one point where a model
 * candidate is matched back to the grounding document it came from: every citation that leaves this
 * module already carries the only string that is meant to be shown, so a new render site cannot
 * reintroduce the leak by reaching for `id` again. The strip is belt-and-braces for the other
 * direction — a builder that lets a stored key into its own label still cannot surface it, because
 * anything uuid-shaped is removed before the label is accepted and a generic phrase stands in when
 * nothing legible survives.
 */
const CITATION_FALLBACK_LABEL = "Cited workspace record";
const MAX_CITATION_LABEL = 240;

export function citationLabel(document: GroundingDocument): string {
  const legible = stripUuidShaped(document.label ?? document.title).replace(/\s+/g, " ").replace(/^[\s·:,\-–—]+|[\s·:,\-–—]+$/g, "").trim();
  if (legible.length === 0) return CITATION_FALLBACK_LABEL;
  if (legible.length <= MAX_CITATION_LABEL) return legible;
  // The ordinal is the whole point of a duplicate-lender label: "Acme · First
  // Bank · Application 2" truncated from the right becomes indistinguishable
  // from "Application 1", which is exactly the record merge the ledger path
  // exists to prevent. Cut from the middle so the tail survives.
  const ordinal = /\s·\sApplication\s\d+$/i.exec(legible)?.[0];
  if (ordinal !== undefined && ordinal.length < MAX_CITATION_LABEL) {
    return `${legible.slice(0, MAX_CITATION_LABEL - ordinal.length - 2).trimEnd()}…${ordinal}`;
  }
  return legible.slice(0, MAX_CITATION_LABEL);
}

/**
 * The citation the model is allowed to return: a handle and nothing else.
 *
 * It used to echo the title and the url back so the belongs-check could compare
 * all three. The handle table is a stricter comparison than any of that — an
 * invented handle resolves to nothing — and dropping the echoes gives the answer
 * back the tokens they cost, which matters inside a 900-token budget that now
 * has to hold a headline and up to six bullets.
 */
const CITATION_SCHEMA = { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string", minLength: 1, maxLength: 32 } } } as const;
export const KB_CANDIDATE_SCHEMA = { type: "object", additionalProperties: false, required: ["headline", "bullets", "citations"], properties: { headline: { type: "string", minLength: 1, maxLength: 400 }, bullets: { type: "array", minItems: 0, maxItems: 6, items: { type: "string", minLength: 1, maxLength: 400 } }, citations: { type: "array", minItems: 1, maxItems: 8, items: CITATION_SCHEMA } } } as const;
const DOCUMENT_LEDGER_ITEM_SCHEMA = { type: "object", additionalProperties: false, required: ["id", "detail"], properties: { id: { type: "string", minLength: 1, maxLength: 32 }, detail: { type: "string", minLength: 1, maxLength: 300 } } } as const;
/**
 * Why the supervisor decided what it decided.
 *
 * The verdict was `{ approved: boolean }`, and a boolean is exactly enough to
 * stop an answer and not nearly enough to explain one. Three admin questions on
 * the live walk were declined and the `route_failure` line for each said only
 * `KB_SUPERVISOR_DECLINED`, so the cause had to be reasoned out from the shape
 * of the documents rather than read off the log. The vocabulary is closed and
 * small on purpose: it is a classification, so it is safe to log beside the
 * correlation id under the two-rails rule, where a free-text reason would be
 * model-written content and would not be.
 *
 * It also gives the caller something a boolean could not: `incomplete` is a
 * different kind of refusal from `forecast_or_guarantee`. One is an answer worth
 * regenerating, the other is a rule holding, and reporting both as a
 * non-retryable policy refusal told a reader to stop trying when trying again
 * was the right advice.
 */
export const KB_SUPERVISOR_REASONS = Object.freeze([
  "approved",
  "unsupported_statement",
  "citation_mismatch",
  "identifier_exposed",
  "forecast_or_guarantee",
  "instruction_outside_records",
  "incomplete",
] as const);

export type KbSupervisorReason = (typeof KB_SUPERVISOR_REASONS)[number];

/**
 * The declines a second draft can answer, and the fixed note it is handed.
 *
 * The reviewer is a model reading another model's draft, and on the live walk
 * it declined the same grounded comparison it had approved on the same records
 * two hours earlier — `unsupported_statement`, which names a sentence rather
 * than a rule. A sentence can be rewritten; a rule cannot be argued with. So a
 * decline for one of these reasons buys exactly one more draft, composed with
 * the reason attached as a fixed sentence from this table, and the reviewer
 * reads that draft cold. A decline for any other reason — an identifier, a
 * forecast, an instruction — is final on the first verdict, because a second
 * draft of a forecast is still a forecast.
 *
 * Nothing model-written travels in the note: the reviewer's verdict is an enum,
 * the note is keyed by that enum, and the candidate never sees the reviewer's
 * words because there are none.
 */
export const KB_REVISION_NOTES: Readonly<Partial<Record<KbSupervisorReason, string>>> = Object.freeze({
  unsupported_statement: "A reviewer found a statement in the previous draft that the supplied documents do not support. Write only what the supplied values state or what follows directly from them, and cite the document each statement comes from.",
  citation_mismatch: "A reviewer found a citation in the previous draft that does not match the supplied documents. Cite only the supplied document ids, one for each statement, and nothing else.",
  incomplete: "A reviewer found the previous draft left out records the question asked about. Cover every supplied document the question applies to, one statement each, and omit none.",
});

export const KB_SUPERVISOR_REVISABLE_REASONS = Object.freeze(
  (Object.keys(KB_REVISION_NOTES) as KbSupervisorReason[]).filter((reason) => KB_REVISION_NOTES[reason] !== undefined),
);

/** One first draft plus one revision. The second verdict is final either way. */
export const SUPERVISOR_ROUND_LIMIT = 2;

/**
 * What a structural retry tells the model it did wrong.
 *
 * The candidate loop always retried a leaked identifier or an unmatched
 * citation, but it re-asked with the identical request, so the second draft
 * failed the same way — measured live on 2026-08-23 (correlation
 * 556edc35-4ae5-4ad0-bc8e-1c7a87df7354): both drafts of the original operator
 * question wrote a document handle into a bullet and the turn died on our own
 * leak gate. Same containment argument as `KB_REVISION_NOTES`: the notes are
 * fixed sentences keyed by the gate that fired, and nothing model-written or
 * document-derived rides along.
 */
export const KB_STRUCTURAL_RETRY_NOTES = Object.freeze({
  identifier_leaked: "The previous draft wrote a document id or internal identifier into the headline or a bullet. Name every record only by its human title or name; ids belong only in the citations field.",
  citation_unmatched: "The previous draft cited an id that was not among the supplied document ids. Cite only the supplied document ids, exactly as given.",
} as const);

export const KB_SUPERVISOR_SCHEMA = { type: "object", additionalProperties: false, required: ["approved", "reason"], properties: { approved: { type: "boolean" }, reason: { type: "string", enum: KB_SUPERVISOR_REASONS } } } as const;

const SUPERVISOR_REASON_SET: ReadonlySet<string> = new Set(KB_SUPERVISOR_REASONS);

/**
 * Read the verdict back.
 *
 * `reason` is required by the schema and optional here. A verdict that approves
 * is acted on whether or not the model filled the field in — withholding an
 * approved answer because its explanation was missing would trade a real answer
 * for a log line. A verdict that declines keeps `null` when the reason is absent
 * or outside the vocabulary, which reads as "declined, cause unrecorded" rather
 * than being silently filed under one of the real causes.
 */
export function parseSupervisorVerdict(value: unknown): { readonly approved: boolean; readonly reason: KbSupervisorReason | null } | null {
  if (!isRecord(value) || typeof value.approved !== "boolean") return null;
  if (Object.keys(value).some((key) => key !== "approved" && key !== "reason")) return null;
  const reason = typeof value.reason === "string" && SUPERVISOR_REASON_SET.has(value.reason) ? value.reason as KbSupervisorReason : null;
  return { approved: value.approved, reason };
}

/**
 * The reasons this module refuses a candidate.
 *
 * They were six string literals scattered through `runGroundedChat`, which is
 * fine for a log line and not fine for a test: a test that wants to assert WHICH
 * gate refused has to transcribe one, and a transcribed code goes stale silently
 * — the refusal still happens, the test still passes, and it is now checking a
 * string nothing produces.
 *
 * The distinction they carry is the point. `MALFORMED` and `LANGUAGE_BLOCKED`
 * both end in `null`, and telling them apart is the difference between "the
 * compliance gate held" and "the parser rejected the shape before the gate was
 * ever consulted". The second masquerading as the first is exactly how
 * `compliance/gate-consumers.test.ts` came to assert nothing.
 */
export const KB_REFUSAL_CODES = Object.freeze({
  ANSWER_FAILED: "KB_ANSWER_FAILED",
  CANDIDATE_MALFORMED: "KB_CANDIDATE_MALFORMED",
  CITATION_UNMATCHED: "KB_CITATION_UNMATCHED",
  IDENTIFIER_LEAKED: "KB_CANDIDATE_IDENTIFIER_LEAKED",
  LANGUAGE_BLOCKED: "KB_CANDIDATE_LANGUAGE_BLOCKED",
  SUPERVISOR_DECLINED: "KB_SUPERVISOR_DECLINED",
  DECLINE_FAILED: "KB_DECLINE_FAILED",
  DECLINE_MALFORMED: "KB_DECLINE_MALFORMED",
  DECLINE_IDENTIFIER_LEAKED: "KB_DECLINE_IDENTIFIER_LEAKED",
  DECLINE_LANGUAGE_BLOCKED: "KB_DECLINE_LANGUAGE_BLOCKED",
  DECLINE_SUPERVISOR_DECLINED: "KB_DECLINE_SUPERVISOR_DECLINED",
} as const);

export type KbRefusalCode = (typeof KB_REFUSAL_CODES)[keyof typeof KB_REFUSAL_CODES];

/** What the refusing gate knew beyond its own name. Classification only, never content. */
export interface KbRefusalDetail { readonly reason: KbSupervisorReason | null }

const MAX_BULLETS = 6;
const MAX_ANSWER_FIELD = 400;
const MAX_LEDGER_DETAIL = 300;
const CANDIDATE_ATTEMPT_LIMIT = 2;

interface Candidate { readonly headline: string; readonly bullets: readonly string[]; readonly citations: readonly { readonly id: string }[] }

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

function bounded(value: unknown): value is string { return typeof value === "string" && value.length >= 1 && value.length <= MAX_ANSWER_FIELD; }

function parseCandidate(value: unknown): Candidate | null {
  if (!isRecord(value) || !bounded(value.headline) || !Array.isArray(value.bullets) || value.bullets.length > MAX_BULLETS || !Array.isArray(value.citations) || value.citations.length < 1 || value.citations.length > 8) return null;
  if (!value.bullets.every(bounded)) return null;
  const citations: { id: string }[] = [];
  for (const item of value.citations) {
    if (!isRecord(item) || typeof item.id !== "string" || item.id.length < 1 || item.id.length > 32) return null;
    if (Object.keys(item).some((key) => key !== "id")) return null;
    citations.push({ id: item.id });
  }
  if (Object.keys(value).some((key) => !["headline", "bullets", "citations"].includes(key))) return null;
  return { bullets: value.bullets as readonly string[], citations, headline: value.headline };
}

/**
 * A ledger answer has a closed cardinality: one item for every document supplied.
 *
 * `KB_CANDIDATE_SCHEMA` caps bullets at six and citations at eight, which is the
 * right shape for "summarize what these records say" and the wrong shape for
 * "where does each application stand" — a book of twelve comes back as six
 * bullets with nothing saying the other six exist. Here the model writes only
 * the record-specific detail and echoes the handle it was given; this process
 * verifies exact, in-order, unique coverage and composes the visible label from
 * the document's own trusted title. Omitting or merging two records is then not
 * a quality problem the supervisor has to notice, it is a parse failure — and
 * `runGroundedChat` returns null the same way it does for any other malformed
 * candidate, so an incomplete answer can never be printed as a complete one.
 */
function parseDocumentLedgerCandidate(
  value: unknown,
  handles: ReturnType<typeof issueGroundingHandles>,
): Candidate | null {
  if (!isRecord(value) || !bounded(value.headline) || !Array.isArray(value.items) || value.items.length !== handles.visible.length) return null;
  if (Object.keys(value).some((key) => !["headline", "items"].includes(key))) return null;

  const seen = new Set<string>();
  const bullets: string[] = [];
  const citations: { id: string }[] = [];
  for (const [index, item] of value.items.entries()) {
    if (!isRecord(item) || Object.keys(item).some((key) => !["id", "detail"].includes(key))) return null;
    if (typeof item.id !== "string" || item.id.length < 1 || item.id.length > 32 || seen.has(item.id)) return null;
    if (typeof item.detail !== "string" || item.detail.length < 1 || item.detail.length > MAX_LEDGER_DETAIL) return null;
    if (item.id !== handles.visible[index]?.id) return null;
    const resolved = handles.resolve(item.id);
    if (resolved === null) return null;
    seen.add(item.id);
    citations.push({ id: item.id });
    // The record kind is already the section the reader is looking at, so the
    // bullet drops the "Application · " prefix and keeps the names.
    const label = citationLabel(resolved).replace(/^Application\s*·\s*/i, "");
    bullets.push(`${label}: ${item.detail}`);
  }
  if (handles.visible.some((document) => !seen.has(document.id))) return null;
  return { headline: value.headline, bullets, citations };
}

function documentLedgerSchema(count: number) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["headline", "items"],
    properties: {
      headline: { type: "string", minLength: 1, maxLength: MAX_ANSWER_FIELD },
      items: { type: "array", minItems: count, maxItems: count, items: DOCUMENT_LEDGER_ITEM_SCHEMA },
    },
  } as const;
}

/** Everything a person would read, in one string, for the scans that run over the answer text. */
function answerText(candidate: Candidate): string {
  return [candidate.headline, ...candidate.bullets].join("\n");
}

export async function runGroundedChat(input: {
  readonly question: string;
  readonly documents: readonly GroundingDocument[];
  readonly transport: ChatTransport;
  readonly prompt: { readonly key: string; readonly version: number; readonly system: string };
  readonly onProgress?: KbProgressReporter;
  /**
   * Require exactly one independently labelled bullet and one citation for every
   * supplied document, in the order they were supplied. Use it when the question
   * is "what does each of these say" and a six-bullet summary of a longer list
   * would read as the whole list.
   */
  readonly documentLedger?: boolean;
  /** Classification only. Never receives candidate text, documents, or identifiers. */
  readonly onFailure?: (code: KbRefusalCode, detail?: KbRefusalDetail) => void;
}): Promise<GroundedAnswer | null> {
  // F-05. From here down the model's view of the workspace is `handles.visible`
  // — opaque per-request handles, titles and bodies, no ids and no urls — and
  // `input.documents` is ours alone. Nothing below may put the raw list into a
  // request.
  const handles = issueGroundingHandles(input.documents);
  try {
    input.onProgress?.({ stage: "reading", titles: input.documents.map((document) => document.title) });
    input.onProgress?.({ stage: "composing" });
    // The ledger schema and its parser are chosen once, outside the loop, so a
    // regeneration asks for the same shape it just refused rather than quietly
    // falling back to the summarizing schema on the second attempt.
    const ledger = input.documentLedger === true;
    const candidateSchema = ledger ? documentLedgerSchema(handles.visible.length) : KB_CANDIDATE_SCHEMA;
    const schemaName = ledger ? `${input.prompt.key}-v${input.prompt.version}-ledger-${handles.visible.length}` : `${input.prompt.key}-v${input.prompt.version}`;
    // This model bills its reasoning tokens against maxTokens, and reasoning
    // length does not follow the answer's size — so both budgets carry a large
    // constant headroom on top of what the schema can produce, and the ledger
    // adds ~110 tokens per record for a 300-character detail plus its handle.
    // Measured, not guessed: 900 truncated on the enriched revenue question
    // (2026-08-23, correlation ef948131), and after the first raise to 1,600
    // the same walk still truncated on both paths (correlations f7dff891 on
    // the ledger at 400+110n, and 023d6256 on the summarizing shape at 1,600).
    // OpenRouter bills tokens generated, not the ceiling, so the only cost of
    // a high ceiling is worst-case latency.
    const candidateTokens = ledger ? Math.min(8_000, 2_400 + handles.visible.length * 110) : 4_000;
    // The transport's default 30-second attempt window was sized for the old
    // budgets; a candidate allowed 4,000–8,000 tokens can legitimately still be
    // generating at 30s, and the 93ea508 walk lost an admin turn to exactly
    // that (OPENROUTER_TIMEOUT at ~38s wall, correlation 01afe987). 90s covers
    // the full ceiling at a conservative 150 tokens/second plus connection
    // overhead; the turn route has no maxDuration cap of its own.
    const candidateTimeLimitMs = 90_000;
    // One draft and, for a decline that names a sentence rather than a rule, one
    // revision. The candidate loop below handles the shapes this process can
    // check itself (malformed, leaked, uncited); the reviewer handles the rest.
    const compose = async (reviewNote: string | null): Promise<{ readonly candidate: Candidate; readonly citations: readonly KbCitation[] } | null> => {
      let structuralNote: string | null = null;
      for (let attempt = 1; attempt <= CANDIDATE_ATTEMPT_LIMIT; attempt += 1) {
        const note = [reviewNote, structuralNote].filter((part) => part !== null).join(" ");
        let candidateValue: unknown;
        try {
          candidateValue = await input.transport.complete({ operation: `${input.prompt.key}.candidate`, schemaName, schema: candidateSchema, maxTokens: candidateTokens, timeLimitMs: candidateTimeLimitMs, messages: [{ role: "system", content: input.prompt.system }, { role: "user", content: JSON.stringify({ question: input.question, documents: handles.visible, ...(note === "" ? {} : { reviewNote: note }) }) }] });
        } catch (cause) {
          // A truncated draft is a malformed draft, not an outage: this model's
          // reasoning length varies per attempt, and the same fees question
          // that truncated at a 4,000-token ceiling on the final walk
          // (correlation f9693c61, 2026-08-23) had answered cleanly on the
          // three walks before it. One more draft usually lands; a second
          // truncation falls through to the outage path like any other throw.
          const truncated = cause instanceof Error && "code" in cause && (cause as { code?: unknown }).code === "OPENROUTER_TRUNCATED";
          if (truncated && attempt < CANDIDATE_ATTEMPT_LIMIT) continue;
          throw cause;
        }
        const parsed = ledger ? parseDocumentLedgerCandidate(candidateValue, handles) : parseCandidate(candidateValue);
        // A handle mention is repaired, not refused: the handle is this
        // process's own alias for a record it can name, so translating it back
        // to the title is grounded and deterministic — where the retry that
        // merely re-asked was measured failing twice in a row on the live
        // deployment (correlations 556edc35 and, after the retry gained a
        // note, 8bf63863 / 2a340bb2 / 007acc04 on 2026-08-23). The uuid gate
        // below stays a hard failure: a uuid is not this table's vocabulary
        // and nothing here can repair it honestly.
        const candidate = parsed === null ? null : { ...parsed, bullets: parsed.bullets.map((bullet) => handles.rewrite(bullet)), headline: handles.rewrite(parsed.headline) };
        if (candidate === null) {
          if (attempt < CANDIDATE_ATTEMPT_LIMIT) continue;
          input.onFailure?.(KB_REFUSAL_CODES.CANDIDATE_MALFORMED);
          recordRouteFailure({ cause: null, code: KB_REFUSAL_CODES.CANDIDATE_MALFORMED, status: 200, surface: `kb.${input.prompt.key}` });
          return null;
        }
        if (complianceLanguageCodes(candidate).length > 0) {
          input.onFailure?.(KB_REFUSAL_CODES.LANGUAGE_BLOCKED);
          recordRouteFailure({ cause: null, code: KB_REFUSAL_CODES.LANGUAGE_BLOCKED, status: 200, surface: `kb.${input.prompt.key}` });
          return null;
        }
        const text = answerText(candidate);
        if (handles.leaks(text) || containsUuidShaped(text)) {
          if (attempt < CANDIDATE_ATTEMPT_LIMIT) { structuralNote = KB_STRUCTURAL_RETRY_NOTES.identifier_leaked; continue; }
          input.onFailure?.(KB_REFUSAL_CODES.IDENTIFIER_LEAKED);
          recordRouteFailure({ cause: null, code: KB_REFUSAL_CODES.IDENTIFIER_LEAKED, status: 200, surface: `kb.${input.prompt.key}` });
          return null;
        }
        const citations = labelledCitations(handles, candidate.citations);
        if (citations === null) {
          if (attempt < CANDIDATE_ATTEMPT_LIMIT) { structuralNote = KB_STRUCTURAL_RETRY_NOTES.citation_unmatched; continue; }
          input.onFailure?.(KB_REFUSAL_CODES.CITATION_UNMATCHED);
          recordRouteFailure({ cause: null, code: KB_REFUSAL_CODES.CITATION_UNMATCHED, status: 200, surface: `kb.${input.prompt.key}` });
          return null;
        }
        return { candidate, citations };
      }
      return null;
    };

    let reviewNote: string | null = null;
    for (let round = 1; round <= SUPERVISOR_ROUND_LIMIT; round += 1) {
      if (round > 1) input.onProgress?.({ stage: "composing" });
      const accepted = await compose(reviewNote);
      if (accepted === null) return null;
      const { candidate, citations } = accepted;
      input.onProgress?.({ stage: "reviewing" });
      const supervisor = parseSupervisorVerdict(await input.transport.complete({ operation: `${KB_SUPERVISOR_PROMPT.key}.review`, schemaName: `${KB_SUPERVISOR_PROMPT.key}-v${KB_SUPERVISOR_PROMPT.version}`, schema: KB_SUPERVISOR_SCHEMA, maxTokens: 128, messages: [{ role: "system", content: KB_SUPERVISOR_PROMPT.system }, { role: "user", content: JSON.stringify({ question: input.question, documents: handles.visible, candidate }) }] }));
      if (supervisor?.approved === true) return { bullets: candidate.bullets, citations, headline: candidate.headline };
      const reason = supervisor?.reason ?? null;
      const note = reason === null ? undefined : KB_REVISION_NOTES[reason];
      if (round < SUPERVISOR_ROUND_LIMIT && note !== undefined) {
        reviewNote = note;
        continue;
      }
      input.onFailure?.(KB_REFUSAL_CODES.SUPERVISOR_DECLINED, { reason });
      // The reason rides in on `cause.code`, which is where `recordRouteFailure`
      // reads `causeCode` from and where it applies its identifier check. Nothing
      // model-written travels with it.
      recordRouteFailure({ cause: reason === null ? null : { code: reason, name: "KbSupervisorVerdict" }, code: KB_REFUSAL_CODES.SUPERVISOR_DECLINED, status: 200, surface: `kb.${input.prompt.key}` });
      return null;
    }
    return null;
  } catch (cause) {
    // This catch used to be `catch { return null; }`, and that is why an outage
    // that made every supervised answer in the product return "unavailable" was
    // invisible from the logs — the surface, the transport and the gate all
    // reported the same empty result and none of them said which had refused.
    // The seam records a classification and an identifier, never content, so the
    // two-rails rule holds over the log stream exactly as it holds over storage.
    input.onFailure?.(KB_REFUSAL_CODES.ANSWER_FAILED);
    recordRouteFailure({ cause, code: KB_REFUSAL_CODES.ANSWER_FAILED, status: 200, surface: `kb.${input.prompt.key}` });
    return null;
  }
}

/**
 * The decline a model is allowed to write, and the reason it is this narrow.
 *
 * `decline` is the only free text in the whole path. The topics are **chosen**,
 * not written: the model returns handles out of a table this process issued and
 * the caller prints its own titles for them, so "invent no facts" is a property
 * of the schema rather than an instruction the model can quietly stop following
 * — the same argument `issueGroundingHandles` makes about citations (F-05).
 * There is no shape in which a topic the knowledge base does not hold can come
 * back from this call.
 */
export const KB_DECLINE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["decline", "topics"],
  properties: {
    decline: { type: "string", minLength: 1, maxLength: 240 },
    topics: { type: "array", minItems: 0, maxItems: 8, items: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string", minLength: 1, maxLength: 32 } } } },
  },
} as const;

export interface GroundedDecline {
  /** One sentence, written by the model and gated exactly as an answer is. */
  readonly decline: string;
  /** The offered topics, as **our** titles for the handles the model chose. */
  readonly titles: readonly string[];
}

/**
 * Write a decline that reads like a person rather than a broken control.
 *
 * Every gate `runGroundedChat` applies to an answer applies here, in the same
 * order and for the same reasons: the compliance language scan, the structural
 * identifier check, the handle resolution, and the supervisor. A decline is a
 * consumer-facing sentence generated by a model, so it is a compliance surface
 * whether or not it carries an answer — treating it as exempt because "it is
 * only a refusal" is how prohibited language reaches a screen through the one
 * path nobody was watching.
 *
 * Returns `null` on every refusal, which is the caller's signal to print the
 * deterministic sentence instead. There is no partial decline: a candidate that
 * fails any gate is not repaired, because the repair would be us writing the
 * sentence we already have a constant for.
 */
export async function runGroundedDecline(input: { readonly question: string; readonly topics: readonly GroundingDocument[]; readonly transport: ChatTransport; readonly prompt: { readonly key: string; readonly version: number; readonly system: string }; readonly onProgress?: KbProgressReporter }): Promise<GroundedDecline | null> {
  const handles = issueGroundingHandles(input.topics);
  try {
    input.onProgress?.({ stage: "composing" });
    const value = await input.transport.complete({
      operation: `${input.prompt.key}.decline`,
      schemaName: `${input.prompt.key}-v${input.prompt.version}`,
      schema: KB_DECLINE_SCHEMA,
      // From the schema: a 240-character sentence is about 60 tokens and eight
      // handles about 60 more, so 256 is double the worst case the schema
      // permits, and the transport adds its 256 of reasoning headroom on top.
      maxTokens: 256,
      timeLimitMs: 20_000,
      messages: [
        { role: "system", content: input.prompt.system },
        { role: "user", content: JSON.stringify({ question: input.question, topics: handles.visible.map((topic) => ({ id: topic.id, title: topic.title })) }) },
      ],
    });
    const candidate = parseDecline(value, input.topics.length);
    if (candidate === null) {
      recordRouteFailure({ cause: null, code: KB_REFUSAL_CODES.DECLINE_MALFORMED, status: 200, surface: `kb.${input.prompt.key}` });
      return null;
    }
    const titles: string[] = [];
    for (const chosen of candidate.topics) {
      const topic = handles.resolve(chosen.id);
      // An invented handle fails the whole decline rather than being skipped.
      // Skipping would silently shorten the offer, and a shortened offer is
      // indistinguishable from the model having judged those topics unhelpful.
      if (topic === null) {
        recordRouteFailure({ cause: null, code: KB_REFUSAL_CODES.DECLINE_MALFORMED, status: 200, surface: `kb.${input.prompt.key}` });
        return null;
      }
      titles.push(citationLabel(topic));
    }
    // Scanned over what a person will actually read — the model's sentence and
    // the titles we are about to print beside it — so a prohibited phrase
    // reaching the screen through either half is refused the same way.
    if (complianceLanguageCodes({ decline: candidate.decline, titles }).length > 0) {
      recordRouteFailure({ cause: null, code: KB_REFUSAL_CODES.DECLINE_LANGUAGE_BLOCKED, status: 200, surface: `kb.${input.prompt.key}` });
      return null;
    }
    if (handles.leaks(candidate.decline) || containsUuidShaped(candidate.decline)) {
      recordRouteFailure({ cause: null, code: KB_REFUSAL_CODES.DECLINE_IDENTIFIER_LEAKED, status: 200, surface: `kb.${input.prompt.key}` });
      return null;
    }
    input.onProgress?.({ stage: "reviewing" });
    const supervisor = await input.transport.complete({
      operation: `${KB_DECLINE_SUPERVISOR_PROMPT.key}.review`,
      schemaName: `${KB_DECLINE_SUPERVISOR_PROMPT.key}-v${KB_DECLINE_SUPERVISOR_PROMPT.version}`,
      schema: KB_SUPERVISOR_SCHEMA,
      maxTokens: 128,
      messages: [
        { role: "system", content: KB_DECLINE_SUPERVISOR_PROMPT.system },
        { role: "user", content: JSON.stringify({ question: input.question, reply: candidate.decline, topics: titles }) },
      ],
    });
    const verdict = parseSupervisorVerdict(supervisor);
    if (verdict?.approved === true) return { decline: candidate.decline, titles };
    recordRouteFailure({ cause: verdict?.reason == null ? null : { code: verdict.reason, name: "KbSupervisorVerdict" }, code: KB_REFUSAL_CODES.DECLINE_SUPERVISOR_DECLINED, status: 200, surface: `kb.${input.prompt.key}` });
    return null;
  } catch (cause) {
    recordRouteFailure({ cause, code: KB_REFUSAL_CODES.DECLINE_FAILED, status: 200, surface: `kb.${input.prompt.key}` });
    return null;
  }
}

/**
 * Read the decline candidate back.
 *
 * `available` is what makes the empty-offer case decidable here rather than at
 * the caller: when the knowledge base has topics to offer and the model chose
 * none, the reply would say what it cannot do and stop — which is the broken
 * control this whole path exists to replace. That is a refusal, so it takes the
 * deterministic sentence, and the caller never has to invent an offer the model
 * declined to make.
 */
function parseDecline(value: unknown, available: number): { readonly decline: string; readonly topics: readonly { readonly id: string }[] } | null {
  if (!isRecord(value) || Object.keys(value).length !== 2) return null;
  if (typeof value.decline !== "string" || value.decline.trim().length < 1 || value.decline.length > 240) return null;
  if (!Array.isArray(value.topics) || value.topics.length > 8) return null;
  if (available > 0 && value.topics.length === 0) return null;
  const topics: { id: string }[] = [];
  const seen = new Set<string>();
  for (const item of value.topics) {
    if (!isRecord(item) || Object.keys(item).length !== 1 || typeof item.id !== "string" || item.id.length < 1 || item.id.length > 32) return null;
    if (seen.has(item.id)) return null;
    seen.add(item.id);
    topics.push({ id: item.id });
  }
  return { decline: value.decline.trim(), topics };
}

/**
 * Resolve each cited handle back to the document it stood for.
 *
 * A handle the table never issued is an invented citation and fails the whole
 * answer, exactly as an unmatched id did before. What changed is that the model
 * can no longer accidentally be right: it has nothing to copy from except the
 * handles it was given.
 */
function labelledCitations(handles: ReturnType<typeof issueGroundingHandles>, citations: readonly { readonly id: string }[]): KbCitation[] | null {
  const labelled: KbCitation[] = [];
  for (const citation of citations) {
    const document = handles.resolve(citation.id);
    if (document === null) return null;
    labelled.push({ id: document.id, label: citationLabel(document), title: document.title });
  }
  return labelled;
}
