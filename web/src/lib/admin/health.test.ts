import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildAdminHealth,
  createHealthRepository,
  databaseTile,
  driversTile,
  jobQueueTile,
  readAdminHealth,
  readEnvDrivers,
} from "./health.ts";

const NOW = new Date("2026-09-05T12:00:00.000Z");
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

type Call = { table: string; steps: string[] };

/**
 * A fake Supabase client covering both shapes the repository uses: a head count
 * that resolves to `{ count }` and a row read that resolves to `{ data }`.
 * `rows` seeds the row read and `counts` the head count; either can be replaced
 * by an error to exercise the unreadable branch.
 */
function fakeClient(
  seed: { counts?: Record<string, number>; rows?: unknown[]; countError?: unknown; rowError?: unknown },
  calls: Call[] = [],
) {
  return {
    calls,
    client: {
      from(table: string) {
        const call: Call = { table, steps: [] };
        calls.push(call);
        const counting = {
          eq(column: string, value: unknown) { call.steps.push(`eq:${column}:${String(value)}`); return this; },
          gte(column: string, value: unknown) { call.steps.push(`gte:${column}:${String(value)}`); return this; },
          then(resolve: (payload: { count: number | null; error: unknown }) => unknown) {
            return Promise.resolve(resolve({ count: seed.counts?.[table] ?? 0, error: seed.countError ?? null }));
          },
        };
        const reading = {
          in(column: string, values: readonly unknown[]) { call.steps.push(`in:${column}:${values.join("|")}`); return this; },
          order(column: string, options: { ascending: boolean }) { call.steps.push(`order:${column}:${options.ascending}`); return this; },
          limit(count: number) { call.steps.push(`limit:${count}`); return this; },
          then(resolve: (payload: { data: unknown[] | null; error: unknown }) => unknown) {
            return Promise.resolve(resolve({ data: seed.rows ?? [], error: seed.rowError ?? null }));
          },
        };
        return {
          select(_columns: string, options?: { count: string; head: boolean }) {
            call.steps.push(options ? `count:${options.count}:${options.head}` : "rows");
            return options ? counting : reading;
          },
        } as never;
      },
    },
  };
}

describe("admin health tiles", () => {
  it("reports the database from whether a trivial read answered", () => {
    assert.equal(databaseTile(true).status, "ok");
    assert.equal(databaseTile(false).status, "degraded");
    assert.equal(databaseTile(null).status, "unknown");
    // The failing detail is a fixed sentence: a database error's own text can
    // carry a connection string, and this body reaches a browser.
    assert.equal(databaseTile(false).detail.includes("://"), false);
  });

  it("calls a completed tick under thirty minutes old healthy and an older one degraded", () => {
    const fresh = jobQueueTile({ failedLast24h: 0, lastCompletedAt: minutesAgo(4) }, NOW);
    assert.equal(fresh.status, "ok");
    assert.match(fresh.detail, /4 minutes ago/);
    assert.match(fresh.detail, /no failures in the last 24 hours/);

    // The boundary itself is still healthy; a minute past it is not.
    assert.equal(jobQueueTile({ failedLast24h: 0, lastCompletedAt: minutesAgo(30) }, NOW).status, "ok");
    const stale = jobQueueTile({ failedLast24h: 3, lastCompletedAt: minutesAgo(31) }, NOW);
    assert.equal(stale.status, "degraded");
    assert.match(stale.detail, /past the 30-minute threshold/);
    assert.match(stale.detail, /3 failures in the last 24 hours/);
  });

  it("says unknown when no tick has ever completed, and still counts recent failures", () => {
    const tile = jobQueueTile({ failedLast24h: 1, lastCompletedAt: null }, NOW);
    assert.equal(tile.status, "unknown");
    assert.match(tile.detail, /No background job has completed yet/);
    assert.match(tile.detail, /1 failure in the last 24 hours/);
    // An unreadable queue is not the same claim as an empty one.
    assert.equal(jobQueueTile(null, NOW).status, "unknown");
    assert.match(jobQueueTile(null, NOW).detail, /could not be read/);
  });

  it("degrades the driver tile while any service is still on a mock", () => {
    const tile = driversTile([
      { driver: "stripe", live: true, service: "billing" },
      { driver: "mock", live: false, service: "crs" },
    ]);
    assert.equal(tile.status, "degraded");
    assert.match(tile.detail, /Mock: crs/);
    assert.match(tile.detail, /live: billing \(stripe\)/);

    assert.equal(driversTile([{ driver: "resend", live: true, service: "email" }]).status, "ok");
    assert.equal(driversTile(null).status, "unknown");
  });

  it("names the six services and never the environment values that select them", () => {
    const drivers = readEnvDrivers({
      AI_DRIVER: "openrouter",
      BILLING_DRIVER: "",
      CRS_DRIVER: "",
      EMAIL_DRIVER: "",
      OPENROUTER_API_KEY: "sk-live-not-a-real-key",
      PLAN_DRIVER: "",
    });
    assert.deepEqual(drivers?.map((entry) => entry.service), [
      "billing", "email", "crs", "plan", "narrative", "assistant",
    ]);
    assert.deepEqual(drivers?.filter((entry) => entry.live).map((entry) => entry.service), ["assistant"]);
    assert.equal(driversTile(drivers).detail.includes("sk-live"), false);
  });

  it("resolves to unknown rather than reporting a misconfiguration's key names", () => {
    // The error a bad selector throws names environment keys, so the tile has
    // to swallow it rather than carry it into an HTTP body.
    assert.equal(readEnvDrivers({ BILLING_DRIVER: "not-a-driver" }), null);
    assert.equal(readEnvDrivers({ BILLING_DRIVER: "stripe" }), null);
  });
});

