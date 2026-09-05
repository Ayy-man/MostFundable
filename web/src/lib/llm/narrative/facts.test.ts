import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { deriveReadinessPlan } from '../mock-driver.ts';
import { derogFeatures } from '../__fixtures__/features.ts';
import { buildFactsPack } from './facts.ts';

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
});
