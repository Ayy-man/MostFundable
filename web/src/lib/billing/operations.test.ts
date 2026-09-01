import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveBillingOperationsAdapter } from "./index.ts";
import { createStripeBillingOperationsAdapter } from "./operations-stripe.ts";
import { createMockBillingOperationsAdapter } from "./operations-mock.ts";
import { BillingOperationsError, closeExpiredCheckoutConflict, createHostedCheckout, createHostedPortal } from "./service-operations.ts";
import { startOperatorSubscriptionForOrg } from "./service-operator.ts";
import { createMockOperatorAdapter } from "./operator-mock.ts";
import type { OperatorBillingRepository, OperatorSubscriptionRow } from "./repository-operator.ts";
import { operatorSubscriptionLookupKeys } from "./repository-operator.ts";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const CHECKOUT = {
  basePriceRef: "price_base",
  cancelUrl: "https://app.example.test/billing?checkout=cancelled",
  customerRef: null,
  orgId: ORG_ID,
  orgName: "Example Funding",
  operationId: "11111111-1111-4111-8111-111111111199",
  ownerEmail: "owner@example.test",
  seatPriceRef: "price_seat",
  seatQuantity: 3,
  successUrl: "https://app.example.test/billing?checkout=success",
};

function stripeHarness() {
  const calls: Array<{ name: string; params: unknown; options?: unknown }> = [];
  return {
    calls,
    client: {
      billingPortal: { sessions: { async create(params: Record<string, unknown>) {
        calls.push({ name: "portal", params });
        return { url: "https://billing.stripe.test/portal" };
      } } },
      // Both shapes are widened to the provider's own contract — a nullable
      // status, subscription and url — so a test can hand the adapter any
      // response Stripe is allowed to return (R4C-05).
      checkout: { sessions: { async create(
        params: Record<string, unknown>,
        options: unknown,
      ): Promise<{ id: string; status?: "complete" | "expired" | "open" | null; subscription?: string | { id: string } | null; url: string | null }> {
        calls.push({ name: "checkout", params, options });
        return { id: "cs_test", url: "https://billing.stripe.test/checkout" };
      }, async retrieve(
        id: string,
      ): Promise<{ customer: string | { id: string } | null; id: string; status?: "complete" | "expired" | "open" | null; subscription?: string | { id: string } | null; url: string | null }> {
        calls.push({ name: "checkout-retrieve", params: id });
        return { customer: "cus_created", id, url: "https://billing.stripe.test/checkout" };
      } } },
      customers: { async create(params: Record<string, unknown>, options: unknown) {
        calls.push({ name: "customer", params, options });
        return { id: "cus_created" };
      } },
      prices: { async retrieve(id: string) {
        calls.push({ name: "price", params: id });
        return { product: { id: "prod_base" } };
      } },
      products: { async update(id: string, params: { statement_descriptor: string }) {
        calls.push({ name: "product", params: { id, ...params } });
        return {};
      } },
    },
  };
}

