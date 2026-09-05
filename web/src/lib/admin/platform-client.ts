"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Client-side readers for the durable admin analytics endpoints.
 *
 * Every read resolves to one of four states and never collapses two of them:
 * `"loading"` before the first answer, `null` when the route 404s because its
 * flag is off (a known disabled state), `"failed"` for anything else that is
 * not a valid payload — a 5xx, an auth refusal, a network error, or a 200 whose
 * body does not parse — and the payload itself on success. Mapping a failure
 * onto the empty payload is the G-HOST-14 class this file exists to avoid: it
 * would render an outage as a healthy, empty dashboard.
 */

export type AdminRead<T> = T | null | "failed" | "loading";

export type AdminTenantView = {
  id: string;
  name: string;
  slug: string;
  plan: string;
  membership: string;
  startedAt: string;
  clients: number;
  fundingReadyDays: number | null;
  fundedYtdCents: number | null;
  fundedAllTimeCents: number | null;
  fundedOutcomes: number | null;
};

export type AdminFundedSeries = {
  enabled: boolean;
  monthly: readonly { label: string; amountCents: number }[];
  weekly: readonly { label: string; amountCents: number }[];
};

export type AdminReviewView = {
  outcomeId: string;
  clientName: string;
  operatorName: string;
  bankRef: string;
  kind: string;
  amountCents: number | null;
  recordedBy: string | null;
  decidedOn: string;
};

export type AdminReviewQueue = { enabled: boolean; reviews: readonly AdminReviewView[] };

export const ADMIN_HEALTH_STATUSES = ["ok", "degraded", "unknown"] as const;
export type AdminHealthStatusView = (typeof ADMIN_HEALTH_STATUSES)[number];
export type AdminHealthTileView = {
  id: string;
  label: string;
  status: AdminHealthStatusView;
  detail: string;
};
export type AdminHealthView = { tiles: readonly AdminHealthTileView[] };

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const count = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const countOrNull = (value: unknown): value is number | null => value === null || count(value);
const text = (value: unknown): value is string => typeof value === "string";

export function parseAdminTenants(value: unknown): readonly AdminTenantView[] | null {
  if (!record(value) || !Array.isArray(value.tenants)) return null;
  const parsed: AdminTenantView[] = [];
  for (const row of value.tenants) {
    if (!record(row)) return null;
    if (!text(row.id) || !text(row.name) || !text(row.slug) || !text(row.plan)
      || !text(row.membership) || !text(row.startedAt) || !count(row.clients)
      || !countOrNull(row.fundingReadyDays) || !countOrNull(row.fundedYtdCents) || !countOrNull(row.fundedAllTimeCents)
      || !countOrNull(row.fundedOutcomes)) return null;
    parsed.push({
      id: row.id, name: row.name, slug: row.slug, plan: row.plan,
      membership: row.membership, startedAt: row.startedAt, clients: row.clients,
      fundingReadyDays: row.fundingReadyDays,
      fundedYtdCents: row.fundedYtdCents, fundedAllTimeCents: row.fundedAllTimeCents,
      fundedOutcomes: row.fundedOutcomes,
    });
  }
  return parsed;
}

function parseBuckets(value: unknown): readonly { label: string; amountCents: number }[] | null {
  if (!Array.isArray(value)) return null;
  const parsed: { label: string; amountCents: number }[] = [];
  for (const row of value) {
    if (!record(row) || !text(row.label) || !count(row.amountCents)) return null;
    parsed.push({ label: row.label, amountCents: row.amountCents });
  }
  return parsed;
}

export function parseAdminFundedSeries(value: unknown): AdminFundedSeries | null {
  if (!record(value) || typeof value.enabled !== "boolean") return null;
  const monthly = parseBuckets(value.monthly);
  const weekly = parseBuckets(value.weekly);
  if (monthly === null || weekly === null) return null;
  return { enabled: value.enabled, monthly, weekly };
}

