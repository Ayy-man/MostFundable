import { validateJobTuple } from "@/lib/jobs/definitions";

import { adminError, adminFailure, adminJson, ADMIN_UUID, isAdminDay, readExactBody } from "./http.ts";
import { GOVERNED_SETTING_KEYS } from "./settings-types.ts";
import { PROMPT_KEYS } from "./prompt-types.ts";

import type { DrainJobsResult } from "@/lib/jobs/drainer";
import type { EmbeddedPrompt, EvalRunRow, PromptActivationDecision, PromptEvaluationSummary, PromptKey, PromptVersionRow, ResolvedPrompt } from "./prompt-types.ts";
import type { GovernedSettingKey, SettingRow } from "./settings-types.ts";
import type { AdminLayoutRow, KpiMetricKey, KpiRollupRow } from "./analytics-types.ts";
import type { AdminHealth } from "./health.ts";
import type { AdminOverviewCounts } from "./overview.ts";
import type { AdminFundedVolume, AdminPendingReview, AdminTenantRow } from "./platform.ts";

type AdminSession = { id: string; role: "platform_admin" };

export interface AdminHandlerDependencies {
  requireAdmin(): Promise<AdminSession>;
  getSetting(key: GovernedSettingKey): Promise<SettingRow | null>;
  setSetting(key: GovernedSettingKey, value: number, actorId: string): Promise<SettingRow>;
  readOverviewCounts(): Promise<AdminOverviewCounts>;
  readHealth(): Promise<AdminHealth>;
  readFundedCents(): Promise<number | null>;
  readCashCents(): Promise<number>;
  listRollups(subject: string, day: string): Promise<readonly KpiRollupRow[]>;
  readLayout(profileId: string): Promise<AdminLayoutRow | null>;
  setLayout(profileId: string, layout: readonly KpiMetricKey[]): Promise<AdminLayoutRow>;
  runNow(subject: string, day: string): Promise<DrainJobsResult>;
  listPromptVersions(key: PromptKey): Promise<readonly PromptVersionRow[]>;
  createPromptVersion(fallback: EmbeddedPrompt, body: string, actorId: string): Promise<PromptVersionRow>;
  activatePromptVersion(key: PromptKey, version: number, actorId: string): Promise<PromptActivationDecision>;
  evaluatePrompt(prompt: ResolvedPrompt, actorId: string): Promise<PromptEvaluationSummary>;
  fallbackFor(key: PromptKey): Promise<EmbeddedPrompt>;
  listEvalRuns(filters: { promptKey?: PromptKey; promptVersion?: number; limit?: number }): Promise<readonly EvalRunRow[]>;
  readEvalRun(id: string): Promise<EvalRunRow | null>;
  readTenants(): Promise<readonly AdminTenantRow[]>;
  readFundedVolume(today: string): Promise<AdminFundedVolume>;
  readPlatformMrrCents(): Promise<number>;
  readPendingReviews(): Promise<readonly AdminPendingReview[]>;
}

