import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { createMockAdapter } from '../crs/mock/driver.ts';
import { createFixedClock } from '../crs/ports.ts';
import { extractFeatures } from './features.ts';

import type { CrsIdentity, CrsPersona, ReportCode } from '../crs/types.ts';
import type { DerivedFeatures } from './features.ts';

/**
 * The shape `extractFeatures` writes is validated again by `private.derived_features_valid`
 * before `persist_analysis_result` stores it, and the in-memory repository the unit suite runs
 * against never calls that validator. When the extractor moved to schemaVersion 2 the database
 * kept refusing every result (ANALYSIS_RESULT_INVALID) and only the live-chain e2e noticed.
 * This test reads the key sets straight out of migration 439 and holds the extractor to them,
 * so the next drift between the two fails here.
 */
const MIGRATION = new URL('../../../../supabase/migrations/439_derived_features_v2.sql', import.meta.url);
const SQL = readFileSync(MIGRATION, 'utf8');

function sqlArrays(pattern: RegExp): string[][] {
  return [...SQL.matchAll(pattern)].map((match) =>
    [...match[1].matchAll(/'([A-Za-z0-9]+)'/g)].map((item) => item[1]).sort(),
  );
}

const second = (arrays: string[][]): string[] => {
  assert.equal(arrays.length, 2, 'migration 439 declares a v1 and a v2 key set');
  return arrays[1];
};

const V2_TOP_LEVEL = second(sqlArrays(/v_required := array\[([^\]]+)\]/g));
const ACCOUNT_REQUIRED = sqlArrays(/v_account_required text\[\] := array\[([^\]]+)\]/g)[0];
const ACCOUNT_OPTIONAL = sqlArrays(/v_account_allowed := v_account_required \|\| array\[([^\]]+)\]/g)[0];
const FLAGS_REQUIRED = second(sqlArrays(/v_flags_required := array\[([^\]]+)\]/g));
const FLAGS_OPTIONAL = sqlArrays(/v_flags_allowed := v_flags_required\s*\|\| array\[([^\]]+)\]/g)[0];

const IDENTITY: CrsIdentity = {
  firstName: 'Mock',
  lastName: 'Subject',
  dateOfBirth: '1990-01-01',
  ssn: '000000000',
  address: { line1: '1 Mock Way', city: 'Mocktown', state: 'CA', postalCode: '00000' },
  email: 'mock-subject@example.invalid',
  phone: '+15550000000',
};
const REPORT_CODES: ReportCode[] = ['EQF1001', 'EXP1001', 'TUC3002'];

async function featuresFor(persona: CrsPersona): Promise<DerivedFeatures> {
  const adapter = createMockAdapter({
    clock: createFixedClock('2026-09-05T12:00:00.000Z'),
    webhookConfig: { basicUser: null, basicPass: null, hmacSecret: null, hmacHeader: 'x-crs-signature', sourceIps: [] },
  });
  const member = await adapter.createMember(IDENTITY, { personaHint: persona });
  return extractFeatures(await adapter.softPull(member.memberRef, REPORT_CODES));
}

const keysOf = (value: object): string[] => Object.keys(value).sort();
const subset = (small: string[], large: string[]) => small.every((key) => large.includes(key));

describe('DerivedFeatures v2 matches the persist validator in migration 439', () => {
  it('reads the four key sets out of the migration', () => {
    assert.ok(V2_TOP_LEVEL.includes('scores') && V2_TOP_LEVEL.includes('identity'));
    assert.ok(ACCOUNT_REQUIRED.includes('accountRef'));
    assert.ok(ACCOUNT_OPTIONAL.includes('lateWithin24Months'));
    assert.ok(FLAGS_REQUIRED.includes('personalInformationConfirmed'));
    assert.ok(FLAGS_OPTIONAL.includes('scoreAtLeast700'));
  });

  for (const persona of ['clean', 'derog', 'thin_file'] as const) {
    it(`the ${persona} persona persists under the v2 rule`, async () => {
      const derived = await featuresFor(persona);
      assert.equal(derived.schemaVersion, 2);
      assert.deepEqual(keysOf(derived), V2_TOP_LEVEL, 'top-level keys are exactly the v2 required set');
      assert.ok(derived.accounts.length > 0, `${persona} carries accounts`);
      for (const account of derived.accounts) {
        const keys = keysOf(account);
        assert.ok(subset(ACCOUNT_REQUIRED, keys), `account ${account.accountRef} has every required key`);
        assert.ok(subset(keys, [...ACCOUNT_REQUIRED, ...ACCOUNT_OPTIONAL]), `account ${account.accountRef} has no unknown key: ${keys.join(',')}`);
        assert.ok(account.balanceCents >= 0);
        assert.ok(account.utilizationPct === null || account.utilizationPct >= 0);
      }
      const flagKeys = keysOf(derived.flags);
      assert.ok(subset(FLAGS_REQUIRED, flagKeys), 'flags carry every required key');
      assert.ok(subset(flagKeys, [...FLAGS_REQUIRED, ...FLAGS_OPTIONAL]), `flags have no unknown key: ${flagKeys.join(',')}`);
      assert.deepEqual(keysOf(derived.identity ?? {}), ['addressesOnFile', 'employersOnFile', 'namesOnFile']);
      for (const score of derived.scores ?? []) {
        assert.deepEqual(keysOf(score), ['bureau', 'model', 'score']);
      }
      for (const inquiry of derived.inquiries ?? []) {
        assert.deepEqual(keysOf(inquiry), ['bureau', 'inquiryRef', 'matchedNewAccountWithin45Days', 'monthsAgo']);
      }
    });
  }
});
