"use client";

import type {
  AffiliateLifecyclePatch,
  AffiliateLifecycleResult,
  AffiliatePaymentStatus,
  AffiliateRosterEntry,
  AffiliateShare,
  AffiliateStatementRow,
  UpdateShareBody,
} from "@/lib/affiliates/types";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAGES = new Set(["onboarding", "optimization", "ready", "applying", "funded", "graduate"]);
const PAYMENT_STATUSES = new Set(["not_ready", "pending", "submitted", "paid"]);

export class OperatorAffiliateClientError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "OperatorAffiliateClientError";
    this.status = status;
  }
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function money(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function rosterEntry(value: unknown): AffiliateRosterEntry | null {
  const row = object(value);
  if (!row || !UUID.test(String(row.affiliateId)) || !UUID.test(String(row.profileId))
    || typeof row.name !== "string" || typeof row.email !== "string"
    || typeof row.referralSlug !== "string" || typeof row.active !== "boolean"
    || !money(row.defaultCommissionBps) || row.defaultCommissionBps > 10_000
    || !money(row.sharedClients) || !money(row.expectedCommissionCents)
    || !money(row.paidCommissionCents)) return null;
  return row as AffiliateRosterEntry;
}

function statementEntry(value: unknown): AffiliateStatementRow | null {
  const row = object(value);
  if (!row || !UUID.test(String(row.affiliateId)) || !UUID.test(String(row.clientId))
    || typeof row.clientName !== "string" || typeof row.startedAt !== "string"
    || typeof row.stage !== "string" || !STAGES.has(row.stage)
    || !money(row.fundedAmountCents) || !money(row.expectedCommissionCents)
    || typeof row.paymentStatus !== "string" || !PAYMENT_STATUSES.has(row.paymentStatus)
    || typeof row.commissionOverride !== "boolean") return null;
  return row as AffiliateStatementRow;
}

function shareEntry(value: unknown): AffiliateShare | null {
  const row = object(value);
  if (!row || !UUID.test(String(row.affiliateId)) || !UUID.test(String(row.clientId))
    || !(row.expectedCommissionCents === null || money(row.expectedCommissionCents))
    || typeof row.paymentStatus !== "string" || !PAYMENT_STATUSES.has(row.paymentStatus)) return null;
  return row as AffiliateShare;
}

async function body(response: Response): Promise<Record<string, unknown>> {
  const value = await response.json().catch(() => null);
  const parsed = object(value);
  if (!response.ok || !parsed) {
    throw new OperatorAffiliateClientError(
      response.status,
      response.status === 403
        ? "Only workspace owners and admins can change affiliate settings."
        : response.status === 404
          ? "Affiliate management is not available for this record."
          : "The affiliate request could not be completed.",
    );
  }
  return parsed;
}

export async function loadOperatorAffiliates(fetcher: Fetcher = fetch): Promise<AffiliateRosterEntry[]> {
  const payload = await body(await fetcher("/api/affiliates", {
    cache: "no-store",
    credentials: "same-origin",
  }));
  if (!Array.isArray(payload.affiliates)) throw new OperatorAffiliateClientError(502, "The affiliate roster response was invalid.");
  const rows = payload.affiliates.map(rosterEntry);
  if (rows.some((row) => row === null)) throw new OperatorAffiliateClientError(502, "The affiliate roster response was invalid.");
  return rows as AffiliateRosterEntry[];
}

export async function loadOperatorAffiliateStatement(
  affiliateId: string,
  fetcher: Fetcher = fetch,
): Promise<AffiliateStatementRow[]> {
  if (!UUID.test(affiliateId)) throw new OperatorAffiliateClientError(400, "The affiliate identifier is invalid.");
  const payload = await body(await fetcher(`/api/affiliates/${encodeURIComponent(affiliateId)}/statement`, {
    cache: "no-store",
    credentials: "same-origin",
  }));
  if (!Array.isArray(payload.statement)) throw new OperatorAffiliateClientError(502, "The affiliate statement response was invalid.");
  const rows = payload.statement.map(statementEntry);
  if (rows.some((row) => row === null)) throw new OperatorAffiliateClientError(502, "The affiliate statement response was invalid.");
  return rows as AffiliateStatementRow[];
}

export async function updateOperatorAffiliateLifecycle(
  affiliateId: string,
  patch: AffiliateLifecyclePatch,
  fetcher: Fetcher = fetch,
): Promise<AffiliateLifecycleResult> {
  if (!UUID.test(affiliateId)) throw new OperatorAffiliateClientError(400, "The affiliate identifier is invalid.");
  const payload = await body(await fetcher(`/api/affiliates/${encodeURIComponent(affiliateId)}`, {
    body: JSON.stringify(patch),
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    method: "PATCH",
  }));
  const row = object(payload.affiliate);
  if (!row || row.affiliateId !== affiliateId || typeof row.active !== "boolean"
    || !money(row.defaultCommissionBps) || row.defaultCommissionBps > 10_000
    || typeof row.changed !== "boolean") {
    throw new OperatorAffiliateClientError(502, "The affiliate update response was invalid.");
  }
  return row as unknown as AffiliateLifecycleResult;
}

export async function shareOperatorAffiliateClient(
  affiliateId: string,
  clientId: string,
  fetcher: Fetcher = fetch,
): Promise<AffiliateShare> {
  if (!UUID.test(affiliateId) || !UUID.test(clientId)) {
    throw new OperatorAffiliateClientError(400, "The affiliate or client identifier is invalid.");
  }
  const payload = await body(await fetcher(`/api/affiliates/${encodeURIComponent(affiliateId)}/share`, {
    body: JSON.stringify({ clientId }),
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  }));
  const share = shareEntry(payload);
  if (share === null || share.affiliateId !== affiliateId || share.clientId !== clientId) {
    throw new OperatorAffiliateClientError(502, "The affiliate share response was invalid.");
  }
  return share;
}

export async function updateOperatorAffiliateShare(
  affiliateId: string,
  clientId: string,
  patch: UpdateShareBody,
  fetcher: Fetcher = fetch,
): Promise<AffiliateShare & { changed: boolean }> {
  if (!UUID.test(affiliateId) || !UUID.test(clientId)) {
    throw new OperatorAffiliateClientError(400, "The affiliate or client identifier is invalid.");
  }
  const payload = await body(await fetcher(
    `/api/affiliates/${encodeURIComponent(affiliateId)}/shares/${encodeURIComponent(clientId)}`,
    {
      body: JSON.stringify(patch),
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    },
  ));
  const share = shareEntry(payload);
  if (share === null || share.affiliateId !== affiliateId || share.clientId !== clientId
    || typeof payload.changed !== "boolean") {
    throw new OperatorAffiliateClientError(502, "The affiliate share response was invalid.");
  }
  return { ...share, changed: payload.changed };
}

export async function unshareOperatorAffiliateClient(
  affiliateId: string,
  clientId: string,
  fetcher: Fetcher = fetch,
): Promise<void> {
  if (!UUID.test(affiliateId) || !UUID.test(clientId)) {
    throw new OperatorAffiliateClientError(400, "The affiliate or client identifier is invalid.");
  }
  const response = await fetcher(`/api/affiliates/${encodeURIComponent(affiliateId)}/share`, {
    body: JSON.stringify({ clientId }),
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    method: "DELETE",
  });
  if (!response.ok) await body(response);
  if (response.status !== 204) {
    throw new OperatorAffiliateClientError(502, "The affiliate unshare response was invalid.");
  }
}

export function affiliatePaymentStatusLabel(status: AffiliatePaymentStatus): string {
  return status === "not_ready" ? "Not ready" : status[0].toUpperCase() + status.slice(1);
}
