import "server-only";

/**
 * The durable sources behind the admin surface's deeper analytics: the operator
 * roster with its recorded funded figures, the funded-volume series, and the
 * platform subscription total.
 *
 * Same shape as overview.ts — an injectable `createClient`, the service-scoped
 * admin client by default, cross-tenant on purpose — so the reads stay unit
 * testable against a fake client and there is one place that knows how a
 * platform figure is derived.
 *
 * Aggregation happens in JS rather than in SQL views because every figure here
 * is a sum or a count over a handful of rows, and a view would need a migration
 * this lane is not allowed to write.
 */

import { PLATFORM_INTAKE_MARKER } from "./overview.ts";

export type AdminTenantRow = {
  id: string;
  name: string;
  slug: string;
  plan: string;
  membership: string;
  startedAt: string;
  clients: number;
  // Recorded approved outcomes. `fundedOutcomes` is the count the average
  // divides by, so a tenant with clients but no recorded outcome renders a
  // dash rather than a $0 average.
  fundedYtdCents: number;
  fundedAllTimeCents: number;
  fundedOutcomes: number;
  // Mean days from a client's start date to its first recorded arrival at the
  // `ready` stage. `null` when no client in the workspace has reached it —
  // never 0, which would read as "same day".
  fundingReadyDays: number | null;
};

export type AdminFundedBucket = { label: string; amountCents: number };
export type AdminFundedVolume = {
  monthly: readonly AdminFundedBucket[];
  weekly: readonly AdminFundedBucket[];
};

export type AdminPendingReview = {
  outcomeId: string;
  clientName: string;
  operatorName: string;
  bankRef: string;
  kind: string;
  amountCents: number | null;
  recordedBy: string | null;
  decidedOn: string;
};

type Payload = { data: unknown[] | null; error: unknown };
interface Query extends PromiseLike<Payload> {
  eq(column: string, value: unknown): Query;
  not(column: string, operator: string, value: unknown): Query;
  in(column: string, values: readonly unknown[]): Query;
}
interface Table {
  select(columns: string): Query;
}
type PlatformTable =
  | "orgs"
  | "profiles"
  | "clients"
  | "outcomes"
  | "outcome_reviews"
  | "stage_history";
interface PlatformDb {
  from(table: PlatformTable): Table;
}

async function defaultClient(): Promise<PlatformDb> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient() as unknown as PlatformDb;
}

async function rows(query: Query, code: string): Promise<readonly Record<string, unknown>[]> {
  const { data, error } = await query;
  if (error || !Array.isArray(data)) throw new Error(code);
  return data as Record<string, unknown>[];
}

const text = (row: Record<string, unknown>, column: string): string =>
  typeof row[column] === "string" ? (row[column] as string) : "";

// Cents columns are `bigint` in Postgres and arrive as JS numbers through
// PostgREST. Anything that is not a safe non-negative integer contributes
// nothing rather than poisoning a total with NaN — the same rule overview.ts
// applies to its sums.
const cents = (row: Record<string, unknown>, column: string): number => {
  const value = row[column];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
};

const day = (row: Record<string, unknown>, column: string): string => {
  const value = row[column];
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : "";
};

/**
 * The seat quantity a platform subscription bills for, taken verbatim from
 * `service-operator.ts` / `service-operations.ts` so the admin total and the
 * checkout line item cannot drift: seats above the plan's included allowance,
 * never a negative.
 */
export function billableSeatQuantity(seatCount: number, seatsIncluded: number): number {
  return Math.max(0, seatCount - seatsIncluded);
}

export function weekStarts(today: string, weeks = 5): readonly string[] {
  const dayMs = 86_400_000;
  const end = Date.parse(`${today}T00:00:00Z`);
  return Array.from({ length: weeks }, (_, index) =>
    new Date(end - (weeks - 1 - index) * 7 * dayMs).toISOString().slice(0, 10),
  );
}

export interface PlatformRepository {
  readTenants(): Promise<readonly AdminTenantRow[]>;
  readFundedVolume(today: string): Promise<AdminFundedVolume>;
  readPlatformMrrCents(): Promise<number>;
  readPendingReviews(): Promise<readonly AdminPendingReview[]>;
}

