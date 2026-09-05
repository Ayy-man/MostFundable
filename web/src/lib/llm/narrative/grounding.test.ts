import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { accountWithLabel, packWith, personalFact, tinyPack } from './__fixtures__/packs.ts';
import { allowedNumbers, checkNarrative } from './grounding.ts';
import { deriveMockNarrative } from './driver.ts';
import { NARRATIVE_REFERENCE_DATASET } from './reference-pack.ts';

import type { FactsPackV2, NarrativeV1 } from './contract.ts';

/**
 * A narrative the tiny pack grounds completely.
 *
 * Every number in it — 62, 84, 30, 4,200, 5,000, 1, 9, 10 — is either on the pack or one of the
 * three constants `allowedNumbers` adds by construction, so any code a test sees came from the
 * override it applied and not from the base.
 */
function groundedNarrative(overrides: Partial<NarrativeV1> = {}): NarrativeV1 {
  return {
    schemaVersion: 1,
    verdict: 'Not ready yet. 1 item to fix.',
    whereYouStand:
      'Readiness is 62 out of 100, with 9 of the 10 personal items satisfied. The card is $4,200 on a $5,000 limit = 84%, above the 30% target.',
    nextSteps: [
      {
        title: 'Bring the card balance down',
        detail: 'Take it to under 30% of the $5,000 limit.',
        itemKey: 'utilization_under_30',
      },
    ],
    itemNotes: {
      utilization_under_30: 'The card is at 84%, above the 30% target.',
    },
    businessSide: 'The business items are supplied by the owner rather than read from a credit file.',
    timeline: { band: '30-60 days', reason: 'One item is open and it moves on a statement cycle.' },
    generation: { driver: 'mock', model: 'template-narrative-v1', promptVersion: 1 },
    ...overrides,
  } as NarrativeV1;
}

