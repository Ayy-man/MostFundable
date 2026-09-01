import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { KB_REFUSAL_CODES, runGroundedChat } from "../kb/chat-driver.ts";
import { setRouteFailureSink, type RouteFailureRecord } from "../diagnostics/route-failure.ts";
import { CONSUMER_KB_PROMPT } from "../kb/prompts.ts";
import { evaluateText } from "../llm/evaluator.ts";
import { createMockChatTransport } from "../llm/mock-chat-transport.ts";
import { evaluateDraftLanguage } from "../support/language-gate.ts";
import {
  ADJUNCT_TAIL_ADVERSARIAL_CASES,
  DROP_7_CLIENT_COPY_CONTROLS,
  GOVERNED_VERB_CLEAN_CASES,
  GUARANTEE_COPULAR_CLEAN_CASES,
  GUARANTEE_INSTRUMENT_CLEAN_CASES,
  NP_MODIFIER_CLEAN_CASES,
  OUTCOME_CERTAINTY_AXES,
  OUTCOME_CERTAINTY_CASES,
  OUTCOME_CERTAINTY_CLEAN_CASES,
  PERCENT_MATRIX_AXES,
  PERCENT_MATRIX_CASES,
  PERCENT_MATRIX_CLEAN_CASES,
  ROUND_4_ADVERSARIAL_CASES,
  ROUND_4_CLEAN_CASES,
  ROUND_5_ADVERSARIAL_CASES,
} from "./__fixtures__/adversarial-language.mjs";
import { complianceLanguageCodes } from "./language-rules.mjs";

// R4D-01. The gate has five consumers and a claim that reaches any one of them reaches a consumer.
// Round 4 found the module's own probe green and the product path open, so every case here runs
// through all five rather than through the rule table alone.
const DOCUMENTS = [
  {
    content: "Keep current business records.",
    id: "doc:1",
    metadata: { sourceArticleId: "1" },
    title: "Business records",
    url: "https://example.test/1",
  },
];
/**
 * Rewritten 2026-08-22 by lane 4a, and the rewrite is the point rather than the
 * schema swap that occasioned it.
 *
 * The candidate used to be `{ answer, citations: [{id,title,url}] }`. The schema
 * is now a headline, bullets and citations carrying only the opaque per-request
 * handle the model was shown (F-05, F-09). Reshaping the literal and stopping
 * there would have left the real defect in place: **every case here asserts
 * `=== null`, and `runGroundedChat` returns null for six different reasons.** A
 * candidate the parser rejected and a candidate the compliance gate refused are
 * indistinguishable from the return value, so the assertion passes whenever
 * anything at all goes wrong upstream of the gate — which is how it survived a
 * schema change that stopped its own fixture parsing.
 *
 * `runGroundedChat` does record which gate refused, through the diagnostics seam
 * F-04 added. So the assertion is now on the reason: exactly one record, and its
 * code is `LANGUAGE_BLOCKED`. A malformed candidate records `CANDIDATE_MALFORMED`
 * and fails here loudly; a candidate refused silently records nothing and fails
 * on the count. The code is imported from the module that raises it rather than
 * transcribed, so renaming it cannot leave this checking a string nothing emits.
 *
 * The clean control stays as the second half. The reason assertion proves the
 * gate fired; the control proves the pipeline could have answered, so neither an
 * always-refusing pipeline nor an always-parsing-failure one reads as green.
 */
async function refusalFor(answer: string): Promise<{
  answer: Awaited<ReturnType<typeof runGroundedChat>>;
  codes: readonly string[];
}> {
  const transport = createMockChatTransport((request) => {
    if (!request.operation.endsWith("candidate")) return { approved: true };
    const body = JSON.parse(request.messages[1]!.content) as { documents: Array<{ id: string }> };
    return { bullets: [], citations: [{ id: body.documents[0]!.id }], headline: answer };
  });
  const records: RouteFailureRecord[] = [];
  const restore = setRouteFailureSink((record) => records.push(record));
  try {
    return {
      answer: await runGroundedChat({
        documents: DOCUMENTS,
        prompt: CONSUMER_KB_PROMPT,
        question: "Question",
        transport,
      }),
      codes: records.map((record) => record.code),
    };
  } finally {
    restore();
  }
}

