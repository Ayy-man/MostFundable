import "server-only";

import { getEmailDriver } from "./bootstrap.ts";

import type { OperatorOrgBillingProfile, OperatorRepositoryResult } from "@/lib/billing/repository-operator";
import type { EmailDriver, EmailSendReceipt } from "./types.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type OperatorCardFailureDispatchEnvelope = Readonly<{
  channel: "email";
  deliveryId: string;
  subject: string;
  window: string;
  orgId: string;
  billingEventId: string;
  template: "operator_card_failure";
}>;

export interface EmailDispatchDependencies {
  readonly driver: EmailDriver;
  readonly readOrgBillingProfile: (
    orgId: string,
  ) => Promise<OperatorRepositoryResult<OperatorOrgBillingProfile | null>>;
}

async function productionProfile(
  orgId: string,
): Promise<OperatorRepositoryResult<OperatorOrgBillingProfile | null>> {
  const { readOrgBillingProfile } = await import("@/lib/billing/repository-operator");
  return readOrgBillingProfile(orgId);
}

function validEnvelope(value: OperatorCardFailureDispatchEnvelope): boolean {
  return value.channel === "email"
    && value.template === "operator_card_failure"
    && UUID.test(value.deliveryId)
    && UUID.test(value.orgId)
    && UUID.test(value.billingEventId)
    && value.subject === `org:${value.orgId}`
    && value.window === `billing-event:${value.billingEventId}`;
}

export async function dispatchOperatorCardFailureEmail(
  envelope: OperatorCardFailureDispatchEnvelope,
  dependencies: EmailDispatchDependencies = {
    driver: getEmailDriver(),
    readOrgBillingProfile: productionProfile,
  },
): Promise<EmailSendReceipt> {
  if (!validEnvelope(envelope)) throw new Error("EMAIL_DISPATCH_ENVELOPE_INVALID");

  const profileResult = await dependencies.readOrgBillingProfile(envelope.orgId);
  if (!profileResult.ok) throw profileResult.error;
  const profile = profileResult.value;
  if (
    profile === null
    || profile.name.trim() === ""
    || profile.ownerEmail === null
    || profile.ownerEmail.trim() === ""
  ) {
    throw new Error("EMAIL_ORG_PROFILE_UNAVAILABLE");
  }

  return dependencies.driver.send({
    to: profile.ownerEmail,
    template: "operator_card_failure",
    vars: { DELIVERY_REFERENCE: envelope.deliveryId },
    orgId: envelope.orgId,
  });
}
