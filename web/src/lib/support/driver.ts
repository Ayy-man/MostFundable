// Support draft driver selection.
//
// One selector, two consumers: `resolveDriver('ai', env)` is the integration-owned
// table in `env.ts` that the plan engine already uses, so support adds no new
// environment key and cannot drift out of step with lane C's choice.
//
// The `openrouter` arm constructs successfully and rejects on use (IA-13-01).
// The reason is concrete rather than stylistic: `llm/driver.ts:33` evaluates
// `createPlanDriver(process.env)` at module load, so the moment lane C flips
// `AI_DRIVER=openrouter` the selector resolves that arm for every consumer of
// the `ai` driver, support included. A throwing constructor would break module
// import in production, for an unrelated change, with a stack trace nobody was
// looking for. Rejecting on use degrades support to human-only messaging, which
// is the safe direction for this phase specifically — a support thread with no
// draft affordance still works.
//
// Lane C's ZDR-hardened transport stays private inside `createOpenRouterPlanDriver`,
// and none of it is copied here. When IA-13-01 lands a narrow chat transport,
// this arm swaps for it and nothing else in the phase moves.

import { resolveDriver } from '../env.ts';
import { createZdrChatTransport } from '../llm/chat-transport.ts';
import { createMockSupportDraftDriver } from './mock-driver.ts';
import { createOpenRouterSupportDraftDriver } from './openrouter-driver.ts';

import type { EnvSource } from '../env.ts';
import type {
  SupervisorVerdict,
  SupportDraftCandidate,
  SupportDraftDriver,
} from './types.ts';

export const SUPPORT_DRAFT_DRIVER_UNAVAILABLE = 'SUPPORT_DRAFT_DRIVER_UNAVAILABLE';

export const UNAVAILABLE_OPENROUTER_MODEL = 'openrouter-support-draft-unavailable';

export class SupportDraftDriverUnavailableError extends Error {
  readonly code = SUPPORT_DRAFT_DRIVER_UNAVAILABLE;

  constructor() {
    super(
      'A live support draft driver is not wired yet. Lane C keeps its zero-data-retention ' +
        'chat transport private, so drafting over a provider is unavailable until that ' +
        'transport is exported (IA-13-01). Human messaging is unaffected.',
    );
    this.name = 'SupportDraftDriverUnavailableError';
  }
}

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
  createOpenRouter(): SupportDraftDriver;
}

const productionFactories: SupportDraftDriverFactories = {
  createMock: createMockSupportDraftDriver,
  createOpenRouter: createUnavailableOpenRouterDraftDriver,
};

function isClearlyPlaceholderKey(value: string | undefined): boolean {
  return value !== undefined && /(?:not-a-real|placeholder|example|fake)/i.test(value);
}

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
  const selected = resolveDriver('ai', env);
  switch (selected) {
    case 'mock':
      return factories.createMock();
    case 'openrouter':
      if (factories === productionFactories && isClearlyPlaceholderKey(env.OPENROUTER_API_KEY)) {
        return createUnavailableOpenRouterDraftDriver();
      }
      return factories === productionFactories
        ? createOpenRouterSupportDraftDriver(
            createZdrChatTransport({ apiKey: env.OPENROUTER_API_KEY }),
          )
        : factories.createOpenRouter();
  }
}
