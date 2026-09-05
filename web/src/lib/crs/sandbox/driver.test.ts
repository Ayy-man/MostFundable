import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DRIVERS } from '../../env.ts';
import { CrsConfigError, CrsDriverError } from '../errors.ts';
import { createFixedClock } from '../ports.ts';
import { sealCrsIdvContinuation } from '../continuation.ts';
import {
  CRS_SPEC_ERROR_CODES,
  CRS_SPEC_HOSTS,
  CRS_SPEC_SMFA_FAILURE_STATUSES,
  CRS_SPEC_SMFA_PASS_STATUSES,
  CRS_SPEC_SMFA_PENDING_STATUS,
} from '../spec-catalog.ts';
import { createSandboxAdapter, normalizeReportBody, readSandboxConfigFromEnv } from './driver.ts';

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

function smfaStatusAdapter(status: unknown) {
  const secret = 'not-a-real-api-secret';
  const requests: string[] = [];
  const adapter = createSandboxAdapter({
    baseUrl: CRS_SPEC_HOSTS.development.api,
    apiKey: 'not-a-real-api-key',
    exposeVerificationUrl: false,
    secret,
    timeoutMs: 1_000,
  }, dependencies(async (input) => {
    const requestUrl = String(input);
    requests.push(requestUrl);
    if (requestUrl.endsWith('/direct/login')) {
      return Response.json({ token: 'direct-token', refresh: 'refresh-token', expires: 3600 });
    }
    if (requestUrl.includes('/direct/preauth-token/')) return Response.json({ token: 'preauth-token' });
    if (requestUrl.includes('/users/preauth-token/')) return Response.json({ token: 'user-token' });
    if (requestUrl.includes('/users/smfa-verify-status/')) return Response.json(status);
    throw new Error(`unexpected request ${requestUrl}`);
  }));
  const continuation = sealCrsIdvContinuation({
    challenge: {
      kind: 'smfa_link',
      attemptsRemaining: 1,
      expiresAt: '2026-08-29T02:00:00.000Z',
    },
    memberRef: MEMBER,
    smfaToken: 'smfa-token',
  }, secret);
  return { adapter, continuation, requests };
}

