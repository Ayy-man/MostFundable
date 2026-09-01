import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { guardDecision } from "./route-guard";

/**
 * Derived, not transcribed (the round-5 standard): the paths under test come
 * from `vercel.json` at test time, so registering a new cron and forgetting the
 * guard fails here instead of failing in production as a 307 to /sign-in.
 */
const vercelConfig = JSON.parse(
  readFileSync(new URL("../../../vercel.json", import.meta.url), "utf8"),
) as { crons?: Array<{ path: string }> };
const cronPaths = (vercelConfig.crons ?? []).map((cron) => cron.path);

describe("guardDecision and machine callers", () => {
  it("has at least one cron path to protect", () => {
    assert.ok(cronPaths.length >= 1, "vercel.json lost its crons block");
  });

  /**
   * Vercel cron invokes these paths with `Authorization: Bearer CRON_SECRET`
   * and no Supabase session — there is no browser and nothing to sign in.
   * Found live on 2026-08-19, the first night FEATURE_REAL_AUTH ran in
   * production: the proxy 307'd the tick to /sign-in before the route's own
   * bearer check could run, so no cron could ever drain a job on the flipped
   * deployment. The route still enforces its own secret; the guard's only job
   * is to stand aside.
   */
  it("lets every registered cron path through without a session", () => {
    for (const path of cronPaths) {
      assert.equal(
        guardDecision({ hasSession: false, pathname: path }),
        null,
        `${path} is a registered cron and must reach its own bearer auth, not /sign-in`,
      );
    }
  });

  it("still redirects a sessionless caller everywhere else", () => {
    for (const pathname of ["/operator", "/api/clients", "/api/revenue/kpis"]) {
      assert.deepEqual(guardDecision({ hasSession: false, pathname }), {
        redirectTo: "/sign-in",
      });
    }
  });

  it("allows recovery and legal pages without a session", () => {
    for (const pathname of [
      "/forgot-password",
      "/reset-password",
      "/privacy",
      "/terms",
      "/api/auth/request-password-reset",
    ]) {
      assert.equal(guardDecision({ hasSession: false, pathname }), null);
    }
  });

  /**
   * The exemption is exact-match on purpose: a sibling under the same segment
   * (run-now is session-authenticated) must stay guarded, so a prefix rule
   * would quietly widen the machine door.
   */
  it("does not widen the exemption to siblings of a cron path", () => {
    for (const path of cronPaths) {
      const sibling = `${path.slice(0, path.lastIndexOf("/"))}/run-now`;
      if (cronPaths.includes(sibling)) continue;
      assert.deepEqual(guardDecision({ hasSession: false, pathname: sibling }), {
        redirectTo: "/sign-in",
      });
    }
  });
});