export function createPlatformRepository(
  createClient: () => unknown | Promise<unknown> = defaultClient,
): PlatformRepository {
  let clientPromise: Promise<PlatformDb> | null = null;
  const client = () => (clientPromise ??= Promise.resolve(createClient()).then((value) => value as PlatformDb));

  // Operator tenants are every org that is not the platform intake org, detected
  // exactly as overview.ts detects it so the two counts agree.
  const operatorOrgs = (db: PlatformDb, columns: string) =>
    db.from("orgs").select(columns).not("brand", "cs", PLATFORM_INTAKE_MARKER);

  const countedApprovals = (db: PlatformDb) =>
    db.from("outcomes").select("client_id, amount_cents, decided_on")
      .eq("kind", "approved").eq("state", "counted");

  return {
    async readTenants() {
      const db = await client();
      const [orgRows, clientRows, outcomeRows, readyRows] = await Promise.all([
        rows(
          operatorOrgs(db, "id, name, slug, plan, membership, created_at"),
          "ADMIN_PLATFORM_ORGS_FAILED",
        ),
        rows(
          db.from("clients").select("id, org_id, started_at").eq("status", "active"),
          "ADMIN_PLATFORM_CLIENTS_FAILED",
        ),
        rows(countedApprovals(db), "ADMIN_PLATFORM_OUTCOMES_FAILED"),
        // `ready` is the funding-ready rung of the one stage taxonomy; the
        // first arrival is what "time to optimize" measures, so later
        // re-entries after a step back must not overwrite it.
        rows(
          db.from("stage_history").select("client_id, changed_at").eq("to_stage", "ready"),
          "ADMIN_PLATFORM_STAGES_FAILED",
        ),
      ]);

      const orgOfClient = new Map<string, string>();
      const startedAt = new Map<string, string>();
      const clientCount = new Map<string, number>();
      for (const row of clientRows) {
        const id = text(row, "id");
        const orgId = text(row, "org_id");
        if (!id || !orgId) continue;
        orgOfClient.set(id, orgId);
        const started = day(row, "started_at");
        if (started) startedAt.set(id, started);
        clientCount.set(orgId, (clientCount.get(orgId) ?? 0) + 1);
      }

      const firstReady = new Map<string, string>();
      for (const row of readyRows) {
        const clientId = text(row, "client_id");
        const changed = day(row, "changed_at");
        if (!clientId || !changed) continue;
        const existing = firstReady.get(clientId);
        if (existing === undefined || changed < existing) firstReady.set(clientId, changed);
      }
      const readyDays = new Map<string, { total: number; count: number }>();
      for (const [clientId, reachedOn] of firstReady) {
        const orgId = orgOfClient.get(clientId);
        const started = startedAt.get(clientId);
        if (!orgId || !started) continue;
        const days = Math.round(
          (Date.parse(`${reachedOn}T00:00:00Z`) - Date.parse(`${started}T00:00:00Z`)) / 86_400_000,
        );
        if (!Number.isFinite(days) || days < 0) continue;
        const bucket = readyDays.get(orgId) ?? { total: 0, count: 0 };
        readyDays.set(orgId, { total: bucket.total + days, count: bucket.count + 1 });
      }

      const year = new Date().toISOString().slice(0, 4);
      const ytd = new Map<string, number>();
      const allTime = new Map<string, number>();
      const funded = new Map<string, number>();
      for (const row of outcomeRows) {
        const orgId = orgOfClient.get(text(row, "client_id"));
        if (!orgId) continue;
        const amount = cents(row, "amount_cents");
        allTime.set(orgId, (allTime.get(orgId) ?? 0) + amount);
        funded.set(orgId, (funded.get(orgId) ?? 0) + 1);
        if (day(row, "decided_on").startsWith(year)) ytd.set(orgId, (ytd.get(orgId) ?? 0) + amount);
      }

      return orgRows.map((row) => {
        const id = text(row, "id");
        return {
          id,
          name: text(row, "name"),
          slug: text(row, "slug"),
          plan: text(row, "plan"),
          membership: text(row, "membership"),
          startedAt: day(row, "created_at"),
          clients: clientCount.get(id) ?? 0,
          fundedYtdCents: ytd.get(id) ?? 0,
          fundedAllTimeCents: allTime.get(id) ?? 0,
          fundedOutcomes: funded.get(id) ?? 0,
          fundingReadyDays: (() => {
            const bucket = readyDays.get(id);
            return bucket && bucket.count > 0 ? Math.round(bucket.total / bucket.count) : null;
          })(),
        };
      });
    },

    async readFundedVolume(today) {
      const db = await client();
      const outcomeRows = await rows(countedApprovals(db), "ADMIN_PLATFORM_OUTCOMES_FAILED");

      const byMonth = new Map<string, number>();
      const starts = weekStarts(today);
      const weekly = starts.map((label) => ({ label, amountCents: 0 }));
      const weekEnd = (start: string) => Date.parse(`${start}T00:00:00Z`) + 7 * 86_400_000;

      for (const row of outcomeRows) {
        const decided = day(row, "decided_on");
        if (!decided) continue;
        const amount = cents(row, "amount_cents");
        const month = decided.slice(0, 7);
        byMonth.set(month, (byMonth.get(month) ?? 0) + amount);
        const time = Date.parse(`${decided}T00:00:00Z`);
        for (const bucket of weekly) {
          const start = Date.parse(`${bucket.label}T00:00:00Z`);
          if (time >= start && time < weekEnd(bucket.label)) {
            bucket.amountCents += amount;
            break;
          }
        }
      }

      return {
        monthly: [...byMonth.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([label, amountCents]) => ({ label, amountCents })),
        weekly,
      };
    },

    async readPlatformMrrCents() {
      const db = await client();
      const [orgRows, memberRows] = await Promise.all([
        rows(
          operatorOrgs(db, "id, membership, base_price_cents, seat_price_cents, seats_included"),
          "ADMIN_PLATFORM_ORGS_FAILED",
        ),
        rows(
          db.from("profiles").select("org_id").eq("role", "operator_member"),
          "ADMIN_PLATFORM_SEATS_FAILED",
        ),
      ]);

      const seats = new Map<string, number>();
      for (const row of memberRows) {
        const orgId = text(row, "org_id");
        if (orgId) seats.set(orgId, (seats.get(orgId) ?? 0) + 1);
      }

      // A deactivated workspace is not billed, so it does not belong in a
      // recurring total. Every other membership rung is an open subscription.
      return orgRows
        .filter((row) => text(row, "membership") !== "deactivated")
        .reduce((total, row) => {
          const id = text(row, "id");
          const quantity = billableSeatQuantity(seats.get(id) ?? 0, cents(row, "seats_included"));
          return total + cents(row, "base_price_cents") + quantity * cents(row, "seat_price_cents");
        }, 0);
    },

    async readPendingReviews() {
      const db = await client();
      const reviewRows = await rows(
        db.from("outcome_reviews").select("outcome_id").eq("state", "pending"),
        "ADMIN_PLATFORM_REVIEWS_FAILED",
      );
      const outcomeIds = [...new Set(reviewRows.map((row) => text(row, "outcome_id")).filter(Boolean))];
      if (outcomeIds.length === 0) return [];

      const outcomeRows = await rows(
        db.from("outcomes")
          .select("id, client_id, bank_ref, kind, amount_cents, decided_on, recorded_by")
          .in("id", outcomeIds),
        "ADMIN_PLATFORM_OUTCOMES_FAILED",
      );
      const clientIds = [...new Set(outcomeRows.map((row) => text(row, "client_id")).filter(Boolean))];
      const actorIds = [...new Set(outcomeRows.map((row) => text(row, "recorded_by")).filter(Boolean))];

      const [clientRows, actorRows] = await Promise.all([
        clientIds.length
          ? rows(db.from("clients").select("id, display_name, org_id").in("id", clientIds), "ADMIN_PLATFORM_CLIENTS_FAILED")
          : Promise.resolve([]),
        actorIds.length
          ? rows(db.from("profiles").select("id, full_name").in("id", actorIds), "ADMIN_PLATFORM_ACTORS_FAILED")
          : Promise.resolve([]),
      ]);
      const orgIds = [...new Set(clientRows.map((row) => text(row, "org_id")).filter(Boolean))];
      const orgRows = orgIds.length
        ? await rows(db.from("orgs").select("id, name").in("id", orgIds), "ADMIN_PLATFORM_ORGS_FAILED")
        : [];

      const orgName = new Map(orgRows.map((row) => [text(row, "id"), text(row, "name")]));
      const clientOf = new Map(clientRows.map((row) => [text(row, "id"), row]));
      const actorName = new Map(actorRows.map((row) => [text(row, "id"), text(row, "full_name")]));

      return outcomeRows.map((row) => {
        const owner = clientOf.get(text(row, "client_id"));
        const amount = row.amount_cents;
        return {
          outcomeId: text(row, "id"),
          clientName: owner ? text(owner, "display_name") : "",
          operatorName: owner ? orgName.get(text(owner, "org_id")) ?? "" : "",
          bankRef: text(row, "bank_ref"),
          kind: text(row, "kind"),
          amountCents:
            typeof amount === "number" && Number.isSafeInteger(amount) && amount >= 0 ? amount : null,
          recordedBy: actorName.get(text(row, "recorded_by")) ?? null,
          decidedOn: day(row, "decided_on"),
        };
      });
    },
  };
}
