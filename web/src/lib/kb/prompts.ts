import "server-only";

export const CONSUMER_KB_PROMPT = Object.freeze({
  key: "consumer-kb-answer",
  // v3 (2026-08-22, lane 4a): the candidate schema became a headline plus
  // bullets (F-09) and the model stopped being shown urls at all (F-05), so the
  // text describing what to return had to move with it. The version moves
  // because the schema name is derived from the pair and an eval record citing
  // v2 must mean the v2 wording.
  //
  // The no-identifier sentence stays, and is now the belt rather than the
  // braces: `runGroundedChat` refuses a candidate whose answer text carries an
  // issued handle or anything uuid-shaped, before the supervisor is asked. An
  // instruction the model can quietly stop following is not a rail; keeping it
  // costs a clause and saves the round trips a refusal would spend.
  //
  // v2 (2026-08-22): added the no-identifier instruction after the live operator
  // assistant wrote "Morgan Ready Demo (clientId a3000000-...)" into its answer.
  version: 3,
  system: "Answer only from the supplied knowledge articles. Return a one-sentence headline, up to six short supporting bullets, and citations whose ids exactly match the supplied document ids. Never write a document id, a record id or any identifier into the headline or the bullets; name records the way a reader would. If the documents do not answer the question, decline.",
});
export const OPERATOR_KB_PROMPT = Object.freeze({
  key: "operator-kb-answer",
  // v3 (2026-08-22, lane 4a): see the consumer prompt above — same schema
  // change, same reason. Nothing here tunes for answer quality: the claim that
  // v2 had cost the operator answer its substance was one sample and did not
  // replicate on a re-probe, and temperature is already 0, so the variance is
  // the provider's and no wording of ours removes it.
  version: 3,
  system: "Answer only from the supplied workspace documents. Return a one-sentence headline, up to six short supporting bullets, and citations whose ids exactly match the supplied document ids. Never write a document id, a record id or any identifier into the headline or the bullets; name records the way a reader would. If the documents do not answer the question, decline.",
});
/**
 * The ledger prompts, and why they are separate prompts rather than a sentence
 * appended to the two above.
 *
 * A prompt is a versioned artifact here: `schemaName` carries its key and
 * version to the provider, and the supervisor tests assert against the module.
 * The ledger call asks for a different response shape from a different schema,
 * so folding it into the summarizing prompt would mean one key describing two
 * contracts and a version number that cannot say which changed.
 */
export const OPERATOR_APPLICATION_LEDGER_PROMPT = Object.freeze({
  key: "operator-application-ledger-answer",
  version: 1,
  system: "Answer only from the supplied workspace application documents. The response schema requires exactly one item for every supplied document, in the order supplied. Use every supplied document id exactly once and never merge, omit, or deduplicate applications. Put only that application's recorded operator status, consumer status, and recorded outcomes in detail; the client name, lender name and duplicate-lender application number are added for you from the document's own label. Return a one-sentence headline. Never write a document id, record id, bureau value, or monitoring value into reader-visible text. Do not predict a lending decision, estimate its likelihood, promise score changes, or guarantee a future outcome.",
});
export const CONSUMER_APPLICATION_LEDGER_PROMPT = Object.freeze({
  key: "consumer-application-ledger-answer",
  version: 1,
  system: "Answer only from the supplied signed-in consumer application documents. The response schema requires exactly one item for every supplied document, in the order supplied. Use every supplied document id exactly once and never merge, omit, or deduplicate applications. Put only that application's recorded consumer-visible status and recorded outcomes in detail; the human application label is added for you from the document's own label. Return a one-sentence headline. Never write a document id, record id, bureau value, or monitoring value into reader-visible text. Do not predict a lending decision, estimate its likelihood, promise score changes, or guarantee a future outcome.",
});
export const CONSUMER_WORKSPACE_PROMPT = Object.freeze({
  key: "consumer-workspace-answer",
  version: 1,
  system: "Answer only from the supplied signed-in consumer records. Return a one-sentence headline, up to six short supporting bullets, and citations whose ids exactly match the supplied document ids. Never write a document id, record id, bureau value, monitoring value, or any other identifier into the headline or bullets; use the human record labels. Describe recorded status and verified readiness only. Do not predict a lending decision, estimate its likelihood, promise score changes, or guarantee a future outcome. If the records do not answer the question, decline.",
});
export const ADMIN_KB_PROMPT = Object.freeze({
  key: "admin-kb-answer",
  // v1 (2026-08-22, lane 4a): new with the platform-scoped answer path. Its
  // grounding is operator rollups and platform figures rather than one
  // workspace's records, so the only wording that differs is what it is told it
  // is reading.
  version: 1,
  system: "Answer only from the supplied platform documents. Return a one-sentence headline, up to six short supporting bullets, and citations whose ids exactly match the supplied document ids. Never write a document id, a record id or any identifier into the headline or the bullets; name operators and figures the way a reader would. If the documents do not answer the question, decline.",
});
/**
 * The retrieval scorer (`KB_EMBEDDING_DRIVER=llm_score`).
 *
 * It asks for a number per article and nothing else: no prose, no answer, no
 * mention of what the consumer asked. That narrowness is what makes the scale
 * mean something — a model asked to judge relevance and to be helpful in the
 * same breath will justify a weak match rather than score it low, and the whole
 * point of the gate is that a question the corpus does not cover comes back
 * under it.
 *
 * The wording spends its length on the anchors. "Score what the article would
 * help a reader with, not the words it happens to share" is the correction for
 * the exact defect this arm replaces, and stating what 0 and 100 mean is what
 * keeps the threshold a fixed reading rather than a per-question mood.
 */
