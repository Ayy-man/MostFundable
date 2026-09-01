"use client";

import { useEffect, useState } from "react";

import {
  ADMIN_AUDIT_DEFAULT_LIMIT,
  ADMIN_AUDIT_MAX_LIMIT,
  ADMIN_AUDIT_UUID,
  type AdminAuditEvent,
} from "./audit-types.ts";

export type AdminAuditRead = readonly AdminAuditEvent[] | null | "failed" | "loading";

function exactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function nonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function parseAdminAudit(value: unknown): readonly AdminAuditEvent[] | null {
  if (!exactRecord(value, ["events"]) || !Array.isArray(value.events)
      || value.events.length > ADMIN_AUDIT_MAX_LIMIT) return null;
  const events: AdminAuditEvent[] = [];
  for (const item of value.events) {
    if (!exactRecord(item, ["action", "actorName", "id", "occurredAt", "subjectId", "subjectType"])
        || !ADMIN_AUDIT_UUID.test(String(item.id)) || !nonEmptyText(item.action)
        || !(item.actorName === null || nonEmptyText(item.actorName))
        || !nonEmptyText(item.occurredAt) || !Number.isFinite(Date.parse(item.occurredAt))
        || !ADMIN_AUDIT_UUID.test(String(item.subjectId)) || !nonEmptyText(item.subjectType)) return null;
    events.push(Object.freeze({
      action: item.action,
      actorName: item.actorName as string | null,
      id: item.id as string,
      occurredAt: item.occurredAt,
      subjectId: item.subjectId as string,
      subjectType: item.subjectType,
    }));
  }
  return Object.freeze(events);
}

export async function loadAdminAudit(fetcher: typeof fetch = fetch): Promise<Exclude<AdminAuditRead, "loading">> {
  let response: Response;
  try {
    response = await fetcher(`/api/admin/audit?limit=${ADMIN_AUDIT_DEFAULT_LIMIT}`, {
      cache: "no-store",
      credentials: "same-origin",
    });
  } catch {
    return "failed";
  }
  if (response.status === 404) return null;
  if (!response.ok) return "failed";
  try {
    return parseAdminAudit(await response.json()) ?? "failed";
  } catch {
    return "failed";
  }
}

export function useAdminAudit(): AdminAuditRead {
  const [read, setRead] = useState<AdminAuditRead>("loading");
  useEffect(() => {
    let active = true;
    void loadAdminAudit().then((result) => { if (active) setRead(result); });
    return () => { active = false; };
  }, []);
  return read;
}

export const isAdminAuditReady = (read: AdminAuditRead): read is readonly AdminAuditEvent[] =>
  read !== null && read !== "loading" && read !== "failed";
