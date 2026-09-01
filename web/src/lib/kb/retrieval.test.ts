import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DRIVERS, MisconfiguredDriverError } from "@/lib/env";

import { complianceLanguageCodes } from "../compliance/language-rules.mjs";
import { setRouteFailureSink } from "../diagnostics/route-failure.ts";
import { createMockChatTransport } from "../llm/mock-chat-transport.ts";
import { CONSUMER_KB_STATIC_DECLINE, createConsumerKbAnswer } from "./consumer.ts";
import { createDeterministicEmbeddingDriver } from "./embedding.ts";
import { createFixtureKbSource, FIXTURE_KB_ARTICLES } from "./fixture-source.ts";
import { runKbImport } from "./import.ts";
import { createKbRetrieval, HASH64_SIMILARITY_THRESHOLD, KB_EMBEDDING_DRIVERS, LLM_SCORE_RELEVANCE_THRESHOLD } from "./retrieval.ts";
import { KB_SOURCE_DRIVERS } from "./source.ts";
import type { KbArticleMatch } from "./search.ts";
import type { KbApplyArticleInput, KbApplyOutcome, KbImportRepository } from "./types.ts";

/**
 * The corpus as the importer actually stores it.
 *
 * Built by running `runKbImport` against a capturing repository rather than by
 * embedding a string this file composes, because the thing under test is what
 * the *shipped* import path puts in the row. The text an article is embedded
 * from, the embedder, and the version are all import.ts's choices; a test that
 * transcribed them would keep passing after they changed and would stop being
 * about production at that moment.
 */
async function importedCorpus(): Promise<readonly { readonly input: KbApplyArticleInput; readonly embedding: readonly number[] }[]> {
  const stored: { input: KbApplyArticleInput; embedding: readonly number[] }[] = [];
  const repository: KbImportRepository = {
    async beginImport() { return { id: "run", status: "running", cursor: null }; },
    async readArticleState() { return null; },
    async applyArticle(input: KbApplyArticleInput): Promise<KbApplyOutcome> {
      assert.notEqual(input.embedding, null, "the importer must embed a first-seen article");
      stored.push({ input, embedding: input.embedding as readonly number[] });
      return "added";
    },
    async completeImport() { return { tombstoned: 0 }; },
    async failImport() { /* the capture never fails */ },
  };
  const result = await runKbImport({ subject: "kb:test", window: "2026-W34", source: createFixtureKbSource(), embedding: createDeterministicEmbeddingDriver(), repository });
  assert.equal(result.status, "ok");
  assert.equal(stored.length, FIXTURE_KB_ARTICLES.length);
  return stored;
}

/**
 * `search_kb_articles` in memory: exact cosine, ordered by similarity then by
 * source article id, clamped to eight rows. Mirrors `130_kb_articles.sql` so a
 * retrieval test measures the ranking the database would return rather than the
 * order the fixture happens to be written in.
 */
function indexOver(corpus: Awaited<ReturnType<typeof importedCorpus>>) {
  const cosine = (left: readonly number[], right: readonly number[]): number => {
    const dot = left.reduce((total, value, position) => total + value * (right[position] ?? 0), 0);
    const norm = (vector: readonly number[]) => Math.sqrt(vector.reduce((total, value) => total + value * value, 0));
    const scale = norm(left) * norm(right);
    return scale === 0 ? 0 : dot / scale;
  };
  return {
    async search(embedding: readonly number[], limit = 6): Promise<KbArticleMatch[]> {
      return corpus
        .map(({ input, embedding: stored }): KbArticleMatch => ({
          id: `row:${input.article.sourceArticleId}`,
          sourceArticleId: input.article.sourceArticleId,
          title: input.article.title,
          body: input.article.body,
          sourceUrl: input.article.sourceUrl,
          metadata: input.article.metadata,
          similarity: cosine(stored, embedding),
        }))
        .sort((left, right) => right.similarity - left.similarity || left.sourceArticleId.localeCompare(right.sourceArticleId))
        .slice(0, Math.min(8, Math.max(1, Math.trunc(limit))));
    },
  };
}

