import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DRIVERS } from '../../env.ts';
import { CrsConfigError, CrsDriverError } from '../errors.ts';
import { createFixedClock } from '../ports.ts';
import { CRS_SPEC_ERROR_CODES, CRS_SPEC_HOSTS } from '../spec-catalog.ts';
import { createSandboxAdapter, readSandboxConfigFromEnv } from './driver.ts';

import type { CrsMemberRef } from '../types.ts';

const MEMBER = '550e8400-e29b-41d4-a716-446655440000' as CrsMemberRef;

function env(values: Record<string, string>): NodeJS.ProcessEnv {
  return values as unknown as NodeJS.ProcessEnv;
}

function dependencies(fetchImpl: typeof fetch) {
  return {
    clock: createFixedClock('2026-08-29T01:00:00.000Z'),
    webhookConfig: {
      basicUser: null,
      basicPass: null,
      hmacSecret: null,
      hmacHeader: 'x-crs-signature',
      sourceIps: [],
    },
    fetchImpl,
  };
}

describe('CRS v3 sandbox boundary', () => {
  it('exposes development verification links only for the registry-selected non-fallback driver', () => {
    const spec = DRIVERS.crs;
    const selected = spec.values.find((value) => value !== spec.fallback);
    assert.ok(selected, 'the CRS registry no longer declares a non-fallback driver');
    const credentials = {
      CRS_BASE_URL: CRS_SPEC_HOSTS.development.api,
      CRS_API_KEY: 'not-a-real-api-key',
      CRS_SECRET: 'not-a-real-api-secret',
    };

    const selectedConfig = readSandboxConfigFromEnv(env({
      ...credentials,
      [spec.selector]: selected,
    })) as unknown as Record<string, unknown>;
    const fallbackConfig = readSandboxConfigFromEnv(env(credentials)) as unknown as Record<string, unknown>;

    assert.equal(selectedConfig.exposeVerificationUrl, true);
    assert.equal(fallbackConfig.exposeVerificationUrl, false);
    assert.throws(
      () => readSandboxConfigFromEnv(env({
        ...credentials,
        [spec.selector]: 'not-a-registry-driver',
      })),
      CrsConfigError,
    );
  });

  it('requires the existing API URL, API key, and secret environment names', () => {
    assert.throws(
      () => readSandboxConfigFromEnv(env({ CRS_BASE_URL: CRS_SPEC_HOSTS.development.api })),
      (error: unknown) => error instanceof CrsConfigError
        && error.missingKeys.includes('CRS_API_KEY')
        && error.missingKeys.includes('CRS_SECRET'),
    );
  });

  it('rejects plaintext provider hosts unless the explicit local-only override is present', () => {
    assert.throws(
      () => readSandboxConfigFromEnv(env({
        CRS_BASE_URL: 'http://crs.invalid/api',
        CRS_API_KEY: 'not-a-real-api-key',
        CRS_SECRET: 'not-a-real-api-secret',
      })),
      CrsConfigError,
    );
  });

  it('retains stable spec codes while discarding provider text and details', async () => {
    const privateProviderText = 'private-provider-response-text';
    const adapter = createSandboxAdapter({
      baseUrl: CRS_SPEC_HOSTS.development.api,
      apiKey: 'not-a-real-api-key',
      exposeVerificationUrl: false,
      secret: 'not-a-real-api-secret',
      timeoutMs: 1_000,
    }, dependencies(async () => new Response(JSON.stringify({
      codes: [CRS_SPEC_ERROR_CODES.ditUnavailable],
      message: privateProviderText,
      details: { raw: privateProviderText },
    }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    })));

    await assert.rejects(
      () => adapter.getPreauthToken(MEMBER),
      (error: unknown) => {
        assert.ok(error instanceof CrsDriverError);
        assert.deepEqual(error.codes, [CRS_SPEC_ERROR_CODES.ditUnavailable]);
        assert.doesNotMatch(error.message, new RegExp(privateProviderText));
        assert.deepEqual(Object.keys(error).sort(), ['codes', 'driver', 'httpStatus', 'name', 'operation']);
        return true;
      },
    );
  });
});