const defaults: AdminHandlerDependencies = {
  async requireAdmin() {
    const { requireRole } = await import("@/lib/auth/session");
    return await requireRole("platform_admin") as AdminSession;
  },
  async getSetting(key) { return (await import("./settings.ts")).getSetting(key); },
  async setSetting(key, value, actorId) { return (await import("./settings.ts")).setSetting(key, value, actorId); },
  async readOverviewCounts() { return (await import("./overview.ts")).readAdminOverviewCounts(); },
  async readHealth() { return (await import("./health.ts")).readAdminHealth(); },
  async readFundedCents() { return (await import("./overview.ts")).readAdminFundedCents(); },
  async readCashCents() { return (await import("./overview.ts")).readAdminCashCents(); },
  async listRollups(subject, day) { return (await import("./analytics.ts")).listKpiRollups(subject, day); },
  async readLayout(profileId) { return (await import("./analytics.ts")).readAdminLayout(profileId); },
  async setLayout(profileId, layout) { return (await import("./analytics.ts")).setAdminLayout(profileId, layout); },
  async runNow(subject, day) {
    return (await import("@/lib/jobs/run-now")).runNow("kpi.rollup", subject, day);
  },
  async listPromptVersions(key) { return (await import("./prompts.ts")).listPromptVersions(key); },
  async createPromptVersion(fallback, body, actorId) {
    return (await import("./prompts.ts")).createPromptVersion(fallback, body, actorId);
  },
  async activatePromptVersion(key, version, actorId) {
    return (await import("./prompts.ts")).activatePromptVersion(key, version, actorId);
  },
  async evaluatePrompt(prompt, actorId) {
    return (await import("./prompt-evaluator.ts")).evaluateStagedPrompt(prompt, actorId);
  },
  async fallbackFor(key) {
    if (key === "funding-readiness-plan") return (await import("@/lib/llm/prompts/plan-v1")).PLAN_EMBEDDED_PROMPT;
    if (key === "funding-readiness-narrative") return (await import("@/lib/llm/narrative/prompt")).NARRATIVE_EMBEDDED_PROMPT;
    return (await import("@/lib/support/prompt")).SUPPORT_DRAFT_EMBEDDED_PROMPT;
  },
  async listEvalRuns(filters) { return (await import("./evals.ts")).listEvalRuns(filters); },
  async readEvalRun(id) { return (await import("./evals.ts")).readEvalRun(id); },
  async readTenants() { return (await import("./platform.ts")).createPlatformRepository().readTenants(); },
  async readFundedVolume(today) { return (await import("./platform.ts")).createPlatformRepository().readFundedVolume(today); },
  async readPlatformMrrCents() { return (await import("./platform.ts")).createPlatformRepository().readPlatformMrrCents(); },
  async readPendingReviews() { return (await import("./platform.ts")).createPlatformRepository().readPendingReviews(); },
};

const withDefaults = (overrides: Partial<AdminHandlerDependencies>) => ({ ...defaults, ...overrides });
const settingKey = (value: string): GovernedSettingKey | null =>
  (GOVERNED_SETTING_KEYS as readonly string[]).includes(value) ? value as GovernedSettingKey : null;
const promptKey = (value: string | null): PromptKey | null =>
  value !== null && (PROMPT_KEYS as readonly string[]).includes(value) ? value as PromptKey : null;

async function authenticate(deps: AdminHandlerDependencies): Promise<AdminSession | Response> {
  try { return await deps.requireAdmin(); } catch (error) { return adminFailure(error); }
}

const isResponse = (value: AdminSession | Response): value is Response => value instanceof Response;

export async function handleGetSetting(keyValue: string, overrides: Partial<AdminHandlerDependencies> = {}): Promise<Response> {
  const deps = withDefaults(overrides);
  const session = await authenticate(deps);
  if (isResponse(session)) return session;
  const key = settingKey(keyValue);
  if (!key) return adminError("setting_key_invalid", 400);
  try { return adminJson({ setting: await deps.getSetting(key) }); } catch (error) { return adminFailure(error); }
}

export async function handlePatchSetting(request: Request, keyValue: string, overrides: Partial<AdminHandlerDependencies> = {}): Promise<Response> {
  const deps = withDefaults(overrides);
  const session = await authenticate(deps);
  if (isResponse(session)) return session;
  const key = settingKey(keyValue);
  if (!key) return adminError("setting_key_invalid", 400);
  const body = await readExactBody(request, ["value"]);
  if (!body || typeof body.value !== "number" || !Number.isFinite(body.value)) return adminError("setting_value_invalid", 400);
  try { return adminJson({ setting: await deps.setSetting(key, body.value, session.id) }); } catch (error) { return adminFailure(error); }
}

