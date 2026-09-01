// web/src/lib/crs/report.ts — `sealReport`, the ONLY construction site for a `SoftPullReport`.
//
// Both drivers call this function and neither builds a report any other way. A second
// construction site is a defect and should be treated as one in review: it would hand a caller a
// value carrying bureau content with none of the refusals below installed, and every downstream
// assumption in this phase is that holding a report means holding a sealed one.
//
// This is mechanism (b) of the three behind CRS-02 (04-CONTEXT). A doc comment cannot stop a
// leak — the frozen `SoftPullReport` comment in `types.ts` describes the rule, and this file is
// the control that enforces it — so a sealed report actively refuses each channel a bureau body
// would otherwise escape through:
//
//   - serialization. A throwing `toJSON`, so `JSON.stringify(report)` raises instead of emitting
//     the body, and so does a stringify of any object that merely CONTAINS the report. The nested
//     case is the one that matters: nobody serializes a report on purpose, they serialize the log
//     context object that happens to hold one.
//   - interpolation. A `toString` returning the redaction marker, so `String(report)` and a
//     template literal both print the marker and nothing else.
//   - inspection. The well-known Node inspect hook, likewise returning the marker, so a log line
//     that inspects the report — or an object containing it — prints the marker with no body
//     field anywhere in the output.
//
// All three are own, non-enumerable properties, so `Object.keys`, a spread and a shallow copy see
// exactly the four data properties and never the refusals. Read that in the other direction too,
// because it is the honest limit of this mechanism: `{ ...report }` yields a PLAIN object holding
// the body with none of the refusals attached, and that copy serializes happily. Which is exactly
// why CRS-02 is three mechanisms rather than one — the closed record type in `ports.ts` leaves a
// copied body nowhere to be written, and plan 04-08's static scan is what catches the copy being
// made. This file closes the direct path only, and closes it completely.
//
// Nothing here reads env, imports a package or throws on import.

import type { BureauCode, ReportCode, SoftPullReport } from './types.ts';

/** What every refusal channel prints in place of a report. Asserted verbatim by the suite. */
export const SOFT_PULL_REPORT_REDACTION = '[SoftPullReport redacted]';

/**
 * Thrown by a sealed report's `toJSON`.
 *
 * Declared locally and deliberately not exported. It does not belong in `errors.ts`, which plan
 * 04-01 froze at exactly `CrsConfigError` and `CrsDriverError` and which this plan does not own;
 * and there is nothing for a caller to do with it, because catching it means having tried to
 * serialize a report, which is the defect rather than a recoverable condition.
 *
 * The message is a fixed literal with no interpolation of any kind. That is threat T-04-07: an
 * error message describing what went wrong is the most natural place to paste the offending
 * value, and an error message is the one string that reliably reaches a log.
 */
class SoftPullReportSerializationError extends Error {
  constructor() {
    super(
      'A SoftPullReport is memory-only and refuses serialization. The only legal exit is ' +
        'extractFeatures() in lib/analysis, which returns derived features; the report itself is ' +
        'never written to a database, a file, a queue payload, a prompt, an analytics event or a ' +
        'log line (DEV-ONBOARDING rule 2).',
    );
    this.name = 'SoftPullReportSerializationError';
  }
}

/**
 * Build the one kind of `SoftPullReport` this codebase has, with all three refusals installed.
 *
 * `bureaus` and `reportCodes` are copied rather than captured, so a caller that reuses and mutates
 * the array it passed in cannot reach into a sealed report afterwards. `body` is held by reference
 * on purpose — it is provider-shaped, arbitrarily large, and Phase 5's `extractFeatures` reads it
 * in place; a deep copy would double the peak memory holding exactly the data this phase exists to
 * keep from spreading.
 */
export function sealReport(input: {
  bureaus: BureauCode[];
  reportCodes: ReportCode[];
  pulledAt: string;
  body: unknown;
}): SoftPullReport {
  const sealed = {
    bureaus: [...input.bureaus],
    reportCodes: [...input.reportCodes],
    pulledAt: input.pulledAt,
    body: input.body,
  };

  // Non-enumerable so they stay invisible to `Object.keys`; non-writable and non-configurable so
  // a later assignment or redefinition cannot strip a refusal off a report that already exists.
  const refusal: Omit<PropertyDescriptor, 'value'> = {
    enumerable: false,
    writable: false,
    configurable: false,
  };

  Object.defineProperty(sealed, 'toJSON', {
    ...refusal,
    value: function toJSON(): never {
      throw new SoftPullReportSerializationError();
    },
  });

  Object.defineProperty(sealed, 'toString', {
    ...refusal,
    value: function toString(): string {
      return SOFT_PULL_REPORT_REDACTION;
    },
  });

  // Keyed through the global symbol registry rather than by importing `node:util`, so this module
  // depends on nothing at all and behaves identically in a runtime where that builtin is absent.
  // It is the same registered symbol Node's inspector looks up, verified on Node v26.5.0.
  Object.defineProperty(sealed, Symbol.for('nodejs.util.inspect.custom'), {
    ...refusal,
    value: function inspectSoftPullReport(): string {
      return SOFT_PULL_REPORT_REDACTION;
    },
  });

  // The single cast in this file and the only one permitted anywhere in `lib/crs/`. The frozen
  // interface declares `readonly toJSON: never` plus a phantom brand keyed by a
  // `declare const ... unique symbol`, so no object literal can satisfy it — which is the point,
  // because it is what makes fabricating a report outside this function impossible. Every real
  // member the interface names is present on the object above, and all three refusals were
  // installed before this line, so the cast asserts nothing that is not already true at runtime.
  return sealed as unknown as SoftPullReport;
}
