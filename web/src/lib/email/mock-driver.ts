import { buildProviderVariables, validateTemplateVariables } from "./templates.ts";
import type { EmailReceiptRepository } from "./repository.ts";
import type { EmailDriver, EmailSendInput, EmailSendReceipt } from "./types.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAILBOX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeRecipient(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized.length < 3 || normalized.length > 320 || !MAILBOX.test(normalized)) {
    throw new Error("EMAIL_RECIPIENT_INVALID");
  }
  return normalized;
}

export function createMockEmailDriver(input: {
  readonly repository: EmailReceiptRepository;
}): EmailDriver {
  return {
    async send<T extends "operator_card_failure" | "crs_alert">(
      request: EmailSendInput<T>,
    ): Promise<EmailSendReceipt> {
      if (!UUID.test(request.orgId) || request.template !== "operator_card_failure") {
        throw new Error("EMAIL_SEND_INPUT_INVALID");
      }
      const vars = validateTemplateVariables("operator_card_failure", request.vars);
      buildProviderVariables("operator_card_failure", vars);
      const deliveryId = vars.DELIVERY_REFERENCE;
      const recipient = normalizeRecipient(request.to);
      const receipt = await input.repository.claim({
        deliveryId,
        template: "operator_card_failure",
        recipient,
      });
      if (receipt.status === "accepted" && receipt.providerRef !== null) {
        return {
          driver: "mock",
          receiptId: receipt.receiptId,
          providerRef: receipt.providerRef,
          status: "accepted",
          attemptCount: receipt.attemptCount,
        };
      }
      const accepted = await input.repository.accept(
        receipt.receiptId,
        `mock_email_${receipt.receiptId}`,
      );
      if (accepted.status !== "accepted" || accepted.providerRef === null) {
        throw new Error("EMAIL_RECEIPT_RESULT_INVALID");
      }
      return {
        driver: "mock",
        receiptId: accepted.receiptId,
        providerRef: accepted.providerRef,
        status: "accepted",
        attemptCount: accepted.attemptCount,
      };
    },
  };
}
