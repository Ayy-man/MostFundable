import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { cleanFeatures } from '../__fixtures__/features.ts';
import { buildFactsPack } from './facts.ts';
import { allowedNumbers } from './grounding.ts';
import { serializeFactsPack } from './driver.ts';
import { deriveReadinessPlan } from '../mock-driver.ts';

import type { DerivedFeatures } from '../../analysis/features.ts';

/**
 * The paydown figures the rules compute so the narrative never has to.
 *
 * These live in `facts.ts`, which the rules lane owns, but the reason they exist is this lane's:
 * the grounding checker refuses a number the pack does not carry, and "29% of the limit" is a
 * number a model works out rather than reads. So the arithmetic has to happen here, once, where it
 * is auditable — and these tests pin it from the narrative side, because this is the side that
 * breaks if it drifts.
 */
function packFrom(features: DerivedFeatures) {
  return buildFactsPack(features, deriveReadinessPlan(features));
}

describe('precomputed paydown targets', () => {
  it('sets 29% of the limit, floored to the dollar, and the distance to it', () => {
    const features = cleanFeatures();
    const pack = packFrom(features);
    for (const account of pack.accounts) {
      if (account.limitCents === null || account.limitCents <= 0) continue;
      const expected = Math.floor((account.limitCents * 0.29) / 100) * 100;
      assert.equal(account.targetBalanceCents, expected, account.accountRef);
      assert.equal(account.targetBalanceCents! % 100, 0, 'a whole number of dollars');
      assert.equal(account.paydownCents, Math.max(0, account.balanceCents - expected), account.accountRef);
    }
  });

  it('lands strictly under the target rather than exactly on it', () => {
    // 30% of the limit is not under 30% of the limit. A consumer who pays to the round number and
    // lands on 30.0% has done the work and still failed the item, which is why this is 29%.
    for (const account of packFrom(cleanFeatures()).accounts) {
      if (account.targetBalanceCents === null || account.limitCents === null) continue;
      assert.ok(
        account.targetBalanceCents / account.limitCents < 0.3,
        `${account.accountRef} target is strictly under the 30% line`,
      );
    }
  });

  it('never claims a target for an account with no limit', () => {
    for (const account of packFrom(cleanFeatures()).accounts) {
      if (account.limitCents !== null) continue;
      assert.equal(account.targetBalanceCents, null);
      assert.equal(account.paydownCents, null);
    }
  });

  it('reports nothing to pay when the card is already under the target', () => {
    const features = cleanFeatures();
    const pack = packFrom(features);
    for (const account of pack.accounts) {
      if (account.paydownCents === null || account.targetBalanceCents === null) continue;
      if (account.balanceCents > account.targetBalanceCents) continue;
      assert.equal(account.paydownCents, 0, 'no negative paydown');
    }
  });

  it('grounds both figures, and shows them to the model in whole dollars', () => {
    const pack = packFrom(cleanFeatures());
    const allowed = allowedNumbers(pack);
    const shown = serializeFactsPack(pack) as { accounts: Record<string, unknown>[] };
    pack.accounts.forEach((account, index) => {
      if (account.targetBalanceCents === null || account.paydownCents === null) return;
      assert.ok(allowed.has(String(Math.round(account.targetBalanceCents / 100))), 'target is grounded');
      assert.ok(allowed.has(String(Math.round(account.paydownCents / 100))), 'paydown is grounded');
      assert.equal(shown.accounts[index].targetBalanceDollars, Math.round(account.targetBalanceCents / 100));
      assert.equal(shown.accounts[index].paydownDollars, Math.round(account.paydownCents / 100));
      assert.equal(shown.accounts[index].targetBalanceCents, undefined, 'no cents key reaches the model');
    });
  });
});
