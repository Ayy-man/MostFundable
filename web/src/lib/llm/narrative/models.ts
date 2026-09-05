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

/**
 * The pair this lane runs on: the first attempt goes to the default model, the second to the
 * fallback. `NARRATIVE_MODEL` and `NARRATIVE_FALLBACK_MODEL` override them.
 *
 * Chosen on the twenty-scenario eval run through the shipped driver on 2026-09-05 (the strict
 * schema, ZDR routing, `require_parameters`, the grounding checker — everything production runs):
 *
 *   x-ai/grok-4.3               18/20, $0.007 a call, 23s median, 32s worst, one provider (xAI)
 *   deepseek/deepseek-v4-flash  19/20, $0.001 a call, 42s median, 119s worst, five providers
 *   anthropic/claude-sonnet-5   18/20, $0.031 a call, 30s median, 62s worst (Amazon Bedrock)
 *   anthropic/claude-haiku-4.5  13/20; google/gemini-3.1-flash-lite 14/20
 *   openai/gpt-5.6-luna         15/20, every miss a transport fault: rate-limited upstream, or
 *                               its answer cut at the token budget; and it only routes at all with
 *                               `require_parameters` dropped
 *
 * Grok is first because it is the cheap one that is also the steadiest, at a fifth of Sonnet's
 * price (its median moved between 23s and 53s across two runs, on one provider). DeepSeek is
 * second rather than first because its latency depends on which of five providers answers, and
 * the driver's 120s limit sits inside that spread; as a fallback its speed costs nothing and its
 * pass rate is the highest measured. The two fail on different things (grok wrote a checklist key
 * in prose on the two "one item left" files, which `driver.ts` now folds; DeepSeek counted a
 * score gap in points once), which is what makes a pair worth more than two attempts on one
 * model: scored as the engine runs it, the pair passed 20/20. Sonnet stays a `NARRATIVE_MODEL`
 * override, not a default.
 *
 * The earlier note here that OpenAI models have no ZDR endpoint was wrong: the 404 came from
 * `require_parameters`, not from `zdr`. Every model above was reached under full ZDR.
 */
export const NARRATIVE_DEFAULT_MODEL = 'x-ai/grok-4.3';

/** The second attempt's model, when the first is refused or the transport fails. */
export const NARRATIVE_FALLBACK_MODEL = 'deepseek/deepseek-v4-flash';

/** The strongest OpenAI option, kept nameable so the reason it is not in the pair stays visible. */
export const NARRATIVE_NON_ZDR_MODEL = 'openai/gpt-5.6-luna';

export const MOCK_NARRATIVE_MODEL = 'template-narrative-v1';

export function narrativeModelFrom(env: EnvSource): string {
  const raw = env.NARRATIVE_MODEL;
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : NARRATIVE_DEFAULT_MODEL;
}

/**
 * The fallback model, or `null` when the second attempt should stay on the first model:
 * `NARRATIVE_FALLBACK_MODEL=none`, or a fallback that names the same model as the primary.
 */
export function narrativeFallbackModelFrom(env: EnvSource): string | null {
  const raw = env.NARRATIVE_FALLBACK_MODEL;
  const chosen = typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : NARRATIVE_FALLBACK_MODEL;
  if (chosen.toLowerCase() === 'none' || chosen === narrativeModelFrom(env)) return null;
  return chosen;
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
  // `'off'` rather than `undefined`, and the distinction is the whole point: `undefined` falls
  // through to the transport's own default of `low`, which still sends a reasoning block. `'off'`
  // is the only value that omits it. Sonnet scored 20/20 without one, and it routes either way
  // (all of no-block, low, and low+exclude reach Bedrock under ZDR — measured 2026-09-05), so this
  // is simply not paying for reasoning the eval showed the job does not need.
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
