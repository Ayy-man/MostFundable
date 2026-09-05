import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

describe('privacy erasure verifier', () => {
  it('only targets a local stack, exits cleanly without settings, and prints no personal values', async () => {
    const source = await readFile(new URL('../../../scripts/verify-privacy-erasure.mjs', import.meta.url), 'utf8');

    assert.match(source, /NEXT_PUBLIC_SUPABASE_URL[\s\S]*SUPABASE_SERVICE_ROLE_KEY/);
    assert.match(source, /process\.exitCode = 2/);
    assert.match(source, /127\\\.0\\\.0\\\.1\|localhost/);
    assert.match(source, /administerPrivacyRequest/);
    assert.match(source, /complete-while-enrolled/);
    assert.doesNotMatch(source, /say\([^)]*(?:serviceRole|password|consumerEmail)\)/);
  });
});
