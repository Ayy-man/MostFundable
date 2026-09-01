import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveCrsDriver } from './driver.ts';
import { CRS_REPORT_CODE_BY_BUREAU } from './constants.ts';
import { CrsDriverError } from './errors.ts';
import { createFixedClock } from './ports.ts';
import {
  CRS_SPEC_DIT_FAILURE_STATUSES,
  CRS_SPEC_DIT_PASS_STATUS,
  CRS_SPEC_ERROR_CODES,
  CRS_SPEC_HOSTS,
  CRS_SPEC_PATHS,
  CRS_SPEC_TOKEN_TTLS_SECONDS,
  CRS_SPEC_WEBHOOK_EVENT_TYPES,
} from './spec-catalog.ts';
import { createSandboxAdapter, readSandboxConfigFromEnv } from './sandbox/driver.ts';
import { parseWebhookBatch } from './webhook.ts';

import type { CrsIdentity, CrsMemberRef } from './types.ts';

const API_KEY = 'not-a-real-api-key';
const API_SECRET = 'not-a-real-api-secret';
const MEMBER = '550e8400-e29b-41d4-a716-446655440000' as CrsMemberRef;
const ACCESS_TOKEN = 'not-a-real-access-token';
const PREAUTH_TOKEN = 'not-a-real-preauth-token';
const USER_TOKEN = 'not-a-real-user-token';
const SMS_VERIFICATION_URL = 'https://efx-dev.stitchcredit.com/api/smfa/auth/not-a-real-session';

const IDENTITY: CrsIdentity = {
  firstName: 'Spec',
  lastName: 'Consumer',
  dateOfBirth: '1990-01-01',
  ssn: '000000000',
  address: {
    line1: '1 Contract Way',
    city: 'Contract',
    state: 'CA',
    postalCode: '00000',
  },
  email: 'spec-consumer@example.test',
  phone: '5555550100',
};

function env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    CRS_DRIVER: 'sandbox',
    CRS_BASE_URL: CRS_SPEC_HOSTS.development.api,
    CRS_API_KEY: API_KEY,
    CRS_SECRET: API_SECRET,
    ...extra,
  } as unknown as NodeJS.ProcessEnv;
}

function json(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: status === 204 ? undefined : { 'content-type': 'application/json' },
  });
}

function basicHeader(): string {
  return `Basic ${Buffer.from('not-a-real-user:not-a-real-pass').toString('base64')}`;
}

