import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

import { billableSeatQuantity, createPlatformRepository, weekStarts } from "./platform.ts";

type Row = Record<string, unknown>;

/**
 * A fake PostgREST client that actually applies the filters, so a repository
 * that forgets `.eq("state", "counted")` counts a tombstoned outcome here and
 * fails, rather than passing against a stub that returns every row regardless.
 */
function fakeClient(tables: Record<string, Row[]>) {
  const query = (rows: Row[]) => {
    const chain = {
      eq(column: string, value: unknown) { return query(rows.filter((row) => row[column] === value)); },
      in(column: string, values: readonly unknown[]) { return query(rows.filter((row) => values.includes(row[column]))); },
      not(column: string, operator: string, value: unknown) {
        // The only `not` this repository uses is the platform-intake marker
        // containment check; mirror it rather than accepting anything.
        assert.equal(operator, "cs");
        const marker = JSON.parse(value as string) as Row;
        return query(rows.filter((row) => {
          const brand = (row[column] ?? {}) as Row;
          return !Object.entries(marker).every(([key, expected]) => brand[key] === expected);
        }));
      },
      then<T>(resolve: (payload: { data: Row[]; error: null }) => T) { return Promise.resolve(resolve({ data: rows, error: null })); },
    };
    return chain;
  };
  return { from: (table: string) => ({ select: () => query(tables[table] ?? []) }) };
}

const YEAR = new Date().toISOString().slice(0, 4);

const BASE = {
  orgs: [
    { id: "org-a", name: "Alpha", slug: "alpha", plan: "agency", membership: "current", created_at: "2025-09-12T00:00:00Z", base_price_cents: 49_700, seat_price_cents: 2_900, seats_included: 5, brand: {} },
    { id: "org-b", name: "Beta", slug: "beta", plan: "pro", membership: "deactivated", created_at: "2026-01-08T00:00:00Z", base_price_cents: 24_900, seat_price_cents: 2_900, seats_included: 3, brand: {} },
    { id: "org-intake", name: "Intake", slug: "intake", plan: "trial", membership: "trial", created_at: "2026-01-01T00:00:00Z", base_price_cents: 49_700, seat_price_cents: 2_900, seats_included: 0, brand: { platform_intake: true } },
  ],
  clients: [
    { id: "c1", org_id: "org-a", started_at: "2026-01-01", status: "active" },
    { id: "c2", org_id: "org-a", started_at: "2026-02-01", status: "active" },
    { id: "c3", org_id: "org-b", started_at: "2026-03-01", status: "active" },
    { id: "c-reset", org_id: "org-a", started_at: "2026-01-15", status: "archived" },
  ],
  outcomes: [
    { id: "o1", client_id: "c1", bank_ref: "amex-business", kind: "approved", state: "counted", amount_cents: 4_500_000, decided_on: `${YEAR}-03-04`, recorded_by: "p1" },
    { id: "o2", client_id: "c2", bank_ref: "bluevine", kind: "approved", state: "counted", amount_cents: 1_000_000, decided_on: "2024-05-06", recorded_by: "p1" },
    // Neither of these may reach a total: one is a tombstone, one is a denial.
    { id: "o3", client_id: "c1", bank_ref: "amex-business", kind: "approved", state: "removed", amount_cents: 9_900_000, decided_on: `${YEAR}-03-05`, recorded_by: "p1" },
    { id: "o4", client_id: "c3", bank_ref: "amex-business", kind: "denied", state: "counted", amount_cents: null, decided_on: `${YEAR}-03-06`, recorded_by: "p1" },
  ],
  profiles: [
    { id: "p1", org_id: "org-a", role: "operator_member", full_name: "Ada Operator" },
    { id: "p2", org_id: "org-a", role: "operator_member", full_name: "Bea Operator" },
    { id: "p3", org_id: "org-a", role: "operator_member", full_name: "Cy Operator" },
    { id: "p4", org_id: "org-a", role: "operator_member", full_name: "Di Operator" },
    { id: "p5", org_id: "org-a", role: "operator_member", full_name: "Ed Operator" },
    { id: "p6", org_id: "org-a", role: "operator_member", full_name: "Fay Operator" },
    { id: "p7", org_id: "org-a", role: "consumer", full_name: "Not A Seat" },
  ],
  stage_history: [
    { client_id: "c1", to_stage: "ready", changed_at: "2026-01-21T00:00:00Z" },
    { client_id: "c1", to_stage: "ready", changed_at: "2026-04-01T00:00:00Z" },
    { client_id: "c2", to_stage: "optimization", changed_at: "2026-02-05T00:00:00Z" },
  ],
  outcome_reviews: [
    { outcome_id: "o1", state: "pending" },
    { outcome_id: "o2", state: "approved" },
  ],
};

