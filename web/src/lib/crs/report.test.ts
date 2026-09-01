// web/src/lib/crs/report.test.ts — CRS-02 mechanism (b), the runtime refusal.
//
// Every report in this file is sealed over a body carrying one unmistakable marker string, so a
// leak in any channel shows up as that marker inside an assertion failure rather than as a vague
// mismatch. The nested cases carry the weight: a report is almost never serialized or inspected
// on purpose, it is serialized because it was sitting inside the object someone logged.
//
// `node:util` is imported HERE and never in `report.ts` — the module under test reaches the
// inspector through the global symbol registry precisely so it depends on nothing.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import util from 'node:util';

import { SOFT_PULL_REPORT_REDACTION, sealReport } from './report.ts';
import type { BureauCode, ReportCode } from './types.ts';

/** Obviously synthetic, and long enough that it cannot appear by coincidence in any output. */
const BODY_MARKER = 'BUREAU-BODY-CANARY-9d4e17';

function sealFixtureReport() {
  const bureaus: BureauCode[] = ['EQF', 'EXP', 'TUC'];
  const reportCodes: ReportCode[] = ['EQF1001', 'EXP1001', 'TUC3002'];

  return sealReport({
    bureaus,
    reportCodes,
    pulledAt: '2026-08-16T12:00:00.000Z',
    body: { marker: BODY_MARKER, accounts: [{ marker: BODY_MARKER }] },
  });
}

describe('sealReport — CRS-02 (b), a report that refuses to serialize', () => {
  it('exports the redaction marker verbatim', () => {
    assert.equal(SOFT_PULL_REPORT_REDACTION, '[SoftPullReport redacted]');
  });

  it('throws on a direct JSON.stringify', () => {
    const report = sealFixtureReport();
    assert.throws(() => JSON.stringify(report));
  });

  it('throws on a JSON.stringify of an object merely containing the report', () => {
    const report = sealFixtureReport();
    assert.throws(() => JSON.stringify({ wrapped: report }));
  });

  it('throws on a JSON.stringify of an array containing the report', () => {
    const report = sealFixtureReport();
    assert.throws(() => JSON.stringify([report]));
  });

  it('throws an error naming the memory-only rule and carrying no part of the body', () => {
    const report = sealFixtureReport();

    assert.throws(
      () => JSON.stringify({ wrapped: report }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.name, 'SoftPullReportSerializationError');
        assert.match(error.message, /memory-only/);
        assert.match(error.message, /extractFeatures/);
        assert.ok(!error.message.includes(BODY_MARKER));
        return true;
      },
    );
  });
});

describe('sealReport — the printing channels redact', () => {
  it('redacts under String()', () => {
    assert.equal(String(sealFixtureReport()), SOFT_PULL_REPORT_REDACTION);
  });

  it('redacts inside a template literal', () => {
    const report = sealFixtureReport();
    assert.equal(`${report}`, SOFT_PULL_REPORT_REDACTION);
  });

  it('redacts under util.inspect', () => {
    assert.equal(util.inspect(sealFixtureReport()), SOFT_PULL_REPORT_REDACTION);
  });

  it('redacts when inspected nested inside a log-context object, with no body field printed', () => {
    const report = sealFixtureReport();
    const printed = util.inspect({ requestId: 'req-0001', wrapped: report });

    assert.ok(printed.includes(SOFT_PULL_REPORT_REDACTION));
    assert.ok(!printed.includes(BODY_MARKER));
    assert.ok(!printed.includes('accounts'));
  });

  it('redacts at depth, where a default inspect would still have descended', () => {
    const report = sealFixtureReport();
    const printed = util.inspect({ outer: { inner: { wrapped: report } } }, { depth: 10 });

    assert.ok(printed.includes(SOFT_PULL_REPORT_REDACTION));
    assert.ok(!printed.includes(BODY_MARKER));
  });
});

describe('sealReport — the shape of the sealed value', () => {
  it('keeps the refusals non-enumerable, so Object.keys sees only the four data properties', () => {
    assert.deepEqual(Object.keys(sealFixtureReport()), [
      'bureaus',
      'reportCodes',
      'pulledAt',
      'body',
    ]);
  });

  it('refuses to have a refusal assigned away', () => {
    const report = sealFixtureReport();
    const asWritable = report as unknown as Record<string, unknown>;

    assert.throws(() => {
      asWritable.toJSON = () => 'stripped';
    }, TypeError);
    assert.throws(() => JSON.stringify(report));
  });

  it('still exposes body, because extractFeatures has to read it in Phase 5', () => {
    const report = sealFixtureReport();
    assert.deepEqual(report.body, {
      marker: BODY_MARKER,
      accounts: [{ marker: BODY_MARKER }],
    });
  });

  it('carries the bureaus, report codes and pull instant it was given', () => {
    const report = sealFixtureReport();
    assert.deepEqual(report.bureaus, ['EQF', 'EXP', 'TUC']);
    assert.deepEqual(report.reportCodes, ['EQF1001', 'EXP1001', 'TUC3002']);
    assert.equal(report.pulledAt, '2026-08-16T12:00:00.000Z');
  });

  it('copies bureaus and reportCodes, so mutating the caller-owned arrays cannot reach in', () => {
    const bureaus: BureauCode[] = ['EQF'];
    const reportCodes: ReportCode[] = ['EQF1001'];
    const report = sealReport({
      bureaus,
      reportCodes,
      pulledAt: '2026-08-16T12:00:00.000Z',
      body: { marker: BODY_MARKER },
    });

    bureaus.push('EXP');
    reportCodes.push('EXP1001');

    assert.deepEqual(report.bureaus, ['EQF']);
    assert.deepEqual(report.reportCodes, ['EQF1001']);
  });
});