describe("billing operations adapters", () => {
  it("defaults to deterministic mock URLs and stable customer references", async () => {
    const adapter = resolveBillingOperationsAdapter({});
    const first = await adapter.createCheckoutSession(CHECKOUT);
    const second = await adapter.createCheckoutSession(CHECKOUT);
    assert.deepEqual(first, second);
    assert.equal(first.url, `https://billing.mock.local/checkout/${ORG_ID}`);
    assert.match(first.customerRef, /^mock_cus_/);
    assert.deepEqual(
      await adapter.createPortalSession({ customerRef: first.customerRef, orgId: ORG_ID, returnUrl: "https://app.example.test/billing" }),
      { url: `https://billing.mock.local/portal/${ORG_ID}` },
    );
  });

  it("fails explicit Stripe selection without a key before constructing a client", () => {
    let factories = 0;
    assert.throws(
      () => resolveBillingOperationsAdapter({ BILLING_DRIVER: "stripe" }, () => { factories += 1; throw new Error(); }),
      (error: unknown) => error instanceof Error && error.name === "MisconfiguredDriverError",
    );
    assert.equal(factories, 0);
  });

  it("creates exactly two subscription lines and updates only the base Product descriptor", async () => {
    const harness = stripeHarness();
    const adapter = createStripeBillingOperationsAdapter("unused", "MOSTFUNDABLE", harness.client);
    const result = await adapter.createCheckoutSession(CHECKOUT);
    assert.deepEqual(result, {
      customerRef: "cus_created",
      providerRef: "cs_test",
      status: "open",
      subscriptionRef: null,
      url: "https://billing.stripe.test/checkout",
    });
    assert.deepEqual(harness.calls.map((call) => call.name), ["customer", "price", "product", "checkout"]);
    assert.deepEqual(harness.calls[2]?.params, { id: "prod_base", statement_descriptor: "MOSTFUNDABLE" });
    const checkout = harness.calls[3]?.params as { line_items: unknown[]; client_reference_id: string; subscription_data: unknown };
    assert.deepEqual(checkout.line_items, [
      { price: "price_base", quantity: 1 },
      { price: "price_seat", quantity: 3 },
    ]);
    assert.equal(checkout.client_reference_id, ORG_ID);
    assert.deepEqual(checkout.subscription_data, { metadata: { org_id: ORG_ID } });
    assert.equal(JSON.stringify(result).includes("MOSTFUNDABLE"), false);
  });

  it("reuses a stored customer and creates a customer-scoped portal", async () => {
    const harness = stripeHarness();
    const adapter = createStripeBillingOperationsAdapter("unused", null, harness.client);
    await adapter.createCheckoutSession({ ...CHECKOUT, customerRef: "cus_stored" });
    assert.equal(harness.calls.some((call) => call.name === "customer"), false);
    assert.equal(harness.calls.some((call) => call.name === "price" || call.name === "product"), false);
    const portal = await adapter.createPortalSession({ customerRef: "cus_stored", orgId: ORG_ID, returnUrl: "https://app.example.test/billing" });
    assert.deepEqual(portal, { url: "https://billing.stripe.test/portal" });
    assert.deepEqual(harness.calls.at(-1)?.params, { customer: "cus_stored", return_url: "https://app.example.test/billing" });
  });

  it.skip("verifies Checkout, Portal and Product update against a real Stripe test account when credentials arrive", () => {});
});

function serviceHarness(subscription: OperatorSubscriptionRow | null = null) {
  const calls: Array<{ name: string; value: unknown }> = [];
  const driver = createMockBillingOperationsAdapter();
  return {
    calls,
    dependencies: {
      driver: {
        ...driver,
        async createCheckoutSession(input: Parameters<typeof driver.createCheckoutSession>[0]) {
          calls.push({ name: "provider", value: input });
          return driver.createCheckoutSession(input);
        },
        async createPortalSession(input: Parameters<typeof driver.createPortalSession>[0]) {
          calls.push({ name: "portal", value: input });
          return driver.createPortalSession(input);
        },
      },
      env: {},
      repository: {
        async claimSubscriptionCreationIntent() {
          calls.push({ name: "claim", value: { path: "checkout" } });
          return { ok: true as const, value: { claimed: true, createdAt: null, operationId: CHECKOUT.operationId, providerRef: null as string | null, reasonCode: "created", status: "pending" } };
        },
        async completeSubscriptionCreationIntent(_orgId: string, operationId: string, _path: string, providerRef: string) {
          calls.push({ name: "complete", value: { operationId, providerRef } });
          return { ok: true as const, value: { applied: true, reasonCode: "created" } };
        },
        async failExpiredCheckoutIntent() {
          return { ok: true as const, value: { applied: true, reasonCode: "expired" } };
        },
        async readOrgBillingProfile() {
          return { ok: true as const, value: { basePriceCents: null, name: "Example Funding", ownerEmail: "owner@example.test", plan: "growth", seatCount: 7, seatPriceCents: null, seatsIncluded: 5 } };
        },
        async readOperatorSubscriptionForOrg() { return { ok: true as const, value: subscription }; },
        async upsertSubscription(input: unknown) {
          calls.push({ name: "persist", value: input });
          return { ok: true as const, value: { applied: true, created: true, reasonCode: "applied", status: "incomplete", subscriptionRef: null } };
        },
      },
    },
  };
}

