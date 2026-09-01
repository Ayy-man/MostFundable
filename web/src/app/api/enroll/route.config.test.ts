// R5B-01 — a driver misconfiguration must not be forged into a flag-off.
//
// The defeated fix (R4B-02) gave the consumer surface four bootstrap states so a transport failure
// could never be read as "the feature is off". This route defeated it from underneath: a bare catch
// answered any throw out of the config block with HTTP 200 and the byte-identical flag-off envelope,
// so the surface behaved correctly for a value the server had manufactured out of an outage. From
// there `enrollFixture` goes true and `confirmCancellation` displays "Subscription canceled" having
// sent no request, with the enrollment and the subscription still active and still billing.
//
// The assertions below are the two halves that have to hold at once: a configuration failure is
// distinguishable from a flag-off, and a genuine flag-off is unchanged to the byte.

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { loadEnrollmentBootstrap } from "@/components/surfaces/consumer-bootstrap";
import { setRouteFailureSink, type RouteFailureRecord } from "@/lib/diagnostics/route-failure";

import { handleEnrollmentGet } from "./route.ts";

const REQUEST = () => new Request("https://mf.test/api/enroll");
const original = { ...process.env };

after(() => {
  process.env = original;
});

async function withEnv<T>(patch: Record<string, string | undefined>, body: () => Promise<T>): Promise<T> {
  const restore: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(patch)) {
    restore[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await body();
  } finally {
    for (const [key, value] of Object.entries(restore)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe("R5B-01 — enrollment configuration failures fail closed", () => {
  it("answers an unsupported IDV selector with 503 and its own code, never 200 {enabled:false}", async () => {
    const records: RouteFailureRecord[] = [];
    const restore = setRouteFailureSink((record) => records.push(record));
    try {
      const response = await withEnv(
        { FEATURE_ENROLLMENT: "true", FEATURE_REAL_AUTH: "true", IDV_DRIVER: "persona" },
        () => handleEnrollmentGet(REQUEST()),
      );
      const body = await response.json() as {
        correlationId?: string;
        enabled?: unknown;
        error?: { code?: string };
      };

      assert.equal(response.status, 503, "a configuration failure must not answer 200");
      assert.equal(body.error?.code, "enrollment_configuration_unavailable");
      assert.equal("enabled" in body, false, "the failure must not carry the flag-off field at all");
      assert.equal(records.length, 1, "the misconfiguration must leave exactly one record");
      assert.equal(records[0].causeName, "MisconfiguredDriverError");
      assert.equal(body.correlationId, records[0].correlationId);
    } finally {
      restore();
    }
  });

  it("maps that response to the unavailable bootstrap state, not disabled", async () => {
    const restore = setRouteFailureSink(() => undefined);
    try {
      const result = await withEnv(
        { FEATURE_ENROLLMENT: "true", FEATURE_REAL_AUTH: "true", IDV_DRIVER: "persona" },
        async () => {
          const response = await handleEnrollmentGet(REQUEST());
          // The real client: `getJson` maps any non-2xx to `{ok:false}`, and the bootstrap maps that
          // to `unavailable`. Composing them here is the point — the reviewer's probe composed the
          // real route with the real bootstrap and got `disabled`.
          const { getJson } = await import("@/lib/enrollment/client");
          return loadEnrollmentBootstrap((path) =>
            getJson(path, async () => response.clone()));
        },
      );

      assert.equal(
        result.state,
        "unavailable",
        "the surface must reach the state that disables cancellation and claims no durable effect",
      );
      assert.notEqual(result.state, "disabled", "disabled is reserved for a deliberate flag-off");
    } finally {
      restore();
    }
  });

  it("leaves a genuine flag-off byte-identical", async () => {
    const records: RouteFailureRecord[] = [];
    const restore = setRouteFailureSink((record) => records.push(record));
    try {
      const response = await withEnv(
        { FEATURE_AFFILIATES: undefined, FEATURE_ENROLLMENT: undefined, IDV_DRIVER: undefined },
        () => handleEnrollmentGet(REQUEST()),
      );
      const body = await response.json() as Record<string, unknown>;

      assert.equal(response.status, 200);
      assert.deepEqual(Object.keys(body).sort(), ["currency", "enabled", "idvDriver", "priceCents"]);
      assert.equal(body.enabled, false);
      assert.equal(body.idvDriver, "mock");
      assert.deepEqual(records, [], "a deliberate flag-off is not a failure and records nothing");
    } finally {
      restore();
    }
  });

  it("fails closed on a price resolution failure too, from inside the same try", async () => {
    const restore = setRouteFailureSink(() => undefined);
    try {
      // A non-numeric governed override is the cheapest reachable throw out of `resolvePrice`.
      const response = await withEnv(
        { CONSUMER_MONITORING_PRICE_CENTS: "not-a-number", FEATURE_ENROLLMENT: "true" },
        () => handleEnrollmentGet(REQUEST()),
      );
      assert.equal(response.status, 503);
      assert.equal(
        (await response.json() as { error?: { code?: string } }).error?.code,
        "enrollment_configuration_unavailable",
      );
    } finally {
      restore();
    }
  });
});
