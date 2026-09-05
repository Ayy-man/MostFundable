import { buildProviderVariables, validateTemplateVariables } from "./templates.ts";
import { isPublishedEmailTemplate } from "./repository.ts";
import type { EmailReceiptRepository, PublishedEmailTemplate } from "./repository.ts";
import type { EmailDriver, EmailSendInput, EmailSendReceipt, EmailTemplate } from "./types.ts";

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
    // The mock shares Resend's published-template boundary, so local delivery exercises the same
    // catalog even though consumer dispatch normally stops at its configuration gate.
    async send<T extends EmailTemplate>(
      request: EmailSendInput<T>,
    ): Promise<EmailSendReceipt> {
      if (!UUID.test(request.orgId) || !isPublishedEmailTemplate(request.template)) {
        throw new Error("EMAIL_SEND_INPUT_INVALID");
      }
      const template: PublishedEmailTemplate = request.template;
      const vars = validateTemplateVariables(template, request.vars);
      buildProviderVariables(template, vars);
      const deliveryId = vars.DELIVERY_REFERENCE;
      const recipient = normalizeRecipient(request.to);
      const receipt = await input.repository.claim({
        deliveryId,
        template,
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
