import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createOverviewRepository } from "./overview.ts";

type Call = { table: string; filters: string[] };

// A fake that satisfies both query shapes the repo uses: a head count
// (`select(cols, {count, head})` resolving to `{count}`) and a row read
// (`select(cols)` resolving to `{data}`). `counts` seeds head counts by table;
// `rows` seeds row reads by table.
function fakeClient(
  counts: Record<string, number>,
  rows: Record<string, unknown[]>,
  calls: Call[],
) {
  return {
    from(table: string) {
      const call: Call = { table, filters: [] };
      calls.push(call);
      const builder: Record<string, unknown> = {
        select(_columns: string, options?: { count: string; head: boolean }) {
          if (options) {
            call.filters.push(`count:${options.count}:${options.head}`);
            return {
              eq(column: string, value: unknown) { call.filters.push(`eq:${column}:${String(value)}`); return this; },
              not(column: string, operator: string, value: unknown) { call.filters.push(`not:${column}:${operator}:${String(value)}`); return this; },
              then(resolve: (payload: { count: number | null; error: unknown }) => unknown) {
                return Promise.resolve(resolve({ count: counts[table] ?? 0, error: null }));
              },
            };
          }
          call.filters.push("rows");
          return {
            is(column: string, value: unknown) { call.filters.push(`is:${column}:${String(value)}`); return this; },
            then(resolve: (payload: { data: unknown[] | null; error: unknown }) => unknown) {
              return Promise.resolve(resolve({ data: rows[table] ?? [], error: null }));
            },
          };
        },
      };
      return builder as never;
    },
  };
}

describe("admin overview repository", () => {
  it("counts operators excluding the platform intake org, consumers by role, and analysis runs", async () => {
    const calls: Call[] = [];
    const repository = createOverviewRepository(() =>
      fakeClient({ orgs: 2, profiles: 5, analysis_runs: 9 }, {}, calls),
    );
    const result = await repository.readCounts();
    assert.deepEqual(result, { operators: 2, consumers: 5, analyses: 9 });

    const orgs = calls.find((call) => call.table === "orgs");
    assert.ok(orgs?.filters.includes("count:exact:true"), "orgs is not a head count");
    assert.ok(
      orgs?.filters.some((filter) => filter.startsWith("not:brand:cs:") && filter.includes("platform_intake")),
      "operators must exclude the platform intake org by its brand marker",
    );

    const profiles = calls.find((call) => call.table === "profiles");
    assert.ok(profiles?.filters.includes("eq:role:consumer"), "consumers must be filtered to role consumer");

    const analyses = calls.find((call) => call.table === "analysis_runs");
    assert.ok(analyses?.filters.includes("count:exact:true"), "analyses is not a head count");
  });

  it("sums funded cents across every client", async () => {
    const repository = createOverviewRepository(() =>
      fakeClient({}, {
        clients: [
          { funded_amount_cents: 4_000_000 },
          { funded_amount_cents: 500_000 },
          { funded_amount_cents: 0 },
        ],
      }, []),
    );
    assert.equal(await repository.readFundedCents(), 4_500_000);
  });

  it("returns null funded — never 0 — when no client has a recorded outcome", async () => {
    const repository = createOverviewRepository(() =>
      fakeClient({}, { clients: [{ funded_amount_cents: 0 }, { funded_amount_cents: 0 }] }, []),
    );
    assert.equal(await repository.readFundedCents(), null);
  });

  it("sums collected cash across orgs, filtering out reversed payments", async () => {
    const calls: Call[] = [];
    const repository = createOverviewRepository(() =>
      fakeClient({}, {
        fee_payments: [{ amount_cents: 300_000 }, { amount_cents: 50_000 }],
      }, calls),
    );
    assert.equal(await repository.readCashCents(), 350_000);
    const payments = calls.find((call) => call.table === "fee_payments");
    assert.ok(payments?.filters.includes("is:reversed_at:null"), "cash must exclude reversed payments");
  });

  it("throws a coded error when a count read fails", async () => {
    const repository = createOverviewRepository(() => ({
      from() {
        return {
          select() {
            return {
              eq() { return this; },
              not() { return this; },
              is() { return this; },
              then(resolve: (payload: { count: number | null; data: unknown[] | null; error: unknown }) => unknown) {
                return Promise.resolve(resolve({ count: null, data: null, error: { message: "boom" } }));
              },
            };
          },
        } as never;
      },
    }));
    await assert.rejects(repository.readCounts(), /ADMIN_OVERVIEW_.*_FAILED/);
    await assert.rejects(repository.readFundedCents(), /ADMIN_OVERVIEW_FUNDED_FAILED/);
    await assert.rejects(repository.readCashCents(), /ADMIN_OVERVIEW_CASH_FAILED/);
  });
});
