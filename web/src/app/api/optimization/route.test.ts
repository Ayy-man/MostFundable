import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { OptimizationDataError } from "@/lib/optimization/read.ts";
import { handleOptimizationGet, type OptimizationGetDependencies } from "./handler.ts";

import type { SessionProfile } from "@/lib/auth/session";
import type { ConsumerOptimizationV1 } from "@/lib/optimization/types.ts";

/**
 * Comments are stripped before the source assertions run. The module documents the rules it obeys,
 * and a scan of the raw text would report that explanation as the violation.
 */
const source = fs
  .readFileSync(path.resolve(process.cwd(), "src/app/api/optimization/route.ts"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^[ \t]*\/\/.*$/gm, "");

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

class FakeAuthError extends Error {
  readonly status: number;
  constructor(status: number) {
    super("auth");
    this.status = status;
  }
}

function dependencies(
  overrides: Partial<OptimizationGetDependencies> = {},
): OptimizationGetDependencies {
  return {
    async readConsumerOptimization() {
      return VIEW;
    },
    recordFailure() {
      return "correlation-id-1";
    },
    async requireConsumer() {
      return CONSUMER;
    },
    ...overrides,
  };
}

describe("GET /api/optimization", () => {
  it("answers a consumer with the view and a private, uncacheable body", async () => {
    const response = await handleOptimizationGet(dependencies());

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.deepEqual(await response.json(), { data: VIEW });
  });

  it("answers 200 with a null payload when the consumer has no workspace yet", async () => {
    const response = await handleOptimizationGet(
      dependencies({ async readConsumerOptimization() { return null; } }),
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { data: null });
  });

  it("answers 401 when there is no session", async () => {
    const response = await handleOptimizationGet(
      dependencies({ async requireConsumer() { throw new FakeAuthError(401); } }),
    );

    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, "session_required");
  });

  it("answers 403 for an operator or admin session", async () => {
    const response = await handleOptimizationGet(
      dependencies({ async requireConsumer() { throw new FakeAuthError(403); } }),
    );

    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, "role_forbidden");
  });

  it("answers 403 when the read itself refuses the role or the flag state", async () => {
    const response = await handleOptimizationGet(
      dependencies({
        async readConsumerOptimization() {
          throw new OptimizationDataError("forbidden");
        },
      }),
    );

    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, "role_forbidden");
  });

  it("answers 503 with a correlation id, and no cause, when the read fails", async () => {
    const recorded: unknown[] = [];
    const response = await handleOptimizationGet(
      dependencies({
        async readConsumerOptimization() {
          throw new OptimizationDataError("read_failed");
        },
        recordFailure(input) {
          recorded.push(input);
          return "correlation-id-9";
        },
      }),
    );

    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error.code, "optimization_unavailable");
    assert.equal(body.correlationId, "correlation-id-9");
    assert.equal(recorded.length, 1);
    assert.ok(!JSON.stringify(body).includes("read_failed"), "the cause reached the wire");
  });

  it("never renders a failed read as an empty view", async () => {
    const response = await handleOptimizationGet(
      dependencies({
        async readConsumerOptimization() {
          throw new Error("connection reset");
        },
      }),
    );

    assert.equal(response.status, 503);
    assert.equal((await response.json()).data, undefined);
  });
});

describe("/api/optimization route module", () => {
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
});
