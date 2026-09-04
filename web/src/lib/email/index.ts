export { createMockEmailDriver } from "./mock-driver.ts";
export { createResendEmailDriver, ResendEmailError } from "./resend-driver.ts";
export { createEmailDriver, getEmailDriver } from "./bootstrap.ts";
export { createEmailReceiptRepository } from "./repository.ts";
export {
  CONSUMER_EMAIL_TEMPLATES,
  EMAIL_TEMPLATE_REGISTRY,
  buildCrsAlertPayload,
  buildProviderVariables,
  deliveryReference,
  isConsumerEmailTemplate,
  validateTemplateVariables,
} from "./templates.ts";
export type {
  ConsumerEmailTemplate,
  ConsumerEmailTemplateVars,
  EmailDriver,
  EmailDriverFactory,
  EmailDriverName,
  EmailSendInput,
  EmailSendReceipt,
  EmailTemplate,
  EmailTemplateCopy,
  EmailTemplateDefinition,
  EmailTemplateRegistry,
  EmailTemplateVars,
} from "./types.ts";
export type {
  EmailReceiptRecord,
  EmailReceiptRepository,
  PublishedEmailTemplate,
} from "./repository.ts";
