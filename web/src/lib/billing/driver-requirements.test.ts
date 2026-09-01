// R4C-03 — a selected real Stripe driver declares every credential and
// provider reference it refuses to run without.
//
// These run in child processes rather than against `resolveDriver` directly
// because the property under test is a *preflight* one: the question is whether
// an incomplete configuration can reach an adapter at all, and the only honest
// way to ask that is to boot the selector the way a deployment does. The
// in-process assertions on the table itself live in
// `scripts/verify-env-contract.mjs`.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, it } from "node:test";

import { webhookVerificationReady } from "./index.ts";

const WEB_ROOT = path.resolve(import.meta.dirname, "../../..");

const SELECT_BILLING = `
  const { getBillingAdapter, getOperatorBillingAdapter, getOneOffBillingAdapter, getBillingOperationsAdapter } =
    await import("./src/lib/billing/index.ts");
  getBillingAdapter();
  getOperatorBillingAdapter();
  getOneOffBillingAdapter();
  getBillingOperationsAdapter();
  process.stdout.write("selected");
`;

const SELECT_CRS = `
  const { resolveDriver } = await import("./src/lib/env.ts");
  process.stdout.write(resolveDriver("crs"));
`;

type Outcome = { ok: boolean; output: string };

function run(env: Readonly<Record<string, string>>, source: string): Outcome {
  try {
    return {
      ok: true,
      output: execFileSync(
        process.execPath,
        ["--import", "./scripts/ts-resolve-hook.mjs", "--input-type=module", "-e", source],
        {
          cwd: WEB_ROOT,
          encoding: "utf8",
          env: { PATH: process.env.PATH, ...env } as unknown as NodeJS.ProcessEnv,
          stdio: ["ignore", "pipe", "pipe"],
        },
      ),
    };
  } catch (error) {
    const failure = error as { stderr?: string; stdout?: string };
    return { ok: false, output: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
}

const COMPLETE_STRIPE = {
  BILLING_DRIVER: "stripe",
  STRIPE_SECRET_KEY: "not-a-real-secret-key",
  STRIPE_WEBHOOK_SECRET: "not-a-real-webhook-secret",
  CONSUMER_MONITORING_PRICE_REF: "price_monitoring",
  STRIPE_PRICE_OPERATOR_BASE: "price_operator_base",
  STRIPE_PRICE_OPERATOR_SEAT: "price_operator_seat",
} as const;

const COMPLETE_CRS = {
  CRS_DRIVER: "sandbox",
  CRS_BASE_URL: "https://crs.example",
  CRS_API_KEY: "crs_selector",
  CRS_SECRET: "not-a-real-crs-secret",
} as const;

function without<T extends Record<string, string>>(source: T, key: keyof T): Record<string, string> {
  const copy: Record<string, string> = { ...source };
  delete copy[key as string];
  return copy;
}

describe("real driver preflight requirements", () => {
  // The reproduction: money moves outbound while every inbound event is
  // rejected for a missing signing secret, so nothing activates, cancels,
  // dunns or attributes a refund. Fails on `c2df7ae`, where the child exits 0
  // and prints "selected".
  it("refuses a Stripe selection missing its inbound signing secret", () => {
    const result = run(without(COMPLETE_STRIPE, "STRIPE_WEBHOOK_SECRET"), SELECT_BILLING);
    assert.equal(result.ok, false);
    assert.match(result.output, /STRIPE_WEBHOOK_SECRET/);
    assert.doesNotMatch(result.output, /not-a-real-secret-key/);
  });

  // The sibling half. A placeholder `mock_price_…` reference is a reference
  // only the mock driver can honour, so the provider rejects the first
  // subscription create rather than the gate rejecting the deployment.
  for (const key of [
    "CONSUMER_MONITORING_PRICE_REF",
    "STRIPE_PRICE_OPERATOR_BASE",
    "STRIPE_PRICE_OPERATOR_SEAT",
  ] as const) {
    it(`refuses a Stripe selection missing ${key}`, () => {
      const result = run(without(COMPLETE_STRIPE, key), SELECT_BILLING);
      assert.equal(result.ok, false);
      assert.match(result.output, new RegExp(key));
    });
  }

  it("refuses a Stripe selection missing only the secret key", () => {
    const result = run(without(COMPLETE_STRIPE, "STRIPE_SECRET_KEY"), SELECT_BILLING);
    assert.equal(result.ok, false);
    assert.match(result.output, /STRIPE_SECRET_KEY/);
  });

  // The positive arm. The expensive failure mode of a preflight requirement is
  // a complete configuration it refuses, so every negative above is paired
  // with this.
  it("selects every Stripe adapter from a complete configuration", () => {
    const result = run({ ...COMPLETE_STRIPE }, SELECT_BILLING);
    assert.equal(result.ok, true, result.output);
    assert.equal(result.output, "selected");
  });

  // Outbound login uses API key plus secret. Webhook Basic auth is configured independently per
  // host and remains fail-closed at the inbound route rather than blocking outbound driver boot.
  it("refuses a sandbox CRS selection missing CRS_SECRET", () => {
    const result = run(without(COMPLETE_CRS, "CRS_SECRET"), SELECT_CRS);
    assert.equal(result.ok, false);
    assert.match(result.output, /CRS_SECRET/);
    assert.doesNotMatch(result.output, /crs_selector/);
  });

  it("selects the sandbox CRS driver from a complete configuration", () => {
    const result = run({ ...COMPLETE_CRS }, SELECT_CRS);
    assert.equal(result.ok, true, result.output);
    assert.equal(result.output, "sandbox");
  });

  it("still falls back to the mock arms on an empty environment", () => {
    const billing = run({}, SELECT_BILLING);
    assert.equal(billing.ok, true, billing.output);
    assert.equal(billing.output, "selected");
    const crs = run({}, SELECT_CRS);
    assert.equal(crs.ok, true, crs.output);
    assert.equal(crs.output, "mock");
  });
});

describe("inbound webhook readiness", () => {
  // R4C-03 hardening. `mockWebhookReady` answers "is the mock signer
  // configured" and keeps doing exactly that; the route needs a predicate that
  // covers the real arm too, so a missing secret is a 503 the provider can
  // redeliver against rather than a 400 that blames Stripe.
  it("requires the real secret before accepting an inbound Stripe event", () => {
    assert.equal(
      webhookVerificationReady({ ...COMPLETE_STRIPE, STRIPE_WEBHOOK_SECRET: "  " }),
      false,
    );
    assert.equal(webhookVerificationReady({ ...COMPLETE_STRIPE }), true);
  });

  it("keeps the explicit mock signing requirement on the mock arm", () => {
    assert.equal(webhookVerificationReady({}), false);
    assert.equal(
      webhookVerificationReady({ STRIPE_WEBHOOK_SECRET: "mock-webhook-signing-value" }),
      false,
    );
    assert.equal(
      webhookVerificationReady({ STRIPE_WEBHOOK_SECRET: "injected-runtime-value" }),
      true,
    );
  });
});
