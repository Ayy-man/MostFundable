// web/src/lib/crs/adapter-contract.ts — one conformance suite for every CRS driver.
//
// Keep this suite free of driver-specific fixture knowledge. The mock has separate tests for its
// deterministic data, while this module proves the interface properties a real CRS account must
// satisfy unchanged when the Key-arrival session enables its arm.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CRS_PREAUTH_TOKEN_TTL_SECONDS,
  CRS_REPORT_CODE_BY_BUREAU,
} from './constants.ts';
import { SOFT_PULL_REPORT_REDACTION } from './report.ts';

import type {
  BureauCode,
  CrsAdapter,
  CrsIdentity,
  CrsMemberRef,
  ReportCode,
} from './types.ts';

const CONTRACT_IDENTITY: CrsIdentity = {
  firstName: 'Contract',
  lastName: 'Subject',
  dateOfBirth: '1990-01-01',
  ssn: '000000000',
  address: {
    line1: '1 Contract Way',
    city: 'Example',
    state: 'CA',
    postalCode: '00000',
  },
  email: 'contract-subject@example.invalid',
  phone: '+15550000000',
};

const CONTRACT_REPORT_CODES: ReportCode[] = ['EQF1001', 'EXP1001'];

const BUREAU_BY_REPORT_CODE = new Map<ReportCode, BureauCode>(
  Object.entries(CRS_REPORT_CODE_BY_BUREAU).map(([bureau, code]) => [
    code,
    bureau as BureauCode,
  ]),
);

async function createContractMember(adapter: CrsAdapter): Promise<CrsMemberRef> {
  const created = await adapter.createMember(CONTRACT_IDENTITY);
  return created.memberRef;
}

export function runAdapterContract(makeAdapter: () => CrsAdapter, label: string): void {
  describe(`${label} CRS adapter contract`, () => {
    it('identifies the selected driver', () => {
      assert.equal(makeAdapter().driver, label);
    });

    it('creates a member with a live identity-verification challenge', async () => {
      const created = await makeAdapter().createMember(CONTRACT_IDENTITY);
      const expiresAt = Date.parse(created.challenge.expiresAt);

      assert.ok(created.memberRef.length > 0);
      assert.equal(typeof created.idpass, 'boolean');
      assert.ok(['sms', 'quiz', 'smfa_link'].includes(created.challenge.kind));
      assert.ok(created.challenge.attemptsRemaining > 0);
      assert.ok(Number.isFinite(expiresAt));
      assert.ok(expiresAt > Date.now());
    });

    it('issues bounded, single-use preauthorization tokens', async () => {
      const adapter = makeAdapter();
      const memberRef = await createContractMember(adapter);
      const issuedAfter = Date.now();
      const first = await adapter.getPreauthToken(memberRef);
      const second = await adapter.getPreauthToken(memberRef);
      const expiresAt = Date.parse(first.expiresAt);
      const latestAllowedExpiry =
        issuedAfter + first.ttlSeconds * 1000 + 5_000;

      assert.ok(first.token.length > 0);
      assert.equal(first.ttlSeconds, CRS_PREAUTH_TOKEN_TTL_SECONDS);
      assert.ok(Number.isFinite(expiresAt));
      assert.ok(expiresAt >= issuedAfter);
      assert.ok(expiresAt <= latestAllowedExpiry);
      assert.notEqual(first.token, second.token);
    });

    it('returns current observed scores without projection fields', async () => {
      const adapter = makeAdapter();
      const memberRef = await createContractMember(adapter);
      const scores = await adapter.getLatestScores(memberRef);
      for (const entry of scores) {
        assert.ok(entry.score >= 300 && entry.score <= 850);
        assert.ok(['EQF', 'EXP', 'TUC'].includes(entry.bureau));
        assert.deepEqual(Object.keys(entry).sort(), ['bureau', 'model', 'observedAt', 'score']);
      }
    });

    it('closes a member idempotently', async () => {
      const adapter = makeAdapter();
      const memberRef = await createContractMember(adapter);

      await adapter.closeMember(memberRef);
      const second = await adapter.closeMember(memberRef);

      assert.ok(Number.isFinite(Date.parse(second.closedAt)));
    });

    it('returns a sealed, memory-only soft-pull report', async () => {
      const adapter = makeAdapter();
      const memberRef = await createContractMember(adapter);
      const report = await adapter.softPull(memberRef, CONTRACT_REPORT_CODES);
      const allowedBureaus = new Set(
        CONTRACT_REPORT_CODES.map((code) => BUREAU_BY_REPORT_CODE.get(code)),
      );

      assert.deepEqual(report.reportCodes, CONTRACT_REPORT_CODES);
      assert.ok(report.bureaus.every((bureau) => allowedBureaus.has(bureau)));
      assert.throws(() => JSON.stringify(report));
      assert.equal(String(report), SOFT_PULL_REPORT_REDACTION);
      assert.ok('body' in report);
    });

    it('rejects a forged webhook with the shared failure shape', () => {
      const result = makeAdapter().verifyAndParseWebhook({
        headers: new Headers({ 'content-type': 'application/json' }),
        rawBody: '[{"id":"contract-hook","type":"TEST","user_id":"contract-ref","time":1755345600000}]',
      });

      assert.deepEqual(result, { ok: false, reason: 'bad_auth' });
    });
  });
}