describe("admin health repository", () => {
  it("pings the database with a head count and reports a refusal as false", async () => {
    const calls: Call[] = [];
    const ok = createHealthRepository(() => fakeClient({ counts: { orgs: 4 } }, calls).client);
    assert.equal(await ok.pingDatabase(), true);
    assert.deepEqual(calls[0], { steps: ["count:exact:true"], table: "orgs" });

    const refused = createHealthRepository(() => fakeClient({ countError: { code: "42501" } }).client);
    assert.equal(await refused.pingDatabase(), false);
    const thrown = createHealthRepository(() => { throw new Error("no client"); });
    assert.equal(await thrown.pingDatabase(), false);
  });

  it("takes the newest succeeded or skipped tick and the failures of the last 24 hours", async () => {
    const calls: Call[] = [];
    const repository = createHealthRepository(() =>
      fakeClient(
        { counts: { background_jobs: 2 }, rows: [{ completed_at: minutesAgo(6) }] },
        calls,
      ).client,
    );
    const pulse = await repository.readJobPulse(NOW);
    assert.deepEqual(pulse, { failedLast24h: 2, lastCompletedAt: minutesAgo(6) });

    const newest = calls.find((call) => call.steps.includes("rows"));
    assert.ok(newest?.steps.includes("in:status:succeeded|skipped"), "a failed tick is not a completed tick");
    assert.ok(newest?.steps.includes("order:completed_at:false"));
    assert.ok(newest?.steps.includes("limit:1"));

    const failures = calls.find((call) => call.steps.includes("count:exact:true"));
    assert.ok(failures?.steps.includes("eq:status:failed"));
    assert.ok(
      failures?.steps.some((step) => step.startsWith("gte:completed_at:")
        && step.endsWith(new Date(NOW.getTime() - 24 * 60 * 60 * 1000).toISOString())),
      "the failure count must be bounded to the last 24 hours",
    );
  });

  it("returns no pulse at all when either half of the read refuses", async () => {
    const rowFailed = createHealthRepository(() => fakeClient({ rowError: { code: "42501" } }).client);
    assert.equal(await rowFailed.readJobPulse(NOW), null);
    const countFailed = createHealthRepository(() => fakeClient({ countError: { code: "42501" } }).client);
    assert.equal(await countFailed.readJobPulse(NOW), null);
  });
});

describe("admin health payload", () => {
  it("carries exactly the three checks, in order", () => {
    const health = buildAdminHealth({
      database: true,
      drivers: [{ driver: "mock", live: false, service: "billing" }],
      jobs: { failedLast24h: 0, lastCompletedAt: minutesAgo(1) },
      now: NOW,
    });
    assert.deepEqual(health.tiles.map((tile) => tile.id), ["database", "jobs", "drivers"]);
    assert.deepEqual(health.tiles.map((tile) => tile.status), ["ok", "ok", "degraded"]);
  });

  it("composes the reads through injected dependencies against one clock", async () => {
    const clocks: Date[] = [];
    const health = await readAdminHealth({
      now: () => NOW,
      pingDatabase: async () => true,
      readDrivers: () => [{ driver: "stripe", live: true, service: "billing" }],
      readJobPulse: async (now) => {
        clocks.push(now);
        return { failedLast24h: 0, lastCompletedAt: minutesAgo(90) };
      },
    });
    assert.deepEqual(clocks, [NOW], "the queue read must share the clock the tile is judged against");
    assert.deepEqual(health.tiles.map((tile) => tile.status), ["ok", "degraded", "ok"]);
    assert.match(health.tiles[1].detail, /1 hour old/);
  });
});
