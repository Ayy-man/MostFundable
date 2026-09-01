// answer-body.property.test.ts — the encoding over bodies nobody hand-wrote.
//
// `structured-answer.test.ts` proves the round trip on a handful of examples. The
// failure mode those cannot reach is the one that matters here: **content that
// looks like our own encoding.** A model writes a bullet that opens with a dash,
// a headline wraps across lines, an answer arrives with a blank line in the
// middle — and the decode has to tell our markers from theirs. Examples somebody
// thought of are exactly the wrong instrument for that, because the cases that
// break it are the ones nobody thought of.
//
// The generator is the same seven-line xorshift32 `operator-ladder.property.test.ts`
// uses, inline, no dependency added. Every failure prints its seed, so a red run
// reproduces with `ANSWER_BODY_SEED=<printed seed> npm test`.
//
// The properties are stated as **fixpoints** rather than as "decode undoes
// encode", and that is deliberate. `encodeAnswerBody` normalizes — it collapses
// whitespace and drops blank bullets — so literal equality after one round trip
// is false by design, and a test asserting it would have to re-implement the
// normalizer to describe the expected value. Re-implementing it is transcription
// of the worst kind: the copy drifts and the test then certifies the copy.
// `encode(decode(encode(b))) === encode(b)` needs no such knowledge and says the
// thing that actually has to be true — once a body has been through the
// encoding, further round trips never change it again.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ANSWER_BULLET_PREFIX, decodeAnswerBody, encodeAnswerBody } from "./answer-body.ts";

const SEED = Number(process.env.ANSWER_BODY_SEED ?? 20260822);
const CASES = 500;

/** xorshift32 — deterministic, seeded, and reproducible from the printed seed. */
function random(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x1_0000_0000;
  };
}

// Fragments chosen to collide with the encoding rather than to read well. The
// marker, a bare dash, blank lines, leading and trailing space, an empty string
// and a run long enough to wrap are all here because each one is a way the
// decode could mistake a reader's text for its own structure.
const FRAGMENTS = [
  "Keep the business records current.",
  `${ANSWER_BULLET_PREFIX}a bullet marker inside the text`,
  "-not a marker, no space after the dash",
  "line one\nline two",
  "\n\n",
  "   leading and trailing   ",
  "",
  "   ",
  "a headline long enough that a renderer would wrap it across more than one visual line in any reasonable column width",
  "Morgan Ready Demo is closest, with two open actions.",
  `${ANSWER_BULLET_PREFIX}${ANSWER_BULLET_PREFIX}doubled marker`,
  "tabs\tand\tmore\ttabs",
];

function pick(next: () => number): string {
  return FRAGMENTS[Math.floor(next() * FRAGMENTS.length)]!;
}

function generateBody(next: () => number): { headline: string; bullets: string[] } {
  const count = Math.floor(next() * 8); // deliberately over the schema's six
  return {
    bullets: Array.from({ length: count }, () => pick(next)),
    headline: pick(next),
  };
}

// Named for what it makes rather than for the verb. `generateText` is the Vercel AI SDK's entry
// point and `verify-ai-transport.mjs` bans it by name across the whole tree — correctly, because
// every model call in this product goes through the ZDR transport and a bare SDK call would bypass
// the supervisor gate. A local helper wearing that name is not a violation, but it makes a reader
// stop and check whether it is one, which is most of what the ban is worth.
function randomBodyText(next: () => number): string {
  const pieces = Math.floor(next() * 6);
  return Array.from({ length: pieces }, () => pick(next)).join(
    next() < 0.5 ? "\n" : "\n\n",
  );
}

