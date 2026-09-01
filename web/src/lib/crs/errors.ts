// web/src/lib/crs/errors.ts — the CRS error taxonomy.
//
// The CRS client spec dated 2026-08-27 publishes stable SC codes. The boundary retains those codes
// for deterministic state mapping while discarding provider messages, details, and response bodies.
//
// Neither class has a field a provider response body could occupy. That is deliberate and is
// threat T-04-04: an error message is the easiest accidental exit for bureau content, and
// CRS-02 says no report data reaches a log. Do not add a `body`, `responseText`, `payload` or
// `cause`-carrying-a-Response field to either class.

import type { CrsDriver } from './types.ts';

/** Fixed prefix for every CrsDriverError message. No provider text is ever appended. */
const CRS_DRIVER_ERROR_MESSAGE = 'CRS request failed';

/**
 * A misconfiguration, not a transport failure: an explicit driver selector naming a driver whose
 * credentials are absent, or a selector that names no driver we implement.
 *
 * Carries only the NAMES of the missing environment variables — never a value, not even a
 * truncated or masked one (DEV-ONBOARDING: no credential values in the repo or its logs).
 */
export class CrsConfigError extends Error {
  /** Environment variable names that were absent or empty. Names only; never values. */
  readonly missingKeys: readonly string[];

  constructor(message: string, missingKeys: readonly string[] = []) {
    super(message);
    this.name = 'CrsConfigError';
    this.missingKeys = [...missingKeys];
  }
}

/**
 * A CRS transport failure, described structurally.
 *
 * `operation` is always a source-code literal chosen by the caller (`'createMember'`,
 * `'softPull'`, …). It must never be built from provider output, because it reaches the message.
 */
export class CrsDriverError extends Error {
  readonly driver: CrsDriver;
  readonly operation: string;
  /** HTTP status when there was a response; null for a connection-level failure. */
  readonly httpStatus: number | null;
  /** Stable CRS catalogue codes only. Provider messages and details never cross this boundary. */
  readonly codes: readonly string[];

  constructor(
    driver: CrsDriver,
    operation: string,
    httpStatus: number | null,
    codes: readonly string[] = [],
  ) {
    super(
      `${CRS_DRIVER_ERROR_MESSAGE}: ${operation} via the ${driver} driver (httpStatus ${httpStatus ?? 'none'})`,
    );
    this.name = 'CrsDriverError';
    this.driver = driver;
    this.operation = operation;
    this.httpStatus = httpStatus;
    this.codes = [...codes];
  }

  /**
   * Build from a response. Reads `status` and nothing else — deliberately, so no future edit can
   * pull `statusText`, a header or `await response.text()` into an error that gets logged.
   */
  static fromResponse(
    driver: CrsDriver,
    operation: string,
    response: { readonly status: number },
  ): CrsDriverError {
    return new CrsDriverError(driver, operation, response.status);
  }

  /** Build from a connection-level failure, where no response exists to read a status off. */
  static fromTransport(driver: CrsDriver, operation: string): CrsDriverError {
    return new CrsDriverError(driver, operation, null);
  }
}
