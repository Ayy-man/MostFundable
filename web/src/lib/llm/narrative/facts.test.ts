import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { deriveReadinessPlan } from '../mock-driver.ts';
import { derogFeatures } from '../__fixtures__/features.ts';
import { buildFactsPack } from './facts.ts';
import { allowedNumbers } from './grounding.ts';

describe('FactsPackV2', () => {
  it('projects only bounded narrative facts and phrases utilization gaps with the reported label', () => {
    const features = derogFeatures();
    features.accounts[0].label = 'DISCOVER';
    const pack = buildFactsPack(features, deriveReadinessPlan(features));

    assert.equal(pack.schemaVersion, 2);
    assert.equal(pack.personal.length, 10);
    assert.match(pack.personal.find((item) => item.key === 'utilization_under_30')?.gap ?? '', /^DISCOVER is \$929 on a \$1,000 limit = 92\.9%, above the 30% target\.$/);
    assert.equal(JSON.stringify(pack).includes('mock-subject'), false);
    assert.equal(JSON.stringify(pack).includes('accountNumber'), false);
  });

  it('spells every counted target as a digit, so a verified item still grounds the number the prose uses', () => {
    // A verified item carries no gap line, so the target text is the only place its number can
    // come from; "against the 24-month target" must be grounded on a file with nothing to fix.
    const features = derogFeatures();
    const pack = buildFactsPack(features, deriveReadinessPlan(features));
    const targets = Object.fromEntries(pack.personal.map((item) => [item.key, item.target]));
    assert.match(targets.average_age_two_years, /\b24\b/);
    assert.match(targets.four_personal_accounts_open, /\b4\b/);
    assert.match(targets.inquiries_within_bureau_limit, /\b2\b/);
    assert.match(targets.clean_report, /\b1\b/);
    const allowed = allowedNumbers(pack);
    for (const value of ['24', '4', '2', '1', '700', '30', '10000']) assert.ok(allowed.has(value), `${value} is grounded by the targets`);
  });
});
