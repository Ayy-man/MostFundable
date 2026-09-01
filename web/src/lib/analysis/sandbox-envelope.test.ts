// R5D-02 regression — the sandbox adapter's own output must survive the production extractor.
//
// The finding: `createSandboxAdapter().softPull()` sealed `{ perBureau: [<CRS response>] }`, and
// `extractFeatures` refuses anything that is not exactly `{ noHit, perBureau }` with exactly the
// seven declared record keys. Every successful sandbox pull therefore became `pull_failed` in
// `runAnalysisWorker`, and no test caught it because every worker test uses the mock driver, which
// has always emitted the declared envelope. The sandbox arm is what the client sees first, because
// CRS keys have not arrived.
//
// This file exists in `lib/analysis` rather than in `lib/crs/sandbox` on purpose: the defect lives
// in the seam between the two modules, and a test that stays inside either one cannot see it.
//
// The assertions are derived, not transcribed. The bureau-to-code pairing comes from
// `CRS_REPORT_CODE_BY_BUREAU`, the subsets are generated from it, and the driver list is the set of
// adapters the wiring can select — so a fourth bureau or a third driver fails this file until its
// envelope is proven, rather than passing by omission.
//
// Named failing assertions on d6ae268 (verified by reverting `normalizedBureauRecord` /
// `reportedNoHit` and the `performSoftPull` body):
//   - 'the sandbox envelope extracts for every requested bureau subset' (FEATURE_SOURCE_UNSUPPORTED)
//   - 'a bureau that answers with no file yields the no-hit envelope'  (FEATURE_SOURCE_UNSUPPORTED)
//   - 'the sandbox driver reaches plan generation and derived persistence' (failed 1, pull_failed)

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CRS_BUREAU_CODES, CRS_REPORT_CODE_BY_BUREAU } from '../crs/constants.ts';
import { createMockAdapter } from '../crs/mock/driver.ts';
import { createFixedClock } from '../crs/ports.ts';
import { createSandboxAdapter } from '../crs/sandbox/driver.ts';
import { createMockPlanDriver } from '../llm/mock-driver.ts';
import { extractFeatures } from './features.ts';
import { createInMemoryAnalysisRepository } from './repository.ts';
import { drainAnalysisQueue, enqueueAnalysisRun } from './worker.ts';

import type { BureauCode, CrsAdapter, CrsMemberRef, ReportCode } from '../crs/types.ts';
import type { CrsWebhookConfig } from '../crs/webhook.ts';

const INSTANT = '2026-08-16T02:00:00.000Z';
const CLIENT_ID = '5d020000-0000-4000-8000-000000000101';
const ENROLLMENT_ID = '5d020000-0000-4000-8000-000000000201';
const WORKER_ID = '5d020000-0000-4000-8000-000000000901';
const MEMBER_REF = 'not-a-real-member' as CrsMemberRef;
const MOCK_MEMBER_REF = 'mock_clean_000001' as CrsMemberRef;
const ENABLED = { FEATURE_ANALYSIS: 'true' };
const SUBJECT_REF = 'subject-r5d02';
const MONTHLY_DEBT_CENTS = 45_000;

const WEBHOOK_CONFIG: CrsWebhookConfig = {
  basicUser: null,
  basicPass: null,
  hmacSecret: null,
  hmacHeader: 'x-crs-signature',
  sourceIps: [],
};

/** A CRS 2026-08-27 `CreditReportProviderViewReport` derived into the analysis contract. */
function providerBody(bureau: BureauCode): unknown {
  return {
    provider: bureau === 'EQF' ? 'EFX' : bureau === 'TUC' ? 'TU' : bureau,
    summary: {
      id: SUBJECT_REF,
      revolvingAccounts: { monthlyPaymentAmount: { amount: 450, currency: 'USD' } },
      mortgageAccounts: { monthlyPaymentAmount: { amount: 0, currency: 'USD' } },
      installmentAccounts: { monthlyPaymentAmount: { amount: 0, currency: 'USD' } },
      otherAccounts: { monthlyPaymentAmount: { amount: 0, currency: 'USD' } },
    },
    revolvingAccounts: [
      {
        id: 'acct-revolving-1', accountOpen: true,
        balanceAmount: { amount: 1200, currency: 'USD' },
        creditLimitAmount: { amount: 10000, currency: 'USD' },
        dateOpened: '2023-04-16T02:00:00.000Z',
        isNegative: false,
      },
    ],
    installmentAccounts: [
      {
        id: 'acct-installment-1', accountOpen: true,
        balanceAmount: { amount: 8000, currency: 'USD' },
        dateOpened: '2025-02-16T02:00:00.000Z',
        isNegative: false,
      },
    ],
    mortgageAccounts: [],
    otherAccounts: [],
    inquiries: [{ id: `inq-${bureau.toLowerCase()}-1`, reportedDate: '2026-05-16T02:00:00.000Z' }],
    // Fields the analysis contract does not declare. A pass-through envelope would carry them into
    // `extractFeatures` and be refused by `hasExactKeys`, so their presence is part of the proof.
    provider_trace_id: 'trace-not-retained',
    raw_tradelines: [{ furnisher: 'not retained' }],
  };
}

