import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { OptimizationDataError } from "@/lib/optimization/read.ts";
import {
  CONSUMER_REPORTABLE_TEMPLATE_KEY_BY_FACTOR_KEY,
  CONSUMER_REPORT_ACTIONS_V1,
} from "@/lib/optimization/map.ts";
import { OptimizationReportError } from "@/lib/optimization/report.ts";
import { handleOptimizationReport, type OptimizationReportDependencies } from "./handler.ts";

import type { SessionProfile } from "@/lib/auth/session";
import type { OptimizationReportRequest } from "@/lib/optimization/report.ts";
import type { ConsumerOptimizationV1 } from "@/lib/optimization/types.ts";

const REPO = path.resolve(process.cwd(), "..");

/**
 * Comments are stripped before the source assertions run. The module documents the rules it obeys,
 * and a scan of the raw text would report that explanation as the violation.
 */
const source = fs
  .readFileSync(path.resolve(process.cwd(), "src/app/api/optimization/report/route.ts"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^[ \t]*\/\/.*$/gm, "");

const migration = fs.readFileSync(
  path.join(REPO, "supabase/migrations/391_consumer_checklist_reporting.sql"),
  "utf8",
);

const CONSUMER: SessionProfile = {
  disabledAt: null,
  id: "a2000000-0000-0000-0000-000000000002",
  manages: [],
  orgId: "a0000000-0000-0000-0000-000000000001",
  orgMembership: null,
  orgRole: null,
  role: "consumer",
};

const VIEW = {
  analysis: null,
  clientId: "a3000000-0000-0000-0000-000000000002",
  estimatedCompletion: { days: null, label: "TBD" },
  provenance: "none",
  readiness: null,
  readinessLabel: null,
  reporting: { enabled: true },
  schemaVersion: 1,
  tracks: {
    business: { factors: [], kind: "business_setup", rollup: null, total: 0, verifiedCount: 0 },
    personal: { factors: [], kind: "personal_credit", rollup: null, total: 0, verifiedCount: 0 },
  },
  utilization: null,
} as unknown as ConsumerOptimizationV1;

/** A factor key the platform really does accept, taken from the table rather than typed here. */
const REPORTABLE_KEY = Object.keys(CONSUMER_REPORTABLE_TEMPLATE_KEY_BY_FACTOR_KEY)[0];

class FakeAuthError extends Error {
  readonly status: number;
  constructor(status: number) {
    super("auth");
    this.status = status;
  }
}

function dependencies(
  overrides: Partial<OptimizationReportDependencies> = {},
): OptimizationReportDependencies {
  return {
    async readBody() {
      return { action: "report", factorKey: REPORTABLE_KEY };
    },
    async readConsumerOptimization() {
      return VIEW;
    },
    recordFailure() {
      return "correlation-id-1";
    },
    async reportChecklistItem() {},
    async requireConsumer() {
      return CONSUMER;
    },
    ...overrides,
  };
}

describe("POST /api/optimization/report", () => {
  it("writes, then answers with the freshly re-read view and a private, uncacheable body", async () => {
    const seen: OptimizationReportRequest[] = [];
    const response = await handleOptimizationReport(
      dependencies({
        async reportChecklistItem(request) {
          seen.push(request);
        },
      }),
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.deepEqual(await response.json(), { data: VIEW });
    assert.deepEqual(seen, [{ action: "report", factorKey: REPORTABLE_KEY }]);
  });

  it("accepts undo as well as report", async () => {
    const seen: OptimizationReportRequest[] = [];
    const response = await handleOptimizationReport(
      dependencies({
        async readBody() {
          return { action: "undo", factorKey: REPORTABLE_KEY };
        },
        async reportChecklistItem(request) {
          seen.push(request);
        },
      }),
    );

    assert.equal(response.status, 200);
    assert.deepEqual(seen, [{ action: "undo", factorKey: REPORTABLE_KEY }]);
  });

  it("answers 400 for a body that is not a report request, and writes nothing", async () => {
    const bodies: unknown[] = [
      null,
      "report",
      {},
      { action: "report" },
      { factorKey: REPORTABLE_KEY },
      { action: "verify", factorKey: REPORTABLE_KEY },
      { action: "report", factorKey: 7 },
      { action: "report", factorKey: "personal_information_confirmed" },
    ];

    for (const body of bodies) {
      let wrote = false;
      const response = await handleOptimizationReport(
        dependencies({
          async readBody() {
            return body;
          },
          async reportChecklistItem() {
            wrote = true;
          },
        }),
      );

      assert.equal(response.status, 400, `body accepted: ${JSON.stringify(body)}`);
      assert.equal((await response.json()).error.code, "invalid_request");
      assert.equal(wrote, false, `body reached the database: ${JSON.stringify(body)}`);
    }
  });

  it("answers 400 when the request carries no readable body at all", async () => {
    const response = await handleOptimizationReport(
      dependencies({
        async readBody() {
          throw new SyntaxError("Unexpected end of JSON input");
        },
      }),
    );

    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "invalid_request");
  });

  it("answers 401 when there is no session, before it reads a body", async () => {
    let readBody = false;
    const response = await handleOptimizationReport(
      dependencies({
        async readBody() {
          readBody = true;
          return {};
        },
        async requireConsumer() {
          throw new FakeAuthError(401);
        },
      }),
    );

    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, "session_required");
    assert.equal(readBody, false, "an unauthenticated request had its body parsed");
  });

  it("answers 403 for an operator or admin session", async () => {
    const response = await handleOptimizationReport(
      dependencies({
        async requireConsumer() {
          throw new FakeAuthError(403);
        },
      }),
    );

    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, "role_forbidden");
  });

  it("answers 403 when the write itself refuses the role or the flag state", async () => {
    const response = await handleOptimizationReport(
      dependencies({
        async reportChecklistItem() {
          throw new OptimizationReportError("forbidden");
        },
      }),
    );

    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, "role_forbidden");
  });

  it("answers 409, and records nothing as a failure, when the transition is refused", async () => {
    const recorded: unknown[] = [];
    const response = await handleOptimizationReport(
      dependencies({
        recordFailure(input) {
          recorded.push(input);
          return "correlation-id-3";
        },
        async reportChecklistItem() {
          throw new OptimizationReportError("conflict");
        },
      }),
    );

    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, "report_conflict");
    assert.equal(recorded.length, 0, "a stale caller was recorded as a platform failure");
  });

  it("answers 503 with a correlation id, and no cause, when the write fails", async () => {
    const recorded: { surface?: string }[] = [];
    const response = await handleOptimizationReport(
      dependencies({
        recordFailure(input) {
          recorded.push(input);
          return "correlation-id-9";
        },
        async reportChecklistItem() {
          throw new OptimizationReportError("write_failed");
        },
      }),
    );

    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error.code, "report_unavailable");
    assert.equal(body.correlationId, "correlation-id-9");
    assert.deepEqual(
      recorded.map((entry) => entry.surface),
      ["api.optimization.report"],
    );
    assert.ok(!JSON.stringify(body).includes("write_failed"), "the cause reached the wire");
  });

  it("answers 503, never a view, when the write lands and the read-back does not", async () => {
    const recorded: { surface?: string }[] = [];
    const response = await handleOptimizationReport(
      dependencies({
        async readConsumerOptimization() {
          throw new OptimizationDataError("read_failed");
        },
        recordFailure(input) {
          recorded.push(input);
          return "correlation-id-4";
        },
      }),
    );

    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error.code, "optimization_unavailable");
    assert.equal(body.data, undefined);
    assert.deepEqual(
      recorded.map((entry) => entry.surface),
      ["api.optimization.report.read-back"],
    );
  });

  it("answers 403 when the read-back refuses the role", async () => {
    const response = await handleOptimizationReport(
      dependencies({
        async readConsumerOptimization() {
          throw new OptimizationDataError("forbidden");
        },
      }),
    );

    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, "role_forbidden");
  });
});