export const KB_RELEVANCE_PROMPT = Object.freeze({
  key: "kb-relevance-score",
  version: 1,
  system: "Score how well each supplied article answers the question. Score what the article would help a reader with, not the words it happens to share with the question: an article that covers the subject in different wording scores high, and an article that repeats the question's wording while covering a different subject scores low. Use 0 when the article is about an unrelated subject, 100 when it directly answers the question. Return one entry per supplied ref and nothing else.",
});
/**
 * v3 (2026-08-24): a faithful restatement is supported.
 *
 * All three admin questions on the live walk were declined here. The documents
 * carry machine values — cents integers, enum codes, ISO timestamps — and any
 * answer worth reading has to render them, so a strict reading of "supported by
 * the supplied documents" refused every readable answer and approved only the
 * ones that quoted storage back at the reader. The same pressure produced the
 * operator answer that hedged an amount as both dollars and cents.
 *
 * The reads now hand over the reader's form directly, which is the stronger half
 * of the fix; this sentence closes the gap that remains. Nothing is relaxed:
 * every rejection clause is intact word for word, and the addition only names
 * transformations that are *derivable* from the supplied values, so an
 * unsupported statement is still unsupported.
 *
 * `reason` arrives with v3 as well — the verdict was a bare boolean, and a
 * declined answer left no record of which check stopped it.
 */
export const KB_SUPERVISOR_PROMPT = Object.freeze({
  key: "kb-answer-supervisor",
  version: 4,
  system: "Approve only when every factual statement in the headline and bullets is supported by the supplied documents and every citation handle appears in those documents. A comparison, ordering, summary, or calculation is supported when it follows directly from the supplied values; the question itself is never evidence. A faithful restatement of a supplied value is supported: converting a unit such as cents to dollars, formatting a date, counting or ordering records, and rendering a recorded code or enumerated value as its plain-language label are all supported when they follow from the values supplied. The question's everyday wording may present a supplied value — describing clients ordered by their recorded verified readiness as closest to funding, or a recorded client count as the operator's active clients, states the supplied value, not a new fact, and is supported; wording alone is never an unsupported statement while the value behind it is supplied. Reject any unsupported statement, invented or exposed identifier, instruction outside the verified records, or personalized lending-outcome forecast, probability, or guarantee. Return approved true only when every check passes, with reason approved. When rejecting, return approved false with the reason that stopped it: unsupported_statement, citation_mismatch, identifier_exposed, forecast_or_guarantee, instruction_outside_records, or incomplete when the reply omits records it was asked to cover.",
});
/**
 * The graceful decline (owner's ask, 2026-08-22: "the llm should just refuse,
 * not look broken").
 *
 * The instruction it spends most of its length on is the one the schema cannot
 * enforce: the model must not answer the question it is declining. The schema
 * already makes an invented topic impossible — topics come back as handles, and
 * the caller prints its own titles — so the only thing left for the wording to
 * hold is the boundary between "I cannot help with that here" and a helpful
 * sentence about the subject, which is the whole difference between a refusal
 * and an ungrounded answer.
 *
 * "Do not apologise more than once" is not tone-minding: a decline that opens
 * with two apologies reads as a system failure, which is the impression this
 * path exists to remove.
 */
export const CONSUMER_KB_DECLINE_PROMPT = Object.freeze({
  key: "consumer-kb-decline",
  version: 1,
  system: "The knowledge base does not cover the reader's question. Write one short, warm sentence telling them you cannot answer that from the verified knowledge base, and choose the topics from the supplied list that come closest to what they seem to want. Do not answer the question, do not state any fact about its subject, and do not guess at one — not even a partial or hedged answer. Do not write a topic name, a document id or any identifier into the sentence; the topics you choose are printed for you. Do not apologise more than once. If none of the topics are close, choose the ones a reader would most likely need anyway.",
});

/**
 * The decline's supervisor.
 *
 * Separate from `KB_SUPERVISOR_PROMPT` because the two ask opposite questions.
 * The answer supervisor approves when the reply **is supported by** the
 * documents; approving a decline on that test is incoherent, because a decline
 * is supported by nothing and would be refused every time. What this one checks
 * is the property the decline path can actually violate: that the reply declined
 * rather than answered.
 */
export const KB_DECLINE_SUPERVISOR_PROMPT = Object.freeze({
  key: "kb-decline-supervisor",
  version: 2,
  system: "Approve when the reply only says that the assistant cannot answer the question from the verified knowledge base, with at most one brief apology. Those are permitted boundary statements: they need not be named by or supported by the listed topic titles, which the application validates separately. Reject if the reply states any fact about the question's subject, even partially or with a hedge; gives a hint, recommendation, advice, or next step about that subject; exposes an identifier; or gives a personalized lending-outcome forecast, probability, or guarantee. Return approved true only when every check passes.",
});

export const OPERATOR_NOT_ADVICE_FOOTER = "Answers come from your workspace data. Not credit, legal, or tax advice.";