describe('CRS client spec 2026-08-27', () => {
  it('boots outbound sandbox from the existing API key, secret and base URL names', () => {
    assert.equal(resolveCrsDriver(env()), 'sandbox');
    const config = readSandboxConfigFromEnv(env()) as unknown as Record<string, unknown>;
    assert.equal(config.secret, API_SECRET);
  });

  it('authenticates, registers the required mobile, exchanges preauth, and submits DIT with a user token', async () => {
    const calls: Array<{ body: unknown; method: string; path: string; auth: string | null }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({
        body,
        method: init?.method ?? 'GET',
        path: `${url.pathname}${url.search}`.replace('/api', ''),
        auth: new Headers(init?.headers).get('authorization'),
      });
      if (url.pathname.endsWith(CRS_SPEC_PATHS.directLogin)) {
        return json({ token: ACCESS_TOKEN, expires: 3600, refresh: 'not-a-real-refresh' });
      }
      if (url.pathname.endsWith(CRS_SPEC_PATHS.directUserRegistration)) {
        return json({ userId: MEMBER, token: PREAUTH_TOKEN });
      }
      if (url.pathname.includes('/users/preauth-token/')) {
        return json({ id: MEMBER, token: USER_TOKEN, expires: 900, refresh: 'not-a-real-user-refresh' });
      }
      if (url.pathname.endsWith(CRS_SPEC_PATHS.ditIdentity)) {
        return json({
          token: 'not-a-real-dit-token',
          expires: '2026-08-29T01:15:00.000Z',
          details: { status: CRS_SPEC_DIT_PASS_STATUS, decision: true, codes: [] },
        });
      }
      if (url.pathname.includes('/users/smfa-send-link/')) {
        return json({
          linkUrl: 'https://example.test/not-a-real-verification-link',
          smsMessage: `Your Requested Authentication Link: ${SMS_VERIFICATION_URL}`,
          token: 'not-a-real-smfa-token',
          expires: '2026-08-29T01:15:00.000Z',
        });
      }
      throw new Error(`unexpected test path ${url.pathname}`);
    };

    const adapter = createSandboxAdapter(readSandboxConfigFromEnv(env()), {
      clock: createFixedClock('2026-08-29T01:00:00.000Z'),
      webhookConfig: { basicUser: null, basicPass: null, hmacSecret: null, hmacHeader: 'x-crs-signature', sourceIps: [] },
      fetchImpl,
    });
    const result = await adapter.createMember(IDENTITY);

    assert.equal(result.memberRef, MEMBER);
    assert.equal(result.challenge.verificationUrl, SMS_VERIFICATION_URL);
    assert.deepEqual(calls.map((call) => call.path), [
      CRS_SPEC_PATHS.directLogin,
      CRS_SPEC_PATHS.directUserRegistration,
      CRS_SPEC_PATHS.userPreauthExchange.replace('{preauthToken}', PREAUTH_TOKEN),
      CRS_SPEC_PATHS.ditIdentity,
      `${CRS_SPEC_PATHS.smfaSendLink.replace('{ditToken}', 'not-a-real-dit-token')}?type=phone`,
    ]);
    assert.deepEqual(calls[0].body, { apikey: API_KEY, secret: API_SECRET });
    assert.equal((calls[1].body as Record<string, unknown>).mobile, IDENTITY.phone);
    assert.equal((calls[1].body as Record<string, unknown>).emailMsg, false);
    assert.equal(calls[1].auth, `Bearer ${ACCESS_TOKEN}`);
    assert.equal(calls[3].auth, `Bearer ${USER_TOKEN}`);
    assert.equal((calls[3].body as Record<string, unknown>).ssn, IDENTITY.ssn);

    const productionResult = await createSandboxAdapter({
      ...readSandboxConfigFromEnv(env()),
      baseUrl: CRS_SPEC_HOSTS.production.api,
    }, {
      clock: createFixedClock('2026-08-29T01:00:00.000Z'),
      webhookConfig: { basicUser: null, basicPass: null, hmacSecret: null, hmacHeader: 'x-crs-signature', sourceIps: [] },
      fetchImpl,
    }).createMember(IDENTITY);
    assert.equal(productionResult.challenge.verificationUrl, undefined);
    assert.equal(typeof productionResult.continuation, 'string');
  });

  it('continues to SMFA when the documented 200 DIT response omits optional details', async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const requestPath = new URL(String(input)).pathname.replace('/api', '');
      calls.push(requestPath);
      if (requestPath === CRS_SPEC_PATHS.directLogin) {
        return json({ token: ACCESS_TOKEN, expires: 3600, refresh: 'not-a-real-refresh' });
      }
      if (requestPath === CRS_SPEC_PATHS.directUserRegistration) {
        return json({ userId: MEMBER, token: PREAUTH_TOKEN });
      }
      if (requestPath === CRS_SPEC_PATHS.userPreauthExchange.replace('{preauthToken}', PREAUTH_TOKEN)) {
        return json({ id: MEMBER, token: USER_TOKEN, expires: 900, refresh: 'not-a-real-user-refresh' });
      }
      if (requestPath === CRS_SPEC_PATHS.ditIdentity) {
        return json({ mobile: IDENTITY.phone, token: 'not-a-real-dit-token', expires: '2026-08-29T01:15:00.000Z' });
      }
      if (requestPath.includes('/users/smfa-send-link/')) {
        return json({
          smsMessage: `Your Requested Authentication Link: ${SMS_VERIFICATION_URL}`,
          token: 'not-a-real-smfa-token',
          expires: '2026-08-29T01:15:00.000Z',
        });
      }
      throw new Error(`unexpected test path ${requestPath}`);
    };
    const adapter = createSandboxAdapter(readSandboxConfigFromEnv(env()), {
      clock: createFixedClock('2026-08-29T01:00:00.000Z'),
      webhookConfig: { basicUser: null, basicPass: null, hmacSecret: null, hmacHeader: 'x-crs-signature', sourceIps: [] },
      fetchImpl,
    });

    const result = await adapter.createMember(IDENTITY);

    assert.equal(result.memberRef, MEMBER);
    assert.equal(result.challenge.verificationUrl, SMS_VERIFICATION_URL);
    assert.ok(calls.some((requestPath) => requestPath.includes('/users/smfa-send-link/')));
  });

  it('maps malformed DIT decision metadata to a provider fault instead of an identity rejection', async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const requestPath = new URL(String(input)).pathname.replace('/api', '');
      calls.push(requestPath);
      if (requestPath === CRS_SPEC_PATHS.directLogin) {
        return json({ token: ACCESS_TOKEN, expires: 3600, refresh: 'not-a-real-refresh' });
      }
      if (requestPath === CRS_SPEC_PATHS.directUserRegistration) {
        return json({ userId: MEMBER, token: PREAUTH_TOKEN });
      }
      if (requestPath === CRS_SPEC_PATHS.userPreauthExchange.replace('{preauthToken}', PREAUTH_TOKEN)) {
        return json({ id: MEMBER, token: USER_TOKEN, expires: 900, refresh: 'not-a-real-user-refresh' });
      }
      if (requestPath === CRS_SPEC_PATHS.ditIdentity) {
        return json({ token: 'not-a-real-dit-token', details: { status: CRS_SPEC_DIT_PASS_STATUS } });
      }
      if (requestPath === CRS_SPEC_PATHS.closeAccount.replace('{id}', MEMBER)) return json(null, 204);
      throw new Error(`unexpected test path ${requestPath}`);
    };
    const adapter = createSandboxAdapter(readSandboxConfigFromEnv(env()), {
      clock: createFixedClock('2026-08-29T01:00:00.000Z'),
      webhookConfig: { basicUser: null, basicPass: null, hmacSecret: null, hmacHeader: 'x-crs-signature', sourceIps: [] },
      fetchImpl,
    });

    await assert.rejects(
      () => adapter.createMember(IDENTITY),
      (error: unknown) => error instanceof CrsDriverError
        && error.httpStatus === 502
        && error.codes.length === 0,
    );
    assert.ok(!calls.some((requestPath) => requestPath.includes('/smfa-')));
    assert.equal(calls.at(-1), CRS_SPEC_PATHS.closeAccount.replace('{id}', MEMBER));
  });

  it('carries the spec-limited timezone-less SMFA session across a serverless adapter restart', async () => {
    const expiresAt = new Date(
      Date.parse('2026-08-29T01:00:00.000Z') + CRS_SPEC_TOKEN_TTLS_SECONDS.smfaSession * 1000,
    ).toISOString().replace(/Z$/, '');
    const fetchImpl: typeof fetch = async (input) => {
      const requestPath = new URL(String(input)).pathname.replace('/api', '');
      if (requestPath === CRS_SPEC_PATHS.directLogin) {
        return json({ token: ACCESS_TOKEN, expires: 3600, refresh: 'not-a-real-refresh' });
      }
      if (requestPath === CRS_SPEC_PATHS.directUserRegistration) {
        return json({ userId: MEMBER, token: PREAUTH_TOKEN });
      }
      if (requestPath === CRS_SPEC_PATHS.directPreauthToken.replace('{id}', MEMBER)) {
        return json({ userId: MEMBER, token: PREAUTH_TOKEN });
      }
      if (requestPath === CRS_SPEC_PATHS.userPreauthExchange.replace('{preauthToken}', PREAUTH_TOKEN)) {
        return json({ id: MEMBER, token: USER_TOKEN, expires: 900, refresh: 'not-a-real-user-refresh' });
      }
      if (requestPath === CRS_SPEC_PATHS.ditIdentity) {
        return json({
          token: 'not-a-real-dit-token',
          details: { status: CRS_SPEC_DIT_PASS_STATUS, decision: true, codes: [] },
        });
      }
      if (requestPath.includes('/users/smfa-send-link/')) {
        return json({
          smsMessage: `Your Requested Authentication Link: ${SMS_VERIFICATION_URL}`,
          token: 'not-a-real-smfa-token',
          expires: expiresAt,
        });
      }
      if (requestPath.includes('/users/smfa-verify-status/')) {
        return json({ codes: [CRS_SPEC_ERROR_CODES.alreadyIdentified] }, 400);
      }
      throw new Error(`unexpected test path ${requestPath}`);
    };
    const options = {
      clock: createFixedClock('2026-08-29T01:00:00.000Z'),
      webhookConfig: { basicUser: null, basicPass: null, hmacSecret: null, hmacHeader: 'x-crs-signature', sourceIps: [] },
      fetchImpl,
    };
    const created = await createSandboxAdapter(readSandboxConfigFromEnv(env()), options).createMember(IDENTITY);
    const continuation = (created as typeof created & { continuation?: string }).continuation;

    assert.equal(typeof continuation, 'string');
    assert.equal(created.challenge.expiresAt, `${expiresAt}Z`);
    const restarted = createSandboxAdapter(readSandboxConfigFromEnv(env()), options);
    const result = await (restarted.submitIdvStep as unknown as (
      memberRef: CrsMemberRef,
      submission: { kind: 'smfa_status' },
      continuation: string,
    ) => Promise<{ outcome: string }>)(MEMBER, { kind: 'smfa_status' }, continuation as string);
    assert.equal(result.outcome, 'pass');
  });

  it('rejects every spec-catalogued non-pass DIT decision before SMFA', async () => {
    for (const failureStatus of CRS_SPEC_DIT_FAILURE_STATUSES) {
      const calls: string[] = [];
      const fetchImpl: typeof fetch = async (input) => {
        const requestPath = new URL(String(input)).pathname.replace('/api', '');
        calls.push(requestPath);
        if (requestPath === CRS_SPEC_PATHS.directLogin) {
          return json({ token: ACCESS_TOKEN, expires: 3600, refresh: 'not-a-real-refresh' });
        }
        if (requestPath === CRS_SPEC_PATHS.directUserRegistration) {
          return json({ userId: MEMBER, token: PREAUTH_TOKEN });
        }
        if (requestPath === CRS_SPEC_PATHS.userPreauthExchange.replace('{preauthToken}', PREAUTH_TOKEN)) {
          return json({ id: MEMBER, token: USER_TOKEN, expires: 900, refresh: 'not-a-real-user-refresh' });
        }
        if (requestPath === CRS_SPEC_PATHS.ditIdentity) {
          return json({
            token: 'not-a-real-dit-token',
            details: { status: failureStatus, decision: false, codes: [] },
          });
        }
        if (requestPath === CRS_SPEC_PATHS.closeAccount.replace('{id}', MEMBER)) return json(null, 204);
        throw new Error(`unexpected test path ${requestPath}`);
      };
      const adapter = createSandboxAdapter(readSandboxConfigFromEnv(env()), {
        clock: createFixedClock('2026-08-29T01:00:00.000Z'),
        webhookConfig: { basicUser: null, basicPass: null, hmacSecret: null, hmacHeader: 'x-crs-signature', sourceIps: [] },
        fetchImpl,
      });

      await assert.rejects(
        () => adapter.createMember(IDENTITY),
        (error: unknown) => error instanceof CrsDriverError
          && error.codes.includes(CRS_SPEC_ERROR_CODES.ditRejected),
      );
      assert.ok(!calls.some((requestPath) => requestPath.includes('/smfa-')));
      assert.equal(calls.at(-1), CRS_SPEC_PATHS.closeAccount.replace('{id}', MEMBER));
    }
  });

  it('uses the published GET report endpoint instead of constructing per-bureau POSTs', async () => {
    const calls: Array<{ method: string; path: string }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      const path = url.pathname.replace('/api', '');
      calls.push({ method: init?.method ?? 'GET', path });
      if (path === CRS_SPEC_PATHS.directLogin) return json({ token: ACCESS_TOKEN, expires: 3600, refresh: 'not-a-real-refresh' });
      if (path === CRS_SPEC_PATHS.directPreauthToken.replace('{id}', MEMBER)) return json({ userId: MEMBER, token: PREAUTH_TOKEN });
      if (path === CRS_SPEC_PATHS.userPreauthExchange.replace('{preauthToken}', PREAUTH_TOKEN)) return json({ id: MEMBER, token: USER_TOKEN, expires: 900, refresh: 'not-a-real-user-refresh' });
      if (path === CRS_SPEC_PATHS.latestEquifaxReport) return json({ id: 'report', reportType: 'US_EFX', providerViews: [] });
      throw new Error(`unexpected test path ${path}`);
    };
    const adapter = createSandboxAdapter(readSandboxConfigFromEnv(env()), {
      clock: createFixedClock('2026-08-29T01:00:00.000Z'),
      webhookConfig: { basicUser: null, basicPass: null, hmacSecret: null, hmacHeader: 'x-crs-signature', sourceIps: [] },
      fetchImpl,
    });
    await adapter.softPull(MEMBER, ['EQF1001']);
    assert.equal(calls.at(-1)?.method, 'GET');
    assert.equal(calls.at(-1)?.path, CRS_SPEC_PATHS.latestEquifaxReport);
  });

  it('reads observed 3B scores from the published Equifax score endpoint', async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const requestPath = new URL(String(input)).pathname.replace('/api', '');
      calls.push(requestPath);
      if (requestPath === CRS_SPEC_PATHS.directLogin) return json({ token: ACCESS_TOKEN, expires: 3600, refresh: 'not-a-real-refresh' });
      if (requestPath === CRS_SPEC_PATHS.directPreauthToken.replace('{id}', MEMBER)) return json({ userId: MEMBER, token: PREAUTH_TOKEN });
      if (requestPath === CRS_SPEC_PATHS.userPreauthExchange.replace('{preauthToken}', PREAUTH_TOKEN)) return json({ id: MEMBER, token: USER_TOKEN, expires: 900, refresh: 'not-a-real-user-refresh' });
      if (requestPath === CRS_SPEC_PATHS.latestEquifaxScores) {
        return json({
          generatedDate: 1_777_298_828_909,
          projectedScoreImprovement: 50,
          providerViews: [
            { provider: 'EFX', score: 825, scoreReasons: [{ description: 'not returned' }] },
            { provider: 'EXP', score: 761 },
            { provider: 'TU', score: 779 },
          ],
          scoreModel: 'VANTAGE',
        });
      }
      throw new Error(`unexpected test path ${requestPath}`);
    };
    const adapter = createSandboxAdapter(readSandboxConfigFromEnv(env()), {
      clock: createFixedClock('2026-08-29T01:00:00.000Z'),
      webhookConfig: { basicUser: null, basicPass: null, hmacSecret: null, hmacHeader: 'x-crs-signature', sourceIps: [] },
      fetchImpl,
    });

    assert.deepEqual(await adapter.getLatestScores(MEMBER), [
      { bureau: 'EQF', model: 'VANTAGE', observedAt: '2026-04-27T14:07:08.909Z', score: 825 },
      { bureau: 'EXP', model: 'VANTAGE', observedAt: '2026-04-27T14:07:08.909Z', score: 761 },
      { bureau: 'TUC', model: 'VANTAGE', observedAt: '2026-04-27T14:07:08.909Z', score: 779 },
    ]);
    assert.equal(calls.at(-1), CRS_SPEC_PATHS.latestEquifaxScores);
  });

  it('uses the Equifax endpoint for the provisioned EFX 3B product', async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const requestPath = new URL(String(input)).pathname.replace('/api', '');
      calls.push(requestPath);
      if (requestPath === CRS_SPEC_PATHS.directLogin) return json({ token: ACCESS_TOKEN, expires: 3600, refresh: 'not-a-real-refresh' });
      if (requestPath === CRS_SPEC_PATHS.directPreauthToken.replace('{id}', MEMBER)) return json({ userId: MEMBER, token: PREAUTH_TOKEN });
      if (requestPath === CRS_SPEC_PATHS.userPreauthExchange.replace('{preauthToken}', PREAUTH_TOKEN)) return json({ id: MEMBER, token: USER_TOKEN, expires: 900, refresh: 'not-a-real-user-refresh' });
      if (requestPath === CRS_SPEC_PATHS.latestEquifaxReport) {
        return json({
          id: 'report',
          reportType: 'US_3B',
          providerViews: [
            { provider: 'EFX', summary: { id: 'efx-summary' } },
            { provider: 'EXP', summary: { id: 'exp-summary' } },
            { provider: 'TU', summary: { id: 'tu-summary' } },
          ],
        });
      }
      if (requestPath === CRS_SPEC_PATHS.latestMultiBureauReport) throw new Error('unexpected multi-bureau route');
      throw new Error(`unexpected test path ${requestPath}`);
    };
    const adapter = createSandboxAdapter(readSandboxConfigFromEnv(env()), {
      clock: createFixedClock('2026-08-29T01:00:00.000Z'),
      webhookConfig: { basicUser: null, basicPass: null, hmacSecret: null, hmacHeader: 'x-crs-signature', sourceIps: [] },
      fetchImpl,
    });

    const report = await adapter.softPull(MEMBER, Object.values(CRS_REPORT_CODE_BY_BUREAU));
    assert.deepEqual(report.bureaus, ['EQF', 'EXP', 'TUC']);
    assert.deepEqual(calls.slice(-1), [CRS_SPEC_PATHS.latestEquifaxReport]);
  });

  it('closes and pauses through fixed direct endpoints with no request body', async () => {
    const calls: Array<{ body: BodyInit | null | undefined; path: string }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const path = new URL(String(input)).pathname.replace('/api', '');
      calls.push({ body: init?.body, path });
      if (path === CRS_SPEC_PATHS.directLogin) return json({ token: ACCESS_TOKEN, expires: 3600, refresh: 'not-a-real-refresh' });
      return json(null, 204);
    };
    const adapter = createSandboxAdapter(readSandboxConfigFromEnv(env()), {
      clock: createFixedClock('2026-08-29T01:00:00.000Z'),
      webhookConfig: { basicUser: null, basicPass: null, hmacSecret: null, hmacHeader: 'x-crs-signature', sourceIps: [] },
      fetchImpl,
    });
    await adapter.closeMember(MEMBER);
    await (adapter as unknown as { pauseMember(member: CrsMemberRef): Promise<unknown> }).pauseMember(MEMBER);
    assert.deepEqual(calls.slice(1).map((call) => call.path), [
      CRS_SPEC_PATHS.closeAccount.replace('{id}', MEMBER),
      CRS_SPEC_PATHS.pauseEnrollment.replace('{userId}', MEMBER),
    ]);
    assert.ok(calls.slice(1).every((call) => call.body === undefined));
  });

  it('accepts the spec millisecond webhook time and the complete event catalog', () => {
    const instant = Date.parse('2026-08-29T01:00:00.000Z');
    const [parsed] = parseWebhookBatch({
      headers: new Headers({ authorization: basicHeader() }),
      rawBody: JSON.stringify([{ id: 'hook', type: CRS_SPEC_WEBHOOK_EVENT_TYPES.at(-1), user_id: MEMBER, host_id: null, time: instant }]),
      config: { basicUser: 'not-a-real-user', basicPass: 'not-a-real-pass', hmacSecret: null, hmacHeader: 'x-crs-signature', sourceIps: [] },
    });
    assert.ok(parsed.ok);
    assert.equal(parsed.event.occurredAt, new Date(instant).toISOString());
  });
});
