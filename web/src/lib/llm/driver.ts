// Plan engine driver selection.
//
// **This has its own selector, and that is the whole point of the file.** It used
// to call `resolveDriver('ai')`, sharing one environment key with the KB
// assistants, the support draft driver and the admin eval policy. `env.ts` states
// the rule this broke, in its own words: "sharing a `*_DRIVER` variable between
// two services is a bug, because flipping one service's driver then silently
// reconfigures the other." That is not a hypothetical. On 2026-08-22 the
// integration terminal set `AI_DRIVER=openrouter` to give the KB assistants a real
// model, and it silently moved the plan engine onto a path that has never once
// passed `evaluatePlan`, so every production analysis run began failing
// `plan_rejected` after burning two engine attempts of roughly a hundred seconds
// each. `support/driver.ts` had predicted exactly this in a comment and shipped
// anyway.
//
// So `PLAN_DRIVER` is the plan engine's own key, resolved through
// `resolveDriverFromSpec` so the semantics stay identical to the frozen §10 table
// (blank is unset, a present key never auto-upgrades a driver, an unknown value
// throws, a missing required key names every missing key at once) without editing
// a table an interface ask governs.
//
// It falls back to `mock` like every other row, which is what makes this fix
// deployable with no environment change at all: production has `PLAN_DRIVER`
// unset, so the plan engine returns to the mock path it ran on before the flip
// while `AI_DRIVER=openrouter` keeps serving the KB assistants. Set
// `PLAN_DRIVER=openrouter` on the day the plan contract can actually survive a
// real model — today it cannot, because `evaluatePlan` recomputes every field it
// checks and demands the model reproduce it exactly.
//
// The three remaining consumers of `AI_DRIVER` are still coupled. That is a known
// gap with a lane of its own, not an oversight.

import { resolveDriverFromSpec } from '../env.ts';
import { createMockPlanDriver } from './mock-driver.ts';
import { createOpenRouterPlanDriver } from './openrouter-driver.ts';

import type { DriverSpec, EnvSource } from '../env.ts';
import type { PlanDriver } from './types.ts';

/**
 * The plan engine's own one-row driver table.
 *
 * Shaped exactly like a §10 row because `resolveDriverFromSpec` is the same
 * resolver the frozen table uses; the only thing that differs is which key it
 * reads.
 */
// `as const satisfies` rather than a `DriverSpec` annotation: the annotation
// widens `values` to `string[]`, which widens the resolver's return type and
// makes the switch below non-exhaustive, so a driver added to the table would
// compile with no arm to handle it. This way tsc still checks the shape and the
// arms stay provably complete.
export const PLAN_DRIVER_SPEC = {
  selector: 'PLAN_DRIVER',
  values: ['mock', 'openrouter'],
  fallback: 'mock',
  requires: { openrouter: ['OPENROUTER_API_KEY'] },
} as const satisfies DriverSpec;

export interface PlanDriverFactories {
  createMock(): PlanDriver;
  createOpenRouter(apiKey: string): PlanDriver;
}

const productionFactories: PlanDriverFactories = {
  createMock: createMockPlanDriver,
  createOpenRouter(apiKey): PlanDriver {
    return createOpenRouterPlanDriver({ apiKey });
  },
};

export function createPlanDriver(
  env: EnvSource,
  factories: PlanDriverFactories = productionFactories,
): PlanDriver {
  const selected = resolveDriverFromSpec('plan', PLAN_DRIVER_SPEC, env);
  switch (selected) {
    case 'mock':
      return factories.createMock();
    case 'openrouter':
      return factories.createOpenRouter(env.OPENROUTER_API_KEY as string);
  }
}

// §10's "chosen once at module load" — the selection happens here, once, and
// `getPlanDriver` only reads it. Named for the instance rather than the selector
// so the environment key and the singleton are not the same identifier.
const SELECTED_PLAN_DRIVER = createPlanDriver(process.env);

export function getPlanDriver(): PlanDriver {
  return SELECTED_PLAN_DRIVER;
}