const LLM_ENV = { [KB_EMBEDDING_DRIVERS.selector]: "llm_score", OPENROUTER_API_KEY: "configured" } as const;

/** The spec's own `requires` row, widened so a selection test can walk it without naming a driver that has no keys. */
function requiredKeysFor(driver: string): readonly string[] {
  const requires: Readonly<Record<string, readonly string[] | undefined>> = KB_EMBEDDING_DRIVERS.requires;
  return requires[driver] ?? [];
}

/**
 * A question a consumer asks in their own words, and the article a person would
 * hand them for it. Both are inputs to the defect rather than measurements of
 * it: the assertions below derive every number they check from the corpus and
 * the module constants, so nothing here carries a similarity score that could go
 * stale while the test kept passing.
 */
const PARAPHRASED_QUESTION = "How do I get funding ready?";
const EXPECTED_ARTICLE_ID = "kb-readiness-review";

/**
 * A passage the corpus must never answer from.
 *
 * The prohibited phrase is encoded for exactly the reason
 * `compliance/language-rules.mjs` encodes its own vocabulary: this file sits
 * inside a scan root, so a plaintext one here would make
 * `verify-compliance-copy.mjs` fail on the test that exists to prove the gate
 * catches it. The test asserts against `complianceLanguageCodes` that the plant
 * is a real trip rather than a string I believe is one, so the plant cannot
 * silently stop being prohibited while the test keeps passing.
 */
const PLANTED_TITLE = "Handling flagged items";
const PLANTED_PROHIBITED_BODY = `Work with a ${atob("Y3JlZGl0IHJlcGFpcg==")} specialist about negative items on the file before applying.`;

/**
 * A stand-in for a model that reads for meaning: it scores the article a person
 * would pick, and scores the rest low. It resolves that article through the
 * title the request carried, so the scoring contract (opaque refs, no stored
 * ids) is what the double depends on — a request that started shipping row ids
 * would not make this easier to write, it would make it fail.
 */
function titleOf(sourceArticleId: string): string {
  const article = FIXTURE_KB_ARTICLES.find((item) => item.sourceArticleId === sourceArticleId);
  assert.ok(article !== undefined, `${sourceArticleId} is not a fixture article`);
  return article.title;
}

function semanticScorer(expectedTitle: string | null, seen: { requests: unknown[] }) {
  return createMockChatTransport((request) => {
    seen.requests.push(request);
    const body = JSON.parse(request.messages[1]!.content) as { articles: Array<{ ref: string; title: string }> };
    return { scores: body.articles.map((article) => ({ ref: article.ref, relevance: article.title === expectedTitle ? 92 : 4 })) };
  });
}

function collectFailures(): { records: unknown[]; restore: () => void } {
  const records: unknown[] = [];
  const restore = setRouteFailureSink((record) => { records.push(record); });
  return { records, restore };
}

/** The answer path with a transport that would answer if it were reached. Its citations name which article retrieval actually surfaced. */
function answerTransport() {
  return createMockChatTransport((request) => {
    if (!request.operation.endsWith("candidate")) return { approved: true };
    const documents = (JSON.parse(request.messages[1]!.content) as { documents: Array<{ id: string; title: string }> }).documents;
    return { bullets: [], citations: [{ id: documents[0]!.id }], headline: "Grounded in the cited article." };
  });
}

