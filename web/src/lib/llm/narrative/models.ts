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
 * High effort for the OpenAI family, and the transport's own default for everything else.
 *
 * `provider.require_parameters` is true, so sending a reasoning block to a model that does not
 * reason can empty the candidate provider set and fail the request outright. The narrative's
 * default is an OpenAI reasoning model and the comparison was run at high effort; a model pointed
 * at by `NARRATIVE_MODEL` outside that family keeps whatever the transport would have sent.
 */
export function narrativeReasoningFor(model: string): 'high' | undefined {
  return model.startsWith('openai/') ? 'high' : undefined;
}