export async function handleOverview(
  flags: { applications: boolean; fees: boolean },
  overrides: Partial<AdminHandlerDependencies> = {},
): Promise<Response> {
  const deps = withDefaults(overrides);
  const session = await authenticate(deps);
  if (isResponse(session)) return session;
  try {
    const { operators, consumers, analyses } = await deps.readOverviewCounts();
    // Funded and cash have durable sources only behind their own flags; with a
    // flag off there is nothing to total, so the figure is null and the strip
    // renders the not-enabled reason rather than a misleading $0.
    const funded = flags.applications ? await deps.readFundedCents() : null;
    const cash = flags.fees ? await deps.readCashCents() : null;
    return adminJson({ operators, consumers, analyses, funded, cash });
  } catch (error) { return adminFailure(error); }
}

/**
 * The three checks behind the admin System health panel.
 *
 * Gated exactly like the Overview strip: `FEATURE_ADMIN` at the route, then the
 * `platform_admin` role here, before anything is read. The payload names
 * services and driver names only — never an environment value, a key or a
 * provider host — because it lands in a browser.
 */
export async function handleHealth(overrides: Partial<AdminHandlerDependencies> = {}): Promise<Response> {
  const deps = withDefaults(overrides);
  const session = await authenticate(deps);
  if (isResponse(session)) return session;
  try { return adminJson(await deps.readHealth()); } catch (error) { return adminFailure(error); }
}

export async function handleAnalytics(request: Request, overrides: Partial<AdminHandlerDependencies> = {}): Promise<Response> {
  const deps = withDefaults(overrides);
  const session = await authenticate(deps);
  if (isResponse(session)) return session;
  const query = new URL(request.url).searchParams;
  const subject = query.get("subject");
  const day = query.get("day") ?? new Date().toISOString().slice(0, 10);
  try {
    if (!subject || !isAdminDay(day)) throw new Error("invalid");
    validateJobTuple({ job: "kpi.rollup", subject, window: day });
  } catch { return adminError("analytics_query_invalid", 400); }
  try { return adminJson({ rollups: await deps.listRollups(subject, day) }); } catch (error) { return adminFailure(error); }
}

export async function handleGetLayout(overrides: Partial<AdminHandlerDependencies> = {}): Promise<Response> {
  const deps = withDefaults(overrides);
  const session = await authenticate(deps);
  if (isResponse(session)) return session;
  try { return adminJson({ layout: await deps.readLayout(session.id) }); } catch (error) { return adminFailure(error); }
}

export async function handlePatchLayout(request: Request, overrides: Partial<AdminHandlerDependencies> = {}): Promise<Response> {
  const deps = withDefaults(overrides);
  const session = await authenticate(deps);
  if (isResponse(session)) return session;
  const body = await readExactBody(request, ["layout"]);
  if (!body || !Array.isArray(body.layout) || !body.layout.every((key) => typeof key === "string")) {
    return adminError("layout_invalid", 400);
  }
  try { return adminJson({ layout: await deps.setLayout(session.id, body.layout as KpiMetricKey[]) }); } catch (error) { return adminFailure(error); }
}

export async function handleAnalyticsRunNow(request: Request, overrides: Partial<AdminHandlerDependencies> = {}): Promise<Response> {
  const deps = withDefaults(overrides);
  const session = await authenticate(deps);
  if (isResponse(session)) return session;
  const body = await readExactBody(request, ["subject", "day"]);
  try {
    if (!body || typeof body.subject !== "string" || !isAdminDay(body.day)) throw new Error("invalid");
    validateJobTuple({ job: "kpi.rollup", subject: body.subject, window: body.day });
    const result = await deps.runNow(body.subject, body.day);
    return adminJson({ claimed: result.claimed, failed: result.failed, retried: result.retried, skipped: result.skipped, succeeded: result.succeeded });
  } catch (error) {
    if (error instanceof Error && (error.message === "invalid" || error.message === "JOB_TUPLE_INVALID")) return adminError("job_tuple_invalid", 400);
    return adminFailure(error);
  }
}

