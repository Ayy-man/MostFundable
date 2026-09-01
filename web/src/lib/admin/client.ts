import {
  parseClientAdminLayout,
  parseClientEvalRunRow,
  parseClientKpiRollup,
  parseClientPromptActivationDecision,
  parseClientPromptVersionRow,
  parseClientSettingRow,
} from "./client-parsers.ts";

import type { AdminLayoutRow, KpiMetricKey, KpiRollupRow } from "./analytics-types.ts";
import type { EmbeddedPrompt, EvalRunRow, PromptActivationDecision, PromptEvaluationSummary, PromptKey, PromptVersionRow } from "./prompt-types.ts";
import type { GovernedSettingKey, SettingRow } from "./settings-types.ts";

type Fetcher = typeof globalThis.fetch;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function requestJson(path: string, init: RequestInit = {}, fetcher: Fetcher = fetch): Promise<unknown> {
  const response = await fetcher(path, { ...init, cache: "no-store", credentials: "same-origin" });
  if (!response.ok) throw new Error(`ADMIN_HTTP_${response.status}`);
  return response.json();
}

/**
 * Was this read refused because the governed admin surface is switched off?
 *
 * Every `/api/admin/*` route answers 404 when `FEATURE_ADMIN` is off, and
 * `requestJson` turns that into `ADMIN_HTTP_404`. The four governed sections
 * used to collapse it into their generic failure state and tell a platform
 * administrator their data "could not be loaded" — an outage that is not
 * happening, sending them to look for a fault instead of a flag. Nothing about
 * the two situations is the same, so nothing about the two messages should be.
 */
export function adminReadNotEnabled(error: unknown): boolean {
  return error instanceof Error && error.message === "ADMIN_HTTP_404";
}

export async function loadAdminSetting(key: GovernedSettingKey, fetcher?: Fetcher): Promise<SettingRow | null> {
  const value = await requestJson(`/api/admin/settings/${key}`, {}, fetcher);
  if (!record(value) || Object.keys(value).join(",") !== "setting") throw new Error("ADMIN_CLIENT_RESPONSE_INVALID");
  return value.setting === null ? null : parseClientSettingRow(value.setting);
}

export async function saveAdminSetting(key: GovernedSettingKey, settingValue: number, fetcher?: Fetcher): Promise<SettingRow> {
  const value = await requestJson(`/api/admin/settings/${key}`, {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ value: settingValue }),
  }, fetcher);
  if (!record(value) || Object.keys(value).join(",") !== "setting") throw new Error("ADMIN_CLIENT_RESPONSE_INVALID");
  return parseClientSettingRow(value.setting);
}

export async function loadAdminAnalytics(subject: string, day: string, fetcher?: Fetcher): Promise<readonly KpiRollupRow[]> {
  const value = await requestJson(`/api/admin/analytics?subject=${encodeURIComponent(subject)}&day=${encodeURIComponent(day)}`, {}, fetcher);
  if (!record(value) || Object.keys(value).join(",") !== "rollups" || !Array.isArray(value.rollups)) throw new Error("ADMIN_CLIENT_RESPONSE_INVALID");
  return Object.freeze(value.rollups.map(parseClientKpiRollup));
}

export async function loadAdminLayout(fetcher?: Fetcher): Promise<AdminLayoutRow | null> {
  const value = await requestJson("/api/admin/analytics/layout", {}, fetcher);
  if (!record(value) || Object.keys(value).join(",") !== "layout") throw new Error("ADMIN_CLIENT_RESPONSE_INVALID");
  return value.layout === null ? null : parseClientAdminLayout(value.layout);
}

export async function saveAdminLayout(layout: readonly KpiMetricKey[], fetcher?: Fetcher): Promise<AdminLayoutRow> {
  const value = await requestJson("/api/admin/analytics/layout", {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ layout }),
  }, fetcher);
  if (!record(value) || Object.keys(value).join(",") !== "layout") throw new Error("ADMIN_CLIENT_RESPONSE_INVALID");
  return parseClientAdminLayout(value.layout);
}

