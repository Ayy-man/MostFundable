export { createMockEmailDriver } from "./mock-driver.ts";
export { createResendEmailDriver, ResendEmailError } from "./resend-driver.ts";
export { createEmailDriver, getEmailDriver } from "./bootstrap.ts";
export { createEmailReceiptRepository } from "./repository.ts";
export {
  EMAIL_TEMPLATE_REGISTRY,
  buildCrsAlertPayload,
  buildProviderVariables,
  validateTemplateVariables,
} from "./templates.ts";
export type {
  EmailDriver,
  EmailDriverFactory,
  EmailDriverName,
  EmailSendInput,
  EmailSendReceipt,
  EmailTemplate,
  EmailTemplateDefinition,
  EmailTemplateRegistry,
  EmailTemplateVars,
} from "./types.ts";
export type { EmailReceiptRecord, EmailReceiptRepository } from "./repository.ts";