describe("KB retrieval driver", () => {
  it("the hash arm cannot reach an article the question does not quote, and the scoring arm can", async () => {
    const corpus = await importedCorpus();
    const index = indexOver(corpus);

    // The defect, measured here rather than transcribed: every hash similarity
    // this question produces over the corpus the importer built is under the
    // hash arm's own gate, so the best-matching article is unreachable.
    const hash = createKbRetrieval({ env: {}, index });
    assert.equal(hash.driver, "hash64");
    const hashed = await hash.retrieve(PARAPHRASED_QUESTION, 6);
    assert.equal(hashed.scale, "hash64");
    assert.equal(hashed.similarityThreshold, HASH64_SIMILARITY_THRESHOLD);
    assert.ok(hashed.matches.length > 0, "the corpus must be reachable at all for this to be about the gate");
    const best = Math.max(...hashed.matches.map((row) => row.similarity));
    assert.ok(best < hashed.similarityThreshold, `the hash arm scored ${best}, which no longer reproduces the refusal this driver exists to fix`);

    const refused = await createConsumerKbAnswer(PARAPHRASED_QUESTION, { retrieval: hash, transport: answerTransport });
    assert.equal(refused.status, "insufficient_grounding");

    // The same question, the same corpus, the same gate arithmetic — and an arm
    // that ranks on what the article is about.
    const seen = { requests: [] as unknown[] };
    const scoring = createKbRetrieval({ env: LLM_ENV, index, transport: () => semanticScorer(titleOf(EXPECTED_ARTICLE_ID), seen) });
    assert.equal(scoring.driver, "llm_score");
    const scored = await scoring.retrieve(PARAPHRASED_QUESTION, 6);
    assert.equal(scored.scale, "llm_score");
    assert.equal(scored.similarityThreshold, LLM_SCORE_RELEVANCE_THRESHOLD);
    assert.equal(scored.matches[0]?.sourceArticleId, EXPECTED_ARTICLE_ID);
    assert.ok(scored.matches[0]!.similarity >= scored.similarityThreshold);

    const answered = await createConsumerKbAnswer(PARAPHRASED_QUESTION, { retrieval: scoring, transport: answerTransport });
    assert.equal(answered.status, "answered");
    assert.deepEqual(answered.citations.map((citation) => citation.title), [titleOf(EXPECTED_ARTICLE_ID)]);
  });

  it("a question the corpus is not about is still refused on the scoring arm", async () => {
    const index = indexOver(await importedCorpus());
    const seen = { requests: [] as unknown[] };
    // `answers: null` is a model that found nothing relevant, which is the only
    // honest reading of a corpus about business funding readiness being asked
    // about the weather. The refusal has to survive the arm that makes answers
    // easier to reach, or the fix has traded one defect for a worse one.
    const scoring = createKbRetrieval({ env: LLM_ENV, index, transport: () => semanticScorer(null, seen) });
    const scored = await scoring.retrieve("What is the weather in Tokyo tomorrow?", 6);
    assert.ok(scored.matches.every((row) => row.similarity < scored.similarityThreshold), "no article may clear the gate for an out-of-scope question");

    // The refusal is now written rather than fixed, so the assertion is that it
    // is still a refusal: nothing cited, no answer status, and — the part the
    // decline path could get wrong — the offered topics are the knowledge
    // base's own titles and nothing else.
    const operations: string[] = [];
    const result = await createConsumerKbAnswer("What is the weather in Tokyo tomorrow?", {
      retrieval: scoring,
      transport: () => createMockChatTransport((request) => {
        operations.push(request.operation);
        if (request.operation.endsWith("candidate")) throw new Error("an answer must never be attempted for an out-of-scope question");
        if (!request.operation.endsWith("decline")) return { approved: true };
        const body = JSON.parse(request.messages[1]!.content) as { topics: Array<{ id: string }> };
        return { decline: "That is outside what the knowledge base covers.", topics: body.topics.slice(0, 3).map((topic) => ({ id: topic.id })) };
      }),
    });
    assert.equal(result.status, "insufficient_grounding");
    assert.deepEqual(result.citations, []);
    assert.notEqual(result.answer, CONSUMER_KB_STATIC_DECLINE);
    assert.ok(operations.every((operation) => !operation.endsWith("candidate")), "the answer path must not be entered");
    // Derived from the fixture set: every offered topic is a real article title.
    const titles = new Set(FIXTURE_KB_ARTICLES.map((article) => article.title));
    const offered = result.answer.slice(result.answer.indexOf(":") + 1).split(";").map((part) => part.replace(/\.$/, "").trim());
    assert.ok(offered.length > 0);
    for (const topic of offered) assert.ok(titles.has(topic), `the decline offered '${topic}', which is not a knowledge-base article`);
  });

  /**
   * The exposure this driver creates, tested in the direction that matters.
   *
   * hash64 could only reach an article whose wording the question echoed, which
   * meant a passage nobody asked for in its own words was effectively
   * unreachable. Semantic ranking removes that accident of protection: an
   * article the corpus should never have carried is now findable by anyone who
   * asks about its subject in ordinary language. So the compliance rail has to
   * hold at the answer gate rather than at retrieval, and this proves it does on
   * the REAL arm, with the retrieval actually surfacing the planted passage.
   *
   * The planted text is built from the compliance rules' own vocabulary at test
   * time, not hand-written, so it cannot fall out of step with the gate.
   */
  it("a planted in-corpus passage the compliance gate forbids is still refused, even though retrieval now finds it", async () => {
    assert.ok(complianceLanguageCodes({ body: PLANTED_PROHIBITED_BODY }).length > 0, "the planted passage must actually trip the compliance rules for this test to mean anything");
    const corpus = await importedCorpus();
    const planted = { input: { ...corpus[0]!.input, article: { ...corpus[0]!.input.article, sourceArticleId: "kb-planted", title: PLANTED_TITLE, body: PLANTED_PROHIBITED_BODY } }, embedding: corpus[0]!.embedding };
    const index = indexOver([...corpus, planted]);
    const question = "What should I do about negative items on my report?";

    // 1. The hash arm never reaches it — which is why nobody had to think about
    //    this before, and exactly why it has to be thought about now.
    const hashed = await createKbRetrieval({ env: {}, index }).retrieve(question, 6);
    assert.ok(hashed.matches.every((row) => row.similarity < hashed.similarityThreshold), "the hash arm is not expected to reach the planted passage");

    // 2. The real arm does reach it, above its own gate.
    const seen = { requests: [] as unknown[] };
    const scoring = createKbRetrieval({ env: LLM_ENV, index, transport: () => semanticScorer(PLANTED_TITLE, seen) });
    const scored = await scoring.retrieve(question, 6);
    assert.equal(scored.matches[0]?.sourceArticleId, "kb-planted");
    assert.ok(scored.matches[0]!.similarity >= scored.similarityThreshold, "the planted passage must actually clear the gate for this test to mean anything");

    // 3. And the answer is refused anyway, because a model that grounds itself
    //    in that passage writes its language, and the language gate refuses the
    //    candidate before the supervisor is even asked.
    const { records, restore } = collectFailures();
    let answered: Awaited<ReturnType<typeof createConsumerKbAnswer>>;
    try {
      answered = await createConsumerKbAnswer(question, {
        retrieval: scoring,
        transport: () => createMockChatTransport((request) => {
          if (!request.operation.endsWith("candidate")) return { approved: true };
          const documents = (JSON.parse(request.messages[1]!.content) as { documents: Array<{ id: string; content: string }> }).documents;
          // Grounded in the planted passage, in its own words — the worst case
          // rather than a convenient one.
          return { bullets: [documents[0]!.content.slice(0, 200)], citations: [{ id: documents[0]!.id }], headline: "Here is what the article says." };
        }),
      });
    } finally {
      restore();
    }
    assert.notEqual(answered.status, "answered", "a candidate carrying prohibited language must never be answered");
    assert.ok(
      (records as Array<Record<string, unknown>>).some((record) => record.code === "KB_CANDIDATE_LANGUAGE_BLOCKED"),
      "the refusal must come from the compliance language gate, not from some other failure",
    );
  });

  it("the scoring call shows the model no stored identifier", async () => {
    const index = indexOver(await importedCorpus());
    const seen = { requests: [] as unknown[] };
    const scoring = createKbRetrieval({ env: LLM_ENV, index, transport: () => semanticScorer(titleOf(EXPECTED_ARTICLE_ID), seen) });
    await scoring.retrieve(PARAPHRASED_QUESTION, 6);
    assert.equal(seen.requests.length, 1);
    const serialized = JSON.stringify(seen.requests);
    // Derived from the rows the index actually returned, so a new field on a
    // match is covered here without an edit.
    for (const row of await index.search(await createDeterministicEmbeddingDriver().embed(PARAPHRASED_QUESTION), 8)) {
      for (const secret of [row.id, row.sourceArticleId, row.sourceUrl]) {
        assert.equal(serialized.includes(secret), false, `the scoring request carried ${secret}`);
      }
    }
  });

  it("a provider failure degrades to exactly the hash arm's rows, read on the hash arm's gate", async () => {
    const index = indexOver(await importedCorpus());
    const expected = await createKbRetrieval({ env: {}, index }).retrieve(PARAPHRASED_QUESTION, 6);
    const { records, restore } = collectFailures();
    try {
      for (const broken of [
        () => { throw new Error("provider down"); },
        () => createMockChatTransport(() => { throw new Error("provider timeout"); }),
        // A response that does not honour the schema is a failure too: ranking
        // on the half of a score table that parsed is worse than not ranking.
        () => createMockChatTransport(() => ({ scores: [{ ref: "a1", relevance: 900 }] })),
        () => createMockChatTransport(() => ({ scores: [{ ref: "invalid", relevance: 50 }] })),
        () => createMockChatTransport(() => ({ verdict: "relevant" })),
      ]) {
        const degraded = await createKbRetrieval({ env: LLM_ENV, index, transport: broken }).retrieve(PARAPHRASED_QUESTION, 6);
        assert.deepEqual(degraded, expected, "a degraded retrieval must be the hash arm's result, gate included");
      }
    } finally {
      restore();
    }
    assert.equal(records.length, 5, "every degrade records one classification");
    for (const record of records as Array<Record<string, unknown>>) {
      assert.equal(record.code, "KB_RETRIEVAL_DEGRADED");
      assert.equal(JSON.stringify(record).includes(PARAPHRASED_QUESTION), false, "the question must never reach the log stream");
    }
  });

  it("selects on its own key, falls back to the hash arm, and refuses a typo", () => {
    const { selector, values, fallback } = KB_EMBEDDING_DRIVERS;
    const index = indexOver([]);
    for (const blank of [undefined, "", "   "]) {
      assert.equal(createKbRetrieval({ env: { [selector]: blank }, index }).driver, fallback);
    }
    for (const driver of values) {
      const keys = Object.fromEntries(requiredKeysFor(driver).map((key) => [key, "configured"]));
      assert.equal(createKbRetrieval({ env: { ...keys, [selector]: driver }, index }).driver, driver);
      // Every required key is required: dropping any one of them must be a
      // configuration error at selection, not a provider error mid-question.
      for (const missing of requiredKeysFor(driver)) {
        const partial = { ...keys, [selector]: driver };
        delete (partial as Record<string, string>)[missing];
        assert.throws(() => createKbRetrieval({ env: partial, index }), MisconfiguredDriverError, `${selector}=${driver} must refuse without ${missing}`);
      }
    }
    assert.throws(() => createKbRetrieval({ env: { [selector]: "openrouter" }, index }), MisconfiguredDriverError);
  });

  it("no other service's selector can change which retrieval runs", () => {
    const { selector, values, fallback } = KB_EMBEDDING_DRIVERS;
    const index = indexOver([]);
    assert.notEqual(selector, DRIVERS.ai.selector);
    assert.notEqual(selector, KB_SOURCE_DRIVERS.selector);
    assert.notEqual(selector, DRIVERS.vault.selector);
    // Walked from the tables rather than listed, so a driver added to either one
    // is covered here the moment it is added.
    const foreign = [
      ...DRIVERS.ai.values.map((value) => ({ [DRIVERS.ai.selector]: value })),
      ...DRIVERS.vault.values.map((value) => ({ [DRIVERS.vault.selector]: value })),
      ...KB_SOURCE_DRIVERS.values.map((value) => ({ [KB_SOURCE_DRIVERS.selector]: value })),
    ];
    for (const env of foreign) {
      assert.equal(createKbRetrieval({ env: { ...env, OPENROUTER_API_KEY: "configured", VAULT_SUPABASE_URL: "configured", VAULT_SERVICE_KEY: "configured" }, index }).driver, fallback, `${JSON.stringify(env)} must not change the retrieval`);
      for (const driver of values) {
        const keys = Object.fromEntries(requiredKeysFor(driver).map((key) => [key, "configured"]));
        assert.equal(createKbRetrieval({ env: { ...env, ...keys, [selector]: driver }, index }).driver, driver);
      }
    }
  });
});