export async function handlePromptFamilies(overrides: Partial<AdminHandlerDependencies> = {}): Promise<Response> {
  const deps = withDefaults(overrides);
  const session = await authenticate(deps);
  if (isResponse(session)) return session;
  try {
    const prompts = await Promise.all(PROMPT_KEYS.map(async (key) => ({ key, fallback: await deps.fallbackFor(key) })));
    return adminJson({ prompts });
  } catch (error) { return adminFailure(error); }
}

export async function handlePromptVersions(keyValue: string, overrides: Partial<AdminHandlerDependencies> = {}): Promise<Response> {
  const deps = withDefaults(overrides);
  const session = await authenticate(deps);
  if (isResponse(session)) return session;
  const key = promptKey(keyValue);
  if (!key) return adminError("prompt_key_invalid", 400);
  try { return adminJson({ key, versions: await deps.listPromptVersions(key) }); } catch (error) { return adminFailure(error); }
}

export async function handleCreatePromptVersion(request: Request, keyValue: string, overrides: Partial<AdminHandlerDependencies> = {}): Promise<Response> {
  const deps = withDefaults(overrides);
  const session = await authenticate(deps);
  if (isResponse(session)) return session;
  const key = promptKey(keyValue);
  if (!key) return adminError("prompt_key_invalid", 400);
  const body = await readExactBody(request, ["body"]);
  if (!body || typeof body.body !== "string" || !body.body.trim()) return adminError("prompt_body_invalid", 400);
  try { return adminJson({ prompt: await deps.createPromptVersion(await deps.fallbackFor(key), body.body, session.id) }, 201); } catch (error) { return adminFailure(error); }
}

export async function handleActivatePrompt(request: Request, keyValue: string, overrides: Partial<AdminHandlerDependencies> = {}): Promise<Response> {
  const deps = withDefaults(overrides);
  const session = await authenticate(deps);
  if (isResponse(session)) return session;
  const key = promptKey(keyValue);
  if (!key) return adminError("prompt_key_invalid", 400);
  const body = await readExactBody(request, ["version"]);
  if (!body || !Number.isSafeInteger(body.version) || (body.version as number) < 1) return adminError("prompt_version_invalid", 400);
  try { return adminJson({ activation: await deps.activatePromptVersion(key, body.version as number, session.id) }); } catch (error) { return adminFailure(error); }
}

export async function handleEvaluatePrompt(keyValue: string, versionValue: string, overrides: Partial<AdminHandlerDependencies> = {}): Promise<Response> {
  const deps = withDefaults(overrides);
  const session = await authenticate(deps);
  if (isResponse(session)) return session;
  const key = promptKey(keyValue);
  const version = Number(versionValue);
  if (!key) return adminError("prompt_key_invalid", 400);
  if (!Number.isSafeInteger(version) || version < 1) return adminError("prompt_version_invalid", 400);
  try {
    const prompt = (await deps.listPromptVersions(key)).find((candidate) => candidate.version === version);
    if (!prompt) return adminError("prompt_version_not_found", 404);
    if (prompt.active) return adminError("prompt_version_not_staged", 409);
    const resolved = Object.freeze({ key, version, body: prompt.body, source: "database" as const });
    return adminJson({ evaluation: await deps.evaluatePrompt(resolved, session.id) });
  } catch (error) { return adminFailure(error); }
}

export async function handleEvalHistory(request: Request, overrides: Partial<AdminHandlerDependencies> = {}): Promise<Response> {
  const deps = withDefaults(overrides);
  const session = await authenticate(deps);
  if (isResponse(session)) return session;
  const query = new URL(request.url).searchParams;
  const rawKey = query.get("promptKey");
  const key = rawKey === null ? undefined : promptKey(rawKey) ?? undefined;
  const rawVersion = query.get("promptVersion");
  const rawLimit = query.get("limit");
  const version = rawVersion === null ? undefined : Number(rawVersion);
  const limit = rawLimit === null ? undefined : Number(rawLimit);
  if ((rawKey !== null && !key) || (version !== undefined && (!Number.isSafeInteger(version) || version < 1)) ||
      (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1 || limit > 200))) return adminError("eval_filter_invalid", 400);
  try { return adminJson({ evals: await deps.listEvalRuns({ promptKey: key, promptVersion: version, limit }) }); } catch (error) { return adminFailure(error); }
}