function bureauForCode(code: ReportCode): BureauCode {
  const found = CRS_BUREAU_CODES.find((bureau) => CRS_REPORT_CODE_BY_BUREAU[bureau] === code);
  assert.ok(found, `no bureau declares report code ${code}`);
  return found;
}

/** Every non-empty subset of the declared report codes, in declaration order. */
function reportCodeSubsets(): ReportCode[][] {
  const codes = CRS_BUREAU_CODES.map((bureau) => CRS_REPORT_CODE_BY_BUREAU[bureau]);
  const subsets: ReportCode[][] = [];
  for (let mask = 1; mask < 1 << codes.length; mask += 1) {
    subsets.push(codes.filter((_code, index) => (mask & (1 << index)) !== 0));
  }
  return subsets;
}

function sandboxAdapter(fetchImpl: typeof fetch): CrsAdapter {
  return createSandboxAdapter(
    {
      baseUrl: 'https://crs.invalid/api',
      apiKey: 'not-a-real-key',
      exposeVerificationUrl: false,
      secret: 'not-a-real-secret',
      timeoutMs: 1_000,
    },
    { clock: createFixedClock(INSTANT), webhookConfig: WEBHOOK_CONFIG, fetchImpl },
  );
}

function respondingFetch(body: (bureau: BureauCode) => unknown): typeof fetch {
  return async (input) => {
    const pathname = new URL(String(input)).pathname.replace('/api', '');
    let response: unknown;
    if (pathname === '/direct/login') response = { token: 'not-a-real-direct-token', expires: 3600, refresh: 'not-a-real-refresh' };
    else if (pathname === `/direct/preauth-token/${MEMBER_REF}`) response = { userId: MEMBER_REF, token: 'not-a-real-preauth' };
    else if (pathname === '/users/preauth-token/not-a-real-preauth') response = { token: 'not-a-real-user-token', expires: 900, refresh: 'not-a-real-user-refresh' };
    else if (pathname === '/users/efx-latest-report') {
      response = { id: SUBJECT_REF, reportType: 'US_3B', providerViews: CRS_BUREAU_CODES.flatMap((bureau) => {
        const view = body(bureau);
        return view === null ? [] : [view];
      }) };
    } else throw new Error(`sandbox requested an unroutable URL: ${pathname}`);
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

describe('R5D-02 — the sandbox envelope and the feature extractor agree', () => {
  it('the sandbox envelope extracts for every requested bureau subset', async () => {
    for (const codes of reportCodeSubsets()) {
      const report = await sandboxAdapter(respondingFetch(providerBody)).softPull(
        MEMBER_REF,
        codes,
      );
      const derived = extractFeatures(report);

      assert.deepEqual(derived.bureausPulled, codes.map(bureauForCode));
      assert.equal(derived.schemaVersion, 1);
      assert.equal(derived.computedAt, INSTANT);
      assert.equal(derived.dti.monthlyDebtPaymentsCents, MONTHLY_DEBT_CENTS);
      // Two distinct account refs reported by every bureau, merged to two accounts, not doubled.
      assert.equal(derived.accounts.length, 2);
      assert.equal(derived.overallUtilizationPct, 12);
      for (const bureau of codes.map(bureauForCode)) {
        assert.equal(derived.inquiriesByBureau[bureau], 1);
      }
    }
  });

  it('a bureau that answers with no file yields the no-hit envelope', async () => {
    const codes = CRS_BUREAU_CODES.map((bureau) => CRS_REPORT_CODE_BY_BUREAU[bureau]);
    const report = await sandboxAdapter(respondingFetch(() => null)).softPull(
      MEMBER_REF,
      codes,
    );

    assert.deepEqual(report.bureaus, []);
    const derived = extractFeatures(report);
    assert.deepEqual(derived.bureausPulled, []);
    assert.equal(derived.accounts.length, 0);
    assert.equal(derived.flags.thinFile, true);
    assert.equal(derived.computedAt, INSTANT);
  });

  it('drops only the bureaus that report no file and keeps the rest', async () => {
    const codes = CRS_BUREAU_CODES.map((bureau) => CRS_REPORT_CODE_BY_BUREAU[bureau]);
    const silent = CRS_BUREAU_CODES[0];
    const report = await sandboxAdapter(
      respondingFetch((bureau) => (bureau === silent ? null : providerBody(bureau))),
    ).softPull(MEMBER_REF, codes);

    const derived = extractFeatures(report);
    assert.deepEqual(
      derived.bureausPulled,
      CRS_BUREAU_CODES.filter((bureau) => bureau !== silent),
    );
    assert.equal(derived.inquiriesByBureau[silent], 0);
  });

  it('carries no provider field the analysis contract does not declare', async () => {
    const codes = CRS_BUREAU_CODES.map((bureau) => CRS_REPORT_CODE_BY_BUREAU[bureau]);
    const report = await sandboxAdapter(respondingFetch(providerBody)).softPull(MEMBER_REF, codes);
    const derived = extractFeatures(report);

    // The extractor is the only legal exit from a sealed report, so the derived object is the only
    // thing that can ever be persisted. Nothing the provider added may appear in it.
    const serialized = JSON.stringify(derived);
    assert.ok(!serialized.includes('trace-not-retained'));
    assert.ok(!serialized.includes('raw_tradelines'));
    assert.ok(!serialized.includes('furnisher'));
    assert.ok(!serialized.includes(SUBJECT_REF));
  });

  it('produces the same envelope shape from every selectable driver', async () => {
    const adapters: Array<{ name: string; adapter: CrsAdapter; memberRef: CrsMemberRef }> = [
      { name: 'mock', adapter: createMockAdapter({ clock: createFixedClock(INSTANT), webhookConfig: WEBHOOK_CONFIG }), memberRef: MOCK_MEMBER_REF },
      { name: 'sandbox', adapter: sandboxAdapter(respondingFetch(providerBody)), memberRef: MEMBER_REF },
    ];
    const codes = CRS_BUREAU_CODES.map((bureau) => CRS_REPORT_CODE_BY_BUREAU[bureau]);

    for (const entry of adapters) {
      const derived = extractFeatures(await entry.adapter.softPull(entry.memberRef, codes));
      assert.equal(derived.schemaVersion, 1, `${entry.name} produced an unextractable envelope`);
      assert.deepEqual(derived.bureausPulled, [...CRS_BUREAU_CODES], entry.name);
    }
  });
});

describe('R5D-02 — the worker on the sandbox driver', () => {
  it('the sandbox driver reaches plan generation and derived persistence', async () => {
    const repository = createInMemoryAnalysisRepository({
      clock: { now: () => new Date(INSTANT) },
      enrollments: { [CLIENT_ID]: MEMBER_REF },
    });
    const adapter = sandboxAdapter(respondingFetch(providerBody));
    const overrides = {
      env: ENABLED,
      repository,
      getAdapter: () => adapter,
      getDriver: () => createMockPlanDriver(),
    };

    const job = await enqueueAnalysisRun(
      {
        clientId: CLIENT_ID,
        sourceKind: 'enrollment' as const,
        sourceId: ENROLLMENT_ID,
        trigger: 'scheduled' as const,
      },
      overrides,
    );
    assert.ok(job);

    const result = await drainAnalysisQueue({ maxJobs: 1, workerId: WORKER_ID }, overrides);

    assert.deepEqual(result, { claimed: 1, succeeded: 1, failed: 0 });
    assert.equal(repository.readJobs()[0]?.status, 'succeeded');
    assert.equal(repository.readJobs()[0]?.errorCode, null);
    assert.equal(repository.readRuns().length, 1);
    assert.equal(repository.readPlanCount(), 1);
  });

  it('leaves the mock-driver worker path exactly as it was', async () => {
    const repository = createInMemoryAnalysisRepository({
      clock: { now: () => new Date(INSTANT) },
      enrollments: { [CLIENT_ID]: MOCK_MEMBER_REF },
    });
    const adapter = createMockAdapter({
      clock: createFixedClock(INSTANT),
      webhookConfig: WEBHOOK_CONFIG,
    });
    const overrides = {
      env: ENABLED,
      repository,
      getAdapter: () => adapter,
      getDriver: () => createMockPlanDriver(),
    };

    const job = await enqueueAnalysisRun(
      {
        clientId: CLIENT_ID,
        sourceKind: 'enrollment' as const,
        sourceId: ENROLLMENT_ID,
        trigger: 'scheduled' as const,
      },
      overrides,
    );
    assert.ok(job);

    const result = await drainAnalysisQueue({ maxJobs: 1, workerId: WORKER_ID }, overrides);
    assert.deepEqual(result, { claimed: 1, succeeded: 1, failed: 0 });
    assert.equal(repository.readPlanCount(), 1);
  });
});