describe("the answer encoding, over generated bodies", () => {
  it("reaches a fixpoint after one round trip", () => {
    const next = random(SEED);
    for (let index = 0; index < CASES; index += 1) {
      const body = generateBody(next);
      const once = encodeAnswerBody(body);
      const twice = encodeAnswerBody(decodeAnswerBody(once));
      assert.equal(
        twice,
        once,
        `seed ${SEED} case ${index}: re-encoding changed the body\n${JSON.stringify(body)}`,
      );
    }
  });

  it("reaches the same fixpoint starting from arbitrary text", () => {
    // The shape a row written before this format existed has, or one restored
    // from elsewhere. It has no obligation to round-trip to itself — it was never
    // encoded — but it must settle, or history renders differently on each read.
    const next = random(SEED + 1);
    for (let index = 0; index < CASES; index += 1) {
      const text = randomBodyText(next);
      const once = encodeAnswerBody(decodeAnswerBody(text));
      const twice = encodeAnswerBody(decodeAnswerBody(once));
      assert.equal(twice, once, `seed ${SEED + 1} case ${index}: decode did not settle\n${JSON.stringify(text)}`);
    }
  });

  it("never throws, whatever it is handed", () => {
    // `decodeAnswerBody` is on a read path that renders history. A body it
    // refuses is a conversation a person cannot open, so the only acceptable
    // response to unrecognisable input is a degraded reading.
    const next = random(SEED + 2);
    for (let index = 0; index < CASES; index += 1) {
      const text = randomBodyText(next);
      assert.doesNotThrow(() => decodeAnswerBody(text), `seed ${SEED + 2} case ${index}`);
    }
  });

  it("keeps exactly the bullets that carried content", () => {
    // Counted against an independent notion of "has content" — a non-whitespace
    // character — rather than against the encoder's own normalizer, which is the
    // thing under test.
    const next = random(SEED + 3);
    for (let index = 0; index < CASES; index += 1) {
      const body = generateBody(next);
      const substantive = body.bullets.filter((bullet) => /\S/.test(bullet)).length;
      const decoded = decodeAnswerBody(encodeAnswerBody(body));
      assert.equal(
        decoded.bullets.length,
        substantive,
        `seed ${SEED + 3} case ${index}: ${substantive} bullets had content, ${decoded.bullets.length} survived\n${JSON.stringify(body)}`,
      );
      for (const bullet of decoded.bullets) {
        assert.ok(/\S/.test(bullet), "a blank bullet survived the encoding");
      }
    }
  });
});

describe("the answer encoding, on input it did not write", () => {
  // The documented degradation, case by case. The rule is one sentence — a line
  // opening with the marker is a bullet, everything else is headline — and these
  // pin what that rule does to the four kinds of body that will eventually reach
  // it: a row written before this format landed, a hand-inserted row, a
  // truncated write, and an empty one.
  const CASES_BY_NAME: ReadonlyArray<[string, string, { headline: string; bullets: string[] }]> = [
    ["an empty body", "", { bullets: [], headline: "" }],
    ["a body that is only whitespace", "   \n\n  ", { bullets: [], headline: "" }],
    [
      "prose written before this format existed",
      "Two clients are close to funding.\n\nBoth have open actions.",
      { bullets: [], headline: "Two clients are close to funding. Both have open actions." },
    ],
    [
      "a hand-inserted row using a different marker",
      "Headline.\n\n* one\n* two",
      { bullets: [], headline: "Headline. * one * two" },
    ],
    [
      "a write truncated mid-bullet",
      "Headline.\n\n- complete bullet\n- trunca",
      { bullets: ["complete bullet", "trunca"], headline: "Headline." },
    ],
    [
      // Position wins over the marker, so the first line reads as the headline
      // even though it is marked. For anything this module wrote that is simply
      // correct — line one is always the headline — and for a hand-written row
      // like this one it is a defensible reading rather than a right answer.
      // The alternative rule, marker-wins, is what silently ate a headline that
      // opened with a dash.
      "a hand-written row that is all bullets",
      "- one\n- two",
      { bullets: ["two"], headline: "- one" },
    ],
    [
      "a trailing paragraph after the bullets",
      "Headline.\n\n- one\n\nA trailing paragraph.",
      { bullets: ["one"], headline: "Headline. A trailing paragraph." },
    ],
  ];

  for (const [name, body, expected] of CASES_BY_NAME) {
    it(`degrades ${name} to a headline and whatever was marked`, () => {
      assert.deepEqual(decodeAnswerBody(body), expected);
    });
  }
});
