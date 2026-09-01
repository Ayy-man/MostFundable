import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  dispatchOperatorCardFailureEmail,
  type EmailDispatchDependencies,
  type OperatorCardFailureDispatchEnvelope,
} from "@/lib/email/dispatch";
import type { OperatorOrgBillingProfile } from "@/lib/billing/repository-operator";
import type { EmailDriver, EmailSendInput } from "@/lib/email/types";

const DELIVERY_ID = "25000000-0000-4000-8000-000000000501";
const ORG_ID = "25000000-0000-4000-8000-000000000502";
const EVENT_ID = "25000000-0000-4000-8000-000000000503";

const ENVELOPE: OperatorCardFailureDispatchEnvelope = {
  channel: "email",
  deliveryId: DELIVERY_ID,
  subject: `org:${ORG_ID}`,
  window: `billing-event:${EVENT_ID}`,
  orgId: ORG_ID,
  billingEventId: EVENT_ID,
  template: "operator_card_failure",
};

const PROFILE: OperatorOrgBillingProfile = {
  basePriceCents: null,
  name: "Northbridge Funding Group",
  ownerEmail: "owner@northbridge.test",
  plan: "growth",
  seatCount: 3,
  seatPriceCents: null,
  seatsIncluded: 5,
};

function dependencies(profile: OperatorOrgBillingProfile | null = PROFILE): {
  calls: unknown[];
  value: EmailDispatchDependencies;
} {
  const calls: unknown[] = [];
  const driver: EmailDriver = {
    async send(input: EmailSendInput) {
      calls.push({ send: input });
      return {
        driver: "mock",
        receiptId: "25000000-0000-4000-8000-000000000504",
        providerRef: "mock_email_2505",
        status: "accepted",
        attemptCount: 1,
      };
    },
  };
  return {
    calls,
    value: {
      driver,
      async readOrgBillingProfile(orgId) {
        calls.push({ read: orgId });
        return { ok: true, value: profile };
      },
    },
  };
}

describe("email dispatch wrapper", () => {
  it("hydrates the trusted profile and sends the exact internal envelope", async () => {
    const fixture = dependencies();
    const receipt = await dispatchOperatorCardFailureEmail(ENVELOPE, fixture.value);

    assert.equal(receipt.status, "accepted");
    assert.deepEqual(fixture.calls, [
      { read: ORG_ID },
      { send: {
        to: "owner@northbridge.test",
        template: "operator_card_failure",
        vars: { DELIVERY_REFERENCE: DELIVERY_ID },
        orgId: ORG_ID,
      } },
    ]);
  });

  for (const [label, profile] of [
    ["absent organization", null],
    ["missing owner", { ...PROFILE, ownerEmail: null }],
    ["missing name", { ...PROFILE, name: "  " }],
  ] as const) {
    it(`fails closed for ${label} before a driver call`, async () => {
      const fixture = dependencies(profile);
      await assert.rejects(
        dispatchOperatorCardFailureEmail(ENVELOPE, fixture.value),
        /EMAIL_ORG_PROFILE_UNAVAILABLE/,
      );
      assert.deepEqual(fixture.calls, [{ read: ORG_ID }]);
    });
  }

  it("rejects an unknown template or mismatched source before profile access", async () => {
    const fixture = dependencies();
    await assert.rejects(
      dispatchOperatorCardFailureEmail(
        { ...ENVELOPE, template: "crs_alert" } as unknown as OperatorCardFailureDispatchEnvelope,
        fixture.value,
      ),
      /EMAIL_DISPATCH_ENVELOPE_INVALID/,
    );
    await assert.rejects(
      dispatchOperatorCardFailureEmail(
        { ...ENVELOPE, window: `billing-event:${DELIVERY_ID}` },
        fixture.value,
      ),
      /EMAIL_DISPATCH_ENVELOPE_INVALID/,
    );
    assert.deepEqual(fixture.calls, []);
  });

  it("propagates profile and driver errors without logging values", async () => {
    const originalError = console.error;
    const logs: unknown[] = [];
    console.error = (...values: unknown[]) => { logs.push(values); };
    try {
      const fixture = dependencies();
      fixture.value.driver.send = async () => { throw new Error("EMAIL_PROVIDER_REJECTED"); };
      await assert.rejects(
        dispatchOperatorCardFailureEmail(ENVELOPE, fixture.value),
        /EMAIL_PROVIDER_REJECTED/,
      );
      assert.deepEqual(logs, []);
    } finally {
      console.error = originalError;
    }
  });
});