describe('narrative grounding checker', () => {
  it('approves a narrative whose every number is on the pack', () => {
    const verdict = checkNarrative(groundedNarrative(), tinyPack());
    assert.deepEqual(verdict.codes, []);
    assert.equal(verdict.approved, true);
  });

  describe('NARRATIVE_SCHEMA', () => {
    it('refuses anything that is not an object', () => {
      for (const value of [null, undefined, 'narrative', 7, []]) {
        assert.deepEqual(checkNarrative(value, tinyPack()).codes, ['NARRATIVE_SCHEMA']);
      }
    });

    it('refuses a missing field, a wrong schema version and an empty string', () => {
      const cases: Partial<NarrativeV1>[] = [
        { schemaVersion: 2 as unknown as 1 },
        { verdict: '' },
        { whereYouStand: '   ' },
        { businessSide: undefined as unknown as string },
      ];
      for (const override of cases) {
        assert.deepEqual(checkNarrative(groundedNarrative(override), tinyPack()).codes, ['NARRATIVE_SCHEMA']);
      }
    });

    it('refuses a band outside the fixed vocabulary', () => {
      const narrative = groundedNarrative({
        timeline: { band: 'next quarter' as never, reason: 'A reason.' },
      });
      assert.deepEqual(checkNarrative(narrative, tinyPack()).codes, ['NARRATIVE_SCHEMA']);
    });

    it('refuses zero steps and refuses four', () => {
      const step = groundedNarrative().nextSteps[0];
      assert.deepEqual(checkNarrative(groundedNarrative({ nextSteps: [] }), tinyPack()).codes, ['NARRATIVE_SCHEMA']);
      assert.deepEqual(
        checkNarrative(groundedNarrative({ nextSteps: [step, step, step, step] }), tinyPack()).codes,
        ['NARRATIVE_SCHEMA'],
      );
    });

    it('refuses a field over its declared cap', () => {
      const narrative = groundedNarrative({ verdict: `Not ready. ${'x'.repeat(200)}` });
      assert.deepEqual(checkNarrative(narrative, tinyPack()).codes, ['NARRATIVE_SCHEMA']);
    });

    it('refuses an item note keyed by something that is not a personal item', () => {
      const narrative = groundedNarrative({
        itemNotes: { business_email_present: 'A note.' } as never,
      });
      assert.deepEqual(checkNarrative(narrative, tinyPack()).codes, ['NARRATIVE_SCHEMA']);
    });

    it('refuses a generation block naming a driver that does not exist', () => {
      const narrative = groundedNarrative({
        generation: { driver: 'anthropic' as never, model: 'x', promptVersion: 1 },
      });
      assert.deepEqual(checkNarrative(narrative, tinyPack()).codes, ['NARRATIVE_SCHEMA']);
    });
  });

  describe('NUMBER_UNGROUNDED', () => {
    it('refuses a number the pack does not carry', () => {
      const narrative = groundedNarrative({ verdict: 'Not ready yet. 7 items to fix.' });
      assert.deepEqual(checkNarrative(narrative, tinyPack()).codes, ['NUMBER_UNGROUNDED']);
    });

    it('refuses arithmetic the model did itself', () => {
      // $5,000 and $4,200 are both on the pack; the difference is not, and computing it is exactly
      // the way a model invents a fact out of two facts.
      const narrative = groundedNarrative({
        nextSteps: [{ title: 'Pay it down', detail: 'That is $2,700 to pay down.', itemKey: 'utilization_under_30' }],
      });
      assert.deepEqual(checkNarrative(narrative, tinyPack()).codes, ['NUMBER_UNGROUNDED']);
    });

    it('grounds cents as whole dollars, punctuated either way', () => {
      const allowed = allowedNumbers(tinyPack());
      assert.ok(allowed.has('4200'), 'balance in whole dollars');
      assert.ok(allowed.has('4,200'), 'balance with a thousands separator');
      assert.ok(allowed.has('420000'), 'the raw cents value');
    });

    it('grounds the score, the counts and the "X/10" form', () => {
      const allowed = allowedNumbers(tinyPack());
      for (const value of ['62', '1', '9', '10']) assert.ok(allowed.has(value), `${value} is grounded`);
    });

    it('grounds the small integers a step uses as an ordinal', () => {
      const allowed = allowedNumbers(tinyPack());
      for (const value of ['1', '2', '3']) assert.ok(allowed.has(value), `${value} is grounded`);
    });

    it('grounds a year inside an account label the pack carries', () => {
      const narrative = groundedNarrative({
        itemNotes: { utilization_under_30: 'RETAIL CARD 2020 is at 84%, above the 30% target.' },
      });
      assert.deepEqual(checkNarrative(narrative, tinyPack()).codes, []);
    });

    it('does not ground a year the pack never mentioned', () => {
      const pack = packWith({ accounts: [accountWithLabel('RETAIL CARD')] });
      const narrative = groundedNarrative({
        itemNotes: { utilization_under_30: 'The card opened in 2020 is at 84%, above the 30% target.' },
      });
      assert.deepEqual(checkNarrative(narrative, pack).codes, ['NUMBER_UNGROUNDED']);
    });

    it('grounds the 45-day window only when the file has an inquiry', () => {
      assert.equal(allowedNumbers(tinyPack()).has('45'), false);
      const withInquiry = packWith({
        inquiries: [{ inquiryRef: 'inquiry-1', bureau: 'EQF', monthsAgo: 2, matchedNewAccountWithin45Days: false }],
      });
      assert.equal(allowedNumbers(withInquiry).has('45'), true);
    });

    it('does not ground the parts of the timestamp the pack was computed at', () => {
      // 2026 and 12 are only in `computedAt`, and a narrative that quoted either would be quoting
      // the clock rather than the file.
      const allowed = allowedNumbers(tinyPack());
      assert.equal(allowed.has('2026'), false);
      assert.equal(allowed.has('12'), false);
    });
  });

  describe('LANGUAGE', () => {
    it('refuses copy that trips the shared compliance vocabulary', () => {
      const narrative = groundedNarrative({
        businessSide: 'Once these are in, credit repair is what gets you the rest of the way.',
      });
      assert.deepEqual(checkNarrative(narrative, tinyPack()).codes, ['LANGUAGE']);
    });

    it('refuses a promised movement in the restricted metric', () => {
      const narrative = groundedNarrative({
        timeline: { band: '30-60 days', reason: 'This will raise your score by 30 points.' },
      });
      assert.ok(checkNarrative(narrative, tinyPack()).codes.includes('LANGUAGE'));
    });

    it('does not let a schema identifier trip a copy rule', () => {
      // The compliance helper walks object keys as well as values. Item keys are identifiers, not
      // copy, so the checker hands it the prose alone — this is the test that pins that.
      const pack = packWith({ personal: [personalFact('no_negative_items_reported', 'unverified')] });
      const narrative = groundedNarrative({
        itemNotes: { no_negative_items_reported: 'Nothing negative is on the file today.' },
        nextSteps: [{ title: 'Hold steady', detail: 'Keep the balances where they are.', itemKey: null }],
        whereYouStand: 'Readiness is 62 out of 100.',
        verdict: 'Not ready yet. 1 item to fix.',
      });
      assert.deepEqual(checkNarrative(narrative, pack).codes, []);
    });
  });

  describe('LENDER_NAMED', () => {
    it('refuses a brand the file never mentioned', () => {
      const narrative = groundedNarrative({
        nextSteps: [{ title: 'Pay the Chase card', detail: 'Take it under 30%.', itemKey: 'utilization_under_30' }],
      });
      assert.deepEqual(checkNarrative(narrative, tinyPack()).codes, ['LENDER_NAMED']);
    });

    it('allows a creditor label the pack carries verbatim', () => {
      const pack = packWith({ accounts: [accountWithLabel('DISCOVER IT CARD')] });
      const narrative = groundedNarrative({
        nextSteps: [{ title: 'Pay the Discover down', detail: 'Take it under 30%.', itemKey: 'utilization_under_30' }],
      });
      assert.deepEqual(checkNarrative(narrative, pack).codes, []);
    });

    it('does not fire on an ordinary word that contains a brand', () => {
      const narrative = groundedNarrative({
        businessSide: 'Discovering which documents you already hold is the fastest part of this.',
      });
      assert.deepEqual(checkNarrative(narrative, tinyPack()).codes, []);
    });
  });

  describe('ITEM_NOTE_MISMATCH', () => {
    it('refuses a note on an item the rules marked verified', () => {
      const pack = packWith({
        personal: [personalFact('utilization_under_30', 'unverified'), personalFact('no_late_payments', 'verified')],
      });
      const narrative = groundedNarrative({
        itemNotes: {
          utilization_under_30: 'The card is at 84%, above the 30% target.',
          no_late_payments: 'Nothing late is reported.',
        },
      });
      assert.deepEqual(checkNarrative(narrative, pack).codes, ['ITEM_NOTE_MISMATCH']);
    });

    it('refuses a missing note for an unverified item', () => {
      const pack = packWith({
        personal: [personalFact('utilization_under_30', 'unverified'), personalFact('no_late_payments', 'unverified')],
      });
      assert.deepEqual(checkNarrative(groundedNarrative(), pack).codes, ['ITEM_NOTE_MISMATCH']);
    });

    it('accepts no notes at all when nothing is unverified', () => {
      const pack = packWith({ personal: [personalFact('utilization_under_30', 'verified')] });
      const narrative = groundedNarrative({
        itemNotes: {},
        nextSteps: [{ title: 'Hold steady', detail: 'Keep the balances where they are.', itemKey: null }],
      });
      assert.deepEqual(checkNarrative(narrative, pack).codes, []);
    });

    it('treats not_checkable as needing no note', () => {
      const pack = packWith({
        personal: [personalFact('utilization_under_30', 'unverified'), personalFact('clean_report', 'not_checkable')],
      });
      assert.deepEqual(checkNarrative(groundedNarrative(), pack).codes, []);
    });
  });

  describe('STEP_ITEM_UNKNOWN', () => {
    it('refuses a step pointing at an item the pack does not carry', () => {
      const narrative = groundedNarrative({
        nextSteps: [{ title: 'Do the thing', detail: 'Take it under 30%.', itemKey: 'no_late_payments' }],
      });
      assert.deepEqual(checkNarrative(narrative, tinyPack()).codes, ['STEP_ITEM_UNKNOWN']);
    });

    it('allows a null itemKey and allows a business item the pack carries', () => {
      const withNull = groundedNarrative({
        nextSteps: [{ title: 'Do the thing', detail: 'Take it under 30%.', itemKey: null }],
      });
      assert.deepEqual(checkNarrative(withNull, tinyPack()).codes, []);
      const withBusiness = groundedNarrative({
        nextSteps: [{ title: 'Send the address', detail: 'It is the last open item.', itemKey: 'business_email_present' }],
      });
      assert.deepEqual(checkNarrative(withBusiness, tinyPack()).codes, []);
    });
  });

  it('reports every distinct failure at once, sorted', () => {
    const narrative = groundedNarrative({
      verdict: 'Not ready yet. 7 items to fix.',
      nextSteps: [{ title: 'Pay the Chase card', detail: 'Take it under 30%.', itemKey: 'no_late_payments' }],
      itemNotes: {},
    });
    assert.deepEqual(checkNarrative(narrative, tinyPack()).codes, [
      'ITEM_NOTE_MISMATCH',
      'LENDER_NAMED',
      'NUMBER_UNGROUNDED',
      'STEP_ITEM_UNKNOWN',
    ]);
  });

  it('approves the mock narrative on every reference pack', () => {
    for (const pack of NARRATIVE_REFERENCE_DATASET satisfies readonly FactsPackV2[]) {
      const verdict = checkNarrative(deriveMockNarrative(pack, 1), pack);
      assert.deepEqual(verdict.codes, [], 'the default deployment must produce something showable');
    }
  });
});