describe("hosted billing service", () => {
  it("derives same-origin URLs and persists the customer before returning checkout", async () => {
    const harness = serviceHarness();
    const result = await createHostedCheckout(ORG_ID, "https://app.example.test/api/billing/checkout", harness.dependencies);
    assert.deepEqual(result, { url: `https://billing.mock.local/checkout/${ORG_ID}` });
    assert.deepEqual(harness.calls.map((call) => call.name), ["claim", "provider", "complete", "persist"]);
    const provider = harness.calls[1]?.value as { cancelUrl: string; operationId: string; successUrl: string; seatQuantity: number };
    assert.equal(provider.cancelUrl, "https://app.example.test/billing?checkout=cancelled");
    assert.equal(provider.successUrl, "https://app.example.test/billing?checkout=success");
    assert.equal(provider.seatQuantity, 2);
    assert.equal(provider.operationId, CHECKOUT.operationId);
    const persisted = harness.calls[3]?.value as { customerRef: string; subscriptionRef: string | null };
    assert.match(persisted.customerRef, /^mock_cus_/);
    assert.equal(persisted.subscriptionRef, null);
  });

  it("uses only the stored organization customer for portal", async () => {
    const subscription: OperatorSubscriptionRow = {
      baseItemRef: null,
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
      customerRef: "cus_stored",
      orgId: ORG_ID,
      provider: "mock",
      seatItemRef: null,
      seatQuantity: 0,
      status: "incomplete",
      subscriptionRef: null,
    };
    const harness = serviceHarness(subscription);
    assert.deepEqual(
      await createHostedPortal(ORG_ID, "https://app.example.test/api/billing/portal", harness.dependencies),
      { url: `https://billing.mock.local/portal/${ORG_ID}` },
    );
    assert.deepEqual(harness.calls[0]?.value, { customerRef: "cus_stored", orgId: ORG_ID, returnUrl: "https://app.example.test/billing" });
  });

  it("refuses portal when the tenant has no stored customer", async () => {
    await assert.rejects(
      createHostedPortal(ORG_ID, "https://app.example.test/api/billing/portal", serviceHarness().dependencies),
      (error: unknown) => error instanceof BillingOperationsError && error.code === "BILLING_CUSTOMER_REQUIRED" && error.status === 409,
    );
  });

  it("lets subscription-created resolve the pre-bound customer before the existing ladder runs", () => {
    assert.deepEqual(operatorSubscriptionLookupKeys({ customerRef: "cus_bound", subscriptionRef: "sub_created" }), [
      { column: "subscription_ref", value: "sub_created" },
      { column: "customer_ref", value: "cus_bound" },
    ]);
  });

  it("recovers a completed hosted intent after persistence crashes without another create", async () => {
    const harness = serviceHarness();
    let intentStatus = "pending";
    let providerRef: string | null = null;
    let persistenceCalls = 0;
    harness.dependencies.repository.claimSubscriptionCreationIntent = async () => ({
      ok: true as const,
      value: {
        claimed: true,
        createdAt: null,
        operationId: CHECKOUT.operationId,
        providerRef,
        reasonCode: intentStatus === "created" ? "provider_returned" : "created",
        status: intentStatus,
      },
    });
    harness.dependencies.repository.completeSubscriptionCreationIntent = async (_orgId, _operationId, _path, completedProviderRef) => {
      intentStatus = "created";
      providerRef = completedProviderRef;
      return { ok: true as const, value: { applied: true, reasonCode: "created" } };
    };
    harness.dependencies.repository.upsertSubscription = async () => {
      persistenceCalls += 1;
      if (persistenceCalls === 1) throw new Error("database unavailable");
      return { ok: true as const, value: { applied: true, created: true, reasonCode: "applied", status: "incomplete", subscriptionRef: null } };
    };
    const originalRead = harness.dependencies.driver.readCheckoutSession;
    harness.dependencies.driver.readCheckoutSession = async (input) => {
      harness.calls.push({ name: "recover", value: input });
      return originalRead(input);
    };

    await assert.rejects(
      createHostedCheckout(ORG_ID, "https://app.example.test/api/billing/checkout", harness.dependencies),
      /database unavailable/,
    );
    assert.deepEqual(
      await createHostedCheckout(ORG_ID, "https://app.example.test/api/billing/checkout", harness.dependencies),
      { url: `https://billing.mock.local/checkout/${ORG_ID}` },
    );
    assert.equal(
      harness.calls.filter((call) => call.name === "provider").length,
      1,
      "crash recovery performs one provider create call",
    );
    assert.equal(harness.calls.filter((call) => call.name === "recover").length, 1);
  });

  // R4C-05. Stripe returns a null URL for an expired session, and the read
  // shape validated it as a redirect, so `closeExpiredCheckoutConflict` never
  // reached its own `status` check — the release path threw inside the adapter
  // and `service-operations.ts` reported a 502 instead. On `c2df7ae` the first
  // assertion below fails: `failExpiredCheckoutIntent` is called zero times.
  it("closes an expired Checkout intent whose session has no redirect URL", async () => {
    const stripe = stripeHarness();
    stripe.client.checkout.sessions.retrieve = async (id: string) => {
      stripe.calls.push({ name: "checkout-retrieve", params: id });
      return { customer: "cus_created", id, status: "expired" as const, subscription: null, url: null };
    };
    const adapter = createStripeBillingOperationsAdapter("sk_test", null, stripe.client);
    let failed = 0;
    const closed = await closeExpiredCheckoutConflict(
      ORG_ID,
      { claimed: false, createdAt: null, operationId: CHECKOUT.operationId, providerRef: "cs_expired", reasonCode: "path_conflict", status: "created" },
      {
        driver: adapter,
        repository: {
          async failExpiredCheckoutIntent() {
            failed += 1;
            return { ok: true as const, value: { applied: true, reasonCode: "expired" } };
          },
        } as unknown as OperatorBillingRepository,
      },
    );

    assert.equal(failed, 1, "the expired session releases the intent exactly once");
    assert.equal(closed, true);
  });

  it("leaves a completed session with no redirect URL alone", async () => {
    const stripe = stripeHarness();
    stripe.client.checkout.sessions.retrieve = async (id: string) => ({
      customer: "cus_created", id, status: "complete" as const, subscription: "sub_live", url: null,
    });
    const adapter = createStripeBillingOperationsAdapter("sk_test", null, stripe.client);
    let failed = 0;
    const closed = await closeExpiredCheckoutConflict(
      ORG_ID,
      { claimed: false, createdAt: null, operationId: CHECKOUT.operationId, providerRef: "cs_complete", reasonCode: "path_conflict", status: "created" },
      {
        driver: adapter,
        repository: {
          async failExpiredCheckoutIntent() {
            failed += 1;
            return { ok: true as const, value: { applied: true, reasonCode: "expired" } };
          },
        } as unknown as OperatorBillingRepository,
      },
    );

    assert.equal(failed, 0, "a completed session is not an expiry, URL or no URL");
    assert.equal(closed, false);
  });

  it("still requires an HTTPS URL from a newly created session", async () => {
    const stripe = stripeHarness();
    stripe.client.checkout.sessions.create = async (params: Record<string, unknown>, options: unknown) => {
      stripe.calls.push({ name: "checkout", params, options });
      return { id: "cs_test", url: null };
    };
    const adapter = createStripeBillingOperationsAdapter("sk_test", null, stripe.client);
    await assert.rejects(adapter.createCheckoutSession(CHECKOUT), /BILLING_PROVIDER_RESULT_INVALID/);
  });

  // The sibling the enumeration turned up: the checkout path resumes its own
  // intent at the same seam, so the same expired session blocked it too.
  it("releases its own expired intent and issues a fresh session rather than a dead link", async () => {
    const harness = serviceHarness();
    let intentStatus = "created";
    let providerRef: string | null = "cs_expired";
    let released = 0;
    harness.dependencies.repository.claimSubscriptionCreationIntent = async () => ({
      ok: true as const,
      value: {
        claimed: true,
        createdAt: null,
        operationId: CHECKOUT.operationId,
        providerRef,
        reasonCode: intentStatus === "created" ? "provider_returned" : "created",
        status: intentStatus,
      },
    });
    harness.dependencies.repository.failExpiredCheckoutIntent = async () => {
      released += 1;
      intentStatus = "pending";
      providerRef = null;
      return { ok: true as const, value: { applied: true, reasonCode: "expired" } };
    };
    harness.dependencies.driver.readCheckoutSession = async () => ({
      customerRef: "mock_cus_shared",
      providerRef: "cs_expired",
      status: "expired" as const,
      subscriptionRef: null,
      url: null,
    });

    const result = await createHostedCheckout(ORG_ID, "https://app.example.test/api/billing/checkout", harness.dependencies);

    assert.equal(released, 1);
    assert.deepEqual(result, { url: `https://billing.mock.local/checkout/${ORG_ID}` });
    assert.equal(harness.calls.filter((call) => call.name === "provider").length, 1);
  });

  it("allows only one provider call when direct and hosted endpoints race", async () => {
    let livePath: "checkout" | "direct" | null = null;
    let releaseDirectProfile: (() => void) | null = null;
    const directProfileReady = new Promise<void>((resolve) => { releaseDirectProfile = resolve; });
    const profile = { basePriceCents: null, name: "Example Funding", ownerEmail: "owner@example.test", plan: "growth", seatCount: 7, seatPriceCents: null, seatsIncluded: 5 };
    const subscription: OperatorSubscriptionRow = {
      baseItemRef: null,
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
      customerRef: "mock_cus_shared",
      orgId: ORG_ID,
      provider: "mock",
      seatItemRef: null,
      seatQuantity: 0,
      status: "incomplete",
      subscriptionRef: null,
    };
    const claim = async (_orgId: string, path: "checkout" | "direct") => {
      if (!livePath) livePath = path;
      if (livePath !== path) {
        return { ok: true as const, value: { claimed: false, createdAt: null, operationId: CHECKOUT.operationId, providerRef: null, reasonCode: "path_conflict", status: "pending" } };
      }
      return { ok: true as const, value: { claimed: true, createdAt: null, operationId: CHECKOUT.operationId, providerRef: null, reasonCode: "created", status: "pending" } };
    };
    let hostedProviderCalls = 0;
    let directProviderCalls = 0;
    const hostedDriver = createMockBillingOperationsAdapter();
    const hostedDependencies = {
      driver: {
        ...hostedDriver,
        async createCheckoutSession(input: Parameters<typeof hostedDriver.createCheckoutSession>[0]) {
          hostedProviderCalls += 1;
          releaseDirectProfile?.();
          return hostedDriver.createCheckoutSession(input);
        },
      },
      env: {},
      repository: {
        claimSubscriptionCreationIntent: claim,
        async completeSubscriptionCreationIntent() { return { ok: true as const, value: { applied: true, reasonCode: "created" } }; },
        async failExpiredCheckoutIntent() { return { ok: true as const, value: { applied: true, reasonCode: "expired" } }; },
        async readOperatorSubscriptionForOrg() { return { ok: true as const, value: subscription }; },
        async readOrgBillingProfile() { return { ok: true as const, value: profile }; },
        async upsertSubscription() { return { ok: true as const, value: { applied: true, created: true, reasonCode: "applied", status: "incomplete", subscriptionRef: null } }; },
      },
    };
    const directDriver = createMockOperatorAdapter();
    const directRepository = {
      ...hostedDependencies.repository,
      async readOrgBillingProfile() {
        await directProfileReady;
        return { ok: true as const, value: profile };
      },
    } as unknown as OperatorBillingRepository;
    const wrappedDirectDriver = {
      ...directDriver,
      async startOperatorSubscription(input: Parameters<typeof directDriver.startOperatorSubscription>[0]) {
        directProviderCalls += 1;
        return directDriver.startOperatorSubscription(input);
      },
    };

    const [hosted, direct] = await Promise.allSettled([
      createHostedCheckout(ORG_ID, "https://app.example.test/api/billing/checkout", hostedDependencies),
      startOperatorSubscriptionForOrg(ORG_ID, {
        driver: wrappedDirectDriver,
        repository: directRepository,
        stateReader: { async readOperatorBillingState() { return { ok: true as const, value: null }; } },
      }),
    ]);

    assert.equal(hosted.status, "fulfilled");
    assert.equal(direct.status, "rejected");
    assert.equal((direct as PromiseRejectedResult).reason.code, "conflict");
    assert.equal(hostedProviderCalls + directProviderCalls, 1, "the two public endpoints share one provider boundary");
  });
});
