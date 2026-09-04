// Support draft driver selection.
//
// `SUPPORT_DRAFT_DRIVER` is support's own key, resolved through the shared
// resolver in `env.ts` so the semantics stay identical to the frozen §10 table
// (blank is unset, a present key never auto-upgrades a driver, an unknown value
// throws, a missing required key names every missing key at once) without
// editing a table an interface ask governs. It used to read `AI_DRIVER`, which
// it shared with the KB assistants and the admin eval policy, and `llm/driver.ts`
// records what that costs: flipping one service's driver silently reconfigured
// the others. `AI_DRIVER` is still read as a fallback for one release, with a
// warning naming this key, so a deployment already running on it keeps the
// driver it has.
//
// The `openrouter` arm is now the real driver: `createOpenRouterSupportDraftDriver`
// over the zero-data-retention chat transport, the same transport the coach
// builds. Nothing in this file starts a request — the transport constructs
// eagerly and calls out only when a person asks for a draft — so selecting this
// arm at module load still cannot fail an import.
//
// `createUnavailableOpenRouterDraftDriver` below is no longer part of the
// production path. It stays because `errors.ts` maps its code to a 503 and two
// suites drive the "driver refused" branch of the service through it.

import { resolveDriverFromSpecWithDeprecatedSelector } from '../env.ts';
import { createZdrChatTransport } from '../llm/chat-transport.ts';
import { createMockSupportDraftDriver } from './mock-driver.ts';
import { createOpenRouterSupportDraftDriver } from './openrouter-driver.ts';

import type { DriverSpec, EnvSource } from '../env.ts';
import type {
  SupervisorVerdict,
  SupportDraftCandidate,
  SupportDraftDriver,
} from './types.ts';

export const SUPPORT_DRAFT_DRIVER_UNAVAILABLE = 'SUPPORT_DRAFT_DRIVER_UNAVAILABLE';

export const UNAVAILABLE_OPENROUTER_MODEL = 'openrouter-support-draft-unavailable';

/** The key `AI_DRIVER` is being retired in favour of, per service. */
export const DEPRECATED_AI_DRIVER_SELECTOR = 'AI_DRIVER';

/**
 * Support's own one-row driver table.
 *
 * `as const satisfies` rather than a `DriverSpec` annotation, for the reason
 * `llm/driver.ts` gives: the annotation widens `values` to `string[]`, which
 * would make the switch below non-exhaustive.
 */
export const SUPPORT_DRAFT_DRIVER_SPEC = {
  selector: 'SUPPORT_DRAFT_DRIVER',
  values: ['mock', 'openrouter'],
  fallback: 'mock',
  requires: { openrouter: ['OPENROUTER_API_KEY'] },
} as const satisfies DriverSpec;

export class SupportDraftDriverUnavailableError extends Error {
  readonly code = SUPPORT_DRAFT_DRIVER_UNAVAILABLE;

  constructor() {
    super(
      'A live support draft driver is not available. Human messaging is unaffected.',
    );
    this.name = 'SupportDraftDriverUnavailableError';
  }
}

/**
 * A driver that constructs and then refuses.
 *
 * Not selected by anything in production any more. It is the fixture the
 * service suites use to drive the branch where drafting is unavailable and to
 * prove that branch writes no row, and `errors.ts` owns the 503 its code maps to.
 */
export function createUnavailableOpenRouterDraftDriver(): SupportDraftDriver {
  return {
    driver: 'openrouter',
    model: UNAVAILABLE_OPENROUTER_MODEL,
    generateDraft(): Promise<SupportDraftCandidate> {
      return Promise.reject(new SupportDraftDriverUnavailableError());
    },
    superviseDraft(): Promise<SupervisorVerdict> {
      return Promise.reject(new SupportDraftDriverUnavailableError());
    },
  };
}

export interface SupportDraftDriverFactories {
  createMock(): SupportDraftDriver;
  createOpenRouter(apiKey: string): SupportDraftDriver;
}

const productionFactories: SupportDraftDriverFactories = {
  createMock: createMockSupportDraftDriver,
  createOpenRouter(apiKey): SupportDraftDriver {
    return createOpenRouterSupportDraftDriver(createZdrChatTransport({ apiKey }));
  },
};

/**
 * Resolve the draft driver, per call.
 *
 * There is deliberately no module-level singleton here, unlike `llm/driver.ts`:
 * support resolves on every call, so a test needs no module-cache tricks and a
 * route picks up an environment change without a reload.
 */
export function createSupportDraftDriver(
  env: EnvSource = process.env,
  factories: SupportDraftDriverFactories = productionFactories,
): SupportDraftDriver {
  const selected = resolveDriverFromSpecWithDeprecatedSelector(
    'support_draft',
    SUPPORT_DRAFT_DRIVER_SPEC,
    DEPRECATED_AI_DRIVER_SELECTOR,
    env,
  );
  switch (selected) {
    case 'mock':
      return factories.createMock();
    case 'openrouter':
      // The resolver has already refused a blank key, so this cast narrows a
      // value the spec proved is present rather than asserting a hope.
      return factories.createOpenRouter(env.OPENROUTER_API_KEY as string);
  }
}
