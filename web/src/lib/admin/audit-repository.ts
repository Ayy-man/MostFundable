import "server-only";

import {
  ADMIN_AUDIT_MAX_LIMIT,
  ADMIN_AUDIT_UUID,
  type AdminAuditEvent,
} from "./audit-types.ts";

type Payload = { data: unknown[] | null; error: unknown };

interface AuditQuery extends PromiseLike<Payload> {
  limit(value: number): AuditQuery;
  order(column: string, options: { ascending: boolean }): AuditQuery;
}

interface ProfileQuery extends PromiseLike<Payload> {
  in(column: string, values: readonly string[]): ProfileQuery;
}

interface AuditDatabase {
  from(table: "audit_log"): { select(columns: string): AuditQuery };
  from(table: "profiles"): { select(columns: string): ProfileQuery };
}

type SourceAuditRow = Readonly<{
  action: string;
  actorProfileId: string | null;
  id: string;
  occurredAt: string;
  subjectId: string;
  subjectType: string;
}>;

async function defaultClient(): Promise<AuditDatabase> {
  // Admin routes authenticate the platform role before constructing their
  // cross-tenant repository, then use the same service-scoped client as the
  // overview and platform repositories. This also supports the governed demo
  // session, whose selected profile is not a Supabase Auth bearer identity.
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient() as unknown as AuditDatabase;
}

function nonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function sourceRow(value: unknown): SourceAuditRow | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (!ADMIN_AUDIT_UUID.test(String(row.id)) || !nonEmptyText(row.action)
      || !nonEmptyText(row.subject_type) || !ADMIN_AUDIT_UUID.test(String(row.subject_id))
      || !nonEmptyText(row.occurred_at) || !Number.isFinite(Date.parse(row.occurred_at))) return null;
  if (!(row.actor_profile_id === null || ADMIN_AUDIT_UUID.test(String(row.actor_profile_id)))) return null;
  return {
    action: row.action,
    actorProfileId: row.actor_profile_id as string | null,
    id: row.id as string,
    occurredAt: row.occurred_at,
    subjectId: row.subject_id as string,
    subjectType: row.subject_type,
  };
}

async function rows(query: PromiseLike<Payload>, code: string): Promise<readonly unknown[]> {
  const { data, error } = await query;
  if (error || !Array.isArray(data)) throw new Error(code);
  return data;
}

export interface AuditRepository {
  list(limit?: number): Promise<readonly AdminAuditEvent[]>;
}

export function createAuditRepository(
  createClient: () => unknown | Promise<unknown> = defaultClient,
): AuditRepository {
  let clientPromise: Promise<AuditDatabase> | null = null;
  const client = () => (clientPromise ??= Promise.resolve(createClient()).then((value) => value as AuditDatabase));

  return {
    async list(limit = ADMIN_AUDIT_MAX_LIMIT) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > ADMIN_AUDIT_MAX_LIMIT) {
        throw new Error("ADMIN_AUDIT_LIMIT_INVALID");
      }

      const db = await client();
      const rawEvents = await rows(
        db.from("audit_log")
          .select("id, action, subject_type, subject_id, occurred_at, actor_profile_id")
          .order("occurred_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(limit),
        "ADMIN_AUDIT_READ_FAILED",
      );
      const events = rawEvents.map(sourceRow);
      if (events.some((event) => event === null)) throw new Error("ADMIN_AUDIT_ROW_INVALID");
      const validEvents = events as SourceAuditRow[];

      const actorIds = [...new Set(validEvents.flatMap((event) =>
        event.actorProfileId === null ? [] : [event.actorProfileId]))];
      const names = new Map<string, string>();
      if (actorIds.length > 0) {
        const profiles = await rows(
          db.from("profiles").select("id, full_name").in("id", actorIds),
          "ADMIN_AUDIT_ACTORS_FAILED",
        );
        for (const value of profiles) {
          if (typeof value !== "object" || value === null || Array.isArray(value)) {
            throw new Error("ADMIN_AUDIT_ACTOR_ROW_INVALID");
          }
          const profile = value as Record<string, unknown>;
          if (!ADMIN_AUDIT_UUID.test(String(profile.id))) throw new Error("ADMIN_AUDIT_ACTOR_ROW_INVALID");
          // A blank or missing display name stays unknown; no fallback reaches
          // for the profile's email address because it was never selected.
          if (nonEmptyText(profile.full_name)) names.set(profile.id as string, profile.full_name.trim());
        }
      }

      return Object.freeze(validEvents.map((event) => Object.freeze({
        action: event.action,
        actorName: event.actorProfileId === null ? null : names.get(event.actorProfileId) ?? null,
        id: event.id,
        occurredAt: event.occurredAt,
        subjectId: event.subjectId,
        subjectType: event.subjectType,
      })));
    },
  };
}