export type AdminPromptFamily = Readonly<{ key: PromptKey; fallback: EmbeddedPrompt }>;

export async function loadAdminPrompts(fetcher?: Fetcher): Promise<readonly AdminPromptFamily[]> {
  const value = await requestJson("/api/admin/prompts", {}, fetcher);
  if (!record(value) || Object.keys(value).join(",") !== "prompts" || !Array.isArray(value.prompts)) throw new Error("ADMIN_CLIENT_RESPONSE_INVALID");
  return Object.freeze(value.prompts.map((item) => {
    if (!record(item) || typeof item.key !== "string" || !record(item.fallback) ||
        item.fallback.key !== item.key || item.fallback.version !== 1 || typeof item.fallback.body !== "string" || !item.fallback.body.trim()) {
      throw new Error("ADMIN_CLIENT_RESPONSE_INVALID");
    }
    if (item.key !== "funding-readiness-plan" && item.key !== "support-draft") throw new Error("ADMIN_CLIENT_RESPONSE_INVALID");
    return Object.freeze({ key: item.key, fallback: Object.freeze({ key: item.key, version: 1 as const, body: item.fallback.body }) });
  }));
}

export async function loadAdminPromptVersions(key: PromptKey, fetcher?: Fetcher): Promise<readonly PromptVersionRow[]> {
  const value = await requestJson(`/api/admin/prompts/${key}/versions`, {}, fetcher);
  if (!record(value) || Object.keys(value).sort().join(",") !== "key,versions" || value.key !== key || !Array.isArray(value.versions)) throw new Error("ADMIN_CLIENT_RESPONSE_INVALID");
  return Object.freeze(value.versions.map(parseClientPromptVersionRow));
}

export async function createAdminPromptVersion(key: PromptKey, body: string, fetcher?: Fetcher): Promise<PromptVersionRow> {
  const value = await requestJson(`/api/admin/prompts/${key}/versions`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body }),
  }, fetcher);
  if (!record(value) || Object.keys(value).join(",") !== "prompt") throw new Error("ADMIN_CLIENT_RESPONSE_INVALID");
  return parseClientPromptVersionRow(value.prompt);
}

export async function activateAdminPromptVersion(key: PromptKey, version: number, fetcher?: Fetcher): Promise<PromptActivationDecision> {
  const value = await requestJson(`/api/admin/prompts/${key}/activate`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ version }),
  }, fetcher);
  if (!record(value) || Object.keys(value).join(",") !== "activation") throw new Error("ADMIN_CLIENT_RESPONSE_INVALID");
  return parseClientPromptActivationDecision(value.activation);
}

export async function evaluateAdminPromptVersion(key: PromptKey, version: number, fetcher?: Fetcher): Promise<PromptEvaluationSummary> {
  const value = await requestJson(`/api/admin/prompts/${key}/${version}/evaluate`, { method: "POST" }, fetcher);
  if (!record(value) || Object.keys(value).join(",") !== "evaluation" || !record(value.evaluation) ||
      value.evaluation.key !== key || value.evaluation.version !== version || typeof value.evaluation.passed !== "boolean" ||
      (value.evaluation.status !== "completed" && value.evaluation.status !== "held") ||
      !(value.evaluation.reason === null || value.evaluation.reason === "launch_driver_unavailable") ||
      !Array.isArray(value.evaluation.runs)) {
    throw new Error("ADMIN_CLIENT_RESPONSE_INVALID");
  }
  return Object.freeze({
    key,
    version,
    passed: value.evaluation.passed,
    status: value.evaluation.status,
    reason: value.evaluation.reason,
    runs: Object.freeze(value.evaluation.runs.map(parseClientEvalRunRow)),
  });
}

export async function loadAdminEvals(fetcher?: Fetcher): Promise<readonly EvalRunRow[]> {
  const value = await requestJson("/api/admin/evals?limit=100", {}, fetcher);
  if (!record(value) || Object.keys(value).join(",") !== "evals" || !Array.isArray(value.evals)) throw new Error("ADMIN_CLIENT_RESPONSE_INVALID");
  return Object.freeze(value.evals.map(parseClientEvalRunRow));
}
