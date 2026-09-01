// web/src/lib/crs/adapter.ts — the single CRS driver-selection point.
//
// Callers hold only `CrsAdapter`; none branches on the driver. The pure factory exists for tests
// and dependency injection, while `getCrsAdapter` memoizes the process-wide runtime instance.
// Environment access happens on first construction, never during module evaluation.

import { assertSandboxCredentials, resolveCrsDriver } from './driver.ts';
import { createMockAdapter } from './mock/driver.ts';
import { systemClock } from './ports.ts';
import { createSandboxAdapter, readSandboxConfigFromEnv } from './sandbox/driver.ts';
import { readWebhookConfigFromEnv } from './webhook.ts';

import type { Clock } from './ports.ts';
import type { CrsAdapter } from './types.ts';

export function createCrsAdapter(
  env: NodeJS.ProcessEnv,
  deps: { clock: Clock },
): CrsAdapter {
  const driver = resolveCrsDriver(env);
  const webhookConfig = readWebhookConfigFromEnv(env);

  if (driver === 'mock') {
    return createMockAdapter({ clock: deps.clock, webhookConfig });
  }

  // Deliberately loud: an explicit sandbox selection with incomplete configuration is never
  // allowed to fall back to mock and hide a deployment error.
  assertSandboxCredentials(env);
  return createSandboxAdapter(readSandboxConfigFromEnv(env), {
    clock: deps.clock,
    webhookConfig,
  });
}

/**
 * R5C-04. Whether repeating a soft pull for the same analysis operation costs nothing.
 *
 * This is the one driver-shaped question the money path has to be able to ask, and it lives here
 * rather than at the caller precisely so that no caller branches on `adapter.driver`. The
 * 2026-08-27 CRS contract serves the latest cached report through GET endpoints; bureau refreshes
 * run on the enrollment schedule rather than on each retrieval, so repeating the read is safe.
 */
export function crsPullIsReplaySafe(adapter: CrsAdapter): boolean {
  void adapter;
  return true;
}

let runtimeAdapter: CrsAdapter | null = null;

/**
 * The process-wide adapter, selected and built on first use.
 *
 * INTERFACES §10 says the driver throws at boot when explicitly misconfigured. Under the
 * no-environment boot contract, the narrow operational meaning is first adapter construction:
 * importing this module stays safe, and plan 04-08 can return the flag-off 404 before touching a
 * sandbox configuration that is intentionally incomplete.
 */
export function getCrsAdapter(): CrsAdapter {
  if (runtimeAdapter === null) {
    runtimeAdapter = createCrsAdapter(process.env, { clock: systemClock });
  }
  return runtimeAdapter;
}
