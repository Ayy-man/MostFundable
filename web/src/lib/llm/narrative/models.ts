/**
 * The narrative lane's driver table and model names, kept apart from `driver.ts`.
 *
 * `driver.ts` resolves its selection at module load, like every other driver on the §10 table, so
 * importing it has a side effect: an environment that names a driver it cannot satisfy throws on
 * import. `admin/eval-policy.ts` needs only the names — which model wrote a recorded evaluation —
 * and has no business inheriting that. Two small modules cost less than one import that can fail
 * for a reason its importer does not care about.
 */

import type { DriverSpec, EnvSource } from '../../env.ts';

export const NARRATIVE_DRIVER_SPEC = {
  selector: 'NARRATIVE_DRIVER',
  values: ['mock', 'openrouter'],
  fallback: 'mock',
  requires: { openrouter: ['OPENROUTER_API_KEY'] },
} as const satisfies DriverSpec;

/** The model the 2026-09-05 comparison chose for this job. `NARRATIVE_MODEL` overrides it. */
export const NARRATIVE_DEFAULT_MODEL = 'openai/gpt-5.6-luna';

export const MOCK_NARRATIVE_MODEL = 'template-narrative-v1';

export function narrativeModelFrom(env: EnvSource): string {
  const raw = env.NARRATIVE_MODEL;
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : NARRATIVE_DEFAULT_MODEL;
}

/**
 * The reasoning setting per model family, which `provider.require_parameters` makes a routing
 * decision rather than a quality one.
 *
 * OpenAI: `high`, which is what the 2026-09-05 comparison measured this job on.
 *
 * Anthropic: `off`, and not as a preference. Anthropic requires `temperature: 1` when extended
 * thinking is on, and `chat-transport.ts` pins `temperature: 0` for every caller; with
 * `require_parameters: true` telling OpenRouter to route only to providers that support every
 * parameter sent, the two together leave no candidate endpoint and the request comes back 404 "No
 * endpoints found that can handle the requested parameters" (measured 2026-09-05 on
 * `anthropic/claude-sonnet-5`). Omitting the block is the only setting that routes at all.
 *
 * Anything else keeps the transport's own default, which is `low`.
 */
export function narrativeReasoningFor(model: string): 'high' | 'off' | undefined {
  if (model.startsWith('openai/')) return 'high';
  if (model.startsWith('anthropic/')) return 'off';
  return undefined;
}

/**
 * Whether this model's ZDR endpoints refuse to be routed to when `temperature` is present.
 *
 * Anthropic's, measured 2026-09-05: `anthropic/claude-sonnet-5` 404s "No endpoints found that can
 * handle the requested parameters" with `temperature` at 0 or at 1 under `require_parameters`, and
 * routes to Amazon Bedrock under full ZDR the moment the parameter is dropped. The narrative can
 * afford to drop it — its correctness guarantee is the grounding checker, not a reproducible
 * sample — so this is a routing fix rather than a change of sampling policy.
 */
export function narrativeOmitsTemperature(model: string): boolean {
  return model.startsWith('anthropic/');
}
