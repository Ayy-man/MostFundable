// web/src/lib/crs/driver.test.ts — the INTERFACES §10 resolution matrix, the boot-time throw,
// import safety under an empty env, and the single FEATURE_ANALYSIS read.
//
// Every env in this file is a literal object, not `process.env`. That is only possible because
// `resolveCrsDriver`, `assertSandboxCredentials` and `isAnalysisEnabled` all take their env as an
// argument — the property that makes the matrix testable without global stubbing. The one
// exception is the import-safety test at the bottom, which is documented in place.
//
// Every credential-shaped value here is an obviously-fake literal. A test string that could be
// mistaken for a real key is a repo-credential defect exactly like a real one.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { assertSandboxCredentials, resolveCrsDriver } from './driver.ts';
import { CrsConfigError } from './errors.ts';
import { isAnalysisEnabled } from './feature-flag.ts';
import type { CrsDriver } from './types.ts';

/** Obviously fake: the wrong shape and length for any real credential, and it says so. */
const FAKE_API_KEY = 'not-a-real-key';
const FAKE_SECRET = 'not-a-real-secret';
const FAKE_BASE_URL = 'https://crs.invalid/not-a-real-host';

/**
 * The complete sandbox credential set, as R4C-03 widened it: a selected real driver must declare
 * its inbound half too, because the CRS adapter rejects every callback without the basic-auth pair.
 * A sandbox arm that boots and then silently drops deliveries is the failure this set prevents.
 */
const SANDBOX_CREDENTIALS = {
  CRS_BASE_URL: FAKE_BASE_URL,
  CRS_API_KEY: FAKE_API_KEY,
  CRS_SECRET: FAKE_SECRET,
} as const;

const SANDBOX_CREDENTIAL_KEYS = Object.keys(SANDBOX_CREDENTIALS);

/**
 * Next augments `NodeJS.ProcessEnv` with a REQUIRED `readonly NODE_ENV`
 * (`node_modules/next/types/global.d.ts`), so a bare literal is `error TS2741` against that type
 * even though the functions under test read neither `NODE_ENV` nor anything else outside their
 * argument. This helper types the literal without adding a key to it, so "a completely empty env"
 * below really is empty at runtime.
 */
function testEnv(values: Readonly<Record<string, string | undefined>>): NodeJS.ProcessEnv {
  return values as NodeJS.ProcessEnv;
}

interface ResolutionCase {
  readonly name: string;
  readonly env: NodeJS.ProcessEnv;
  readonly expected: CrsDriver;
}

const RESOLUTION_MATRIX: readonly ResolutionCase[] = [
  {
    name: 'a completely empty env resolves to mock',
    env: testEnv({}),
    expected: 'mock',
  },
  {
    name: "an explicit CRS_DRIVER='mock' resolves to mock",
    env: testEnv({ CRS_DRIVER: 'mock' }),
    expected: 'mock',
  },
  {
    name: "an explicit CRS_DRIVER='sandbox' resolves to sandbox",
    env: testEnv({ CRS_DRIVER: 'sandbox', ...SANDBOX_CREDENTIALS }),
    expected: 'sandbox',
  },
  {
    name: 'a key with no selector does not change the fallback driver',
    env: testEnv({ CRS_API_KEY: FAKE_API_KEY }),
    expected: 'mock',
  },
  {
    name: 'an explicit selector beats the key sniff, so mock plus a key is still mock',
    env: testEnv({ CRS_DRIVER: 'mock', CRS_API_KEY: FAKE_API_KEY }),
    expected: 'mock',
  },
  {
    name: 'an empty CRS_DRIVER is treated as unset, not as a selection',
    env: testEnv({ CRS_DRIVER: '' }),
    expected: 'mock',
  },
  {
    name: 'an empty CRS_API_KEY is treated as absent, so a blank Vercel row does not flip the driver',
    env: testEnv({ CRS_API_KEY: '' }),
    expected: 'mock',
  },
];

describe('resolveCrsDriver — INTERFACES §10', () => {
  for (const testCase of RESOLUTION_MATRIX) {
    it(testCase.name, () => {
      assert.equal(resolveCrsDriver(testCase.env), testCase.expected);
    });
  }

  it('throws CrsConfigError on an unrecognised explicit selector rather than falling back to mock', () => {
    assert.throws(
      () => resolveCrsDriver(testEnv({ CRS_DRIVER: 'production' })),
      (error: unknown) => {
        assert.ok(error instanceof CrsConfigError);
        assert.match(error.message, /CRS_DRIVER/);
        return true;
      },
    );
  });

  it('never echoes the rejected selector value back into the error message', () => {
    assert.throws(
      () => resolveCrsDriver(testEnv({ CRS_DRIVER: 'wildly-wrong-selector-value' })),
      (error: unknown) => {
        assert.ok(error instanceof CrsConfigError);
        assert.ok(!error.message.includes('wildly-wrong-selector-value'));
        return true;
      },
    );
  });

  it('is total — a missing key changes which driver runs and never throws', () => {
    assert.doesNotThrow(() => resolveCrsDriver(testEnv({})));
    assert.doesNotThrow(() => resolveCrsDriver(testEnv({ FEATURE_ANALYSIS: 'true' })));
  });
});

