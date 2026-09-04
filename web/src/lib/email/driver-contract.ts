import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { EMAIL_TEMPLATE_REGISTRY } from "./templates.ts";
import type {
  EmailDriver,
  EmailDriverName,
  EmailSendInput,
} from "./types.ts";
import type { EmailReceiptRepository } from "./repository.ts";

const DELIVERY_ID = "8a000000-0000-4000-8000-000000000201";
const RECEIPT_ID = "8a000000-0000-4000-8000-000000000501";
const ORG_ID = "8a000000-0000-4000-8000-000000000001";

interface ContractDependencies {
  readonly repository: EmailReceiptRepository;
  readonly resolveOrgDisplayName: (orgId: string) => Promise<string>;
}

export type EmailContractDriverFactory = (
  dependencies: ContractDependencies,
) => EmailDriver;

function supportedRequest(): EmailSendInput<"operator_card_failure"> {
  const published = Object.values(EMAIL_TEMPLATE_REGISTRY)
    .filter((definition) => definition.providerTemplate !== null)
    .map((definition) => definition.template)
    .sort();
  assert.deepEqual(
    published,
    [
      "consumer_analysis_complete",
      "consumer_application_update",
      "consumer_document",
      "consumer_enrollment_milestone",
      "consumer_monitoring_alert",
      "consumer_refresh_result",
      "consumer_stage_change",
      "consumer_team_message",
      "operator_card_failure",
    ],
    "the email catalog changed its published-template set without updating the driver contract",
  );
  // Every driver must carry the operator template; consumer templates only reach the resend
  // driver, which the consumer dispatcher gates on, so the shared contract stays on this one.
  const definition = EMAIL_TEMPLATE_REGISTRY.operator_card_failure;
  assert.deepEqual(definition.internalKeys, ["DELIVERY_REFERENCE"]);
  return {
    orgId: ORG_ID,
    template: definition.template,
    to: " Contract@Email.Test ",
    vars: Object.fromEntries(
      definition.internalKeys.map((key) => [key, DELIVERY_ID]),
    ) as { DELIVERY_REFERENCE: string },
  };
}

function pendingRepository(events: unknown[]): EmailReceiptRepository {
  return {
    async claim(input) {
      events.push(["claim", input]);
      return {
        attemptCount: 1,
        deliveryId: input.deliveryId,
        providerRef: null,
        receiptId: RECEIPT_ID,
        status: "pending",
        template: input.template,
      };
    },
    async accept(receiptId, providerRef) {
      events.push(["accept", receiptId, providerRef]);
      return {
        attemptCount: 1,
        deliveryId: DELIVERY_ID,
        providerRef,
        receiptId,
        status: "accepted",
        template: "operator_card_failure",
      };
    },
    async fail(receiptId, errorCode) {
      events.push(["fail", receiptId, errorCode]);
      return {
        attemptCount: 1,
        deliveryId: DELIVERY_ID,
        providerRef: null,
        receiptId,
        status: "failed",
        template: "operator_card_failure",
      };
    },
  };
}

export function runEmailDriverContract(
  makeDriver: EmailContractDriverFactory,
  expectedDriver: EmailDriverName,
): void {
  describe(expectedDriver + " email driver contract", () => {
    it("claims the catalog-published template and returns the interface receipt", async () => {
      const events: unknown[] = [];
      const result = await makeDriver({
        repository: pendingRepository(events),
        resolveOrgDisplayName: async () => "Contract Operator",
      }).send(supportedRequest());

      assert.equal((events[0] as unknown[])[0], "claim");
      assert.deepEqual((events[0] as unknown[])[1], {
        deliveryId: DELIVERY_ID,
        recipient: "contract@email.test",
        template: EMAIL_TEMPLATE_REGISTRY.operator_card_failure.template,
      });
      assert.equal((events[1] as unknown[])[0], "accept");
      assert.equal(result.driver, expectedDriver);
      assert.equal(result.receiptId, RECEIPT_ID);
      assert.equal(result.status, "accepted");
      assert.equal(result.attemptCount, 1);
      assert.ok(result.providerRef.length > 0);
    });

    it("returns an accepted durable receipt despite a transient send dependency failure", async () => {
      const providerRef = "accepted_" + RECEIPT_ID;
      const repository = pendingRepository([]);
      repository.claim = async () => ({
        attemptCount: 2,
        deliveryId: DELIVERY_ID,
        providerRef,
        receiptId: RECEIPT_ID,
        status: "accepted",
        template: "operator_card_failure",
      });
      repository.accept = async () => {
        throw new Error("accepted receipt was sent again");
      };

      const result = await makeDriver({
        repository,
        resolveOrgDisplayName: async () => {
          throw new Error("transient profile read must not invalidate an accepted receipt");
        },
      }).send(supportedRequest());

      assert.equal(result.providerRef, providerRef);
      assert.equal(result.attemptCount, 2);
    });

    it("rejects an invalid recipient before durable or provider activity", async () => {
      let activity = 0;
      const repository = pendingRepository([]);
      repository.claim = async () => {
        activity += 1;
        throw new Error("unexpected");
      };
      await assert.rejects(
        makeDriver({
          repository,
          resolveOrgDisplayName: async () => {
            activity += 1;
            return "Contract Operator";
          },
        }).send({ ...supportedRequest(), to: "invalid" }),
      );
      assert.equal(activity, 0);
    });
  });
}
