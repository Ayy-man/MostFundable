import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { evaluateDraftLanguage } from './language-gate.ts';
import { ROUND_3_ADVERSARIAL_CASES } from '../compliance/__fixtures__/adversarial-language.mjs';

// THIS TEST PROTECTS A DEPENDENCY ON ANOTHER LANE'S STATEMENT ORDER.
//
// `evaluateDraftLanguage` reaches lane C's canonical battery through
// `evaluatePlan`, which runs `validateLanguage(candidate, codes)` immediately
// before its schema early-return. A plain string is therefore fully scanned and
// then rejected with `PLAN_SCHEMA`, which the gate discards.
//
// If lane C ever moves the schema check above the language scan, Phase 13 would
// silently screen nothing — every draft would come back clean and every draft
// would be sendable. The union assertion below turns that into a red test on
// the first run instead. IA-13-02 asks lane C for a first-class
// `evaluateText(value)` export, which removes the ordering dependency; the pin
// stays either way.
//
// The fixture is the one already allow-listed in `verify-compliance-copy.mjs`
// by path, which is why it is reused rather than replaced with fresh strings:
// writing new ones would mean a new allow-list entry.
const POISONED_FIXTURE_PATH = '../llm/__fixtures__/compliance/poisoned-plan.json';

function poisonedStrings(): string[] {
  const fixture: unknown = JSON.parse(
    readFileSync(new URL(POISONED_FIXTURE_PATH, import.meta.url), 'utf8'),
  );

  const found: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === 'string') {
      if (evaluateDraftLanguage(value).length > 0) found.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (value !== null && typeof value === 'object') {
      for (const item of Object.values(value as Record<string, unknown>)) walk(item);
    }
  };
  walk(fixture);
  return found;
}

const CLEAN_SUPPORT_STRINGS = [
  'Thanks for checking in. Your file is with the team and we are working through the current step.',
  'You can add the file from the documents area of your account.',
  'Send me a couple of windows that suit you and I will confirm one back here.',
  'I can walk through what is on your account and where each line comes from.',
  'Thanks for writing in. Could you tell me a little more about what you need?',
  '',
];

describe('draft language gate', () => {
  it('flags every poisoned string in the shared fixture', () => {
    const strings = poisonedStrings();
    assert.equal(
      strings.length,
      11,
      'the shared fixture should carry exactly one poisoned string per canonical rule',
    );
    for (const value of strings) {
      assert.ok(
        evaluateDraftLanguage(value).length > 0,
        `expected at least one code for ${JSON.stringify(value)}`,
      );
    }
  });

  it('covers all eleven legacy fixture rules with no gaps', () => {
    const union = new Set<string>();
    for (const value of poisonedStrings()) {
      for (const code of evaluateDraftLanguage(value)) union.add(code);
    }

    // R5D-04. The fixture's C09 line names a movement of the restricted metric with an adverb
    // rather than a verb, and the widened C21 now reaches it as well. Kept as an exact set rather
    // than relaxed to a superset: the eleven legacy rules still have to be covered with no gaps,
    // and a rule that starts firing here without anybody deciding it should still fails.
    const expected = [
      ...Array.from({ length: 11 }, (_unused, index) =>
        `LANGUAGE_C${String(index + 1).padStart(2, '0')}`,
      ),
      'LANGUAGE_C21',
    ];
    assert.deepEqual([...union].sort(), expected);
  });

  it('covers the three added rules through the direct support gate', () => {
    const values = [
      'Q3JlZGl0IFNlcnZpY2VzIEFncmVlbWVudA==',
      'QSA0MC1wb2ludCBzY29yZSBpbmNyZWFzZSBpcyBleHBlY3RlZC4=',
      'WW91IGFyZSA4MiUgbGlrZWx5IHRvIGJlIGFwcHJvdmVkLg==',
    ];
    // R4D-01's compositional detectors add a second code to each of these. The extra code is the
    // point of that round: each string is now refused by a rule that does not depend on its word
    // order, so the phrase-order rule beside it is no longer the only thing standing there. R5D-05
    // adds C27 to the third, which is a certainty word bound to a percentage about the reader's own
    // outcome — named here rather than relaxed to a superset, so an undecided new code still fails.
    assert.deepEqual(values.map((value) => evaluateDraftLanguage(atob(value))), [
      ['LANGUAGE_C12', 'LANGUAGE_C15', 'LANGUAGE_C22'],
      ['LANGUAGE_C13', 'LANGUAGE_C21'],
      ['LANGUAGE_C14', 'LANGUAGE_C20', 'LANGUAGE_C23', 'LANGUAGE_C27'],
    ]);
  });

  it('returns only canonical language codes, never the schema rejection', () => {
    for (const value of poisonedStrings()) {
      for (const code of evaluateDraftLanguage(value)) {
        assert.match(code, /^LANGUAGE_C\d{2}$/);
      }
    }
  });

  it('rejects every round-three reproduced form through the support gate', () => {
    for (const testCase of ROUND_3_ADVERSARIAL_CASES) {
      assert.ok(evaluateDraftLanguage(testCase.text).includes(testCase.expectedCode), testCase.text);
    }
  });

  it('passes clean support copy', () => {
    for (const value of CLEAN_SUPPORT_STRINGS) {
      assert.deepEqual(evaluateDraftLanguage(value), [], JSON.stringify(value));
    }
  });
});
