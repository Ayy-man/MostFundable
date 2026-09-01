import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import {
  clearPaidRefreshFixture,
  PAID_REFRESH_FIXTURE,
  provisionPaidRefreshFixture,
  readPaidRefreshFixtureEvidence,
  type PaidRefreshFixtureCase,
  type PaidRefreshFixtureEvidence,
} from "@/lib/pricing/fixture";

const baseUrl = process.env.PAID_REFRESH_E2E_BASE_URL?.replace(/\/$/, "");
const fixtureEnabled = process.env.PAID_REFRESH_E2E === "1";
const databaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
);
const skip = !baseUrl
  ? "PAID_REFRESH_E2E_BASE_URL is required for the live paid-refresh proof"
  : !fixtureEnabled
    ? "PAID_REFRESH_E2E=1 is required to permit the isolated local fixture"
    : !databaseConfigured
      ? "the local Supabase URL and service role key are required for fixture evidence"
      : false;

/** The governed force-pull price this fixture runs against, in cents. */
const FORCE_PULL_CENTS = 1_900;

interface ApiResult {
  status: number;
  body: unknown;
  cacheControl: string | null;
}

async function call(
  path: string,
  options: {
    actorId?: string;
    /**
     * The price the consumer confirmed. `/api/refresh-now` requires it — the
     * amount travels with the request so the service can compare it against the
     * single governed read it charges from (R4B-01) — so a POST that omits it
     * is answered `request_body_invalid` and never reaches the money path.
     */
    expectedAmountCents?: number;
    idempotencyKey?: string;
    method?: "GET" | "POST";
  } = {},
): Promise<ApiResult> {
  assert.ok(baseUrl);
  const method = options.method ?? "GET";
  const headers: Record<string, string> = {};
  if (options.actorId) headers["x-mf-demo-profile-id"] = options.actorId;
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;
  if (method === "POST") headers.Origin = new URL(baseUrl).origin;
  let body: string | undefined;
  if (options.expectedAmountCents !== undefined) {
    body = JSON.stringify({ expectedAmountCents: options.expectedAmountCents });
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(`${baseUrl}${path}`, { body, method, headers });
  return {
    status: response.status,
    body: await response.json(),
    cacheControl: response.headers.get("cache-control"),
  };
}

function assertPrivate(result: ApiResult): void {
  assert.equal(result.cacheControl, "private, no-store");
}

function assertNoEnqueue(evidence: PaidRefreshFixtureEvidence): void {
  assert.equal(evidence.analysisCount, 0);
  assert.equal(evidence.backgroundCount, 0);
  assert.equal(evidence.backgroundAuditCount, 0);
  assert.equal(evidence.analysisJobId, null);
  assert.equal(evidence.analysisRunId, null);
  assert.equal(evidence.backgroundJobId, null);
}

async function assertPaymentRejection(
  caseName: Extract<PaidRefreshFixtureCase, "paymentFailed" | "actionRequired">,
  expectedError: "payment_failed" | "payment_requires_action",
  expectedOutcome: "failed" | "requires_action",
): Promise<void> {
  const fixture = PAID_REFRESH_FIXTURE.cases[caseName];
  const result = await call("/api/refresh-now", {
    actorId: fixture.consumerId,
    expectedAmountCents: FORCE_PULL_CENTS,
    idempotencyKey: fixture.idempotencyKey,
    method: "POST",
  });
  assert.equal(result.status, 402);
  assert.deepEqual(result.body, { error: expectedError });
  assertPrivate(result);

  const evidence = readPaidRefreshFixtureEvidence(caseName);
  assert.equal(evidence.requestCount, 1);
  assert.equal(evidence.requestState, expectedOutcome === "failed" ? "payment_failed" : "requires_action");
  assert.equal(evidence.paymentEventCount, 1);
  assert.equal(evidence.succeededEventCount, 0);
  assert.equal(evidence.latestPaymentOutcome, expectedOutcome);
  assert.equal(evidence.capAttemptCount, 1);
  assert.equal(evidence.capAllowedCount, 1);
  assert.equal(evidence.capDeniedCount, 0);
  assertNoEnqueue(evidence);
}

describe("paid refresh live durable chain", { skip }, () => {
  before(() => provisionPaidRefreshFixture());
  after(() => clearPaidRefreshFixture());

  it("authorizes catalogs and persists one payment-before-enqueue chain across replay", async () => {
    const { adminId, operatorId, cases } = PAID_REFRESH_FIXTURE;

    const unauthenticated = await call("/api/pricing/consumer");
    assert.equal(unauthenticated.status, 401);
    assert.deepEqual(unauthenticated.body, { error: "unauthenticated" });
    assertPrivate(unauthenticated);

    const incorrectRole = await call("/api/pricing/consumer", { actorId: operatorId });
    assert.equal(incorrectRole.status, 403);
    assert.deepEqual(incorrectRole.body, { error: "forbidden" });
    assertPrivate(incorrectRole);

    const consumerCatalog = await call("/api/pricing/consumer", { actorId: cases.success.consumerId });
    assert.equal(consumerCatalog.status, 200);
    assert.deepEqual(consumerCatalog.body, {
      enabled: true,
      currency: "usd",
      monitoring: { amountCents: 4_900 },
      forcePull: { amountCents: 1_900 },
    });
    assertPrivate(consumerCatalog);

    const operatorCatalog = await call("/api/pricing/operator", { actorId: operatorId });
    assert.equal(operatorCatalog.status, 200);
    assert.deepEqual(operatorCatalog.body, {
      enabled: true,
      monitoringSplit: { percent: 40, configured: false },
    });
    assertPrivate(operatorCatalog);

    const adminCatalog = await call("/api/pricing/admin", { actorId: adminId });
    assert.equal(adminCatalog.status, 200);
    assert.deepEqual(adminCatalog.body, {
      enabled: true,
      currency: "usd",
      forcePull: { amountCents: 1_900 },
      monitoringSplit: { percent: 40, configured: false },
    });
    assertPrivate(adminCatalog);

    const unauthorizedRefresh = await call("/api/refresh-now", { method: "POST" });
    assert.equal(unauthorizedRefresh.status, 401);
    assert.deepEqual(unauthorizedRefresh.body, { error: "unauthenticated" });

    const wrongRoleRefresh = await call("/api/refresh-now", {
      actorId: operatorId,
      idempotencyKey: cases.success.idempotencyKey,
      method: "POST",
    });
    assert.equal(wrongRoleRefresh.status, 403);
    assert.deepEqual(wrongRoleRefresh.body, { error: "forbidden" });

    const first = await call("/api/refresh-now", {
      actorId: cases.success.consumerId,
      expectedAmountCents: FORCE_PULL_CENTS,
      idempotencyKey: cases.success.idempotencyKey,
      method: "POST",
    });
    assert.equal(first.status, 202);
    assertPrivate(first);
    assert.deepEqual(Object.keys(first.body as object).sort(), [
      "amountCents", "analysisRunId", "currency", "requestId", "status",
    ]);
    assert.deepEqual(first.body, {
      requestId: (first.body as { requestId: string }).requestId,
      analysisRunId: (first.body as { analysisRunId: string }).analysisRunId,
      status: "queued",
      amountCents: 1_900,
      currency: "usd",
    });

    const firstEvidence = readPaidRefreshFixtureEvidence("success");
    assert.equal(firstEvidence.requestCount, 1);
    assert.equal(firstEvidence.requestId, (first.body as { requestId: string }).requestId);
    assert.equal(firstEvidence.requestState, "queued");
    assert.equal(firstEvidence.paymentEventCount, 1);
    assert.equal(firstEvidence.succeededEventCount, 1);
    assert.equal(firstEvidence.latestPaymentOutcome, "succeeded");
    assert.equal(firstEvidence.analysisCount, 1);
    assert.equal(firstEvidence.analysisRunId, (first.body as { analysisRunId: string }).analysisRunId);
    assert.equal(firstEvidence.backgroundCount, 1);
    assert.equal(firstEvidence.backgroundAuditCount, 1);
    assert.equal(firstEvidence.backgroundSubject, `client:${cases.success.clientId}`);
    assert.equal(firstEvidence.backgroundWindow, `run:${firstEvidence.analysisRunId}`);
    assert.equal(firstEvidence.capAttemptCount, 1);
    assert.equal(firstEvidence.capAllowedCount, 1);
    assert.equal(firstEvidence.capDeniedCount, 0);
    assert.ok(firstEvidence.providerPaymentRef);
    assert.ok(firstEvidence.latestPaymentOccurredAt);
    assert.ok(firstEvidence.analysisCreatedAt);
    assert.ok(
      Date.parse(firstEvidence.latestPaymentOccurredAt) <= Date.parse(firstEvidence.analysisCreatedAt),
      "the durable payment event must precede analysis enqueue",
    );

    const replay = await call("/api/refresh-now", {
      actorId: cases.success.consumerId,
      expectedAmountCents: FORCE_PULL_CENTS,
      idempotencyKey: cases.success.idempotencyKey,
      method: "POST",
    });
    assert.equal(replay.status, 202);
    assert.deepEqual(replay.body, first.body);
    assert.deepEqual(readPaidRefreshFixtureEvidence("success"), firstEvidence);

    const capDenied = await call("/api/refresh-now", {
      actorId: cases.capDenied.consumerId,
      expectedAmountCents: FORCE_PULL_CENTS,
      idempotencyKey: cases.capDenied.idempotencyKey,
      method: "POST",
    });
    assert.equal(capDenied.status, 429);
    assert.deepEqual(capDenied.body, { error: "cap_denied" });
    assertPrivate(capDenied);
    const capEvidence = readPaidRefreshFixtureEvidence("capDenied");
    assert.equal(capEvidence.requestCount, 1);
    assert.equal(capEvidence.paymentEventCount, 0);
    assert.equal(capEvidence.capAttemptCount, 1);
    assert.equal(capEvidence.capAllowedCount, 0);
    assert.equal(capEvidence.capDeniedCount, 1);
    assertNoEnqueue(capEvidence);

    await assertPaymentRejection("paymentFailed", "payment_failed", "failed");
    await assertPaymentRejection("actionRequired", "payment_requires_action", "requires_action");
  });
});
