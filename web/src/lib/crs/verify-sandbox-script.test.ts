import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

describe('CRS sandbox verifier', () => {
  it('fails safely without credentials and never formats credential or identity values', async () => {
    const source = await readFile(new URL('../../../scripts/verify-crs-sandbox.mjs', import.meta.url), 'utf8');

    assert.match(source, /\.env\.local/);
    assert.match(source, /process\.exitCode = 2/);
    assert.match(source, /CRS_BASE_URL[\s\S]*CRS_API_KEY[\s\S]*CRS_SECRET/);
    assert.doesNotMatch(source, /console\.log\([^)]*(?:apiKey|secret|token|identity)/i);
  });
});