const repository = (tables: Record<string, Row[]> = BASE) =>
  createPlatformRepository(() => fakeClient(tables));

describe("the platform repository totals what the database records", () => {
  it("excludes the platform intake org from the operator roster", async () => {
    const tenants = await repository().readTenants();
    assert.deepEqual(tenants.map((tenant) => tenant.id), ["org-a", "org-b"]);
  });

  it("counts the same active client book the operator tracker exposes", async () => {
    const [alpha, beta] = await repository().readTenants();
    assert.equal(alpha.clients, 2);
    assert.equal(beta.clients, 1);
  });

  it("counts only counted approved outcomes, and only this year's toward YTD", async () => {
    const [alpha] = await repository().readTenants();
    // Derived from the fixture rows rather than transcribed: every row that is
    // approved, counted and owned by an org-a client.
    const owned = new Set(BASE.clients.filter((client) => client.org_id === "org-a").map((client) => client.id));
    const eligible = BASE.outcomes.filter((row) =>
      row.kind === "approved" && row.state === "counted" && owned.has(row.client_id as string));
    assert.equal(
      alpha.fundedAllTimeCents,
      eligible.reduce((total, row) => total + (row.amount_cents as number), 0),
    );
    assert.equal(
      alpha.fundedYtdCents,
      eligible.filter((row) => (row.decided_on as string).startsWith(YEAR))
        .reduce((total, row) => total + (row.amount_cents as number), 0),
    );
    assert.equal(alpha.fundedOutcomes, eligible.length);
  });

  it("measures time to funding-ready from the first arrival, and reports none as null", async () => {
    const [alpha, beta] = await repository().readTenants();
    // c1 started 2026-01-01 and first reached ready on 2026-01-21; the later
    // re-entry must not move the figure. c2 never reached ready.
    assert.equal(alpha.fundingReadyDays, 20);
    assert.equal(beta.fundingReadyDays, null);
  });

  it("bills base plus seats above the included allowance, and never a deactivated workspace", async () => {
    const total = await repository().readPlatformMrrCents();
    // org-a has six operator members against five included seats; org-b is
    // deactivated and org-intake is not an operator tenant.
    assert.equal(total, 49_700 + 1 * 2_900);
  });

  it("keeps the seat rule identical to the one the checkout line item uses", () => {
    const service = fs.readFileSync(new URL("../billing/service-operator.ts", import.meta.url), "utf8");
    assert.ok(
      service.includes("Math.max(0, profile.seatCount - (profile.seatsIncluded ?? 0))"),
      "the checkout seat rule moved — re-derive billableSeatQuantity against it",
    );
    assert.equal(billableSeatQuantity(6, 5), 1);
    assert.equal(billableSeatQuantity(2, 5), 0);
  });

  it("buckets funded volume by month and by the trailing five weeks", async () => {
    const volume = await repository().readFundedVolume(`${YEAR}-03-10`);
    assert.deepEqual(volume.monthly, [
      { label: "2024-05", amountCents: 1_000_000 },
      { label: `${YEAR}-03`, amountCents: 4_500_000 },
    ]);
    assert.deepEqual(volume.weekly.map((bucket) => bucket.label), weekStarts(`${YEAR}-03-10`));
    assert.equal(volume.weekly.reduce((total, bucket) => total + bucket.amountCents, 0), 4_500_000);
  });

  it("enriches only pending reviews, and names the client, operator and actor", async () => {
    const reviews = await repository().readPendingReviews();
    assert.deepEqual(reviews, [{
      outcomeId: "o1",
      clientName: "",
      operatorName: "Alpha",
      bankRef: "amex-business",
      kind: "approved",
      amountCents: 4_500_000,
      recordedBy: "Ada Operator",
      decidedOn: `${YEAR}-03-04`,
    }]);
  });

  it("raises rather than returning a zero when a read fails", async () => {
    const broken = createPlatformRepository(() => ({
      from: () => ({ select: () => ({
        eq() { return this; }, in() { return this; }, not() { return this; },
        then: <T,>(resolve: (payload: { data: null; error: unknown }) => T) =>
          Promise.resolve(resolve({ data: null, error: new Error("down") })),
      }) }),
    }));
    await assert.rejects(() => broken.readPlatformMrrCents(), /ADMIN_PLATFORM_/);
    await assert.rejects(() => broken.readTenants(), /ADMIN_PLATFORM_/);
  });
});