export async function handleEvalDetail(id: string, overrides: Partial<AdminHandlerDependencies> = {}): Promise<Response> {
  const deps = withDefaults(overrides);
  const session = await authenticate(deps);
  if (isResponse(session)) return session;
  if (!ADMIN_UUID.test(id)) return adminError("eval_id_invalid", 400);
  try {
    const evaluation = await deps.readEvalRun(id);
    return evaluation ? adminJson({ eval: evaluation }) : adminError("eval_not_found", 404);
  } catch (error) { return adminFailure(error); }
}

/**
 * The operator roster with its recorded figures.
 *
 * `funded` is `null` — never 0 — while `FEATURE_APPLICATIONS` is off, because
 * with the outcomes surface disabled there is no recorded-outcome source at all
 * and a zero would read as "this operator funded nothing". The surface renders
 * the not-enabled reason against a dash instead, exactly as the Overview strip
 * does for the same flag.
 */
export async function handleTenants(
  flags: { applications: boolean },
  overrides: Partial<AdminHandlerDependencies> = {},
): Promise<Response> {
  const deps = withDefaults(overrides);
  const session = await authenticate(deps);
  if (isResponse(session)) return session;
  try {
    const tenants = await deps.readTenants();
    return adminJson({
      tenants: tenants.map((tenant) => ({
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        plan: tenant.plan,
        membership: tenant.membership,
        startedAt: tenant.startedAt,
        clients: tenant.clients,
        fundingReadyDays: tenant.fundingReadyDays,
        fundedYtdCents: flags.applications ? tenant.fundedYtdCents : null,
        fundedAllTimeCents: flags.applications ? tenant.fundedAllTimeCents : null,
        fundedOutcomes: flags.applications ? tenant.fundedOutcomes : null,
      })),
    });
  } catch (error) { return adminFailure(error); }
}

export async function handleFundedVolume(
  flags: { applications: boolean },
  overrides: Partial<AdminHandlerDependencies> = {},
): Promise<Response> {
  const deps = withDefaults(overrides);
  const session = await authenticate(deps);
  if (isResponse(session)) return session;
  // With the outcomes surface off there is no series, and an empty series is
  // not the same statement as "no funded outcome was recorded" — so say which.
  if (!flags.applications) return adminJson({ enabled: false, monthly: [], weekly: [] });
  try {
    const volume = await deps.readFundedVolume(new Date().toISOString().slice(0, 10));
    return adminJson({ enabled: true, monthly: volume.monthly, weekly: volume.weekly });
  } catch (error) { return adminFailure(error); }
}

export async function handleSaasMetrics(overrides: Partial<AdminHandlerDependencies> = {}): Promise<Response> {
  const deps = withDefaults(overrides);
  const session = await authenticate(deps);
  if (isResponse(session)) return session;
  try { return adminJson({ platformMrrCents: await deps.readPlatformMrrCents() }); } catch (error) { return adminFailure(error); }
}

export async function handlePendingOutcomeReviews(
  flags: { applications: boolean },
  overrides: Partial<AdminHandlerDependencies> = {},
): Promise<Response> {
  const deps = withDefaults(overrides);
  const session = await authenticate(deps);
  if (isResponse(session)) return session;
  if (!flags.applications) return adminJson({ enabled: false, reviews: [] });
  try { return adminJson({ enabled: true, reviews: await deps.readPendingReviews() }); } catch (error) { return adminFailure(error); }
}