describe('assertSandboxCredentials — the boot-time throw', () => {
  it('throws on an empty env and names every outbound credential', () => {
    assert.throws(
      () => assertSandboxCredentials(testEnv({})),
      (error: unknown) => {
        assert.ok(error instanceof CrsConfigError);
        for (const key of SANDBOX_CREDENTIAL_KEYS) assert.match(error.message, new RegExp(key));
        assert.deepEqual([...error.missingKeys], SANDBOX_CREDENTIAL_KEYS);
        return true;
      },
    );
  });

  it('names only the keys that are actually missing', () => {
    assert.throws(
      () => assertSandboxCredentials(testEnv({ CRS_BASE_URL: FAKE_BASE_URL })),
      (error: unknown) => {
        assert.ok(error instanceof CrsConfigError);
        assert.deepEqual(
          [...error.missingKeys],
          SANDBOX_CREDENTIAL_KEYS.filter((key) => key !== 'CRS_BASE_URL'),
        );
        return true;
      },
    );
  });

  it('does not throw when the whole credential set is present', () => {
    assert.doesNotThrow(() => assertSandboxCredentials(testEnv({ ...SANDBOX_CREDENTIALS })));
  });

  it('still throws when the API secret is absent', () => {
    assert.throws(
      () =>
        assertSandboxCredentials(
          testEnv({ CRS_BASE_URL: FAKE_BASE_URL, CRS_API_KEY: FAKE_API_KEY }),
        ),
      (error: unknown) => {
        assert.ok(error instanceof CrsConfigError);
        assert.deepEqual(
          [...error.missingKeys],
          ['CRS_SECRET'],
        );
        return true;
      },
    );
  });

  it('carries no credential value on the error, only key names', () => {
    try {
      assertSandboxCredentials(testEnv({ CRS_BASE_URL: FAKE_BASE_URL }));
      assert.fail('expected a CrsConfigError');
    } catch (error) {
      assert.ok(error instanceof CrsConfigError);
      assert.ok(!error.message.includes(FAKE_BASE_URL));
      assert.ok(!JSON.stringify(error.missingKeys).includes(FAKE_BASE_URL));
    }
  });
});

describe('isAnalysisEnabled — the single FEATURE_ANALYSIS read', () => {
  const OFF_VALUES: readonly (string | undefined)[] = [undefined, '', 'false', '0', 'no', 'junk'];
  const ON_VALUES = ['1', 'true', 'on', 'yes', ' TRUE '] as const;

  for (const value of OFF_VALUES) {
    it(`is OFF for ${value === undefined ? 'an unset flag' : `the value ${JSON.stringify(value)}`}`, () => {
      assert.equal(isAnalysisEnabled(testEnv({ FEATURE_ANALYSIS: value })), false);
    });
  }

  for (const value of ON_VALUES) {
    it(`is ON for the canonical truthy value ${JSON.stringify(value)}`, () => {
      assert.equal(isAnalysisEnabled(testEnv({ FEATURE_ANALYSIS: value })), true);
    });
  }
});

describe('import safety under a completely empty env', () => {
  it('evaluates driver.ts fresh with no env set and throws nothing', async () => {
    // Documented stub-and-restore. This is the ONLY `process.env` touch in this file, and it is
    // unavoidable: the claim under test is that a FRESH module evaluation with no env at all
    // throws nothing (threat T-04-03 — an import-time throw would brick the deployed app), which
    // cannot be observed while the real env is populated. The `?empty-env-probe` query busts
    // Node's module cache so this is a genuine re-evaluation and not the copy the static import
    // at the top of this file already loaded. The specifier is widened to `string` because
    // TypeScript cannot resolve a specifier carrying a query, while Node resolves it fine (that
    // asymmetry was verified by running it). The env is restored in `finally`.
    const probeSpecifier: string = './driver.ts?empty-env-probe';
    const savedEnv = process.env;
    try {
      process.env = testEnv({});
      const freshModule = (await import(probeSpecifier)) as typeof import('./driver.ts');
      assert.equal(typeof freshModule.resolveCrsDriver, 'function');
      assert.equal(freshModule.resolveCrsDriver(testEnv({})), 'mock');
    } finally {
      process.env = savedEnv;
    }
  });
});