async function groundedAnswerFor(answer: string) {
  return (await refusalFor(answer)).answer;
}

/** The clean control: the same pipeline, the same documents, language nothing objects to. */
const CLEAN_ANSWER = "Keep the business records current.";

describe("compliance gate consumers (R4D-01)", () => {
  for (const { expectedCode, text } of [
    ...ROUND_4_ADVERSARIAL_CASES,
    // R5D-04 / R5D-05. Same loop, deliberately: round 4 already proved that a claim reaching any
    // one consumer reaches a consumer, so a corpus that only ran against the rule table would
    // repeat round 4's mistake in a second place. Every widened form goes through all five.
    ...ROUND_5_ADVERSARIAL_CASES,
  ]) {
    it(`refuses ${expectedCode} through every consumer: ${text}`, async () => {
      const codes: readonly string[] = complianceLanguageCodes(text);
      assert.ok(
        codes.includes(expectedCode),
        `direct rules returned ${JSON.stringify(codes)}`,
      );

      const plan = evaluateText(text);
      assert.equal(plan.approved, false);
      assert.ok(plan.codes.includes(expectedCode));

      assert.ok(evaluateDraftLanguage(text).includes(expectedCode));

      const refused = await refusalFor(text);
      assert.equal(refused.answer, null);
      // Not "it was refused" — WHICH gate refused it. `CANDIDATE_MALFORMED` here
      // would mean the parser rejected the shape and the compliance gate was
      // never consulted, which is a green test guarding nothing.
      assert.deepEqual(
        refused.codes,
        [KB_REFUSAL_CODES.LANGUAGE_BLOCKED],
        `the grounded path refused this for ${JSON.stringify(refused.codes)}, not the language gate`,
      );
      // And the control: the same pipeline, the same documents, clean language.
      // Without it an always-refusing pipeline reads as green.
      assert.notEqual(
        await groundedAnswerFor(CLEAN_ANSWER),
        null,
        "the clean control was refused too, so the refusal above proves nothing",
      );
    });
  }

  for (const text of ROUND_4_CLEAN_CASES) {
    it(`approves clean copy through every consumer: ${text}`, async () => {
      assert.deepEqual(complianceLanguageCodes(text), []);
      assert.deepEqual(evaluateText(text), { approved: true, codes: [] });
      assert.deepEqual(evaluateDraftLanguage(text), []);
      const answer = await groundedAnswerFor(text);
      // `headline`, not `answer`: F-09 split the candidate into parts, and this
      // responder puts the case's text in the headline.
      assert.equal(answer?.headline, text);
    });
  }

  // Named separately from the generic clean loop so the failure message says whose copy broke.
  // Drop 7 ships this text verbatim and rebases onto round 4, so a hit here fails CI on strings the
  // client wrote. The fix is always to narrow the detector, never to reword these.
  it("leaves the Drop 7 client copy alone through every consumer", async () => {
    assert.equal(DROP_7_CLIENT_COPY_CONTROLS.length, 3);
    for (const text of DROP_7_CLIENT_COPY_CONTROLS) {
      assert.deepEqual(
        complianceLanguageCodes(text),
        [],
        `a detector widened onto client copy: ${JSON.stringify(text)}`,
      );
      assert.deepEqual(evaluateText(text), { approved: true, codes: [] });
      assert.deepEqual(evaluateDraftLanguage(text), []);
      assert.equal((await groundedAnswerFor(text))?.headline, text);
    }
  });

  it("carries the corpus into the static-copy scanner's own battery", () => {
    const script = fileURLToPath(new URL("../../../scripts/verify-compliance-copy.mjs", import.meta.url));
    const output = execFileSync(process.execPath, [script, "--self-test"], {
      encoding: "utf8",
      timeout: 120_000,
    });
    assert.match(output, /self-test: \d+\/\d+ case\(s\) passed/);
    const total = Number(/self-test: (\d+)\//.exec(output)?.[1] ?? "0");
    // 220 before round 4, 271 before round 5; the derived corpus, the percentage matrix composed
    // over verb, unit and casing, and C27's family add the rest.
    assert.ok(total >= 14000, `self-test only ran ${total} case(s)`);
  });

  // R5D-04 / R5D-05. The finding these two rows come from is not that a particular sentence got
  // through — it is that every compositional rule's corpus was a single syntactic form, so the
  // rule only ever had to survive the one sentence it was written from and a green suite proved
  // nothing about the class. This asserts the shape of the corpus rather than its contents: a rule
  // whose vocabulary someone widens later still fails here until the corpus widens with it.
  //
  // Per-rule counts before round 5 / after: C20 4/44, C21 1/11, C22 2/2, C23 2/20, C24 1/18,
  // C25 0/30, C26 0/19, C27 0/23329 (composed, not transcribed).
  // R5D-05 third pass. C20's verb axis was derived from a frame and is complete; its percentage-unit
  // axis was a hand-written list holding the symbol and one spelling of the word, and the hole never
  // showed because every probe that reached it used a noun C10 catches independently. The expectation
  // below is composed from the two axes at run time rather than transcribed as sentences, so a verb
  // or a unit added to either axis extends this test on its own. A transcribed assertion is the
  // mechanism behind twenty of round 5's twenty-two findings, and this is the rule it applies to
  // itself.
  it("composes the decision vocabulary against the percentage vocabulary rather than listing it", () => {
    assert.ok(
      PERCENT_MATRIX_AXES.subjects.length >= 24,
      `the decision axis carries ${PERCENT_MATRIX_AXES.subjects.length} subject(s)`,
    );
    assert.ok(
      PERCENT_MATRIX_AXES.units.length >= 11,
      `the percentage axis carries ${PERCENT_MATRIX_AXES.units.length} unit(s)`,
    );
    assert.equal(PERCENT_MATRIX_AXES.spacings.length, 2);
    assert.ok(
      PERCENT_MATRIX_AXES.casingCount >= 3,
      `the casing axis carries ${PERCENT_MATRIX_AXES.casingCount} form(s)`,
    );
    // Casing is an axis, not a detail. Every rule compiles with `i`, so an upper-case unit matches
    // by construction — but a corpus generating only lower-case units would go green whether or not
    // that stayed true, and the tokens that already worked were all lower case.
    assert.ok(
      PERCENT_MATRIX_AXES.casings.some((unit) => unit === unit.toUpperCase() && /[A-Z]/.test(unit)),
      "the casing axis never produces an upper-case unit",
    );
    assert.ok(
      PERCENT_MATRIX_CASES.length
        >= PERCENT_MATRIX_AXES.subjects.length
          * PERCENT_MATRIX_AXES.units.length
          * PERCENT_MATRIX_AXES.casingCount
          * PERCENT_MATRIX_AXES.spacings.length,
      "the corpus is smaller than the cross-product of its own axes",
    );

    const escaped: string[] = [];
    for (const { expectedCode, text } of PERCENT_MATRIX_CASES) {
      if (!complianceLanguageCodes(text).includes(expectedCode)) escaped.push(text);
    }
    assert.deepEqual(escaped, [], `${escaped.length} cell(s) of the matrix returned no code`);
  });

  // The negative half of the same three axes. An abbreviation becoming a recognised unit is exactly
  // what puts ordinary progress copy at risk, so the control is composed rather than pinned as one
  // sentence: every unit in every casing has to leave a progress statement alone.
  it("leaves ordinary progress copy alone in every unit and every casing", () => {
    assert.ok(
      PERCENT_MATRIX_CLEAN_CASES.length
        >= PERCENT_MATRIX_AXES.units.length * PERCENT_MATRIX_AXES.casingCount,
      "the clean corpus is smaller than the cross-product of its own axes",
    );
    const overfired: string[] = [];
    for (const { text } of PERCENT_MATRIX_CLEAN_CASES) {
      const codes = complianceLanguageCodes(text);
      if (codes.length > 0) overfired.push(`${JSON.stringify(codes)} ${text}`);
    }
    assert.deepEqual(overfired, [], `${overfired.length} progress string(s) were refused`);
  });

  // The same matrix through the product path, batched by unit so the consumer round trip runs once
  // per column rather than once per cell.
  for (const unit of PERCENT_MATRIX_AXES.units) {
    it(`refuses a personalized approval percentage written in "${unit}" through every consumer`, async () => {
      const column = PERCENT_MATRIX_CASES.filter((testCase) => testCase.unit === unit);
      assert.ok(column.length > 0);
      for (const { expectedCode, text } of column) {
        const plan = evaluateText(text);
        assert.equal(plan.approved, false, text);
        assert.ok(plan.codes.includes(expectedCode), text);
        assert.ok(evaluateDraftLanguage(text).includes(expectedCode), text);
      }
      assert.equal(await groundedAnswerFor(column[0].text), null);
    });
  }

  // R5D-05, fourth pass. A certainty word bound to a percentage about the reader's own outcome.
  // C14 reached part of this family through a subject list that included the bare noun for money;
  // once that noun came out, the rest of the family turned out never to have been covered, because
  // C14's other branch wants the percentage, then the certainty word, then the subject, in that
  // order. Composed here over outcome x certainty x unit x casing x spacing in both orderings, so
  // neither the vocabulary nor the word order is a list anyone has to keep complete by hand.
  it("composes the outcome vocabulary against certainty and percentage rather than listing it", () => {
    assert.ok(
      OUTCOME_CERTAINTY_AXES.outcomes.length >= 12,
      `the outcome axis carries ${OUTCOME_CERTAINTY_AXES.outcomes.length} subject(s)`,
    );
    assert.ok(
      OUTCOME_CERTAINTY_AXES.certainties.length >= 6,
      `the certainty axis carries ${OUTCOME_CERTAINTY_AXES.certainties.length} form(s)`,
    );
    // Both orderings of the claim, because writing one order out is what let this family through.
    assert.equal(OUTCOME_CERTAINTY_AXES.frames.length, 2);
    // The positive half is the full subject-by-certainty cross-product minus the one pairing the
    // sixth pass carved out — an instrument with a guaranteed fraction of principal — so the bound
    // is the cross-product with that rectangle subtracted rather than a number anyone typed.
    const claimingPairs = OUTCOME_CERTAINTY_AXES.outcomes.length
        * OUTCOME_CERTAINTY_AXES.certainties.length
      - OUTCOME_CERTAINTY_AXES.instrumentOutcomes.length
        * OUTCOME_CERTAINTY_AXES.guaranteeCertainties.length;
    assert.ok(
      OUTCOME_CERTAINTY_CASES.length
        >= claimingPairs
          * PERCENT_MATRIX_AXES.units.length
          * PERCENT_MATRIX_AXES.casingCount
          * PERCENT_MATRIX_AXES.spacings.length
          * OUTCOME_CERTAINTY_AXES.frames.length,
      "the corpus is smaller than the cross-product of its own axes",
    );

    const escaped: string[] = [];
    for (const { expectedCode, text } of OUTCOME_CERTAINTY_CASES) {
      if (!complianceLanguageCodes(text).includes(expectedCode)) escaped.push(text);
    }
    assert.deepEqual(escaped, [], `${escaped.length} cell(s) of the family returned no code`);
  });

  it("leaves the same outcome subjects alone in ordinary progress copy", () => {
    const overfired: string[] = [];
    for (const { text } of OUTCOME_CERTAINTY_CLEAN_CASES) {
      const codes = complianceLanguageCodes(text);
      if (codes.length > 0) overfired.push(`${JSON.stringify(codes)} ${text}`);
    }
    assert.deepEqual(overfired, [], `${overfired.length} progress string(s) were refused`);
  });

  // R5D-05, sixth pass. The guarantee split, asserted in both directions rather than as the four
  // sentences that reported it. A stated fraction of principal is a term of an instrument, so the
  // instrument column has to be clean in every unit and every casing; the same sentence about a sum
  // of money has no such reading and has to keep firing in the same cells. A rule that closes the
  // over-fire by dropping the guarantee vocabulary passes the first half and fails the second.
  it("tells a guaranteed fraction of an instrument from a guarantee about money", () => {
    assert.ok(
      OUTCOME_CERTAINTY_AXES.instrumentOutcomes.length >= 6,
      `the instrument axis carries ${OUTCOME_CERTAINTY_AXES.instrumentOutcomes.length} subject(s)`,
    );
    assert.ok(
      OUTCOME_CERTAINTY_AXES.moneyOutcomes.length >= 8,
      `the money axis carries ${OUTCOME_CERTAINTY_AXES.moneyOutcomes.length} subject(s)`,
    );
    assert.ok(
      GUARANTEE_INSTRUMENT_CLEAN_CASES.length
        >= OUTCOME_CERTAINTY_AXES.instrumentOutcomes.length
          * OUTCOME_CERTAINTY_AXES.guaranteeCertainties.length
          * PERCENT_MATRIX_AXES.units.length
          * PERCENT_MATRIX_AXES.casingCount,
      "the instrument half is smaller than the cross-product of its own axes",
    );

    // R5D-05, seventh pass. The carve-out has to reach every phrasing of the same fact, not the
    // direct one it was written from. Saying the guarantee through a copula moves the vocabulary out
    // of the certainty slot and into the predicate, and the sixth pass's version of the split — which
    // keyed on the certainty word — let that path straight back through. Asserted as its own axis so
    // dropping the family cannot be hidden inside the union count above.
    assert.equal(OUTCOME_CERTAINTY_AXES.guaranteeCopularFrames.length, 2);
    assert.ok(
      GUARANTEE_COPULAR_CLEAN_CASES.length
        >= OUTCOME_CERTAINTY_AXES.instrumentOutcomes.length
          * OUTCOME_CERTAINTY_AXES.certainties.length
          * PERCENT_MATRIX_AXES.units.length
          * PERCENT_MATRIX_AXES.casingCount,
      "the copular half is smaller than the cross-product of its own axes",
    );

    const overfired: string[] = [];
    for (const { text } of GUARANTEE_INSTRUMENT_CLEAN_CASES) {
      const codes = complianceLanguageCodes(text);
      if (codes.length > 0) overfired.push(`${JSON.stringify(codes)} ${text}`);
    }
    assert.deepEqual(overfired, [], `${overfired.length} instrument term(s) were refused`);

    // The mirror of the instrument half, matched the same way — a money subject in a clause that
    // carries the guarantee vocabulary, wherever in the clause it sits.
    const moneyHalf = OUTCOME_CERTAINTY_CASES.filter((testCase) =>
      OUTCOME_CERTAINTY_AXES.moneyOutcomes.includes(testCase.outcome)
      && /guarant/i.test(testCase.text));
    assert.ok(
      moneyHalf.length
        >= OUTCOME_CERTAINTY_AXES.moneyOutcomes.length
          * OUTCOME_CERTAINTY_AXES.guaranteeCertainties.length
          * PERCENT_MATRIX_AXES.units.length
          * PERCENT_MATRIX_AXES.casingCount,
      "the money half is smaller than the cross-product of its own axes",
    );
    const escaped: string[] = [];
    for (const { expectedCode, text } of moneyHalf) {
      if (!complianceLanguageCodes(text).includes(expectedCode)) escaped.push(text);
    }
    assert.deepEqual(escaped, [], `${escaped.length} guarantee(s) about money returned no code`);
  });

  // The other half of the same pass. A certainty word that governs a following verb is a claim
  // about that verb's event, except when the verb is the lending decision itself — so the split is
  // the decision vocabulary crossed against the certainty vocabulary, both of which already exist,
  // rather than a list of verbs to bound. Bounding `certain to` wholesale passes the clean half and
  // fails the decision half; leaving it unbounded does the reverse.
  it("tells a certainty over a decision from a certainty over an ordinary verb", () => {
    assert.ok(
      OUTCOME_CERTAINTY_AXES.decisionVerbs.length >= 17,
      `the decision-verb axis carries ${OUTCOME_CERTAINTY_AXES.decisionVerbs.length} form(s)`,
    );
    assert.ok(
      OUTCOME_CERTAINTY_AXES.nonDecisionVerbs.length >= 6,
      `the ordinary-verb axis carries ${OUTCOME_CERTAINTY_AXES.nonDecisionVerbs.length} form(s)`,
    );
    // The copulas sit on the claiming side of the split: they carry no event of their own, so the
    // certainty lands back on the subject and the figure predicated of it. The rule no longer names
    // them — it asks where the percentage sits — but the axis stays as the floor that rule clears,
    // so a positional guard that quietly stopped covering one of these fails here.
    assert.ok(
      OUTCOME_CERTAINTY_AXES.copulas.length >= 34,
      `the copula axis carries ${OUTCOME_CERTAINTY_AXES.copulas.length} form(s)`,
    );

    // The corpus is a union of two case shapes and only the verb-governed half carries `verb`, so
    // an optional-coalesce does not narrow it — the other branch has no such property at all. The
    // test runner transpiles without checking, so this only ever surfaces under `tsc`.
    const verbOf = (testCase: (typeof OUTCOME_CERTAINTY_CASES)[number]): string =>
      "verb" in testCase && typeof testCase.verb === "string" ? testCase.verb : "";
    const governedFires = OUTCOME_CERTAINTY_CASES.filter((testCase) =>
      OUTCOME_CERTAINTY_AXES.decisionVerbs.includes(verbOf(testCase))
      || OUTCOME_CERTAINTY_AXES.copulas.includes(verbOf(testCase)));
    assert.ok(
      governedFires.length
        >= OUTCOME_CERTAINTY_AXES.outcomes.length
          * OUTCOME_CERTAINTY_AXES.certainties.length
          * (OUTCOME_CERTAINTY_AXES.decisionVerbs.length + OUTCOME_CERTAINTY_AXES.copulas.length)
        - OUTCOME_CERTAINTY_AXES.instrumentOutcomes.length
          * OUTCOME_CERTAINTY_AXES.guaranteeCertainties.length
          * OUTCOME_CERTAINTY_AXES.copulas.length,
      "the governed half is smaller than the cross-product of its own axes",
    );
    const escaped: string[] = [];
    for (const { expectedCode, text } of governedFires) {
      if (!complianceLanguageCodes(text).includes(expectedCode)) escaped.push(text);
    }
    assert.deepEqual(escaped, [], `${escaped.length} governed decision(s) returned no code`);

    // R5D-05, ninth pass. The rule stopped naming the verbs and started asking where the figure
    // sits, which trades one failure mode for another: a percentage can sit in the complement
    // position and still belong to the noun after it. This is that half of the position test, and
    // it is the direction the enumeration was never exposed to, so it gets its own floor.
    assert.equal(OUTCOME_CERTAINTY_AXES.npModifierFrames.length, 3);
    assert.ok(
      OUTCOME_CERTAINTY_AXES.npHeads.length >= 4,
      `the head-noun axis carries ${OUTCOME_CERTAINTY_AXES.npHeads.length} noun(s)`,
    );
    assert.ok(
      NP_MODIFIER_CLEAN_CASES.length
        >= (OUTCOME_CERTAINTY_AXES.moneyOutcomes.length
          + OUTCOME_CERTAINTY_AXES.instrumentOutcomes.length)
          * OUTCOME_CERTAINTY_AXES.certainties.length
          * OUTCOME_CERTAINTY_AXES.npHeads.length
          * PERCENT_MATRIX_AXES.units.length,
      "the noun-modifier half is smaller than the cross-product of its own axes",
    );
    const modifiers: string[] = [];
    for (const { text } of NP_MODIFIER_CLEAN_CASES) {
      const codes = complianceLanguageCodes(text);
      if (codes.length > 0) modifiers.push(`${JSON.stringify(codes)} ${text}`);
    }
    assert.deepEqual(modifiers, [], `${modifiers.length} product term(s) were refused`);

    // R5D-05, tenth pass. The other side of the same test: a figure that does land on the certainty
    // and carries an adjunct behind it. The ninth pass recognised five openers and read the rest of
    // the class as a following noun, so this floor is one tail per grammatical kind crossed against
    // the subject, certainty and unit axes — a kind that stops being recognised fails a column.
    assert.equal(OUTCOME_CERTAINTY_AXES.adjunctTailFrames.length, 2);
    assert.ok(
      OUTCOME_CERTAINTY_AXES.adjunctTails.length >= 12,
      `the adjunct-tail axis carries ${OUTCOME_CERTAINTY_AXES.adjunctTails.length} tail(s)`,
    );
    assert.ok(
      ADJUNCT_TAIL_ADVERSARIAL_CASES.length
        >= OUTCOME_CERTAINTY_AXES.moneyOutcomes.length
          * OUTCOME_CERTAINTY_AXES.certainties.length
          * OUTCOME_CERTAINTY_AXES.adjunctTails.length
          * PERCENT_MATRIX_AXES.units.length,
      "the adjunct-tail half is smaller than the cross-product of its own axes",
    );
    const tails: string[] = [];
    for (const { text } of ADJUNCT_TAIL_ADVERSARIAL_CASES) {
      if (!complianceLanguageCodes(text).includes("LANGUAGE_C27")) tails.push(text);
    }
    assert.deepEqual(tails, [], `${tails.length} adjunct-tail claim(s) returned no C27`);

    assert.ok(
      GOVERNED_VERB_CLEAN_CASES.length
        >= (OUTCOME_CERTAINTY_AXES.moneyOutcomes.length
          + OUTCOME_CERTAINTY_AXES.instrumentOutcomes.length)
          * OUTCOME_CERTAINTY_AXES.certainties.length
          * OUTCOME_CERTAINTY_AXES.nonDecisionVerbs.length,
      "the ordinary-verb half is smaller than the cross-product of its own axes",
    );
    const overfired: string[] = [];
    for (const { text } of GOVERNED_VERB_CLEAN_CASES) {
      const codes = complianceLanguageCodes(text);
      if (codes.length > 0) overfired.push(`${JSON.stringify(codes)} ${text}`);
    }
    assert.deepEqual(overfired, [], `${overfired.length} ordinary-verb string(s) were refused`);
  });

  // One representative cell per outcome and ordering through the product path. The rule-level
  // assertion above covers every cell; this proves the family reaches the consumers, which is the
  // check round 4 found missing when the module's own probe was green and the product path open.
  for (const outcome of OUTCOME_CERTAINTY_AXES.outcomes) {
    it(`refuses a certainty percentage about "${outcome}" through every consumer`, async () => {
      const sample = OUTCOME_CERTAINTY_CASES.filter((testCase) => testCase.outcome === outcome)
        .filter((testCase, index, all) =>
          all.findIndex((other) => other.text.endsWith(testCase.text.slice(-1))
            && other.certainty === testCase.certainty) === index)
        .slice(0, 4);
      assert.ok(sample.length > 0);
      for (const { expectedCode, text } of sample) {
        const plan = evaluateText(text);
        assert.equal(plan.approved, false, text);
        assert.ok(plan.codes.includes(expectedCode), text);
        assert.ok(evaluateDraftLanguage(text).includes(expectedCode), text);
      }
      assert.equal(await groundedAnswerFor(sample[0].text), null);
    });
  }

  it("carries more than one syntactic form for every compositional rule", () => {
    const byRule = new Map<string, number>();
    for (const { expectedCode } of [
      ...ROUND_4_ADVERSARIAL_CASES,
      ...ROUND_5_ADVERSARIAL_CASES,
      ...OUTCOME_CERTAINTY_CASES,
    ]) {
      byRule.set(expectedCode, (byRule.get(expectedCode) ?? 0) + 1);
    }
    const minimums: Record<string, number> = {
      LANGUAGE_C20: 30,
      LANGUAGE_C21: 8,
      LANGUAGE_C22: 2,
      LANGUAGE_C23: 14,
      LANGUAGE_C24: 12,
      LANGUAGE_C25: 24,
      LANGUAGE_C26: 14,
      LANGUAGE_C27: 20000,
    };
    for (const [code, minimum] of Object.entries(minimums)) {
      const actual = byRule.get(code) ?? 0;
      assert.ok(
        actual >= minimum,
        `${code} carries ${actual} case(s), below the ${minimum} this class needs`,
      );
    }
  });
});