describe("/api/optimization/report route module", () => {
  it("checks its feature flag before it reads a session", () => {
    assert.ok(
      source.indexOf('featureFlag("FEATURE_ANALYSIS")') < source.indexOf("requireRole"),
      "the flag check must precede the session read",
    );
    assert.match(source, /notFound\(\)/);
  });

  it("asks only for the consumer role", () => {
    assert.match(source, /requireRole\("consumer"\)/);
    assert.doesNotMatch(source, /"operator_member"|"platform_admin"|"affiliate"/);
  });

  it("never reaches for the service-role client", () => {
    assert.doesNotMatch(source, /createAdminClient|service_role/);
  });

  it("exposes only POST", () => {
    assert.doesNotMatch(source, /export async function (GET|PUT|PATCH|DELETE)\b/);
  });
});

/**
 * The route's allow-list and the database's are two copies of one decision, and the database's is
 * the one that binds. These derive both sides at test time — the TypeScript table from the module,
 * the SQL list from the `not in (...)` clause in migration 391 — so a key added to either alone
 * fails here rather than becoming a 500 in production or a quietly unreachable button.
 */
describe("the reportable set", () => {
  const sqlKeys = (() => {
    const clause = migration.match(/p_template_key not in \(([^)]*)\)/);
    assert.ok(clause, "migration 391 no longer refuses template keys with a not-in list");
    return [...clause[1].matchAll(/'([^']+)'/g)].map((match) => match[1]).sort();
  })();

  it("names the same template keys in TypeScript and in SQL", () => {
    assert.deepEqual(
      Object.values(CONSUMER_REPORTABLE_TEMPLATE_KEY_BY_FACTOR_KEY).sort(),
      sqlKeys,
    );
  });

  it("names the same two actions in TypeScript and in SQL", () => {
    const clause = migration.match(/p_action not in \(([^)]*)\)/);
    assert.ok(clause, "migration 391 no longer refuses actions with a not-in list");
    assert.deepEqual(
      [...CONSUMER_REPORT_ACTIONS_V1].sort(),
      [...clause[1].matchAll(/'([^']+)'/g)].map((match) => match[1]).sort(),
    );
  });

  it("hands out one grant, to authenticated, and none to anon or the public", () => {
    const grants = [...migration.matchAll(/^grant\s+([\s\S]*?);$/gm)].map((match) =>
      match[1].replace(/\s+/g, " ").trim(),
    );
    assert.deepEqual(grants, [
      "execute on function public.report_checklist_item(text, text) to authenticated",
    ]);
    assert.match(
      migration,
      /revoke all on function public\.report_checklist_item\(text, text\) from public, anon;/,
    );
  });
});
