// web/src/lib/crs/driver.ts — driver selection, INTERFACES §10 (DEC-OWN-CREDLESS).
//
// Nothing at module scope in this file reads `process.env`, and nothing here throws at import
// time. That is threat T-04-03: an import-time throw on a missing key would brick the deployed
// app, and the app must build and boot with no env vars set at all.
//
// `resolveCrsDriver` is pure and total. It reads only its argument and never `process.env`, so
// a test can drive the whole matrix from literal objects with no global stubbing.
//
// Phase 0a's integration-owned `env.ts` is the canonical source for the §10 table and its
// resolution semantics. This lane-owned module keeps the frozen CRS-specific export and error
// taxonomy while delegating the decision itself, so there is no second selector to drift.

import { MisconfiguredDriverError, resolveDriver } from '../env.ts';
import { CrsConfigError } from './errors.ts';
import type { CrsDriver } from './types.ts';

/**
 * Resolve which CRS driver runs, per the INTERFACES §10 table:
 *
 * | `CRS_DRIVER`        | `CRS_API_KEY` | result                    |
 * |---------------------|---------------|---------------------------|
 * | `'mock'`            | any           | `'mock'`                  |
 * | `'sandbox'`         | present       | `'sandbox'`               |
 * | `'sandbox'`         | absent/empty  | throws `CrsConfigError`   |
 * | anything else, set  | any           | throws `CrsConfigError`   |
 * | unset or empty      | any           | `'mock'`                  |
 *
 * The selector must explicitly opt into sandbox. Merely adding a key never changes a live
 * deployment's driver. The shared resolver also rejects an explicit sandbox selector whose
 * required keys are absent; this wrapper translates its integration-level error into the frozen
 * CRS taxonomy without adding any environment value to the message.
 */
export function resolveCrsDriver(env: NodeJS.ProcessEnv): CrsDriver {
  try {
    return resolveDriver('crs', env);
  } catch (error) {
    if (error instanceof MisconfiguredDriverError) {
      throw new CrsConfigError(error.message, error.missingKeys);
    }
    throw error;
  }
}

/**
 * Throw unless the three outbound sandbox values are present.
 *
 * There is no default base URL: CRS publishes distinct development and production API hosts, and
 * selecting one is deployment configuration. The error names missing keys and carries no values.
 */
export function assertSandboxCredentials(env: NodeJS.ProcessEnv): void {
  resolveCrsDriver({ ...env, CRS_DRIVER: 'sandbox' });
}
