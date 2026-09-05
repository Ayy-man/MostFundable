import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { accountWithLabel, packWith, personalFact, tinyPack } from './__fixtures__/packs.ts';
import { allowedNumbers, checkNarrative } from './grounding.ts';
import { deriveMockNarrative } from './driver.ts';
import { NARRATIVE_REFERENCE_DATASET } from './reference-pack.ts';

import type { FactsPackV2, NarrativeV1 } from './contract.ts';

/**
 * Copy that must fail, encoded rather than written out.
 *
 * `verify-compliance-copy.mjs` scans `web/src` for the restricted vocabulary and does not make an
 * exception for a test's negative fixtures, which is correct — a gate with a "unless it is a test"
 * clause is a gate with a hole. `compliance/__fixtures__/adversarial-language.mjs` solves it the
 * same way for the same reason.
 */
const BARRED_COPY = Object.freeze({
  repairService: atob('T25jZSB0aGVzZSBhcmUgaW4sIGNyZWRpdCByZXBhaXIgaXMgd2hhdCBnZXRzIHlvdSB0aGUgcmVzdCBvZiB0aGUgd2F5Lg=='),
  promisedMovement: atob('VGhpcyB3aWxsIHJhaXNlIHlvdXIgc2NvcmUgYnkgMzAgcG9pbnRzLg=='),
});

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
    verdict: 'Near Ready. 1 item to fix.',
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
      const narrative = groundedNarrative({ verdict: `Near Ready. ${'x'.repeat(200)}` });
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
      const narrative = groundedNarrative({ verdict: 'Near Ready. 7 items to fix.' });
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

    it('lets the timeline reason restate the numbers of the band it chose', () => {
      // "30-60 days" is a contract enum value, not a model invention, so the reason may say it.
      const narrative = groundedNarrative({
        timeline: { band: '30-60 days', reason: 'Paying the card down reports within 30 to 60 days.' },
      });
      assert.deepEqual(checkNarrative(narrative, tinyPack()).codes, []);
    });

    it('refuses band numbers outside the timeline reason, and numbers of a band it did not choose', () => {
      const elsewhere = groundedNarrative({
        businessSide: 'The business items usually take 60 days to gather.',
        timeline: { band: '30-60 days', reason: 'One item is open.' },
      });
      assert.deepEqual(checkNarrative(elsewhere, tinyPack()).codes, ['NUMBER_UNGROUNDED']);
      const otherBand = groundedNarrative({
        timeline: { band: '7-30 days', reason: 'This can be done within 60 days.' },
      });
      assert.deepEqual(checkNarrative(otherBand, tinyPack()).codes, ['NUMBER_UNGROUNDED']);
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

  describe('the precomputed paydown figures', () => {
    it('grounds the target and the paydown a step is told to name', () => {
      // tinyPack's card: $4,200 on a $5,000 limit, so 29% is $1,450 and $2,750 has to come off.
      const narrative = groundedNarrative({
        nextSteps: [{
          title: 'Bring the card down',
          detail: 'Pay $2,750 to reach a $1,450 balance, which clears the 30% target.',
          itemKey: 'utilization_under_30',
        }],
      });
      assert.deepEqual(checkNarrative(narrative, tinyPack()).codes, []);
    });

    it('still refuses the arithmetic the pack did not do', () => {
      // The eval's failure mode: a plausible target the rules never chose. $1,500 is 30% of the
      // limit rather than 29%, and it is nowhere in the pack, so it reads as invented — which is
      // exactly right, because a consumer paying to $1,500 lands on 30.0% and fails the item.
      const narrative = groundedNarrative({
        nextSteps: [{ title: 'Bring the card down', detail: 'Pay it to $1,500.', itemKey: 'utilization_under_30' }],
      });
      assert.deepEqual(checkNarrative(narrative, tinyPack()).codes, ['NUMBER_UNGROUNDED']);
    });

    it('grounds nothing extra for an account with no limit', () => {
      const pack = packWith({
        accounts: [{ ...tinyPack().accounts[0], limitCents: null, utilizationPct: null, targetBalanceCents: null, paydownCents: null }],
      });
      const allowed = allowedNumbers(pack);
      assert.equal(allowed.has('1450'), false, 'no target where there is no limit');
      assert.equal(allowed.has('2750'), false, 'and no paydown either');
    });
  });

  describe('LANGUAGE', () => {
    it('refuses copy that trips the shared compliance vocabulary', () => {
      const narrative = groundedNarrative({
        businessSide: BARRED_COPY.repairService,
      });
      assert.deepEqual(checkNarrative(narrative, tinyPack()).codes, ['LANGUAGE']);
    });

    it('refuses a promised movement in the restricted metric', () => {
      const narrative = groundedNarrative({
        timeline: { band: '30-60 days', reason: BARRED_COPY.promisedMovement },
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
        verdict: 'Near Ready. 1 item to fix.',
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

  describe('SCHEMA_LEAKED', () => {
    it('refuses a checklist key written into the prose', () => {
      const narrative = groundedNarrative({
        whereYouStand: 'utilization_under_30 is the one item still open, at 84% against the 30% target.',
      });
      assert.deepEqual(checkNarrative(narrative, tinyPack()).codes, ['SCHEMA_LEAKED']);
    });

    it('refuses the not_checkable state token', () => {
      const narrative = groundedNarrative({
        businessSide: 'Every business item is not_checkable until the owner supplies it.',
      });
      assert.deepEqual(checkNarrative(narrative, tinyPack()).codes, ['SCHEMA_LEAKED']);
    });

    it('allows the ordinary words "verified" and "unverified"', () => {
      // The 2026-09-05 rerun: Sonnet wrote "9 of the 10 items are already verified" on a clean
      // file and the checker rejected it. That is the founder's own sentence, not a schema leak.
      const narrative = groundedNarrative({
        whereYouStand: '9 of the 10 personal items are already verified; one is unverified: the card at 84%, above the 30% target.',
      });
      assert.deepEqual(checkNarrative(narrative, tinyPack()).codes, []);
    });

    it('matches on word boundaries, so "a clean report" is not the clean_report key', () => {
      const narrative = groundedNarrative({
        whereYouStand: 'A clean report and 9 of the 10 items in place; the card at 84% is above the 30% target.',
      });
      assert.deepEqual(checkNarrative(narrative, tinyPack()).codes, []);
    });
  });

  describe('VERDICT_LABEL', () => {
    it('refuses a verdict that opens with a label the rules did not choose', () => {
      // The failure the eval actually produced: a model narrating "Not ready yet" over a file the
      // rules had labelled "Near Ready", so the headline and the status beside it disagreed.
      const narrative = groundedNarrative({ verdict: 'Not ready yet. 1 item to fix.' });
      assert.deepEqual(checkNarrative(narrative, tinyPack()).codes, ['VERDICT_LABEL']);
    });

    it('accepts each of the three labels against its own pack', () => {
      for (const label of ['Ready', 'Near Ready', 'Building Readiness'] as const) {
        const pack = packWith({ readinessLabel: label });
        const narrative = groundedNarrative({ verdict: `${label}. 1 item to fix.` });
        assert.deepEqual(checkNarrative(narrative, pack).codes, [], label);
      }
    });

    it('does not turn on capitalisation or a leading space', () => {
      for (const verdict of ['near ready. 1 item to fix.', '  Near Ready. 1 item to fix.']) {
        assert.deepEqual(checkNarrative(groundedNarrative({ verdict }), tinyPack()).codes, []);
      }
    });

    it('refuses a label that is merely close', () => {
      // "Ready" is a real label, and a pack labelled "Near Ready" is the one case where a prefix
      // check in the other direction would wave the wrong string through.
      const pack = packWith({ readinessLabel: 'Near Ready' });
      assert.deepEqual(
        checkNarrative(groundedNarrative({ verdict: 'Ready. 1 item to fix.' }), pack).codes,
        ['VERDICT_LABEL'],
      );
    });
  });

  it('reports every distinct failure at once, sorted', () => {
    const narrative = groundedNarrative({
      verdict: 'Near Ready. 7 items to fix.',
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