describe('CRS v3 sandbox boundary', () => {
  it('treats report retrieval as per-request until CRS gives this account a replay guarantee', () => {
    const adapter = createSandboxAdapter({
      baseUrl: CRS_SPEC_HOSTS.development.api,
      apiKey: 'not-a-real-api-key',
      exposeVerificationUrl: false,
      secret: 'not-a-real-api-secret',
      timeoutMs: 1_000,
    }, dependencies(async () => {
      throw new Error('report retrieval is not part of this declaration test');
    }));

    assert.equal(adapter.pullBilling, 'per-request');
  });

  it('normalizes scores, identity, delinquency comments, and the 45-day inquiry match without account numbers', () => {
    const pulledAt = '2026-09-05T00:00:00.000Z';
    const body = normalizeReportBody({ providerViews: [{
      provider: 'EFX', summary: { creditScore: { score: 705, provider: 'VANTAGE' }, subject: { currentName: 'Private', currentAddress: 'Private', previousAddresses: [{}], employmentHistory: [{}] }, totalCollections: 1, totalPublicRecords: 2, totalNegativeAccounts: 3 },
      revolvingAccounts: [{ id: 'opaque-1', accountName: ' DISCOVER ', accountNumber: 'must-not-leave-provider', accountOpen: true, balanceAmount: { amount: 4200 }, creditLimitAmount: { amount: 5000 }, pastDueAmount: { amount: 0 }, dateOpened: Date.parse('2026-08-20T00:00:00.000Z'), accountStatus: 'PAYS_AS_AGREED', isNegative: false, comments: [{ description: 'LAST REPORTED DELINQUENCIES: 9/2026=R2' }] }],
      inquiries: [{ id: 'inquiry-1', reportedDate: Date.parse('2026-08-10T00:00:00.000Z') }],
    }] }, ['EQF1001'], pulledAt) as unknown as { perBureau: Array<{ accounts: Array<Record<string, unknown>>; inquiries: Array<Record<string, unknown>>; scores: unknown; identity: unknown; summaryCounts: unknown }> };
    const row = body.perBureau[0];
    assert.deepEqual(row.scores, [{ bureau: 'EQF', model: 'VANTAGE', score: 705 }]);
    assert.deepEqual(row.identity, { namesOnFile: 1, addressesOnFile: 2, employersOnFile: 1 });
    assert.deepEqual(row.summaryCounts, { totalCollections: 1, totalPublicRecords: 2, totalNegativeAccounts: 3 });
    assert.equal(row.accounts[0].label, 'DISCOVER');
    assert.equal(row.accounts[0].lateWithin24Months, true);
    assert.equal(row.inquiries[0].matchedNewAccountWithin45Days, true);
    assert.equal(JSON.stringify(body).includes('must-not-leave-provider'), false);
  });
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

  for (const status of CRS_SPEC_SMFA_PASS_STATUSES) {
    it(`passes the SMFA ${status} status fixture`, async () => {
      const { adapter, continuation, requests } = smfaStatusAdapter({ status });

      assert.deepEqual(
        await adapter.submitIdvStep(MEMBER, { kind: 'smfa_status' }, continuation),
        { outcome: 'pass', verifiedAt: '2026-08-29T01:00:00.000Z' },
      );
      assert.equal(requests.filter((request) => request.includes('/users/smfa-verify-status/')).length, 1);
    });
  }

  it(`retries the same SMFA challenge for ${CRS_SPEC_SMFA_PENDING_STATUS}`, async () => {
    const { adapter, continuation } = smfaStatusAdapter({ status: CRS_SPEC_SMFA_PENDING_STATUS });

    assert.deepEqual(
      await adapter.submitIdvStep(MEMBER, { kind: 'smfa_status' }, continuation),
      {
        outcome: 'retry',
        challenge: {
          kind: 'smfa_link',
          attemptsRemaining: 1,
          expiresAt: '2026-08-29T02:00:00.000Z',
        },
      },
    );
  });

  for (const status of CRS_SPEC_SMFA_FAILURE_STATUSES) {
    it(`returns a terminal failure for the SMFA ${status} status fixture`, async () => {
      const { adapter, continuation } = smfaStatusAdapter({ status });

      assert.deepEqual(
        await adapter.submitIdvStep(MEMBER, { kind: 'smfa_status' }, continuation),
        { outcome: 'failed', code: status },
      );
    });
  }

  it('passes when the completed-link response is the member record with idpass true', async () => {
    const { adapter, continuation } = smfaStatusAdapter({ id: MEMBER, idpass: true, demo: true, just_enrolled: true });

    assert.deepEqual(
      await adapter.submitIdvStep(MEMBER, { kind: 'smfa_status' }, continuation),
      { outcome: 'pass', verifiedAt: '2026-08-29T01:00:00.000Z' },
    );
  });

  it('fails closed when the member record says idpass false and carries no status', async () => {
    const { adapter, continuation } = smfaStatusAdapter({ id: MEMBER, idpass: false });

    await assert.rejects(
      () => adapter.submitIdvStep(MEMBER, { kind: 'smfa_status' }, continuation),
      (error: unknown) => error instanceof CrsDriverError && error.httpStatus === 502,
    );
  });

  it('fails closed when a successful SMFA response has no recognised status', async () => {
    const { adapter, continuation } = smfaStatusAdapter({});

    await assert.rejects(
      () => adapter.submitIdvStep(MEMBER, { kind: 'smfa_status' }, continuation),
      (error: unknown) => error instanceof CrsDriverError
        && error.driver === 'sandbox'
        && error.operation === 'submitIdvStep'
        && error.httpStatus === 502,
    );
  });
});