export function parseAdminSaasMetrics(value: unknown): { platformMrrCents: number } | null {
  if (!record(value) || !count(value.platformMrrCents)) return null;
  return { platformMrrCents: value.platformMrrCents };
}

export function parseAdminReviewQueue(value: unknown): AdminReviewQueue | null {
  if (!record(value) || typeof value.enabled !== "boolean" || !Array.isArray(value.reviews)) return null;
  const reviews: AdminReviewView[] = [];
  for (const row of value.reviews) {
    if (!record(row)) return null;
    if (!text(row.outcomeId) || !text(row.clientName) || !text(row.operatorName)
      || !text(row.bankRef) || !text(row.kind) || !countOrNull(row.amountCents)
      || !(row.recordedBy === null || text(row.recordedBy)) || !text(row.decidedOn)) return null;
    reviews.push({
      outcomeId: row.outcomeId, clientName: row.clientName, operatorName: row.operatorName,
      bankRef: row.bankRef, kind: row.kind, amountCents: row.amountCents,
      recordedBy: row.recordedBy as string | null, decidedOn: row.decidedOn,
    });
  }
  return { enabled: value.enabled, reviews };
}

/**
 * The System health payload. The status vocabulary is closed, so a body naming
 * a fourth state is a failed read rather than a pill the panel cannot colour.
 */
export function parseAdminHealth(value: unknown): AdminHealthView | null {
  if (!record(value) || !Array.isArray(value.tiles)) return null;
  const tiles: AdminHealthTileView[] = [];
  for (const row of value.tiles) {
    if (!record(row) || !text(row.id) || !text(row.label) || !text(row.detail)) return null;
    if (!ADMIN_HEALTH_STATUSES.includes(row.status as AdminHealthStatusView)) return null;
    tiles.push({ detail: row.detail, id: row.id, label: row.label, status: row.status as AdminHealthStatusView });
  }
  return { tiles };
}

export async function loadAdminResource<T>(
  path: string,
  parse: (value: unknown) => T | null,
  fetcher: typeof fetch = fetch,
): Promise<T | null | "failed"> {
  let response: Response;
  try {
    response = await fetcher(path, { cache: "no-store", credentials: "same-origin" });
  } catch { return "failed"; }
  // The route's flag-off answer. A disabled feature is a known state the
  // surface can name; it is not an outage.
  if (response.status === 404) return null;
  if (!response.ok) return "failed";
  try { return parse(await response.json()) ?? "failed"; } catch { return "failed"; }
}

export function useAdminResource<T>(
  path: string,
  parse: (value: unknown) => T | null,
): { read: AdminRead<T>; reload: () => void } {
  const [read, setRead] = useState<AdminRead<T>>("loading");
  const [generation, setGeneration] = useState(0);
  // A reload returns the panel to `loading` before the request goes out, so a
  // refetch after a write never leaves the previous figures on screen looking
  // like the confirmed result. The state moves in the event handler rather than
  // in the effect body, which keeps the effect a single subscription.
  const reload = useCallback(() => {
    setRead("loading");
    setGeneration((value) => value + 1);
  }, []);
  useEffect(() => {
    let active = true;
    void loadAdminResource(path, parse).then((result) => { if (active) setRead(result); });
    return () => { active = false; };
    // `parse` is a module-scope function in every caller; the path is the key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, generation]);
  return { read, reload };
}

/**
 * The one sentence a panel shows instead of a figure, chosen from the read
 * state. Callers pass the reason that applies when the feature itself is off,
 * because that reason is specific to the figure (recorded outcomes, fee
 * records) rather than to the transport.
 */
export function adminReadReason(read: AdminRead<unknown>, disabledReason: string): string {
  if (read === "loading") return "Loading platform totals";
  if (read === "failed") return "Platform totals unavailable";
  return disabledReason;
}

export const isAdminReady = <T,>(read: AdminRead<T>): read is T =>
  read !== "loading" && read !== "failed" && read !== null;
