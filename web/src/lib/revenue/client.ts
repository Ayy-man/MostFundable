"use client";

import { useEffect, useState } from "react";

import { REVENUE_INCOMPLETE_CODES } from "./types.ts";

import type { RevenueIncompleteCode } from "./types.ts";

export type RevenueKpiResponse = {
  complete: boolean;
  enabled: true;
  incompleteCodes: RevenueIncompleteCode[];
  monitoringShareTotalCents: number;
  saasReferralTotalCents: number;
};

/**
 * What a read can resolve to. `null` keeps its original meaning — the feature is
 * off (the route 404s by design) — and `"failed"` is everything else that is not
 * a valid enabled payload: a 5xx, an auth refusal, a network error, or a 200
 * whose body does not parse. The two used to collapse into `null`, which made a
 * failing revenue read indistinguishable from a disabled feature: the screen
 * rendered fixture money with no signal at all (GAPS G-HOST-14). Callers that
 * only choose numbers treat `"failed"` like `null`; the presentation names it.
 */
export type RevenueKpiRead = RevenueKpiResponse | null | "failed";

export type SaasMetrics = {
  monthlyRecurringTotal: number;
  monitoringCost: number;
  monitoringProfit: number;
  monitoringRevenue: number;
  operatorMonitoringSplit: number;
  platformMrr: number;
  referralSplit: number;
};

const cache = new Map<string, Promise<RevenueKpiRead>>();
const codeSet = new Set<string>(REVENUE_INCOMPLETE_CODES);

function currentUtcMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function parseRevenueKpiResponse(value: unknown): RevenueKpiResponse | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const codes = row.incompleteCodes;
  if (
    row.enabled !== true
    || typeof row.complete !== "boolean"
    || typeof row.monitoringShareTotalCents !== "number"
    || !Number.isSafeInteger(row.monitoringShareTotalCents)
    || row.monitoringShareTotalCents < 0
    || typeof row.saasReferralTotalCents !== "number"
    || !Number.isSafeInteger(row.saasReferralTotalCents)
    || row.saasReferralTotalCents < 0
    || !Array.isArray(codes)
    || !codes.every((code): code is RevenueIncompleteCode => typeof code === "string" && codeSet.has(code))
  ) return null;
  return {
    complete: row.complete,
    enabled: true,
    incompleteCodes: [...new Set(codes)].sort(),
    monitoringShareTotalCents: row.monitoringShareTotalCents,
    saasReferralTotalCents: row.saasReferralTotalCents,
  };
}

export function loadRevenueKpis(
  window = currentUtcMonth(),
  fetcher: typeof fetch = fetch,
): Promise<RevenueKpiRead> {
  const existing = cache.get(window);
  if (existing) return existing;
  const pending = fetcher(`/api/revenue/kpis?window=${encodeURIComponent(window)}`, {
    cache: "no-store",
    credentials: "same-origin",
  }).then(async (response): Promise<RevenueKpiRead> => {
    // The route answers 404 with no body when FEATURE_REVENUE is off; that is
    // the one non-ok status that means "disabled" rather than "broken".
    if (response.status === 404) return null;
    if (!response.ok) return "failed";
    // A 200 whose body does not parse is a failure too — the feature is on and
    // the read still did not produce a value anyone should present as real.
    return parseRevenueKpiResponse(await response.json()) ?? "failed";
  }).catch((): RevenueKpiRead => "failed");
  cache.set(window, pending);
  return pending;
}

export function useRevenueKpis(window = currentUtcMonth()): RevenueKpiRead {
  const [result, setResult] = useState<RevenueKpiRead>(null);
  useEffect(() => {
    let current = true;
    void loadRevenueKpis(window).then((value) => {
      if (current) setResult(value);
    });
    return () => { current = false; };
  }, [window]);
  return result;
}

export function selectRevenueMetrics<T extends SaasMetrics>(
  fixture: T,
  live: RevenueKpiRead,
): T {
  // A failed read chooses the same numbers as a disabled feature — the fixture
  // is the only value there is — but never the same words: the presentation
  // below is what stops the two states looking identical on screen.
  if (live === null || live === "failed") return fixture;
  return {
    ...fixture,
    monitoringProfit: live.monitoringShareTotalCents / 100,
    referralSplit: live.saasReferralTotalCents / 100,
  };
}

export function revenuePresentation(live: RevenueKpiRead): {
  complete: boolean;
  enabled: boolean;
  failed: boolean;
  monitoringLabel: string;
  referralLabel: string;
} {
  if (live === "failed") {
    return {
      complete: true,
      enabled: false,
      failed: true,
      monitoringLabel: "Monitoring profit",
      referralLabel: "Referral split",
    };
  }
  return live === null
    ? {
        complete: true,
        enabled: false,
        failed: false,
        monitoringLabel: "Monitoring profit",
        referralLabel: "Referral split",
      }
    : {
        complete: live.complete,
        enabled: true,
        failed: false,
        monitoringLabel: "Monthly monitoring share",
        referralLabel: "Monthly SaaS referral share",
      };
}

export function resetRevenueKpiCacheForTests(): void {
  cache.clear();
}
